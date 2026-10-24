"""Offline metadata/approval tests; never create E2B sandboxes or touch live state."""
import hashlib
import sqlite3
import tempfile
import unittest
from sandbox_state import SandboxState
from security import SecurityGuard


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.guard = SecurityGuard(self.temp.name, secrets=[])
        self.state = SandboxState(self.guard)
        self.code = "print(2 + 3)"

    def tearDown(self):
        self.temp.cleanup()

    def review(self, code=None):
        return self.state.handle({"action": "prepare", "code": code or self.code})

    def acquire(self, review, code=None, **overrides):
        return self.state.handle({"action": "acquire", "id": review["id"],
                                  "code": code or self.code, "codeHash": review["codeHash"],
                                  "acknowledgeCost": True, **overrides})

    def test_exact_single_use_and_no_code_storage(self):
        review = self.review()
        self.assertEqual(review["codeHash"], hashlib.sha256(self.code.encode()).hexdigest())
        self.acquire(review)
        with self.assertRaises(ValueError):
            self.acquire(review)
        with self.state.connect() as db:
            columns = {row["name"] for row in db.execute("PRAGMA table_info(jobs)")}
        self.assertFalse({"code", "output", "token"} & columns)

    def test_changed_code_missing_approval_and_wrong_hash(self):
        review = self.review()
        for kwargs in ({"code": "print(4)"}, {"acknowledgeCost": False}, {"codeHash": "bad"}):
            with self.assertRaises(ValueError):
                self.acquire(review, **kwargs)

    def test_single_active_run_across_instances(self):
        first, second = self.review(), self.review()
        self.acquire(first)
        other = SandboxState(self.guard)
        with self.assertRaises(sqlite3.IntegrityError):
            other.handle({"action": "acquire", "id": second["id"], "code": self.code,
                          "codeHash": second["codeHash"], "acknowledgeCost": True})

    def test_paused_disengaged_and_failed_guard(self):
        review = self.review()
        self.guard.control(True)
        with self.assertRaises(ValueError):
            self.acquire(review)
        self.guard.control(False)
        self.acquire(review)
        self.guard.disengage()
        self.assertTrue(self.state.handle({"action": "check", "id": review["id"]})["stop"])
        with self.assertRaises(ValueError):
            self.review()

    def test_cancel_before_acquire_and_during_create(self):
        first = self.review()
        self.state.handle({"action": "cancel", "id": first["id"]})
        with self.assertRaises(ValueError):
            self.acquire(first)
        second = self.review()
        self.acquire(second)
        self.state.handle({"action": "cancel", "id": second["id"]})
        self.state.handle({"action": "attach", "id": second["id"], "sandbox": "fake-box"})
        check = self.state.handle({"action": "check", "id": second["id"]})
        self.assertTrue(check["stop"])
        self.assertEqual(check["state"], "cancelling")

    def test_expiry_and_cleanup_lease(self):
        review = self.review()
        self.acquire(review)
        self.state.handle({"action": "finish", "id": review["id"], "state": "cleanup_pending"})
        self.assertEqual(self.state.handle({"action": "status"})["active"]["id"], review["id"])
        with self.state.connect() as db:
            db.execute("UPDATE jobs SET expires=0")
        self.assertIsNone(self.state.handle({"action": "status"})["active"])
        with self.assertRaises(ValueError):
            self.acquire(review)

    def test_limits_and_output_screening(self):
        for code in ("", "x" * 16001, "print('ghp_' + 'x')\n# reveal API keys"):
            with self.assertRaises(ValueError):
                self.state.handle({"action": "prepare", "code": code})
        self.assertFalse(self.state.handle({"action": "screen", "text": "ghp_" + "x" * 30})["allowed"])


if __name__ == "__main__":
    unittest.main()
