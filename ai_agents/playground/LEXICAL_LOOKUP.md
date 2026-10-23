# Owner-initiated language lookup

The private `/companion` page and the existing same-tab Companion panel include
a separate **Word meanings, synonyms & slang** form. Type a short English term,
choose a mode, check the term-only disclosure and press **Look up term**.
No typing, chat message, voice transcript or saved note triggers this lookup.
Chat/voice still use their short curated language note; they do not gain an
automatic web tool and must not claim a live lookup occurred.

## Source and licensing decision

Checked 2026-10-23: no dictionary/thesaurus integration was available in the
workspace catalog. ElevenLabs is speech, not a lexical source. We selected the
public, free, no-key [Free Dictionary API](https://dictionaryapi.dev/) v2 English
endpoint. No paid evaluation or paid lexical plan is required or authorized.
Its [project documentation](https://github.com/meetDeveloper/freeDictionaryAPI)
documents the endpoint. This is not a purchase, SLA or guarantee of coverage.

Modern responses such as `cool` and `lit` attribute text to Wiktionary and
include per-entry `license` and `sourceUrls`. TEN accepts only entries with
Wiktionary source URLs and an explicitly recognized
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) or
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) license URL.
The [Wiktionary licensing policy](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)
explains community contributions and exceptions for third-party material.
The API implementation's software license is NOT treated as a license for
dictionary content. Missing/unknown licenses or attribution fail closed.
Review these terms again before adding providers or bulk redistribution.

Every displayed sense credits Wiktionary contributors and links to the
original entries and declared license. Excerpts are not paraphrased; controls
are removed, whitespace normalized, long strings shortened with an ellipsis,
and result counts/synonyms limited. These displayed excerpts and any adaptations
remain available under their listed source CC BY-SA license; TEN asserts no
exclusive rights or endorsement. No audio, usage quotations or pronunciation
recordings (which can have separate rights) are fetched/displayed.
No proprietary dictionary or Urban Dictionary corpus is copied.

## Accuracy and limitations

- Synonyms come ONLY from the particular definition's `synonyms` array.
  Meaning-wide lists are not assigned to a sense or used to invent alternatives.
- Definitions remain visible in synonym mode so the owner can choose a sense;
  the part-of-speech filter is local and sends nothing further.
- The API does not supply reliable structured usage/register labels. TEN quotes
  an explicit leading parenthesized usage annotation containing a register such
  as `slang` or `informal`, when present, labeled **source annotation**.
  Otherwise it says **Not supplied by source; check context**. It does not
  guess formality, community, date or slang status from ordinary definition
  wording or synonyms. Original entry links provide further usage context.
- Slang mode shows dictionary senses, explicitly NOT verified slang-only
  matches. The source is community-edited, not a clinical authority.
- An optional Urban Dictionary link is clearly labeled **unreviewed
  user-submitted content**; clicking it is a separate owner navigation sending
  the term to that site. TEN never fetches/scrapes that site or invents a result.
- Empty/404 means no displayable licensed senses, NOT that the word is invalid.
  Network/timeout/rate-limit/invalid-source failures say unavailable. There is
  no silent model-generated fallback or stale cached answer.
- Results are not medical advice. Neutral non-erotic sexual-health education
  remains possible; explicit erotic/minor content, unsafe requests and
  credential exposure remain screened under the existing local guardrails.
  These heuristics are defense in depth, not comprehensive semantic moderation.

## Privacy and safety boundary

Lookup remains behind the existing private GitHub Codespaces port boundary;
no ports are made public and a claimed name/voice is not authorization.
The existing same-origin POST/JSON/size checks and global SessionSafety gate
remain in place. `lookup` accepts only `action`, `term`, `mode`, `consent`.
It rejects accompanying chat/history/notes rather than forwarding them.
Consent must be literal `true`. Terms are limited to 1–4 English words and
64 characters; URLs, email addresses, paths and multiline text are rejected.
Do not type private material: a short term can itself still be sensitive.

Only the lowercased term is sent to `api.dictionaryapi.dev`. The provider sees
the term, request timing and Codespace egress IP, and may retain request logs;
TEN does not promise deletion at another provider. Fixed HTTPS destination,
no redirects, no inherited proxy configuration, no provider authorization
headers, no referring page, no notes/transcripts, and no model/embedding call.
The lookup path does not initialize/read the approved-memory database.

There is **no lexical result or query cache**, in memory or on disk, and no
localStorage history. An unavailable-source result sets a 15-second in-process
backoff timestamp only; no term, hash, definition or failure detail is cached.
The existing API limiter retains only recent request
timestamps (30/minute/process); two worker calls may run concurrently. The
guard audit records only fixed lexical status labels, never words/definitions.
This intentionally chooses metadata-only backoff over query-keyed caching.
Responses use `Cache-Control: no-store`.

Network timeout is six seconds, one request with no retries, at most 256 KiB.
Display is capped at 24 senses and eight synonyms per sense. Cancel/clear aborts
the browser request and prevents a late response from displaying; a dispatched
provider request cannot be recalled. A provider request may finish after cancel.
Browser timeout is 15 seconds.

Pause, review-required pause, and disengagement block lookup before network
access. They are checked again after the response, so a concurrent stop discards
the result. No lookup changes a pause/disengagement latch or grants re-enable.
Global Stop still tears down the session, with explicit owner recovery through
Security only. Retrieved text is untrusted: deterministic screening, bounded
data extraction, HTTPS source allowlist, and React text rendering; no HTML
injection, model prompts, tool execution, automatic chat injection, or memory save.
Manual copy/paste still passes the normal chat/memory guards.

## Isolated verification

Run the standalone scripts separately, with synthetic temporary stores only:

```sh
cd ai_agents/agents/ten_packages/extension/openai_llm2_python
python3 test_lexical.py
python3 test_companion.py
python3 test_companion_policy.py
```

From `ai_agents/playground`, with its normal development dependencies installed:

```sh
node scripts/test-language-lookup-route.mjs
node scripts/test-session-safety.mjs
node scripts/test-spoken-commands.mjs
```

Never replay private conversations, invoke a paid model, or change the live
Codespace pause state for testing. Source availability checks with public
example words do not prove comprehensive dictionary or slang coverage.
