"""Offline offsite-backup tests: synthetic notes, fake provider and remote only."""
import base64
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from memory_crypto import MemoryLocked
import memory_backup as backup
from memory_migration import recover_backup, BACKUP_PURPOSE
from memory_store import MemoryStore
from test_companion import FakeClient

KEY = base64.b64encode(b"B" * 32).decode()
NOW = 1800000000
NOTE = "SYNTHETIC approved game design note"


class FakeRemote:
    def __init__(self, policy):
        self.files = {}
        self.calls = []
        self.fail = None

    def names(self):
        return list(self.files)

    def put(self, name, ciphertext):
        self.calls.append("put")
        if self.fail == "upload":
            raise OSError("SYNTHETIC private provider details")
        self.files[name] = ciphertext

    def get(self, name):
        self.calls.append("get")
        if self.fail == "download":
            raise OSError("SYNTHETIC private provider details")
        return b"damaged" if self.fail == "tamper" else self.files[name]

    def delete(self, name):
        self.calls.append("delete")
        if self.fail == "delete":
            raise OSError("SYNTHETIC private provider details")
        del self.files[name]


class BackupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"TEN_MEMORY_KEY": KEY})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.directory = self.root / "notes"
        self.store = MemoryStore(self.directory)
        self.client = FakeClient()
        self.config = self.root / "rclone.conf"
        self.config.write_text("# synthetic; never used with a real network")
        self.config.chmod(0o600)
        self.policy = {
            "version": 1, "enabled": True, "destination": "owner:ten-backups",
            "rclone_config": str(self.config), "consent": backup.CONSENT,
            "offsite_confirmed": True, "provider_expiry_confirmed": True,
        }
        self.path = self.root / "policy.json"
        self.write_policy()
        self.remote = FakeRemote(self.policy)

    def write_policy(self):
        self.path.write_text(json.dumps(self.policy))
        self.path.chmod(0o600)

    def run_backup(self, now=NOW):
        return backup.run(self.path, self.directory, now=now,
                          remote_factory=lambda policy: self.remote)

    async def test_save_edit_import_delete_recover_independently(self):
        created = await self.store.save(self.client, NOTE, approved=True)
        self.assertEqual(self.run_backup(), "verified")
        await self.store.save(self.client, "SYNTHETIC edited game note",
                              approved=True, memory_id=created["id"])
        await self.store.import_note(self.client, "SYNTHETIC reviewed imported note", approved=True)
        self.run_backup(NOW + 1)
        latest = sorted(self.remote.files)[-1]
        local_copy = self.root / "download.tenbackup"
        local_copy.write_bytes(self.remote.files[latest])
        restored = self.root / "independent-recovery"
        recover_backup(local_copy, restored, acknowledged=True)
        recovered = MemoryStore(restored)
        self.assertEqual(recovered.list(), self.store.list())
        self.assertTrue(await recovered.search(self.client, "game"))
        with self.assertRaises(FileExistsError):
            recover_backup(local_copy, restored, acknowledged=True)
        self.store.delete(created["id"])
        for note in self.store.list():
            self.store.delete(note["id"])
        self.run_backup(NOW + 2)
        newest = sorted(self.remote.files)[-1]
        payload = json.loads(self.store.cipher.decrypt(self.remote.files[newest], BACKUP_PURPOSE))
        self.assertEqual(payload["rows"], [])
        # An empty snapshot supersedes deleted notes; older copies expire.
        self.run_backup(NOW + backup.MAX_AGE + 3)
        self.assertEqual(len(self.remote.files), 1)
        for ciphertext in self.remote.files.values():
            self.assertNotIn(NOTE.encode(), ciphertext)
            self.assertNotIn(KEY.encode(), ciphertext)
        for file in self.directory.iterdir():
            self.assertNotIn(NOTE.encode(), file.read_bytes())

    async def test_unapproved_save_never_backed_up(self):
        with self.assertRaises(ValueError):
            await self.store.save(self.client, NOTE)
        self.run_backup()
        data = next(iter(self.remote.files.values()))
        self.assertEqual(json.loads(self.store.cipher.decrypt(data, BACKUP_PURPOSE))["rows"], [])

    async def test_bounded_count_age_and_retry_after_interrupted_upload(self):
        for index in range(30):
            self.run_backup(NOW + index)
            self.assertLessEqual(len(self.remote.files), backup.MAX_COPIES)
        self.remote.fail = "tamper"
        with self.assertRaises(MemoryLocked):
            self.run_backup(NOW + 30)
        self.assertLessEqual(len(self.remote.files), backup.MAX_COPIES)
        self.remote.fail = None
        self.run_backup(NOW + 31)
        self.assertLessEqual(len(self.remote.files), backup.MAX_COPIES)
        self.run_backup(NOW + backup.MAX_AGE + 32)
        self.assertEqual(len(self.remote.files), 1)

    async def test_failed_upload_download_delete_never_report_verified(self):
        self.run_backup()
        for failure in ("upload", "download", "delete"):
            self.remote.fail = failure
            with self.assertRaises(OSError):
                self.run_backup(NOW + backup.MAX_AGE + 1 if failure == "delete" else NOW + 1)
        self.assertEqual(self.store.list(), [])

    async def test_disabled_missing_bad_policy_and_unapproved_destination(self):
        self.policy["enabled"] = False
        self.write_policy()
        with patch.object(backup, "MemoryStore", side_effect=AssertionError):
            self.assertEqual(self.run_backup(), "disabled")
        self.path.unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_backup()
        self.policy["enabled"] = True
        for field, value in (
            ("offsite_confirmed", False), ("provider_expiry_confirmed", False),
            ("consent", ""), ("destination", "/local"),
            ("destination", ":local:/tmp"), ("destination", "owner:../notes"),
            ("destination", "owner:folder --dump bodies"),
        ):
            original = self.policy[field]
            self.policy[field] = value
            self.write_policy()
            with self.assertRaises(MemoryLocked):
                self.run_backup()
            self.policy[field] = original
        self.assertEqual(self.remote.calls, [])

    async def test_policy_and_config_permissions_and_symlinks(self):
        for file in (self.path, self.config):
            file.chmod(0o644)
            with self.assertRaises(MemoryLocked):
                self.run_backup()
            file.chmod(0o600)
        moved = self.root / "moved"
        self.path.rename(moved)
        self.path.symlink_to(moved)
        with self.assertRaises(OSError):
            self.run_backup()

    async def test_wrong_key_missing_store_and_cleanup_pending_never_upload(self):
        with patch.dict(os.environ, {"TEN_MEMORY_KEY": base64.b64encode(b"C" * 32).decode()}):
            with self.assertRaises(MemoryLocked):
                self.run_backup()
        with self.store.connect() as db:
            db.execute("UPDATE memory_encryption SET cleanup_pending=1")
        with self.assertRaises(MemoryLocked):
            self.run_backup()
        with self.assertRaises(MemoryLocked):
            backup.run(self.path, self.root / "missing")
        self.assertEqual(self.remote.calls, [])

    async def test_unknown_or_future_inventory_is_not_deleted(self):
        for name in ("unrelated.txt", f"approved-{NOW+100:010d}-{'a'*32}.tenbackup"):
            self.remote.files = {name: b"synthetic"}
            with self.assertRaises(MemoryLocked):
                self.run_backup()
            self.assertIn(name, self.remote.files)
            self.assertEqual(self.remote.calls, [])

    async def test_lock_prevents_overlapping_jobs(self):
        with backup.backup_lock(self.directory):
            with self.assertRaises(BlockingIOError):
                self.run_backup()
        self.assertEqual(self.run_backup(), "verified")

    async def test_transport_is_ciphertext_only_without_inherited_keys(self):
        transport = backup.Remote(self.policy)
        with patch.dict(os.environ, {"RCLONE_DUMP": "bodies", "OPENAI_API_KEY": "synthetic-provider"}):
            with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"")) as runner:
                transport.put(f"approved-{NOW}-{'a'*32}.tenbackup", b"synthetic-ciphertext")
        args, kwargs = runner.call_args
        self.assertEqual(kwargs["input"], b"synthetic-ciphertext")
        self.assertNotIn("TEN_MEMORY_KEY", kwargs["env"])
        self.assertNotIn("OPENAI_API_KEY", kwargs["env"])
        self.assertNotIn("RCLONE_DUMP", kwargs["env"])
        self.assertNotIn("shell", kwargs)
        self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
        self.assertEqual(kwargs["timeout"], 120)
        self.assertIn("--config", args[0])

    async def test_wrong_key_and_damaged_offsite_copy_cannot_recover(self):
        self.run_backup()
        file = self.root / "remote-copy.tenbackup"
        file.write_bytes(next(iter(self.remote.files.values())))
        with patch.dict(os.environ, {"TEN_MEMORY_KEY": base64.b64encode(b"C" * 32).decode()}):
            with self.assertRaises(MemoryLocked):
                recover_backup(file, self.root / "wrong-key", acknowledged=True)
        file.write_bytes(b"corrupt")
        with self.assertRaises(MemoryLocked):
            recover_backup(file, self.root / "corrupt", acknowledged=True)
        self.assertFalse((self.root / "wrong-key").exists())
        self.assertFalse((self.root / "corrupt").exists())

    async def test_cli_failure_is_fixed_and_has_nonzero_exit_status(self):
        output = io.StringIO()
        with patch("sys.argv", ["memory_backup.py", "--policy", str(self.path)]):
            with patch.object(backup, "run", side_effect=OSError("SYNTHETIC secret provider detail")):
                with patch("sys.stdout", output):
                    with self.assertRaises(SystemExit) as stopped:
                        backup.main()
        self.assertEqual(stopped.exception.code, 2)
        self.assertEqual(output.getvalue().strip(), backup.ERROR)

    async def test_snapshot_size_limit_prevents_any_transfer(self):
        await self.store.save(self.client, NOTE, approved=True)
        with patch.object(backup, "MAX_BYTES", 10):
            with self.assertRaises(MemoryLocked):
                self.run_backup()
        self.assertEqual(self.remote.calls, [])


if __name__ == "__main__":
    unittest.main()
