"""Offline synthetic encryption/recovery tests; never reads live notes or keys."""
import base64
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from memory_crypto import MemoryCipher, MemoryLocked
import memory_migration as migration
from memory_store import MemoryStore, SCHEMA, EMBEDDING_MODEL
from test_companion import FakeClient

SYNTHETIC_KEY = base64.b64encode(b"E" * 32).decode()
OTHER_KEY = base64.b64encode(b"X" * 32).decode()
NOTE = "SYNTHETIC game spaceship uses silver portals."
VECTOR = json.dumps([1.0, 0.0])
HERE = Path(__file__).resolve().parent


class EncryptionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.key_env = patch.dict(os.environ, {
            "TEN_MEMORY_KEY": SYNTHETIC_KEY, "OPENAI_API_KEY": "",
            "DEEPGRAM_API_KEY": "", "ELEVENLABS_TTS_KEY": "", "AGORA_APP_CERTIFICATE": "",
        })
        self.key_env.start()
        self.addCleanup(self.key_env.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / "notes"
        self.client = FakeClient()

    def legacy(self, *, wal=False):
        self.directory.mkdir(mode=0o700)
        db = sqlite3.connect(self.directory / "memory.sqlite3")
        if wal:
            db.execute("PRAGMA journal_mode=WAL")
        db.execute(SCHEMA)
        db.execute("INSERT INTO memories VALUES(7,?,?,?,?,?)",
                   (NOTE, VECTOR, EMBEDDING_MODEL, 100.0, 200.0))
        db.commit()
        return db

    def assert_no_plaintext_files(self, directory=None):
        for file in (directory or self.directory).iterdir():
            if file.is_file():
                content = file.read_bytes()
                self.assertNotIn(NOTE.encode(), content, file.name)
                self.assertNotIn(VECTOR.encode(), content, file.name)
                self.assertNotIn(SYNTHETIC_KEY.encode(), content, file.name)
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)

    async def test_missing_invalid_key_never_creates_or_changes_database(self):
        for key in ("", "not-base64!", base64.b64encode(b"short").decode()):
            with patch.dict(os.environ, {"TEN_MEMORY_KEY": key}):
                with self.assertRaises(MemoryLocked):
                    MemoryStore(self.directory)
            self.assertFalse(self.directory.exists())
        store = MemoryStore(self.directory)
        await store.save(self.client, NOTE, approved=True)
        before = (self.directory / "memory.sqlite3").read_bytes()
        with patch.dict(os.environ, {"TEN_MEMORY_KEY": OTHER_KEY}):
            with self.assertRaises(MemoryLocked):
                MemoryStore(self.directory)
        self.assertEqual(before, (self.directory / "memory.sqlite3").read_bytes())

    async def test_encrypted_crud_reopen_search_and_deleted_during_embedding(self):
        store = MemoryStore(self.directory)
        created = await store.save(self.client, NOTE, approved=True)
        self.assert_no_plaintext_files()
        reopened = MemoryStore(self.directory)
        self.assertEqual(reopened.list()[0]["text"], NOTE)
        self.assertEqual((await reopened.search(self.client, "game"))[0]["id"], created["id"])
        await reopened.save(self.client, "SYNTHETIC quantum plan.", approved=True, memory_id=created["id"])
        self.assertEqual(await reopened.search(self.client, "game"), [])
        self.assertEqual(len(await reopened.search(self.client, "quantum")), 1)
        original = self.client.embeddings.create
        async def deleting(**kwargs):
            reopened.delete(created["id"])
            return await original(**kwargs)
        self.client.embeddings.create = deleting
        self.assertEqual(await reopened.search(self.client, "quantum"), [])
        self.assertEqual(reopened.list(), [])
        self.assert_no_plaintext_files()

    async def test_ciphertexts_randomized_and_row_field_metadata_swaps_rejected(self):
        store = MemoryStore(self.directory)
        await store.save(self.client, NOTE, approved=True)
        await store.save(self.client, NOTE, approved=True)
        with store.connect() as db:
            rows = db.execute("SELECT id,text,vector,model,created,updated FROM memories ORDER BY id").fetchall()
        self.assertNotEqual(rows[0][1], rows[1][1])
        variants = [
            (rows[0][0], rows[1][1], *rows[0][2:]),  # other row
            (rows[0][0], rows[0][2], rows[0][1], *rows[0][3:]),  # other field
            (*rows[0][:5], rows[0][5] + 1),  # altered timestamp
            (rows[0][0], "invalid ciphertext", *rows[0][2:]),
        ]
        for row in variants:
            with self.assertRaises(MemoryLocked):
                store.cipher.decrypt_row(row)
        with store.connect() as db:
            # Alter actual encrypted vector; list/search must not return partial notes.
            db.execute("UPDATE memories SET vector='damaged' WHERE id=1")
        with self.assertRaises(MemoryLocked):
            store.list()
        with self.assertRaises(MemoryLocked):
            await store.search(self.client, "game")

    async def test_legacy_blocked_until_explicit_acknowledged_migration(self):
        self.legacy().close()
        before = (self.directory / "memory.sqlite3").read_bytes()
        with self.assertRaisesRegex(MemoryLocked, "migration required"):
            MemoryStore(self.directory)
        with self.assertRaises(MemoryLocked):
            migration.migrate(self.directory)
        self.assertEqual(before, (self.directory / "memory.sqlite3").read_bytes())
        migration.migrate(self.directory, acknowledged=True)
        store = MemoryStore(self.directory)
        self.assertEqual(store.list(), [{"id": 7, "text": NOTE, "created": 100.0, "updated": 200.0}])
        self.assertEqual((await store.search(self.client, "game"))[0]["id"], 7)
        self.assert_no_plaintext_files()
        backup = next(self.directory.glob("*.tenbackup"))
        payload = json.loads(store.cipher.decrypt(backup.read_bytes(), migration.BACKUP_PURPOSE))
        self.assertEqual(payload["rows"][0], [7, NOTE, VECTOR, EMBEDDING_MODEL, 100.0, 200.0])
        migration.migrate(self.directory, acknowledged=True)
        self.assertEqual(len(list(self.directory.glob("*.tenbackup"))), 1)

    async def test_backup_write_or_verification_failure_leaves_legacy_intact(self):
        self.legacy().close()
        for target, failure in (
            ("memory_migration.write_backup", OSError("synthetic disk full")),
            ("memory_crypto.MemoryCipher.decrypt", MemoryLocked("synthetic backup verification failure")),
        ):
            with patch(target, side_effect=failure):
                with self.assertRaises((OSError, MemoryLocked)):
                    migration.migrate(self.directory, acknowledged=True)
            db = sqlite3.connect(self.directory / "memory.sqlite3")
            try:
                self.assertEqual(db.execute("SELECT text,vector FROM memories").fetchone(), (NOTE, VECTOR))
                self.assertFalse(db.execute("SELECT 1 FROM sqlite_master WHERE name='memory_encryption'").fetchone())
            finally:
                db.close()
        migration.migrate(self.directory, acknowledged=True)
        self.assertEqual(MemoryStore(self.directory).list()[0]["text"], NOTE)

    async def test_real_process_interruption_before_commit_is_recoverable(self):
        self.legacy().close()
        code = """
import os, sys
import memory_migration as m
from memory_crypto import MemoryCipher
original = MemoryCipher.encrypt_row
def interrupted(self, row):
    original(self, row)
    os._exit(73)
MemoryCipher.encrypt_row = interrupted
m.migrate(sys.argv[1], acknowledged=True)
"""
        result = subprocess.run([sys.executable, "-c", code, str(self.directory)],
                                cwd=HERE, capture_output=True)
        self.assertEqual(result.returncode, 73)
        self.assertTrue(list(self.directory.glob("*.tenbackup")))
        migration.migrate(self.directory, acknowledged=True)
        self.assertEqual(MemoryStore(self.directory).list()[0]["text"], NOTE)
        self.assert_no_plaintext_files()

    async def test_real_process_interruption_after_commit_locks_until_cleanup(self):
        self.legacy().close()
        code = """
import os, sys
import memory_migration as m
m.finish_cleanup = lambda *args: os._exit(74)
m.migrate(sys.argv[1], acknowledged=True)
"""
        result = subprocess.run([sys.executable, "-c", code, str(self.directory)],
                                cwd=HERE, capture_output=True)
        self.assertEqual(result.returncode, 74)
        with self.assertRaisesRegex(MemoryLocked, "cleanup interrupted"):
            MemoryStore(self.directory)
        before = (self.directory / "memory.sqlite3").read_bytes()
        with patch.dict(os.environ, {"TEN_MEMORY_KEY": OTHER_KEY}):
            with self.assertRaises(MemoryLocked):
                migration.migrate(self.directory, acknowledged=True)
        self.assertEqual(before, (self.directory / "memory.sqlite3").read_bytes())
        migration.migrate(self.directory, acknowledged=True)
        self.assertEqual(MemoryStore(self.directory).list()[0]["text"], NOTE)
        self.assert_no_plaintext_files()

    async def test_legacy_wal_truncated_and_plaintext_removed(self):
        connection = self.legacy(wal=True)
        try:
            migration.migrate(self.directory, acknowledged=True)
        except sqlite3.OperationalError:
            # A real old worker may retain a WAL connection; cleanup stays locked.
            with self.assertRaises(MemoryLocked):
                MemoryStore(self.directory)
        finally:
            connection.close()
        migration.migrate(self.directory, acknowledged=True)
        self.assertEqual(MemoryStore(self.directory).list()[0]["text"], NOTE)
        self.assert_no_plaintext_files()

    async def test_encrypted_backup_recovers_to_new_directory_without_plaintext_copy(self):
        self.legacy().close()
        migration.migrate(self.directory, acknowledged=True)
        backup = next(self.directory.glob("*.tenbackup"))
        destination = Path(self.temp.name) / "recovery"
        with patch.dict(os.environ, {"TEN_MEMORY_KEY": OTHER_KEY}):
            with self.assertRaises(MemoryLocked):
                migration.recover_backup(backup, destination, acknowledged=True)
        self.assertFalse(destination.exists())
        damaged = Path(self.temp.name) / "damaged.tenbackup"
        damaged.write_bytes(backup.read_bytes()[:-8] + b"tampered")
        with self.assertRaises(MemoryLocked):
            migration.recover_backup(damaged, destination, acknowledged=True)
        self.assertFalse(destination.exists())
        migration.recover_backup(backup, destination, acknowledged=True)
        self.assertEqual(MemoryStore(destination).list()[0]["text"], NOTE)
        self.assert_no_plaintext_files(destination)
        with self.assertRaises(FileExistsError):
            migration.recover_backup(backup, destination, acknowledged=True)

    async def test_key_never_in_api_error_or_provider_payload(self):
        from companion import handle
        from security import SecurityGuard
        store = MemoryStore(self.directory)
        guard = SecurityGuard(Path(self.temp.name) / "guard")
        # The new secret participates in credential screening before embeddings.
        with self.assertRaises(ValueError):
            await handle({"action": "save", "text": SYNTHETIC_KEY, "approved": True},
                         self.client, store, guard)
        self.assertEqual(self.client.calls, [])
        status = await handle({}, self.client, store, guard)
        self.assertNotIn(SYNTHETIC_KEY, json.dumps(status))
        with patch.dict(os.environ, {"TEN_MEMORY_KEY": OTHER_KEY}):
            with self.assertRaises(MemoryLocked) as error:
                MemoryStore(self.directory)
        self.assertNotIn(OTHER_KEY, str(error.exception))
        self.assertNotIn(SYNTHETIC_KEY, str(error.exception))

    async def test_actual_worker_protocol_returns_safe_missing_wrong_key_errors(self):
        import companion
        MemoryStore(self.directory)
        original = MemoryStore
        for value in ("", OTHER_KEY):
            output = io.StringIO()
            with patch.dict(os.environ, {"TEN_MEMORY_KEY": value}):
                with patch.object(companion, "MemoryStore", side_effect=lambda: original(self.directory)):
                    with patch("sys.stdin", io.StringIO('{"action":"status"}')), patch("sys.stdout", output):
                        with self.assertRaises(SystemExit) as stopped:
                            await companion.main()
            self.assertEqual(stopped.exception.code, 2)
            response = json.loads(output.getvalue())
            self.assertIn("Memory locked", response["error"])
            self.assertNotIn(SYNTHETIC_KEY, output.getvalue())
            self.assertNotIn(OTHER_KEY, output.getvalue())


if __name__ == "__main__":
    unittest.main()
