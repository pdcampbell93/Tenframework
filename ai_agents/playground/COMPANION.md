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
feature; this recovery accepts the authenticated `.tenbackup` format shared by
migration and ongoing backups.
There is no automatic key rotation: retain the original key and backups.

The protected voice-assistant OpenAI path retrieves the same approved notes
and references. Reconnect an existing voice worker after installing this
version. No voice transcript is automatically saved long-term. Retrieval errors
are disclosed or omitted safely, never replaced with fabricated memories.

## Restore a reviewed JSON export

Use **Import approved-note JSON** beside **Export JSON** in `/companion`.
This is separate from encrypted `.tenbackup` disaster recovery above. It works
only with TEN's plaintext `{exported, memories}` approved-note export. Protect
exports independently; importing does not encrypt or remove the original file.

1. Choose a UTF-8 `.json` file up to **2 MiB**, containing at most **500 notes**
   of **1–2000 characters** each. The entire file must validate before preview.
   Transcripts, vectors, unknown fields, duplicate JSON keys, invalid IDs/dates,
   credential patterns and safeguard overrides are rejected, not silently dropped.
   Credential/transcript detection is defensive pattern screening, not a proof
   that arbitrary prose contains no sensitive data: review every selected note.
2. Review the plain-text preview. Nothing is preselected or saved. Existing
   matches and repeated file text are marked and cannot be selected.
   Matching ignores case, Unicode compatibility differences and repeated
   whitespace; it does not merge similar meaning or changed wording.
3. Select up to **10 notes per confirmation**, within the **500 stored-note**
   limit. Confirm that you reviewed those notes and accept OpenAI processing and
   possible API charges, then press **Approve & import**. Only selected text is
   re-embedded with `text-embedding-3-small`; imported vectors are never trusted.
   Preview uses the private TEN server, without provider calls.
4. Review each result: saved, duplicate, failed, limit, or not attempted.
   Each successful note is durably saved independently. The batch has a bounded
   time budget; later notes may be left unattempted. Failures stay selected for
   a new review/confirmation. If the connection is interrupted, keep/reopen the
   same file and retry; current matching saved text is skipped before embedding.
   An embedding failure/timeout can still incur provider charges. Concurrent
   imports can both start an embedding, but the final locked insert checks text
   again so only one copy is stored. If a note is subsequently edited/deleted,
   its old export text is no longer a current duplicate and can be imported anew.

Imported notes always get fresh local IDs/timestamps; existing notes are never
updated, replaced or deleted. Text and new vectors use the existing encryption
key/store. Imported notes join the normal approved-note retrieval path; this
does not create another voice client, store transcripts, auto-save summaries or
change private Codespaces access. Keep all forwarded ports **Private**.
Cancel/discard clears the import preview from page state. No file is persisted
by the importer, although the selected local file and original export remain
on your device. Do not import secrets or private conversations.

## Optional ongoing offsite encrypted backups

The pre-migration backup is a one-time snapshot, **not** ongoing protection.
`memory_backup.py` is a separate opt-in operator routine, not JSON import/restore
and not a conversation recorder. It snapshots the current approved-memory table
under its writer lock, including later reviewed saves, edits, imports and
deletions. It does not read chat history, draft summaries, voice transcripts,
provider logs or exported JSON files. Text and vectors are authenticated with
the existing AES-256-GCM key entirely in RAM. Only `.tenbackup` ciphertext leaves
the Codespace. The key is not passed to the transfer process. Filename time,
file size and backup frequency remain visible to the destination.

**Default is OFF. No destination is chosen or contacted by installing this
change.** A missing policy is an error, not implicit consent. Never paste keys,
decrypted notes, private conversations or credentials into a policy, repository,
issue, chat, transfer URL or command line.

### Owner setup and retention consent

1. Complete encrypted-memory setup/migration above; keep an independent secure
   recovery copy of the **original key**. Losing it makes backups unreadable.
2. Install `rclone` using your Codespace's normal package management, and create
   a private named remote for a destination **you own and approve outside the
   Codespace**. This routine does not provision accounts or request credentials.
   Configure credentials directly with the provider/rclone; use a dedicated,
   least-privilege account and owner-only (`0600`) absolute config file outside
   the repository. It must work unattended without inheriting TEN/provider keys,
   `RCLONE_*` variables, an interactive config-password prompt or SSH-agent env.
   Use authenticated encrypted transport (for example S3 HTTPS); do not use a
   local/memory remote, Codespace disk, public bucket, FTP, or a public share.
3. Provision a **dedicated empty folder/prefix** such as
   `ownerbackup:private-bucket/ten-approved`. Do not share it with migration
   snapshots or unrelated files. Unknown filenames cause the job to stop.
   Use one scheduler/Codespace per prefix; the lock is local, not distributed.
4. Set and verify **provider-side expiry of seven days or less** for this
   prefix, including noncurrent versions, soft-deleted/trash copies and
   incomplete uploads. Disable version history/object lock/immutable retention
   if they prevent that expiry. Provider purge may be delayed by the provider's
   lifecycle granularity: read its terms and approve that delay. Do not enable
   if the destination cannot supply an acceptable deletion policy.
   `provider_expiry_confirmed` is your attestation, **not an API check**;
   this routine cannot audit the provider's hidden backups or guarantee erasure.
