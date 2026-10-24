"""Metadata-only execution leases. Never execute submitted code on the TEN host."""
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import uuid
from security import SecurityGuard

ACTIVE = ("starting", "running", "cancelling", "cleanup_pending")


class SandboxState:
    def __init__(self, guard=None):
        self.guard = guard or SecurityGuard()
        self.file = self.guard.directory / "sandbox.sqlite3"
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                  id TEXT PRIMARY KEY, hash TEXT NOT NULL, state TEXT NOT NULL,
                  expires INTEGER NOT NULL, sandbox TEXT, cancel INTEGER NOT NULL DEFAULT 0);
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_sandbox ON jobs((1))
                  WHERE state IN ('starting','running','cancelling','cleanup_pending');
            """)
        os.chmod(self.file, 0o600)

    def connect(self):
        db = sqlite3.connect(self.file, timeout=3)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def public(row):
        return {"id": row["id"], "state": row["state"], "expiresAt": row["expires"]}

    def allowed(self):
        return not (self.guard.paused() or self.guard.disengaged())

    def handle(self, body):
        action = body.get("action")
        now = int(time.time() * 1000)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE jobs SET state='expired', sandbox=NULL WHERE expires<?", (now,))
            db.execute("DELETE FROM jobs WHERE expires<?", (now - 600000,))
            if action == "status":
                row = db.execute("SELECT * FROM jobs WHERE state IN (?,?,?,?)", ACTIVE).fetchone()
                return {"paused": self.guard.paused(), "disengaged": self.guard.disengaged(),
                        "active": self.public(row) if row else None}
            if action == "screen":
                text = body.get("text", "")
                return {"allowed": isinstance(text, str) and not self.guard.check_text(text, "output")}
            identifier = body.get("id", "")
            if action == "prepare":
                code = body.get("code")
                if not self.allowed():
                    raise ValueError("TEN is paused or disengaged.")
                if not isinstance(code, str) or not code.strip() or len(code.encode()) > 16000:
                    raise ValueError("Python code must contain 1–16000 bytes.")
                if self.guard.check_text(code, "input"):
                    raise ValueError("Code did not pass TEN's safety checks.")
                if db.execute("SELECT COUNT(*) FROM jobs WHERE state='review'").fetchone()[0] >= 20:
                    raise ValueError("Too many recent reviews. Wait for them to expire.")
                identifier, digest, expires = str(uuid.uuid4()), hashlib.sha256(code.encode()).hexdigest(), now + 600000
                db.execute("INSERT INTO jobs(id,hash,state,expires) VALUES (?,?,'review',?)", (identifier, digest, expires))
                return {"id": identifier, "codeHash": digest, "expiresAt": expires}
            if not isinstance(identifier, str) or not re.fullmatch(r"[a-f0-9-]{36}", identifier):
                raise ValueError("Invalid run identifier.")
            row = db.execute("SELECT * FROM jobs WHERE id=?", (identifier,)).fetchone()
            if not row:
                raise ValueError("Run not found or expired.")
            if action == "acquire":
                code = body.get("code", "")
                if not self.allowed() or self.guard.check_text(code, "input"):
                    raise ValueError("TEN safety controls do not permit this run.")
                if row["state"] != "review" or row["expires"] < now:
                    raise ValueError("Review expired or already used. Review again.")
                if body.get("acknowledgeCost") is not True or body.get("codeHash") != row["hash"]:
                    raise ValueError("Explicit approval of the reviewed code and usage cost is required.")
                if hashlib.sha256(code.encode()).hexdigest() != row["hash"]:
                    raise ValueError("Code changed. Review it again.")
                db.execute("UPDATE jobs SET state='starting',expires=? WHERE id=?", (now + 120000, identifier))
                return {"id": identifier}
            if action == "cancel":
                state = "cancelling" if row["state"] in ACTIVE else "cancelled" if row["state"] == "review" else row["state"]
                db.execute("UPDATE jobs SET cancel=1,state=? WHERE id=?", (state, identifier))
                return {"id": identifier, "state": state}
            if action == "check":
                return {"stop": bool(row["cancel"]) or not self.allowed() or row["expires"] < now,
                        "sandbox": row["sandbox"], "state": row["state"]}
            if action == "attach":
                if row["state"] not in ACTIVE:
                    raise ValueError("Execution lease is no longer active.")
                sandbox = body.get("sandbox")
                if not isinstance(sandbox, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", sandbox):
                    raise ValueError("Invalid sandbox identifier.")
                db.execute("UPDATE jobs SET sandbox=?,state=? WHERE id=?",
                           (sandbox, "cancelling" if row["cancel"] else "running", identifier))
                return {"ok": True}
            if action == "finish":
                state = body.get("state")
                if state not in ("completed", "failed", "cancelled", "cleanup_pending"):
                    raise ValueError("Invalid completion state.")
                db.execute("UPDATE jobs SET state=?,sandbox=CASE WHEN ?='cleanup_pending' THEN sandbox ELSE NULL END WHERE id=?",
                           (state, state, identifier))
                return {"ok": True}
        raise ValueError("Unknown sandbox action.")


def main():
    try:
        raw = sys.stdin.buffer.read(100001)
        if len(raw) > 100000:
            raise ValueError("Request too large.")
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError("Object required.")
        print(json.dumps(SandboxState().handle(body)))
    except (ValueError, sqlite3.Error, OSError):
        # No raw code, credentials, database paths or provider errors in responses/logs.
        print(json.dumps({"error": "Sandbox control rejected the request. Check safety status, review, and run availability."}))
        sys.exit(1)


if __name__ == "__main__":
    main()
