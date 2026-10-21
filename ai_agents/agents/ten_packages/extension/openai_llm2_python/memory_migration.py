"""Explicit offline migration. Never prints data, keys, or exception details."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import uuid

from memory_crypto import MemoryCipher, MemoryLocked
from memory_store import (
    DEFAULT_DIRECTORY, SCHEMA, locked_database, initialize_encryption, check_encryption,
)

BACKUP_PURPOSE = "approved-memory-backup-v1"
ACK = "I understand key loss and backup consequences"


def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_backup(directory, cipher, rows):
    """Encrypt in RAM, durably write, then decrypt/compare before any DB change."""
    payload = json.dumps({"version": 1, "rows": rows}, ensure_ascii=False).encode()
    encrypted = cipher.encrypt(payload, BACKUP_PURPOSE).encode()
    path = directory / ("approved-before-migration-" + uuid.uuid4().hex + ".tenbackup")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as file:
        file.write(encrypted)
        file.flush()
        os.fsync(file.fileno())
    sync_directory(directory)
    if cipher.decrypt(path.read_bytes(), BACKUP_PURPOSE) != payload:
        raise MemoryLocked("Encrypted backup verification failed. Migration stopped.")
    return path


def finish_cleanup(db, directory):
    # The transaction has committed, but plaintext may remain in free/WAL pages.
    # A persisted flag keeps all API/voice access locked until cleanup succeeds.
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    mode = db.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
    if mode != "delete":
        raise MemoryLocked("Stop all TEN workers before resuming migration cleanup.")
    db.execute("VACUUM")
    db.execute("UPDATE memory_encryption SET cleanup_pending=0 WHERE id=1")
    db.commit()
    sync_directory(directory)


def migrate(directory=DEFAULT_DIRECTORY, *, acknowledged=False):
    if not acknowledged:
        raise MemoryLocked("Read COMPANION.md and acknowledge key loss and backup consequences before migration.")
    cipher = MemoryCipher()
    directory = Path(directory)
    if not (directory / "memory.sqlite3").is_file():
        raise MemoryLocked("No existing memory database. Normal startup creates an encrypted store.")
    with locked_database(directory) as db:
        encrypted = db.execute("SELECT 1 FROM sqlite_master WHERE name='memory_encryption'").fetchone()
        if encrypted:
            pending = check_encryption(db, cipher, allow_cleanup=True)
            if pending:
                finish_cleanup(db, directory)
            return
        # Lock the legacy DB against old workers too. Do not run old code again.
        db.execute("BEGIN EXCLUSIVE")
        rows = db.execute("SELECT id,text,vector,model,created,updated FROM memories ORDER BY id").fetchall()
        write_backup(directory, cipher, rows)
        initialize_encryption(db, cipher)
        for row in rows:
            encrypted_row = cipher.encrypt_row(row)
            db.execute("UPDATE memories SET text=?,vector=? WHERE id=?",
                       (encrypted_row[1], encrypted_row[2], row[0]))
        # Verify all records before committing. Any interruption rolls back.
        actual = db.execute("SELECT id,text,vector,model,created,updated FROM memories ORDER BY id").fetchall()
        if [cipher.decrypt_row(row) for row in actual] != rows:
            raise MemoryLocked("Migration verification failed; transaction rolled back.")
        db.execute("UPDATE memory_encryption SET cleanup_pending=1 WHERE id=1")
        db.commit()
        finish_cleanup(db, directory)


def recover_backup(backup, destination, *, acknowledged=False):
    """Recover into a NEW directory only; never write a decrypted SQLite copy."""
    if not acknowledged:
        raise MemoryLocked("Read COMPANION.md and acknowledge key loss and backup consequences before recovery.")
    cipher = MemoryCipher()
    try:
        payload = json.loads(cipher.decrypt(Path(backup).read_bytes(), BACKUP_PURPOSE))
        if payload["version"] != 1 or not isinstance(payload["rows"], list):
            raise ValueError()
        rows = [cipher.encrypt_row(row) for row in payload["rows"]]
    except MemoryLocked:
        raise
    except Exception:
        raise MemoryLocked("Invalid encrypted backup. Recovery stopped.") from None
    destination = Path(destination)
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    with locked_database(destination) as db:
        db.execute(SCHEMA)
        initialize_encryption(db, cipher)
        db.executemany("INSERT INTO memories VALUES(?,?,?,?,?,?)", rows)
    sync_directory(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument("--acknowledge", choices=[ACK], required=True)
    parser.add_argument("--restore-backup", type=Path)
    args = parser.parse_args()
    try:
        if args.restore_backup:
            recover_backup(args.restore_backup, args.directory, acknowledged=True)
        else:
            migrate(args.directory, acknowledged=True)
        print("Encrypted memory operation verified. Keep the original key and encrypted backups safe.")
    except (MemoryLocked, OSError, sqlite3.Error):
        # Paths, DB errors and provider details must not expose private data.
        print("Memory operation stopped safely. Check the original key, permissions and recovery instructions in COMPANION.md.")
        raise SystemExit(2)


if __name__ == "__main__":
    main()
