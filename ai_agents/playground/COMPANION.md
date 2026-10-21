# TEN companion, memory, and optional gaze

## Conversation and references

`/companion` provides text chat with 24 recent transient messages, editable
local writing suggestions, and curated reference notes for quantum mechanics,
engineering, entanglement, circuits, binary coding, and sensor limitations.
These are retrieval context, not model retraining or a live authoritative search.
References link to IBM Quantum Learning, NIST, Python, and MediaPipe documentation.

Text chat uses the existing OpenAI account. Summaries are suggested after four
user turns or on demand; they are editable, browser-memory-only drafts.
Nothing becomes long-term memory until the user explicitly approves a save.
Voice transcripts are not imported into text chat or draft summaries.

## Approved memory

Approved text is sent to OpenAI's `text-embedding-3-small` (512 dimensions)
and stored with its real vector in a separate SQLite database under
`ai_agents/.ten-memory/`, which is Git-ignored and private to the Codespace.
Cosine similarity retrieves up to four related notes. This is a small personal
vector store, not an external managed vector database. It supports up to 500
notes, each up to 2000 characters. Recent context and retrieval are bounded.

Approved text and vectors use **AES-256-GCM authenticated encryption** from
the maintained Python `cryptography` library. Each field has a fresh random
nonce and is bound to its record ID, field name, model, and timestamps.
IDs, timestamps, model names, schema, and note counts remain visible.
Missing/malformed/wrong keys, damaged ciphertext, legacy plaintext stores, and
unfinished migration cleanup lock memory access; there is no plaintext fallback.
Keep Codespaces ports private, restrict repository/Codespace access, and do not save secrets.
OpenAI receives text for chats, summaries, embeddings, and recall queries under
the account's provider terms. Provider requests may incur charges.

The UI supports reviewed save, edit/re-embedding, semantic search, export of
approved notes, and confirmed deletion. Deletion removes text and its vector
from the active SQLite database with secure-delete enabled; it cannot recall
information already sent to a provider or erase external backups.
Exported files contain personal data; protect them accordingly.

### Read before enabling encryption or migrating

**Losing `TEN_MEMORY_KEY` permanently loses access to encrypted notes AND encrypted
backups. Replacing/deleting the secret does not recover or rotate existing data.**
Keep an independent recovery copy in a password manager or other secure offline
storage, outside this repository and Codespace. A backup stored only in the
Codespace is lost when that Codespace is deleted. Copy the `.tenbackup` file to
separate secure storage too. Old plaintext exports, database copies, snapshots,
Git history, and provider records are not retroactively encrypted by migration.
Deletion does not erase retained backups; establish your own retention policy.

Encryption protects stored note fields, not a running compromised Codespace:
the server decrypts approved notes in RAM for the authorized UI, search and voice.
The authorized API intentionally returns note text, **never the key**. Providers
still receive approved text/queries as described above. Do not enable raw request,
environment, or SDK debug logging. Application keys must not be put in graph
properties (which can be serialized), `.env`, source code, prompts, browser
storage, chat, logs, or API responses.

1. Stop TEN UI/API/voice workers before changing code or migrating. Do not run
   old, plaintext-capable workers again against the migrated database.
2. Create a new random **32-byte key encoded as standard Base64** in a trusted
   password manager/secure local tool; save the independent recovery copy first.
   In GitHub **Settings → Codespaces → Secrets → New secret**, add
   `TEN_MEMORY_KEY` and grant access only to the TEN repository. Do not send the
   value through Replit chat or add it as a `NEXT_PUBLIC_` variable.
3. Restart the Codespace to receive the secret. Verify *presence only* in a login
   shell (never run `env`, `printenv`, shell tracing, or echo the key).
   Both Next's server and TEN's API/voice launcher must inherit the secret.
   No graph config change is needed: the voice worker inherits server environment.
4. Install the updated Python extension requirements with your existing TEN
   dependency setup (including `cryptography>=46.0.0`). The unrelated Replit API
   and Canvas do not serve this app.
