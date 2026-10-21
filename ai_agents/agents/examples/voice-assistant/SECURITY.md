# Diagnostic privacy and retention

See [LOGGING_PRIVACY.md](LOGGING_PRIVACY.md) for safe logging defaults, local file
retention controls, synthetic regression checks, and the separate provider-side
retention settings. Metadata-only security auditing is not a zero-retention
guarantee for the voice assistant or its providers.

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
