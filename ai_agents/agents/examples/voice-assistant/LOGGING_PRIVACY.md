# Voice assistant logging and retention

These defaults reduce accidental disclosure from the original `voice-assistant`
graph. **They are not a zero-retention or confidentiality guarantee.** They do
not delete old logs, change provider account settings, or deploy themselves to
an already-running Codespace.

## What local diagnostics contain

- Main control logs operations, final/interim flags and character counts, not
  ASR text, assistant text, reasoning, queued context, model replies, tool names,
  tool arguments or tool results. The transcript still goes to the phone UI,
  context still goes to the model, and the intended reply still goes to TTS.
- Deepgram logs connection state, bounded provider codes, exception class names,
  retry counts and timing. No transcript JSON, transcript text, options,
  hotwords, configuration values, or provider error bodies are logged.
- ElevenLabs logs connection state, numeric error codes, exception class names,
  byte/character counts, timing and request state. No text, alignment text,
  connection URL/query, configuration, arbitrary request IDs, traceback text
  or provider error bodies are logged. Error events also omit raw provider text
  so downstream loggers cannot re-log it.
- OpenAI keeps prompts, headers, keys, response chunks and configuration values
  out of diagnostics. Failures retain an exception category and bounded numeric
  HTTP status without the provider response body. Chat completions explicitly
  use `store=false`, overriding a caller-supplied `store=true`.
- The default TEN console threshold is `warn`; this limits inherited runtime
  and dependency chatter. Operation-level logs above remain safe if an owner
  deliberately raises the threshold to `info` or `debug`, but raising it can
  expose **other** native extensions or unreviewed dependency logging.
- `tenapp/scripts/start.sh` adds a Python startup policy that replaces standard
  Python logging messages with a fixed source group, source line, severity and
  bounded exception category. It removes logging args, exception tracebacks and
  stack text before SDK handlers format them, including DEBUG HTTP/WebSocket
  diagnostics. `OPENAI_LOG` is unset. No environment values are read by the policy.

The policy is scoped to Python's standard logging API. Arbitrary `print()`,
custom logging handlers that independently read request data, native SDKs,
TEN's native logger and other graphs are not intercepted. The audited extension
calls above are changed at their source. Installed `ten_ai_base` and native RTC
packages are separately versioned dependencies, not a guarantee of exhaustive
coverage. After dependency upgrades, verify the actual installed worker with
synthetic speech before using sensitive conversations.

## Local retention controls

| Control | Default / effect |
| --- | --- |
| `TEN_LOG_FILES` | Unset/anything except exact `true`: no new per-worker disk logs. Diagnostics go to stdout/stderr. |
| `LOG_STDOUT` | `true` still forces console output even when `TEN_LOG_FILES=true`. For deliberate file capture use `LOG_STDOUT=false` and `TEN_LOG_FILES=true`. |
| TEN console level | `warn` in this example's `tenapp/property.json`; avoid verbose logging for sensitive sessions. |
| ASR/TTS `dump` | Explicitly `false` in this graph. Keep disabled; enabling writes real PCM audio independently of log settings. |
| File access | Launcher uses `umask 077`; opt-in worker logs and temporary properties use owner-only `0600`. Existing append logs have permissions tightened; symlinks are rejected. |
| Temporary properties | Removed when a worker fails to launch or exits normally/crashes. They exist while the worker needs them. A host crash, forced API-server kill or power loss can leave orphan files. |

`TEN_LOG_FILES` changes take effect for **new** workers; the Python policy and TEN
level require restarting the worker through the updated launcher. Do not restart
or change an active support conversation solely to test this change.

Console output may still be retained by a terminal, Codespaces host, process
supervisor, log collector or exported diagnostic bundle. Configure retention
there separately. This patch adds **no automatic expiry** for opt-in disk logs:
the owner must set a short retention period in their log-rotation system and
restrict access to `LOG_PATH`. Prefer a private directory outside the Git
checkout, for example an owner-created directory with mode `0700`.

Existing files and backups are **not** deleted by installation. When all workers
are stopped, review only filenames/ages in the configured `LOG_PATH`, then remove
obsolete `app-*.log`, orphan `property-*.json`, and any intentionally enabled ASR
or TTS PCM dumps according to your retention policy. Do not delete active property
files. Also review terminal captures, old Codespace log files, uploaded bundles,
repository history, snapshots and backups. Deleting a current file does not erase
its copies. No cleanup command is run automatically by these tests.

