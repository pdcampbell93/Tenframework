# Spoken controls in the TEN workspace

Open the original TEN home page, connect TEN as usual, then choose **Arm commands**.
The Lightcraft, Chat and Memory buttons now switch panels in that same tab.
The existing TEN voice component stays mounted, so navigation does not create a
second microphone connection or depend on a background browser tab.

The command layer reuses finalized user-text RTC events from the existing TEN
speech pipeline. It ignores assistant replies, partial transcripts, reasoning,
images, malformed data, repeated final packets, and unsupported commands.
Commands are off on reload, disabled when the browser tab is hidden or TEN
disconnects, and must be re-armed afterward. No browser SpeechRecognition API,
extra provider, microphone track, or model-controlled tool is added.

## Supported examples

Say one command per utterance, beginning with “TEN”:

- “TEN, open Lightcraft”
- “TEN, open chat”
- “TEN, open memory”
- “TEN, open voice controls”
- “TEN, pause” / “TEN, resume”
- “TEN, manifest an orb” / “a crystal” / “a portal”
- “TEN, set light direction to 40”
- “TEN, set shadow bend to seventy-five”
- “TEN, clear field” / “TEN, reset field” — require on-screen confirmation
- “TEN, disable commands”

Light direction and shadow bend accept integers from 0 to 100, in digits or
number words. Unrecognized phrases do not cause app actions.
When the field is paused, say “TEN, resume” before manifesting a form.
Leaving Lightcraft pauses its effects and stops its optional gaze camera.
Returning does not automatically resume effects.

Commands cannot enable cameras, save/delete personal memory, send text-chat
messages, execute code, open arbitrary URLs, or control real sensing hardware.
Existing on-screen memory approval and camera-permission controls are unchanged.
The independently opened `/simulation` and `/companion` pages remain manual;
use the home workspace for same-session spoken navigation.

## Privacy and limitations

Turning off **commands** does not mute TEN's existing microphone or disconnect
the assistant. Use **Back to TEN** for those controls. Normal speech continues
through TEN's existing ASR/model/providers and may be answered by the assistant;
the usual provider processing, retention policies and account charges apply.
The command layer keeps only bounded normalized command metadata for duplicate
suppression and a friendly last-command label in transient page state; it does
not add transcript persistence or log raw speech.

Wake phrases are not speaker authentication: nearby speech, misrecognition or
audio playback can trigger harmless allowed controls. This is not a medical,
attention, liveness, security, or safety monitoring system. It is a small UI
grammar, not a sandbox or replacement for the TEN response guard.

## Verification

Run `bun scripts/test-spoken-commands.mjs` for synthetic parser/event tests.
These tests do not connect to providers, access a microphone, replay private
conversations, change live pause state, or spend provider credits.