5. For an existing SQLite store, from the TEN repository root, run:

   ```sh
   GUARD=ai_agents/agents/ten_packages/extension/openai_llm2_python
   python3 "$GUARD/memory_migration.py" \
     --acknowledge 'I understand key loss and backup consequences'
   ```

   This is an explicit local operator action, never automatic on startup or an
   API action. It writes a uniquely named, mode-600 authenticated encrypted backup
   under `ai_agents/.ten-memory/`, fsyncs and decrypt-verifies it before rewriting
   any rows. Text AND vectors, IDs, models and timestamps are preserved.
   Each row is round-trip verified before the transaction commits. A failure
   before commit rolls back the original database; retry with the same key.
   A crash after commit leaves a cleanup marker and locks memory access until
   rerunning the same command completes WAL truncation and SQLite vacuum.
   The command is safe to rerun after success. Never delete the original DB to
   bypass an error. An empty/new installation initializes encrypted storage
   directly once the key is configured.
6. Copy the verified encrypted backup outside the Codespace. Confirm all
   forwarded ports (3000, 8080, 49483, 49484 and any additional ports) show
   **Private** in Codespaces' Ports panel. No public access is needed or enabled
   by this change. Restart the UI, API and voice workers in a login shell,
   review notes, and confirm recall. Reconnect the phone/voice session.

Migration uses SQLite secure-delete, WAL truncation and vacuum to remove
plaintext from the active database and its journals, but cannot promise physical
erasure on cloud disks, snapshots, or previously made copies. It can temporarily
need room for the backup, rollback journal, and vacuum copy; keep enough free disk
space. Keep workers stopped if migration/cleanup fails and retry after correcting
disk/permission issues. Never reset or generate another key as a troubleshooting step.

### Interrupted migration or damaged database

Retry migration with the **same original key** first. The pre-migration
`.tenbackup` is independently authenticated and contains all approved rows.
If SQLite itself is damaged, recover into a **new, nonexistent directory**:

```sh
python3 "$GUARD/memory_migration.py" \
  --restore-backup /secure/path/approved-before-migration-REPLACE.tenbackup \
  --directory /secure/path/recovered-memory \
  --acknowledge 'I understand key loss and backup consequences'
```

Recovery decrypts only in RAM, writes encrypted rows and refuses to overwrite a
destination. With all workers stopped, verify recovered notes locally with
`MemoryStore(directory=...)`, then move the old directory aside privately and
put the verified recovery directory at `ai_agents/.ten-memory/`. Keep both until
verified. Never print notes to shared logs. JSON-export import is a separate
feature; this recovery accepts only the migration's encrypted backup format.
There is no automatic key rotation: retain the original key and backups.

The protected voice-assistant OpenAI path retrieves the same approved notes
and references. Reconnect an existing voice worker after installing this
version. No voice transcript is automatically saved long-term. Retrieval errors
are disclosed or omitted safely, never replaced with fabricated memories.

## Optional camera and fictional effects

`/simulation` adds fictional light shaping and shadow bending. Camera access
is off until explicitly enabled, requests video only, and runs MediaPipe face
and iris landmark estimation locally. Model/WASM assets download from Google's
model storage and jsDelivr. Frames are not uploaded or stored by this feature.
Use calibration and adequate lighting; glasses, occlusion, head pose, photographs,
and model bias can make estimates unreliable.

This is approximate gaze direction—not EEG, awareness, intent, liveness,
diagnosis, or a safety assessment. It must not be used while driving or for
medical/safety decisions. The optional face-loss pause only affects animation;
it never resumes automatically and is no substitute for attention or supervision.
Camera tracks are stopped on off, hidden tab, and unmount. Touch controls remain.

An iPhone alone cannot provide EEG or general RF sensing. External hardware,
a supported connection/bridge, and a separate integration are required.
No real EEG/RF device is connected or simulated data represented as measurements.

## Verification

Run `python3 ai_agents/agents/ten_packages/extension/openai_llm2_python/test_companion.py`
and `python3 ai_agents/agents/ten_packages/extension/openai_llm2_python/test_memory_encryption.py`,
plus the existing `test_security_adapter.py` from the Codespace. They use fake providers and
temporary databases, never private conversations, saved notes, or paid calls.
With playground dev dependencies installed, also run
`cd ai_agents/playground && node src/app/api/companion/route.test.cjs` for
server-only key forwarding, no-store responses and same-origin regression checks.
