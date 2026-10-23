"""Explicit, bounded English lookup. Retrieved strings are data, never prompts.

No LLM, transcript access, disk/result cache, audio fetch or automatic fallback.
Only per-entry CC BY-SA Wiktionary text is accepted; see LEXICAL_LOOKUP.md.
"""
import asyncio
import json
import re
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from security import BLOCK_MESSAGE, PAUSE_MESSAGE

API = "https://api.dictionaryapi.dev/api/v2/entries/en/"
MAX_BYTES = 262144
MAX_SENSES = 24
LICENSES = {
    "https://creativecommons.org/licenses/by-sa/3.0": "CC BY-SA 3.0",
    "https://creativecommons.org/licenses/by-sa/4.0": "CC BY-SA 4.0",
}
SOURCE_NOTICE = (
    "Wiktionary contributors via Free Dictionary API: community-edited, not an "
    "authoritative clinical or slang reference. Coverage and usage labels may be "
    "incomplete. Synonyms belong only to their listed sense, not every use."
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_entries(term):
    """Fixed HTTPS host; no redirects, environment proxies, keys or chat headers."""
    request = Request(API + quote(term, safe=""), headers={
        "Accept": "application/json", "User-Agent": "TEN-Owner-Lexical-Lookup/1.0",
    })
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=6) as response:
        if response.headers.get_content_type() != "application/json":
            raise ValueError("Unexpected source format")
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Source response too large")
    return json.loads(raw)


def short_text(value, limit):
    if not isinstance(value, str):
        return ""
    # Strip controls, not words; React renders these strings as text, never HTML.
    value = "".join(c for c in value if unicodedata.category(c)[0] != "C")
    value = re.sub(r"\s+", " ", value).strip()
    return value if len(value) <= limit else value[:limit - 1] + "…"


def source_url(value):
    if not isinstance(value, str) or len(value) > 500:
        return None
    parsed = urlsplit(value)
    if (parsed.scheme == "https" and parsed.netloc == "en.wiktionary.org"
            and parsed.path.startswith("/wiki/") and not parsed.query
            and not parsed.fragment and not any(c.isspace() for c in value)):
        return value
    return None


def safe_text(text, guard):
    # Defense in depth: never turn retrieved instructions into model input.
    if guard.check_text(text, "input") or guard.check_text(text, "output"):
        return False
    if re.search(r"\b(?:porn\w*|erotic\w*|sexual roleplay)\b", text, re.I):
        return False
    if (re.search(r"\b(?:minor|underage|child|children|kid|teen\w*)\b", text, re.I)
            and re.search(r"\b(?:sex\w*|arous\w*|genital\w*)\b", text, re.I)):
        return False
    return True


def register_label(text):
    # Only quote an explicit leading usage annotation. Do not classify register
    # from a synonym or an adjective occurring inside an ordinary definition.
    match = re.match(r"^\(([^)]{1,100})\)\s+", text)
    if match and re.search(
        r"\b(?:slang|informal|colloquial|formal|vulgar|offensive|derogatory|"
        r"archaic|obsolete|dialectal|humorous)\b", match[1], re.I,
    ):
        return match[1] + " (source annotation)"
    return "Not supplied by source; check context."