5. Create an owner-only (`0600`) policy **outside the repository**. Replace the
   two example paths below with your approved remote and actual private config:

   ```json
   {
     "version": 1,
     "enabled": true,
     "destination": "ownerbackup:private-bucket/ten-approved",
     "rclone_config": "/home/vscode/.config/rclone/rclone.conf",
     "consent": "I approve this offsite destination and the deleted-note retention described in COMPANION.md",
     "offsite_confirmed": true,
     "provider_expiry_confirmed": true
   }
   ```

   The policy is bound to the exact destination/config named in it. If these
   change, recheck ownership, transport and expiry, and approve the new policy.

**Retention:** every successful run keeps at most 24 snapshots, removes snapshots
seven days old or older, and uploads at most one new snapshot (32 MiB maximum).
Count/age pruning happens **before** upload; if the new upload fails you may have
fewer recovery points. Expired snapshots are not kept as a silent fallback.
The routine never automatically deletes local pre-migration backups or JSON
exports; review and remove those separately when no longer needed.

**Deleted notes and edits:** deletion affects the active store immediately, but
older snapshots can still recover the deleted note or earlier text until expiry.
Restoring an older snapshot can resurrect deleted notes: inspect the restored
store before enabling recall. If the Codespace stops, its schedule and pruning
stop too; provider-side expiry is the independent expiry mechanism. If that
policy is removed/misconfigured, remote copies can remain indefinitely.
Turning backups off does **not** purge existing copies. For immediate removal,
stop the schedule, delete all snapshots in the dedicated prefix and purge
provider versions/trash; manually downloaded copies require separate deletion.
No application can erase information already sent to a provider.

### Schedule, verify, disable

From the repository root, with the existing `TEN_MEMORY_KEY` supplied privately
by the Codespaces environment, run:

```sh
python3 ai_agents/agents/ten_packages/extension/openai_llm2_python/memory_backup.py \
  --policy /home/vscode/.config/ten/backup-policy.json
```

Use `--directory /absolute/path/to/.ten-memory` only if the active approved store
is elsewhere. A missing store is an error, not a new empty store. No migration
or live worker restart is performed. Saves are not blocked by remote transfer
and a backup failure never rolls back an approved note.

The command returns 0 only for a verified backup or an explicitly disabled
policy; failure returns 2 with a fixed message, never provider diagnostics.
Verification downloads the uploaded ciphertext, compares bytes and authenticates
and compares the payload in RAM. An upload alone is not reported as success.
Interrupted uploads may leave unverified files; the next run prunes them by the
same count/age rules. Failed verification does not make that file a recovery
point. No decrypted temporary file is created.

To enable ongoing protection, register this same one-shot command with your
owner-managed scheduler **hourly while the Codespace is running**, using a login
shell that receives the Codespaces secret. For a manual foreground alternative:

```sh
while true; do
  python3 ai_agents/agents/ten_packages/extension/openai_llm2_python/memory_backup.py \
    --policy /home/vscode/.config/ten/backup-policy.json
  sleep 3600
done
```

Do not put the key itself in a crontab, service unit or script. Do not assume a
cron daemon inherits Codespaces secrets; first verify a one-shot run through
that scheduler succeeds. Monitor its exit status and last verified-run time:
there is no UI alert or always-on external scheduler in this change.
Hourly protection has up to an hour of data-loss exposure plus transfer time;
if the Codespace/schedule is stopped or a run fails, exposure lasts until the
next verified run. An edit followed by deletion between runs will not be backed
up (intentionally). Run once manually after important saves if needed.

To disable, stop the scheduler and set `"enabled": false` in the policy. This
stops all transfer/pruning, not local saves or recall. Keep independent provider
expiry in place or explicitly purge remote copies as described above.

### Recovery drill (synthetic data only)

Run `python3 ai_agents/agents/ten_packages/extension/openai_llm2_python/test_memory_backup.py`
before activation. It uses a temporary synthetic key, fake provider and fake
offsite storage to verify save/edit/import/delete snapshots, independent recovery
into a new encrypted store, semantic recall, count/age limits, failures and key/
tamper rejection. It never contacts a remote or reads the live notes/key.

Before trusting your actual remote, repeat a drill with a **separate synthetic
store, separate temporary key, separate dedicated test prefix and separate
policy**. Never substitute a production key or copy a live database into a
test. Confirm upload/download verification and provider expiry, and retrieve a
synthetic `.tenbackup` with rclone into a private directory outside the repo.
Use the existing `memory_migration.py --restore-backup` recovery command above
with that synthetic key and a **new** destination directory. Inspect the
recovered synthetic notes and test recall. Purge test objects/versions and
discard the synthetic key afterward. This operator/provider drill is not
claimed to have run by the offline tests.

Real recovery uses the original key and the same authenticated recovery command;
it refuses to overwrite an existing directory and writes encrypted text/vectors.
Keep recovered notes private. A plaintext JSON export is not a `.tenbackup`
and is not accepted by this routine.

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
plus `python3 ai_agents/agents/ten_packages/extension/openai_llm2_python/test_memory_import.py`,
plus the existing `test_security_adapter.py` from the Codespace. They use fake providers and
temporary databases, never private conversations, saved notes, or paid calls.
With playground dev dependencies installed, also run
`cd ai_agents/playground && node src/app/api/companion/route.test.cjs` for
server-only key forwarding, no-store responses and same-origin regression checks.
