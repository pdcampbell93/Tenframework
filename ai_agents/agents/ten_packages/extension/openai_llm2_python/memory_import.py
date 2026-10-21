"""Strict approved-note JSON import. Untrusted file data is never executed."""
import asyncio
from datetime import datetime
import json
import math
import re
import time
import unicodedata

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_NOTES = 500
MAX_BATCH = 10


def canonical_text(text):
    return " ".join(unicodedata.normalize("NFKC", text).split()).casefold()


def validate_text(text, guard):
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
        raise ValueError("Each approved note must contain 1–2000 characters.")
    normalized = guard.normalized(text)
    if guard.check_text(text) or guard.check_text(normalized) or re.search(
        r"-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----"
        r"|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"
        r"|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"
        r"|\b(?:password|passwd|api[_ -]?key|secret|access[_ -]?token|authorization)"
        r"""["']?\s*[:=]\s*\S+"""
        r"|\bBearer\s+[A-Za-z0-9._-]{16,}"
        r"|\b[a-z][a-z0-9+.-]*://[^\s/:]+:[^\s/@]+@",
        normalized, re.I,
    ):
        raise ValueError("Backup rejected: credentials or unsafe instructions are not allowed.")
    if re.search(r"(?:^|\n)\s*(?:user|assistant|system|developer)\s*:", text, re.I):
        raise ValueError("Backup rejected: conversation transcripts are not approved notes.")
    # Reject surrogate escapes and hidden binary/control content.
    if any(unicodedata.category(c) in ("Cs", "Cc") and c not in "\n\t\r" for c in text):
        raise ValueError("Backup rejected: invalid note characters.")
    return text.strip()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Backup rejected: duplicate JSON fields.")
        result[key] = value
    return result


def validate_backup(raw, guard):
    if not isinstance(raw, str):
        raise ValueError("Choose a TEN approved-note JSON export.")
    try:
        size = len(raw.encode("utf-8"))
    except UnicodeError:
        raise ValueError("Backup rejected: invalid UTF-8.") from None
    if size > MAX_FILE_BYTES:
        raise ValueError("Backup exceeds the 2 MiB file limit.")
    try:
        backup = json.loads(raw, object_pairs_hook=unique_object)
    except (json.JSONDecodeError, RecursionError):
        raise ValueError("Backup rejected: invalid JSON.") from None
    if not isinstance(backup, dict) or set(backup) != {"exported", "memories"}:
        raise ValueError("Only TEN approved-note exports are accepted, not transcripts or encrypted database backups.")
    exported = backup["exported"]
    try:
        if not isinstance(exported, str) or len(exported) > 40:
            raise ValueError()
        datetime.fromisoformat(exported.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Backup rejected: invalid export timestamp.") from None
    notes = backup["memories"]
    if not isinstance(notes, list) or len(notes) > MAX_NOTES:
        raise ValueError("Backup must contain at most 500 approved notes.")
    ids = set()
    validated = []
    for note in notes:
        if not isinstance(note, dict) or set(note) != {"id", "text", "created", "updated"}:
            raise ValueError("Backup rejected: unsupported note fields. Transcripts and vectors are not accepted.")
        if type(note["id"]) is not int or note["id"] < 1 or note["id"] in ids:
            raise ValueError("Backup rejected: invalid or repeated source IDs.")
        ids.add(note["id"])
        for field in ("created", "updated"):
            value = note[field]
            if type(value) not in (int, float) or not 0 <= value <= 253402300799 or not math.isfinite(value):
                raise ValueError("Backup rejected: invalid note timestamps.")
        validated.append(validate_text(note["text"], guard))
    return validated


def preview_backup(raw, store, guard):
    texts = validate_backup(raw, guard)
    existing = {canonical_text(note["text"]) for note in store.list()}
    seen = set()
    notes = []
    for index, text in enumerate(texts):
        key = canonical_text(text)
        status = "duplicate_existing" if key in existing else "duplicate_file" if key in seen else "new"
        notes.append({"index": index, "text": text, "status": status})
        seen.add(key)
    return {
        "notes": notes,
        "limits": {"file_bytes": MAX_FILE_BYTES, "notes": MAX_NOTES, "characters": 2000,
                   "batch": MAX_BATCH, "remaining": max(0, MAX_NOTES - len(store.list()))},
    }


async def import_selected(body, store, guard, client_factory):
    if body.get("approved") is not True or body.get("provider_consent") is not True:
        raise ValueError("Review selected notes and explicitly approve provider processing and API charges.")
    texts = body.get("texts")
    if not isinstance(texts, list) or not 1 <= len(texts) <= MAX_BATCH:
        raise ValueError("Select 1–10 notes per confirmation.")
    # Validate the entire selection before any provider request or write.
    texts = [validate_text(text, guard) for text in texts]
    results = []
    client = None
    deadline = time.monotonic() + 50
    for index, text in enumerate(texts):
        remaining = deadline - time.monotonic()
        if remaining <= 1:
            results.append({"index": index, "status": "not_attempted", "message": "Time limit reached; review and retry."})
            continue
        try:
            if any(canonical_text(note["text"]) == canonical_text(text) for note in store.list()):
                results.append({"index": index, "status": "duplicate", "message": "Already saved; skipped without embedding."})
                continue
            if len(store.list()) >= MAX_NOTES:
                results.append({"index": index, "status": "limit", "message": "500-note storage limit reached; nothing replaced."})
                continue
            client = client or client_factory()
            outcome = await asyncio.wait_for(store.import_note(client, text, approved=True), timeout=min(35, remaining))
            results.append({"index": index, **outcome})
        except Exception:
            # Never echo provider errors, raw file data, paths or credentials.
            results.append({"index": index, "status": "failed", "message": "Could not confirm this save. Retry safely; existing text is skipped."})
    return {"results": results, "memories": store.list()}