The live conversation still exists in memory, provider traffic, RTC delivery
and the browser's transcript display. Ending a worker clears that process's
memory in the ordinary OS sense, not a secure-memory-erasure guarantee.

## Provider controls are separate

The following references were checked on 2026-10-21. Verify current eligibility,
contract, region, billing impact, actual request behavior and account/project
settings with each provider. A local setting cannot prove server-side deletion.

### Deepgram ASR

The historical local config field is named `mid_opt_out`. When true (the default,
explicit in this graph), the adapter now sends **`mip_opt_out=true`** as a query
addon using the pinned Deepgram SDK's `start(..., addons=...)` API. Previously it
was sent as `LiveOptions.extra`, which is custom metadata, not a retention control.
Advanced option values are never logged.

Deepgram documents that opted-out audio and transcripts are retained only for
processing, while metadata/usage logs remain retrievable for 90 days and
summarized usage can remain longer. Without opt-out, requests participate in model
improvement by default. Opt-out may change pricing/eligibility. Confirm the
request's `mip_opt_out` flag in Deepgram's account logs without exporting content;
residency also depends on the endpoint. Do not infer opt-out from a successful
transcription alone.

Reference: https://developers.deepgram.com/trust-security/your-data

### ElevenLabs TTS

Provider retention is **not disabled by the local `dump=false` setting**.
For an account eligible for Enterprise Zero Retention Mode, add
`"enable_logging": false` inside the TTS node's `property.params`. The existing
WebSocket adapter supports this query flag and serializes booleans as lowercase.
It is not enabled unconditionally because unsupported accounts may reject it
and break speech. Ask the provider to confirm eligibility and verify no saved
audio appears in request history; usage analytics still exist.

ElevenLabs documents default retention, select-Enterprise eligibility and
limitations/exceptions for Zero Retention Mode. Training/data-use preferences,
history deletion, backups, account data and any moderation/security exceptions
are provider/account controls. This patch does not change them.

Reference: https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode

### OpenAI LLM

`store=false` avoids intentionally stored chat completions. It does **not**
disable abuse-monitoring logs, establish Zero Data Retention, or turn off every
model/endpoint's caching. OpenAI documents default abuse-monitoring retention of
up to 30 days, with legal/safety exceptions, and approval requirements plus
endpoint/model limitations for Zero Data Retention / Modified Abuse Monitoring.
API data is not used for training by default unless the account opts in.

Check the actual organization and project's data controls, sharing preferences,
model eligibility and endpoint. If `base_url` points to an OpenAI-compatible
third party or proxy, that service's terms also apply and it must support the
`store` parameter. The local adapter cannot enforce that provider's retention.

Reference: https://developers.openai.com/api/docs/guides/your-data

### RTC, browser, and other extensions

Agora carries audio and transcript messages for this graph. Its account,
recording, telemetry and legal retention settings, as well as any browser/client
storage, are separate from the STT/LLM/TTS diagnostic changes. Enabling another
graph, provider, memory service or tool requires its own retention review.

## Offline verification

Run from the repository root:

```sh
python3 ai_agents/agents/examples/voice-assistant/test_logging_privacy.py
cd ai_agents/server
go test ./...
```

The Python suite executes production method bodies with synthetic boundary
fakes: interim/final transcription, ASR errors and opt-out request shape, context
queuing, phone-display/TTS payload delivery, TTS duplicate/error states, WebSocket
text/audio/alignment handling, Python SDK logging and startup policy, and
diagnostic source checks. It uses no real credentials, history, provider calls,
RTC session or pause state. It does not boot the native TEN worker.

The isolated file-policy tests can also run without downloading the server's
third-party dependencies:

```sh
go test internal/privacy_files.go internal/privacy_files_test.go
```

A successful mock flow is **not** proof that a provider account is authorized,
that a microphone/RTC device works, or that provider-side retention is disabled.
For installation, separately schedule an approved synthetic voice smoke test in
an isolated channel with the account's actual dependency versions. Do not replay
private support history or make paid calls without explicit approval.
