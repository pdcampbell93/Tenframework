"""Local, deterministic guardrails. No network, model calls, or raw-text audit logs."""
import argparse
import base64
from collections import deque
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import unicodedata
try:
    from .companion_policy import content_rule, is_disengagement
except ImportError:  # Direct CLI/API subprocess.
    from companion_policy import content_rule, is_disengagement


DEFAULT_STATE_DIR = Path(__file__).resolve().parents[4] / ".ten-security"
BLOCK_MESSAGE = (
    "I can't safely help with that request. "
    "I can help with a nonviolent, privacy-respecting or educational alternative."
)
PAUSE_MESSAGE = "My responses are paused in TEN Security. Resume them there to continue."


class SecurityGuard:
    """Defense in depth, not a sandbox or a comprehensive injection detector."""

    def __init__(self, state_dir=None, allowed_tools=(), secrets=None):
        self.directory = Path(state_dir or DEFAULT_STATE_DIR)
        self.allowed_tools = frozenset(allowed_tools)
        self.secrets = tuple(
            value for value in (
                secrets if secrets is not None else (
                    os.environ.get(key, "") for key in (
                        "OPENAI_API_KEY", "DEEPGRAM_API_KEY",
                        "ELEVENLABS_TTS_KEY", "AGORA_APP_CERTIFICATE",
                    )
                )
            ) if len(value) >= 12
        )
        self.calls = deque()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS control
                  (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL);
                INSERT OR IGNORE INTO control VALUES (1, 0);
                CREATE TABLE IF NOT EXISTS events
                  (id INTEGER PRIMARY KEY, timestamp REAL NOT NULL,
                   stage TEXT NOT NULL, decision TEXT NOT NULL, rule TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS report
                  (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS companion_control
                  (id INTEGER PRIMARY KEY CHECK(id=1), disengaged INTEGER NOT NULL);
                INSERT OR IGNORE INTO companion_control VALUES (1, 0);
            """)
        os.chmod(self.directory / "security.sqlite3", 0o600)

    def connect(self):
        return sqlite3.connect(self.directory / "security.sqlite3", timeout=3)

    def paused(self):
        try:
            with self.connect() as db:
                row = db.execute("SELECT paused FROM control WHERE id=1").fetchone()
            return row is None or bool(row[0])
        except (OSError, sqlite3.Error):
            return True

    def event(self, stage, decision, rule):
        # Only internal fixed labels are passed here, never input/output/tool arguments.
        with self.connect() as db:
            db.execute(
                "INSERT INTO events(timestamp,stage,decision,rule) VALUES (?,?,?,?)",
                (time.time(), stage, decision, rule),
            )
            db.execute(
                "DELETE FROM events WHERE id NOT IN "
                "(SELECT id FROM events ORDER BY id DESC LIMIT 1000)"
            )

    def control(self, paused):
        with self.connect() as db:
            db.execute("UPDATE control SET paused=? WHERE id=1", (int(paused),))
            if not paused:
                db.execute("UPDATE companion_control SET disengaged=0 WHERE id=1")
        self.event("control", "paused" if paused else "resumed", "owner_control")

    def disengaged(self):
        try:
            with self.connect() as db:
                row = db.execute("SELECT disengaged FROM companion_control WHERE id=1").fetchone()
            return row is None or bool(row[0])
        except (OSError, sqlite3.Error):
            return True

    def disengage(self):
        with self.connect() as db:
            db.execute("UPDATE control SET paused=1 WHERE id=1")
            db.execute("UPDATE companion_control SET disengaged=1 WHERE id=1")
        self.event("control", "paused", "direct_disengagement")

    @staticmethod
    def normalized(text):
        text = unicodedata.normalize("NFKC", text)
        text = "".join(c for c in text if unicodedata.category(c) != "Cf")
        return re.sub(r"\s+", " ", text).strip()

    def check_text(self, text, stage="input"):
        """Return a fixed rule identifier on a block, otherwise None."""
        if len(text) > 32000:
            return "text_limit"
        if any(secret in text for secret in self.secrets):
            return "credential_exposure"
        if re.search(r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{24,})\b", text):
            return "credential_pattern"
        text = self.normalized(text)
        policy_rule = content_rule(text, stage)
        if policy_rule:
            return policy_rule
        if stage == "input":
            if re.search(
                r"\b(ignore|disregard|override|bypass|forget)\b.{0,70}"
                r"\b(previous|prior|system|developer|safety|security)\b.{0,35}"
                r"\b(instructions?|prompts?|rules?|checks?|safeguards?)\b",
                text, re.I,
            ):
                return "instruction_override"
            if re.search(
                r"\b(reveal|expose|dump|print|show|send|read)\b.{0,70}"
                r"\b(api[ _-]?keys?|environment variables?|system prompt|private keys?|credentials)\b",
                text, re.I,
            ):
                return "secret_request"
            # Bounded decoding of explicitly labelled payloads; never execute content.
            match = re.search(r"\bbase64\s*:\s*([A-Za-z0-9+/=]{12,4096})", text, re.I)
            if match:
                try:
                    decoded = base64.b64decode(match[1], validate=True).decode("utf-8")
                    # No recursive decoding: nested encodings remain a documented limitation.
                    if re.search(r"\b(ignore|reveal|dump|bypass)\b", decoded, re.I):
                        return "encoded_instruction"
                except (ValueError, UnicodeError):
                    pass
        return None

    def begin(self):
        if self.paused():
            return "paused"
        now = time.monotonic()
        while self.calls and now - self.calls[0] > 60:
            self.calls.popleft()
        if len(self.calls) >= 30:
            return "rate_limit"
        self.calls.append(now)
        return None

    def check_tool(self, name, arguments):
        if name not in self.allowed_tools:
            return "tool_not_allowed"
        # This first version intentionally permits no tools. Future schemas must
        # validate allowed arguments before any tool is added to the allowlist.
        if self.check_text(json.dumps(arguments), "output"):
            return "tool_secret"
        return None

    def snapshot(self):
        with self.connect() as db:
            rows = db.execute(
                "SELECT timestamp,stage,decision,rule FROM events ORDER BY id DESC LIMIT 60"
            ).fetchall()
            report = db.execute("SELECT body FROM report WHERE id=1").fetchone()
        return {
            "paused": self.paused(),
            "disengaged": self.disengaged(),
            "scope": "voice_assistant / openai_llm2_python",
            "allowed_tools": sorted(self.allowed_tools),
            "events": [
                dict(zip(("timestamp", "stage", "decision", "rule"), row))
                for row in rows
            ],
            "report": json.loads(report[0]) if report else None,
            "limits": [
                "Heuristic injection checks are bypassable; not enterprise-grade protection.",
                "Pause stops new model output at checkpoints, not audio already queued.",
                "Only the configured OpenAI voice-assistant path is protected.",
                "Other processes and anyone with Codespace write access are not sandboxed.",
                "Security audit contains labels only; upstream services may retain conversations.",
                "Dismissal is a persistent digital stop, not physical departure or person recognition.",
                "Other browsers observe a server dismissal when their next status poll succeeds.",
                "Companion content checks are conservative heuristics plus model instructions, not guarantees.",
            ],
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("status", "pause", "resume", "disengage", "selftest"))
    parser.add_argument("--state-dir")
    args = parser.parse_args()
    guard = SecurityGuard(args.state_dir)
    if args.action in ("pause", "resume"):
        guard.control(args.action == "pause")
    if args.action == "disengage":
        guard.disengage()
    if args.action == "selftest":
        from security_lab import run_suite
        report = run_suite()
        with guard.connect() as db:
            db.execute("INSERT OR REPLACE INTO report VALUES (1,?)", (json.dumps(report),))
        guard.event("test", "passed" if report["passed"] == report["total"] else "failed", "synthetic_suite")
    print(json.dumps(guard.snapshot()))


if __name__ == "__main__":
    main()
