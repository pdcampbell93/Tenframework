# Owner-reviewed Python console

Open the expandable Python/game-logic console in `/companion`. Ask TEN for a
fenced Python snippet, explicitly insert it, or paste your own code. Prepare a
review, inspect the full exact snapshot/hash, and acknowledge E2B usage costs
before approving one run. Changed, expired or consumed reviews cannot run.
No model tool can approve or start execution.

## Isolation and limits

- E2B creates a fresh default-template VM per run, with outbound internet
  disabled, controller authentication enabled and a 60-second provider timeout.
- Only the explicitly approved source is transferred. No host mounts, chat
  history, saved memories, provider credentials, or environment forwarding.
- Python/game logic only: this is **not** a desktop, Godot installation, game
  renderer, package installer, deployment tool or persistent agent.
- One active run across tabs/processes; 30-second Python wall-time limit, CPU
  and file-size ulimits inside the guest, and provider template CPU/RAM bounds.
  Guest process limits are defense in depth, not a replacement for VM isolation.
- Filesystem reads and displayed text are bounded; rich outputs are not loaded
  or rendered. Outputs pass TEN screening, remain text, are not spoken, and are
  not automatically sent back to the chat model.
- E2B control credentials stay in TEN's server environment. E2B handles approved
  source inside its infrastructure; its own retention and account policies apply.
  Presence of a configured key is not proof of available credits/provider health.

## Stop, failure and privacy

Stop active run, pause, dismissal, and page departure request cancellation.
The server also checks the persistent safety latch while running. Cancellation
is not instant across networks: UI distinguishes requested/unconfirmed cleanup
from confirmed termination. VM expiry is a provider-side fallback, not a promise
that a network stop always succeeds.

Unconfirmed cleanup or ambiguous creation failures hold the execution lease
until cleanup or a conservative two-minute lease expiry. No automatic run retry,
timeout extension, persistent snapshots, scheduled restart or substitute AI.
After a TEN process crash, a known VM can still be cancelled through its stored
identifier; otherwise the provider timeout bounds its lifetime.

The private GitHub Codespaces port is the owner-access boundary. Same-origin,
bounded JSON mutations are also required. Do not publish this API without real
application authentication. Someone able to edit the server/credentials remains
trusted; prompt rules and browser controls cannot constrain that administrator.

The local SQLite lease database stores hashes, identifiers, timestamps and
states only—never code, output or control credentials. Code/results remain in
tab state only. Metadata expires; this is not a memory/backups feature.

## Verification without spending

Run Python `test_sandbox_state.py` and `bun test scripts/sandbox.test.ts` only
inside a disposable copy with its own `.ten-security` directory. The latter
uses a deliberately invalid key and a fake E2B module. Browser tests must mock
all sandbox run requests. Never replay private chats or test live pause state.
An actual E2B execution requires the owner's explicit run approval and credits.
