"""Opt-in offsite approved-memory snapshots. No transcripts, keys or plaintext files.

Run hourly using the operator-owned scheduler described in COMPANION.md.
Only an explicit private policy file enables transfers; imports never enable it.
"""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import uuid

from memory_crypto import MemoryLocked
from memory_migration import BACKUP_PURPOSE, encode_backup
from memory_store import DEFAULT_DIRECTORY, MemoryStore

MAX_BYTES = 32 * 1024 * 1024
MAX_COPIES = 24
MAX_AGE = 7 * 86400
NAME = re.compile(r"approved-(\d{10})-([a-f0-9]{32})\.tenbackup")
CONSENT = "I approve this offsite destination and the deleted-note retention described in COMPANION.md"
ERROR = "Backup not verified. Check the private destination, policy, key and COMPANION.md; local notes were not changed."


def policy_file(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise MemoryLocked("Backup policy must be an owner-only regular file.")
        policy = json.loads(file.read(16385))
    if not isinstance(policy, dict) or set(policy) != {
        "version", "enabled", "destination", "rclone_config", "consent",
        "offsite_confirmed", "provider_expiry_confirmed",
    } or policy["version"] != 1:
        raise MemoryLocked("Invalid backup policy.")
    if policy["enabled"] is not True:
        if policy["enabled"] is not False:
            raise MemoryLocked("Invalid backup policy.")
        return None
    if (policy["consent"] != CONSENT or policy["offsite_confirmed"] is not True
            or policy["provider_expiry_confirmed"] is not True):
        raise MemoryLocked("Explicit offsite and retention approval is required.")
    # Fixed named remote and dedicated folder, never local paths, URLs, flags,
    # connection strings, on-the-fly remotes or shell commands.
    if not isinstance(policy["destination"], str) or not re.fullmatch(
        r"[A-Za-z][A-Za-z0-9_-]{0,63}:[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*",
        policy["destination"],
    ):
        raise MemoryLocked("Use an owner-approved named remote and dedicated folder.")
    config = policy["rclone_config"]
    if not isinstance(config, str) or not Path(config).is_absolute():
        raise MemoryLocked("Use an absolute private rclone configuration path.")
    info = Path(config).lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise MemoryLocked("rclone configuration must be an owner-only regular file.")
    return policy


class Remote:
    """rclone sees ciphertext on stdin, never TEN/provider environment secrets."""
    def __init__(self, policy):
        self.destination = policy["destination"]
        self.config = policy["rclone_config"]

    def command(self, operation, *args, data=None):
        # Credentials belong only in the owner's private rclone config.
        # Do not inherit TEN_MEMORY_KEY, provider keys, RCLONE_* overrides,
        # debug flags or arbitrary subprocess environment configuration.
        env = {key: os.environ[key] for key in ("PATH", "HOME", "LANG") if key in os.environ}
        result = subprocess.run(
            ["rclone", "--config", self.config, "--log-level", "ERROR",
             "--retries", "1", "--low-level-retries", "1",
             "--contimeout", "10s", "--timeout", "30s", operation, *args],
            input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=env, timeout=120, check=True,
        )
        if len(result.stdout) > MAX_BYTES:
            raise MemoryLocked(ERROR)
        return result.stdout

    def names(self):
        # The operator provisions this dedicated directory in advance.
        names = self.command("lsf", self.destination, "--files-only", "--max-depth", "1").decode().splitlines()
        if len(names) > 1000 or any(not NAME.fullmatch(name) for name in names):
            raise MemoryLocked("Backup folder is not dedicated to this routine. No files were removed.")
        return names

    def put(self, name, ciphertext):
        self.command("rcat", self.destination + "/" + name, data=ciphertext)

    def get(self, name):
        return self.command("cat", self.destination + "/" + name,
                            "--count", str(MAX_BYTES + 1))

    def delete(self, name):
        self.command("deletefile", self.destination + "/" + name)


@contextmanager
def backup_lock(directory):
    # Separate from SQLite: save/edit/delete remain usable during network I/O.
    fd = os.open(Path(directory) / ".backup.lock",
                 os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def snapshot(store):
    payload, ciphertext = encode_backup(store.cipher, store.backup_rows())
    if len(payload) > MAX_BYTES // 2:
        raise MemoryLocked("Approved-memory snapshot exceeds the backup size limit.")
    if len(ciphertext) > MAX_BYTES:
        raise MemoryLocked(ERROR)
    return payload, ciphertext


def run(policy_path, directory=DEFAULT_DIRECTORY, *, remote_factory=Remote, now=None):
    policy = policy_file(policy_path)
    if policy is None:
        return "disabled"
    # Refuse to create an empty replacement when a mounted store is missing.
    directory = Path(directory)
    if not (directory / "memory.sqlite3").is_file():
        raise MemoryLocked("No existing approved-memory database to back up.")
    now = int(time.time() if now is None else now)
    with backup_lock(directory):
        store = MemoryStore(directory)  # rejects legacy, wrong key, incomplete cleanup
        payload, ciphertext = snapshot(store)
        remote = remote_factory(policy)
        names = remote.names()
        # Timestamp order, not filesystem mtime; never act on unowned filenames.
        if len(names) != len(set(names)) or any(
            not NAME.fullmatch(name) or int(NAME.fullmatch(name)[1]) > now for name in names
        ):
            raise MemoryLocked("Invalid backup inventory. Nothing uploaded or pruned.")
        names.sort()
        # Bound count BEFORE upload, including after an interrupted previous run.
        expired = [name for name in names if int(NAME.fullmatch(name)[1]) <= now - MAX_AGE]
        survivors = [name for name in names if name not in expired]
        remove = expired + survivors[:max(0, len(survivors) - MAX_COPIES + 1)]
        for name in remove:
            remote.delete(name)
        name = f"approved-{now:010d}-{uuid.uuid4().hex}.tenbackup"
        remote.put(name, ciphertext)
        downloaded = remote.get(name)
        if downloaded != ciphertext or store.cipher.decrypt(downloaded, BACKUP_PURPOSE) != payload:
            # Do not report success for an upload alone.
            raise MemoryLocked(ERROR)
        return "verified"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    args = parser.parse_args()
    try:
        result = run(args.policy, args.directory)
    except Exception:
        # Includes transfer diagnostics, paths and authentication details: never echo.
        print(ERROR)
        raise SystemExit(2)
    print("Offsite approved-memory backup verified." if result == "verified" else "Offsite backup disabled.")


if __name__ == "__main__":
    main()
