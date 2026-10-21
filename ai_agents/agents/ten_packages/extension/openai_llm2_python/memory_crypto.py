"""Versioned authenticated encryption. Keys never leave the server environment."""
import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_ENV = "TEN_MEMORY_KEY"
KEY_ERROR = "Memory locked: configure the original TEN_MEMORY_KEY Codespaces secret. Never paste it into chat."


class MemoryLocked(ValueError):
    """Safe, fixed messages suitable for the private owner UI."""


class MemoryCipher:
    def __init__(self):
        try:
            raw = base64.b64decode(os.environ.get(KEY_ENV, ""), validate=True)
            if len(raw) != 32:
                raise ValueError()
        except (ValueError, binascii.Error):
            raise MemoryLocked(KEY_ERROR) from None
        self._aead = AESGCM(raw)

    def encrypt(self, data, purpose):
        nonce = os.urandom(12)
        return base64.b64encode(
            b"TEN1" + nonce + self._aead.encrypt(nonce, data, purpose.encode())
        ).decode("ascii")

    def decrypt(self, encoded, purpose):
        try:
            raw = base64.b64decode(encoded, validate=True)
            if raw[:4] != b"TEN1" or len(raw) < 32:
                raise ValueError()
            return self._aead.decrypt(raw[4:16], raw[16:], purpose.encode())
        except (ValueError, TypeError, binascii.Error, InvalidTag):
            raise MemoryLocked("Memory locked: key mismatch or damaged encrypted data. Restore the original key or a verified backup.") from None

    @staticmethod
    def purpose(row, field):
        # Bind each field to its record and metadata; swapping rows/columns fails.
        import json
        memory_id, _, _, model, created, updated = row
        return "memory-field-v1:" + json.dumps(
            [memory_id, field, model, created, updated], separators=(",", ":")
        )

    def encrypt_row(self, row):
        memory_id, text, vector, model, created, updated = row
        return (
            memory_id,
            self.encrypt(text.encode(), self.purpose(row, "text")),
            self.encrypt(vector.encode(), self.purpose(row, "vector")),
            model, created, updated,
        )

    def decrypt_row(self, row):
        memory_id, text, vector, model, created, updated = row
        return (
            memory_id,
            self.decrypt(text, self.purpose(row, "text")).decode(),
            self.decrypt(vector, self.purpose(row, "vector")).decode(),
            model, created, updated,
        )