def normalize_entries(entries, guard):
    """Keep only licensed, attributed, screened senses; never mix synonym scopes."""
    if not isinstance(entries, list):
        raise ValueError("Invalid source entries")
    senses, limited = [], False
    for entry in entries[:8]:
        if not isinstance(entry, dict):
            raise ValueError("Invalid source entry")
        license_data = entry.get("license")
        if not isinstance(license_data, dict):
            continue
        license_url = license_data.get("url")
        if not isinstance(license_url, str):
            continue
        license_url = license_url.rstrip("/")
        if license_url not in LICENSES:
            continue
        urls = entry.get("sourceUrls", [])
        if not isinstance(urls, list):
            continue
        sources = [url for value in urls[:8] if (url := source_url(value)) and safe_text(url, guard)]
        if not sources:
            continue
        meanings = entry.get("meanings", [])
        if not isinstance(meanings, list):
            raise ValueError("Invalid meanings")
        for meaning in meanings[:20]:
            if not isinstance(meaning, dict):
                raise ValueError("Invalid meaning")
            part = short_text(meaning.get("partOfSpeech"), 30) or "Not supplied"
            definitions = meaning.get("definitions", [])
            if not isinstance(definitions, list):
                raise ValueError("Invalid senses")
            for definition in definitions[:40]:
                if not isinstance(definition, dict):
                    raise ValueError("Invalid sense")
                text = short_text(definition.get("definition"), 450)
                if not text or not safe_text(part + " " + text, guard):
                    limited = True
                    continue
                raw_synonyms = definition.get("synonyms", [])
                if not isinstance(raw_synonyms, list):
                    raise ValueError("Invalid synonyms")
                synonyms = []
                for value in raw_synonyms[:40]:
                    synonym = short_text(value, 60)
                    if synonym and safe_text(synonym, guard) and synonym not in synonyms:
                        synonyms.append(synonym)
                senses.append({
                    "id": len(senses) + 1, "part_of_speech": part,
                    "definition": text, "register": register_label(text),
                    "synonyms": synonyms[:8], "sources": sources[:3],
                    "attribution": "Wiktionary contributors",
                    "license": LICENSES[license_url], "license_url": license_url,
                })
                if len(senses) >= MAX_SENSES:
                    return senses, True
    return senses, limited


def check_active(guard):
    if guard.disengaged() or guard.paused():
        raise ValueError(PAUSE_MESSAGE)


async def lookup(body, guard, fetcher=None):
    if set(body) - {"action", "term", "mode", "consent"}:
        raise ValueError("Lookup accepts only a term, mode and consent; never chat or notes.")
    if body.get("consent") is not True:
        raise ValueError("Confirm sending only this term to Free Dictionary API.")
    term = body.get("term")
    mode = body.get("mode", "definition")
    if not isinstance(mode, str) or mode not in ("definition", "synonyms", "slang"):
        raise ValueError("Choose definition, synonyms or slang.")
    if not isinstance(term, str):
        raise ValueError("Enter a short English word or phrase.")
    term = term.strip()
    check_active(guard)
    if guard.check_text(term):
        raise ValueError(BLOCK_MESSAGE)
    if not 1 <= len(term) <= 64 or not re.fullmatch(r"[A-Za-z]+(?:[ '-][A-Za-z]+){0,3}", term):
        raise ValueError("Use 1–4 English words, at most 64 characters; no URLs or private text.")
    if guard.begin():
        raise ValueError(PAUSE_MESSAGE if guard.paused() else "Please wait before another lookup.")
    result = {
        "status": "empty", "term": term, "mode": mode, "senses": [],
        "notice": SOURCE_NOTICE, "limited": False,
        "message": "No displayable licensed senses found. This does not mean the term has no meaning.",
        # Link only: no Urban Dictionary API call, content scraping or invented entry.
        "slang_url": "https://www.urbandictionary.com/define.php?term=" + quote(term, safe=""),
    }
    try:
        entries = await asyncio.to_thread(fetcher or fetch_entries, term.lower())
        result["senses"], result["limited"] = normalize_entries(entries, guard)
        if result["senses"]:
            result.update(status="ok", message="Retrieved from Free Dictionary API, not generated by TEN.")
    except HTTPError as error:
        if error.code != 404:
            result.update(status="unavailable", message="Dictionary provider unavailable or rate-limited. Try again later.")
    except (OSError, URLError, ValueError, TypeError, RecursionError):
        result.update(status="unavailable", message="Dictionary lookup unavailable or source response invalid. Try again later.")
    # A pause/dismissal while the request was in flight must discard the result.
    check_active(guard)
    guard.event("lexical", "allowed", result["status"])
    return result
