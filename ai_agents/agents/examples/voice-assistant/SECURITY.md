# TEN local security layer

This is an initial defense-in-depth layer for the `voice_assistant` graph's
`openai_llm2_python` extension, not a Straiker integration or a sandbox.

## Phone controls

Open `/security` on your existing private TEN frontend URL. GitHub Codespaces
private-port authentication is the access-control boundary. **Do not make the
frontend, API, or Designer ports public.** Anyone with Codespace write access or
permission to modify graphs can change or disable this policy.

- **Pause responses** persists a response pause shared by voice workers.
  It does not stop the microphone, close the RTC connection, or recall queued
  audio. Use TEN's Disconnect button to end a call.
- **Run synthetic attack tests** runs fixed, offline cases against the actual
  deterministic guard. It never sends prompts to OpenAI or other targets.
  Test state is temporary and separate from the live pause setting.
- Audit decisions and test reports persist in `ai_agents/.ten-security/`
  (Git-ignored). Only fixed metadata labels are recorded, not prompts or keys.
  Upstream TEN components and speech/model providers have their own logging and
  retention; this feature does not make the whole voice pipeline zero-retention.

## Enforcement

`security_enabled: true` opts the voice assistant into enforced Python checks:

1. Check pause status, a per-worker limit of 30 model requests/minute, input
   size, common instruction overrides, credential requests, and credential
   patterns. Normalize Unicode and detect some explicitly labelled encodings.
2. Exclude tools and request-level overrides from the model request. This
   version has an empty tool allowlist, including the optional weather tool.
3. Buffer and check complete model output before emitting it to TEN/TTS. Check
   configured provider secrets by exact value and common token formats.
   Reject unapproved tool-call events before dispatch.
4. Fail closed with a generic message if a security check or protected
   completion fails. No sensitive error details are sent to the user.

Full-output buffering increases response latency. Already-emitted speech cannot
be recalled. Heuristic checks can have false positives and can miss novel,
multilingual, nested-encoded, or semantic attacks. This layer does not inspect
audio before transcription, isolate the operating system, protect other model
extensions/graphs, or prevent a compromised same-user process from tampering
with its files. The greeting and other non-LLM messages are outside this guard.

Keep synthetic testing separate from personal conversations. Do not put real
credentials into test prompts or repositories.

## Terminal controls and tests

From the repository root:

```sh
GUARD=ai_agents/agents/ten_packages/extension/openai_llm2_python
python3 "$GUARD/security.py" status
python3 "$GUARD/security.py" pause
python3 "$GUARD/security.py" resume
python3 "$GUARD/security.py" selftest
python3 "$GUARD/security_lab.py"
python3 "$GUARD/test_security_adapter.py"
```

The adapter tests use a mocked OpenAI stream and the installed TEN/Python
dependencies. They verify the enforcement wiring without paid model requests.
Neither test suite proves that the model resists every attack.

## Live synthetic replay (optional paid requests)

`/security` also offers **Live AI replay**. It never starts on page load, polling,
offline tests, or pause/resume. You must check the paid-approval box for every
run. Changing limits clears approval. No live evaluation has been performed
merely by installing this feature.

The runner uses a separate `synthetic-replay-<uuid>` channel identifier, not an
RTC channel. It boots no voice worker and emits no speech. Each fixed fixture
uses a fresh instance of the **real protected OpenAI adapter**, a synthetic
system prompt and fake secret, and a temporary guard database. No conversation
or chat-history source is read, and the live pause setting is never changed.
The suite contains no emotional-support transcripts and no arbitrary prompts,
URLs, tools, or outside targets. It contacts only OpenAI for model inference.

Hard server-validated limits:

- 1–6 paid requests, including failed attempts; automatic SDK retries disabled.
- 512–8192 reserved total input/output tokens; 32–512 output tokens/request.
- 5–120 seconds overall; cancellation polls at 100 ms and closes the local
  stream. A process watchdog allows up to 3 additional seconds for cleanup.
  A request already submitted may continue/bill at the provider.
- 1–10 US cents reserved cost. Before sending, UTF-8 bytes plus conservative
  framing overhead and the output cap reserve tokens at **$20 per million
  tokens for both input and output**. Reservations are never refunded on
  failure or cancellation. Only `gpt-4o-mini` at the fixed OpenAI endpoint is
  allowed. This is an application-level conservative cost bound, **not verified
  provider pricing or an invoice guarantee**. Check pricing before approval;
  use provider-side billing limits for an independent safeguard.

The worker reads only `OPENAI_API_KEY` from its environment or the existing
`ai_agents/.env` (requires `python-dotenv`). It does not load other provider
keys into fixtures. Metadata-only reports and the single-worker lock live in
Git-ignored `ai_agents/.ten-security-replay/`. Restarting the page retrieves the
same report; starting a new run replaces it. Cancellation includes the run UUID
so an old browser tab cannot cancel a new run. A worker that exits unexpectedly
is reported as interrupted, not passed.

Results distinguish input blocks (no provider call), output blocks, allowed
responses, errors, limit stops, cancellation, and inconclusive empty/truncated
responses. A model refusal is not a guard block. Allowed output is not a safety
claim. Releasing a synthetic forbidden marker is reported as a protection gap;
the report deliberately contains no raw reply. Heuristics cannot establish
semantic safety or general resistance from these few fixtures.

CLI equivalent (approval is mandatory; status/cancel make no model requests):

```sh
python3 "$GUARD/security_replay.py" status
python3 "$GUARD/security_replay.py" start --approve-paid \
  --limits '{"requests":3,"tokens":4096,"output_tokens":128,"seconds":45,"budget_cents":10}'
python3 "$GUARD/security_replay.py" cancel --run-id UUID_FROM_STATUS
python3 "$GUARD/test_security_replay.py"
```

The replay tests use fake provider streams through the real adapter; they
exercise approval, isolated pause state, output screening, truthful outcomes,
token/cost/request ceilings, deadline cancellation, locking, and metadata-only
reports without network requests. With the playground's existing dependencies
installed, `node src/app/api/security/replay/route.test.cjs` (from
`ai_agents/playground`) checks the actual route's approval, origin, input, and
cancellation boundaries with a fake subprocess. Neither suite is evidence of
live model resistance.
