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
Cosine similarity retrieves up to eight related notes. This is a personal
SQLite vector store, not an external managed vector database. It supports up
to 2,000 notes, each up to 2,000 characters; the browser lists 100 notes per
page. The memory library can be exported on request. Recent context and
retrieval are bounded.

Storage is **not encrypted at rest by this application**. Keep Codespaces
ports private, restrict repository/Codespace access, and do not save secrets.
OpenAI receives text for chats, summaries, embeddings, and recall queries under
the account's provider terms. Provider requests may incur charges.

The UI supports reviewed save, edit/re-embedding, semantic search, export of
approved notes, and confirmed deletion. Deletion removes text and its vector
from the active SQLite database with secure-delete enabled; it cannot recall
information already sent to a provider or erase external backups.
Exported files contain personal data; protect them accordingly.

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
and the existing adapter tests from the Codespace. They use fake providers and
temporary databases, never private conversations, saved notes, or paid calls.
