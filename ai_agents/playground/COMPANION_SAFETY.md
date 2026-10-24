# Private companion rules and dismissal

TEN's protected OpenAI voice path and text companion use the same fixed
companion policy. It personalizes the assistant for its owner, preserves
supportive and technical roles, requires an honest AI identity, and prohibits
encouraging harm, killing, privacy violations, explicit sexual content,
explicit sexual content involving minors, and self-replication.

## Owner boundary

The running app relies on **GitHub Codespaces private-port authentication**.
The connected GitHub account was checked against the intended repository owner.
Keep ports 3000, 8080, 49483 and 49484 private. A name in a prompt, a familiar
voice, or a claim in chat does not establish identity. This is not biometric
authentication, an OS sandbox, or protection against someone with Codespace
write access. Do not expose the app publicly without separate application auth.

## Disengagement

A direct finalized user utterance `fuck off`, optionally prefixed with `TEN`
or `please`, stops the session. Common ASR-censored `f*** off` is supported.
Quoted discussion, assistant speech, partial transcripts and future/negated
statements are not stop commands. This listener is independent of Lightcraft's
opt-in command mode and does not open another microphone.

The browser stores a stop marker, stops media and navigates to Security in a
new document, terminating pending media initialization and SDK playback.
The server stores a separate disengagement latch and pauses responses.
Text chat also recognizes the direct dismissal before making a model request.
The protected voice adapter emits no farewell or pause speech when disengaged.
No transcripts are included in the control request or metadata audit.

No automatic return, scheduled contact or substitute AI is created.
Reloading or reconnecting does not clear a dismissal. The owner must click
**Resume responses** in Security and manually return to TEN. A local-only stop
can also be recovered there if the network prevented the server stop request.
Existing chat drafts held only in memory are lost on the dismissal navigation;
approved saved memories are not deleted.

Other open tabs receive the local stop marker; other devices observe the
server state on their next successful status poll (normally 2.5 seconds).
Network outages can delay that observation. Server output is blocked at
checkpoints; audio already delivered to another device cannot be recalled.
This is a digital session control, not physical departure or lifelong
recognition of people nearby.

## Content and execution boundaries

Full output remains buffered and checked before speech. Additional offline
heuristics catch selected unsafe requests and harmful output. These are
conservative, incomplete heuristics plus model instructions—not a guarantee of
semantic safety or model resistance. Brief refusals offer safe alternatives.
All model tools remain denied by default. Remote RTC action packets cannot
automatically open websites. No Python/GDScript runner, autonomous deployment,
self-copying, or hardware-control capability was added.

RTC transcript/payload console dumps are removed for this path, SDK diagnostic
upload is disabled, and SDK logging is silenced. This does not establish
zero-retention at upstream ASR/model/TTS providers or cover every other TEN demo.
Private conversations must never become adversarial-test fixtures.

## Knowledge scope

The curated reference collection now includes EM fields, human anatomy,
physiology, psychology, non-erotic sexual-health/consent education, language
and slang guidance, AR/VR, Python game building and Godot. These are short
educational retrieval notes with source links, not medical training, a full
dictionary/Urban Dictionary mirror or live web lookups.

Godot knowledge does **not** mean a Godot engine has been embedded. Lightcraft
still uses its existing canvas renderer; a real Godot web export and bridge are
separate integration work. Default game suggestions follow nonviolent rules.

## Offline verification

Run the policy and adapter tests with existing TEN Python dependencies:

```sh
GUARD=ai_agents/agents/ten_packages/extension/openai_llm2_python
python3 "$GUARD/test_companion_policy.py"
python3 "$GUARD/test_security_adapter.py"
python3 "$GUARD/test_companion.py"
cd ai_agents/playground
bun scripts/test-session-safety.mjs
./node_modules/.bin/tsc --noEmit --pretty false
```

Use temporary state directories, synthetic messages and fake provider streams.
Do not pause/resume the live assistant or send paid provider requests in tests.
