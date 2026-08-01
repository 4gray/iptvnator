# Structured mpegts.js Diagnostics

## Context

PR #1314 stopped treating ambiguous native media errors as codec evidence and
retained explicit HTTP status. PR #1316 added an allowlisted hls.js boundary,
PR #1317 added one for Video.js/VHS, and PR #1318 added one for Shaka Player.
mpegts.js is now the remaining browser source engine whose diagnostic path
serializes arbitrary error payloads and classifies them with substring
heuristics.

The locked workspace installs mpegts.js `1.8.0`. Its public player error event
has three arguments: error type, error detail, and an information value. The
runtime exports exact `ErrorTypes` and `ErrorDetails` constants. The current
IPTVnator classifier instead lowercases the arguments, serializes arbitrary
`info`, and searches the resulting text for network, access, codec, format,
MSE, and early-EOF fragments. This can misdiagnose failures, retain provider
text, and miss reliable facts such as the HTTP status carried by
`HttpStatusCodeInvalid`.

All three built-in web players own a mpegts.js integration:

- `HtmlVideoPlayerComponent` for the built-in HTML5 player;
- `VjsMpegTsSession` for Video.js;
- `ArtPlayerSourceSession` for ArtPlayer.

They must cross the same evidence boundary so the selected player does not
change the diagnosis for an identical engine event.

## Goals

- Add one minimal, allowlisted `MpegTsPlaybackEvidence` boundary shared by all
  three mpegts.js owners.
- Version-lock the accepted public constants to installed mpegts.js `1.8.0`.
- Classify only exact, internally consistent public type/detail pairs.
- Surface a validated HTTP 4xx/5xx status for
  `NetworkError + HttpStatusCodeInvalid`.
- Preserve the existing useful distinction for unrecoverable early EOF while
  replacing text inference with the exact public detail.
- Prevent arbitrary `info`, messages, URLs, headers, bodies, credentials, and
  provider objects from reaching stored or rendered diagnostics.
- Shape the evidence so a later player-neutral recommendation layer can use it
  without coupling diagnostics to `PlayerController`.

## Non-goals

- Building the cross-player recommendation matrix.
- Moving recommendations, diagnostics, or fallback policy into
  `PlayerController`.
- Automatic failover, player preference changes, retries beyond those already
  owned by mpegts.js, probes, persistence, correlation, or diagnostic history.
- Adding new top-level diagnostic codes or changing diagnostic layout and
  translations.
- Inferring CORS, mixed content, Content Security Policy, private-network
  access, codec, format, or pipeline stage from message text.
- Inspecting mpegts.js loaders, demuxers, workers, or MediaSource internals at
  runtime.
- Changing source selection, live/VOD mode, playback controls, duration
  correction, or engine cleanup.

## Approaches Considered

### Public allowlisted evidence boundary (selected)

Normalize the public error-event arguments immediately into a small evidence
object. Accept only exact mpegts.js `1.8.0` type/detail constants, derive stage
and failure from consistent pairs, and read only a validated numeric status
from the documented network error-info slot. Classification and rendering then
receive the sanitized evidence rather than the raw event.

This is the strongest stable contract available. It fixes HTTP diagnostics,
removes unsafe serialization, keeps all three players consistent, and gives a
future recommendation layer explicit facts instead of prose.

### Exact constants plus message heuristics

Keep the public constants but continue reading `info.msg` to infer browser
access or more specific causes. This could preserve a few synthetic CORS cases,
but browser fetch exceptions commonly expose only generic text such as
`Failed to fetch`. Message text is not a stable public taxonomy and may contain
provider data. This approach is rejected.

### Add HTTP status to the existing classifier

Special-case `HttpStatusCodeInvalid` while leaving the rest of the substring
classifier unchanged. This would address issue #1159 narrowly but retain the
privacy and accuracy problems for every other mpegts.js failure. It would also
leave no coherent evidence contract for later recommendations. This approach
is rejected.

## Version-Locked Public Contract

The production allowlist accepts the exact public constants exported by
mpegts.js `1.8.0`.

Error types:

- `NetworkError`;
- `MediaError`;
- `OtherError`.

Error details:

- `Exception`;
- `HttpStatusCodeInvalid`;
- `ConnectingTimeout`;
- `UnrecoverableEarlyEof`;
- `MediaMSEError`;
- `FormatError`;
- `FormatUnsupported`;
- `CodecUnsupported`.

The package also exports loader-only `EarlyEof`, but it is not a public player
`ErrorDetails` value. mpegts.js attempts its finite-source reconnect internally
and exposes only `UnrecoverableEarlyEof` through the player error event when
recovery cannot complete. IPTVnator must not create a terminal diagnostic for
the internal recoverable value.

A contract test compares the allowlist and package version with the real
installed runtime. A dependency upgrade must fail that test and trigger a new
audit before changed or additional constants are accepted.

## Evidence Contract

`MpegTsPlaybackEvidence` contains:

- `engineType`: exact `NetworkError`, `MediaError`, or `OtherError`, otherwise
  `unknown`;
- `engineDetails`: one exact public mpegts.js detail, otherwise `unknown`;
- `disposition`: `terminal`;
- `stage`: `loader`, `demux`, `media-source`, or `unknown`;
- `failure`: `http`, `timeout`, `network`, `truncated-stream`, `format`,
  `codec`, `media-source`, or `unknown`;
- optional `httpStatus`: an integer from 400 through 599.

Stage and failure names are app-owned and stable. Exact engine type and detail
remain available separately so technical output still identifies the public
mpegts.js condition.

The evidence object does not retain:

- `info.msg` or any other message;
- arbitrary or serialized `info` values;
- request, response, redirect, or source URLs;
- headers, response text, bodies, events, exceptions, or loader objects;
- provider metadata, tokens, cookies, credentials, or unknown properties.

The existing `PlaybackDiagnostic.sourceUrl` remains the active source metadata
used by Retry, Copy URL, and explicit external-player actions. No URL is copied
from an engine error.

## Sanitization And HTTP Status

`createMpegTsPlaybackEvidence(type, details, info)` validates exact,
case-sensitive public values. Unknown strings, differently cased variants,
numbers, objects, and missing values become `unknown`; message fragments never
upgrade them.

The boundary reads `info.code` only for the exact
`NetworkError + HttpStatusCodeInvalid` pair. It retains the value only when it
is an integer from 400 through 599. Status-like fields on any other pair,
inside nested objects, or supplied as strings are ignored. No other `info`
property is read or copied.

The validated status is mirrored to the top-level diagnostic so the existing
metadata badge shows `HTTP 404` or `HTTP 5xx` without a UI redesign.

## Stage And Failure Mapping

Only internally consistent public type/detail pairs receive a stage or failure:

| Public type | Public detail | Stage | Failure |
| --- | --- | --- | --- |
| `NetworkError` | `HttpStatusCodeInvalid` | `loader` | `http` |
| `NetworkError` | `ConnectingTimeout` | `loader` | `timeout` |
| `NetworkError` | `Exception` | `loader` | `network` |
| `NetworkError` | `UnrecoverableEarlyEof` | `loader` | `truncated-stream` |
| `MediaError` | `FormatError` | `demux` | `format` |
| `MediaError` | `FormatUnsupported` | `demux` | `format` |
| `MediaError` | `CodecUnsupported` | `demux` | `codec` |
| `MediaError` | `MediaMSEError` | `media-source` | `media-source` |

`OtherError`, unknown values, and mismatched pairs keep both fields unknown.
For example, `OtherError + CodecUnsupported` must not become codec evidence.
This fail-closed rule prevents a future engine change or malformed event from
borrowing meaning from only half of the public contract.

## Lifecycle And Disposition

The public player `ERROR` event is terminal for IPTVnator's diagnostic
boundary. The installed engine handles recoverable finite-source early EOF
inside `IOController`; only failed recovery becomes
`UnrecoverableEarlyEof` and reaches the player event. Network, demux, and MSE
error paths likewise reach the player event after the active engine operation
has failed.

IPTVnator does not subscribe to internal recovery events or duplicate engine
retry logic. All accepted evidence therefore records `disposition=terminal`.

## User-Facing Classification

`classifyMpegTsPlaybackIssue` consumes sanitized evidence with this mapping:

1. `failure=http`, `timeout`, or `network` → `network-error`.
2. `failure=truncated-stream` → `media-decode-error`.
3. Exact `MediaError + FormatUnsupported` → `unsupported-container`.
4. Exact `MediaError + CodecUnsupported` → `unsupported-codec`.
5. `failure=format` or `media-source` → `media-decode-error`.
6. Everything else → `unknown-playback-error`.

The existing code-derived fallback behavior remains intentional:

- HTTP, timeout, generic network, and unknown failures do not claim that a
  different decoder will fix the provider response;
- truncated-stream, unsupported-container, unsupported-codec, format, and
  MediaSource failures may offer configured MPV/VLC actions because another
  demuxer or media pipeline can plausibly handle the same source.

No mpegts.js error becomes `browser-access-error`. The public constants do not
distinguish CORS, mixed content, CSP, or private-network access from a generic
fetch exception, and status zero is not sufficient evidence.

## Runtime Integration

The raw event must cross the boundary once in each owner:

- `emitMpegTsPlaybackError` creates evidence for
  `HtmlVideoPlayerComponent`;
- `VjsMpegTsSession` creates evidence before emitting its issue;
- `ArtPlayerSourceSession` creates evidence before emitting its issue.

All three call the same classifier with source metadata that preserves their
existing `InlinePlaybackPlayer` identity. No owner keeps or forwards the raw
event after normalization. Listener binding, stale-engine guards, live/VOD
mode, duration correction, source routing, play calls, and teardown remain
unchanged.

## Relationship To Shared Controls And Recommendations

`PlayerController` remains the engine-neutral command/state/capability
contract. It does not own error taxonomy, fallback policy, or provider
evidence.

Playback diagnostics are a sibling player-neutral layer: engine adapters emit
sanitized evidence, the diagnostic classifier maps it to a user-facing issue,
and the existing viewport renders that issue. A later recommendation layer can
consume diagnostic code, source, engine evidence, source metadata, and runtime
capabilities to explain whether another player is likely to help. That later
work must not require parsing the technical-details string or changing the
controls contract.

## User Interface

The existing technical `Error details` row renders only structured mpegts.js
evidence, for example:

`stage=loader · failure=http · type=NetworkError · details=HttpStatusCodeInvalid · disposition=terminal · HTTP 404`

When `issue.mpegTs` exists, legacy raw `details` and native message fields are
ignored even if a caller accidentally supplies them. Existing titles,
descriptions, HTTP badge, Retry, Copy URL, external-player actions, layout, and
translations remain unchanged.

## Testing

Use test-driven development:

- Compare the accepted constants and version with the real installed
  mpegts.js `1.8.0` runtime.
- Cover every consistent public type/detail mapping.
- Prove mismatched, unknown, differently cased, and malformed inputs remain
  unknown.
- Prove only exact `HttpStatusCodeInvalid` can expose a validated HTTP 4xx/5xx
  status.
- Prove `info.msg`, nested status, URLs, headers, bodies, exceptions, and
  arbitrary provider objects never enter evidence or rendered details.
- Cover HTTP 404, timeout, exception, unrecoverable early EOF, format error,
  unsupported format, unsupported codec, MSE error, other, and unknown
  classification.
- Cover evidence creation and issue emission through HTML5, Video.js, and
  ArtPlayer integrations.
- Prove the rendered detail row uses only structured mpegts.js evidence and
  preserves the HTTP metadata badge.

Run the focused red/green tests, complete `ui-playback` unit and lint targets,
web typecheck, i18n validation, release-note validation, and the repository
test-impact pass. No new E2E case is required because source selection,
playback lifecycle, controls, actions, and diagnostic layout remain unchanged;
the engine event, three adapter boundaries, classifier, and rendered output are
covered directly and deterministically.

## Documentation And Release Note

Update `docs/architecture/embedded-inline-playback.md` as the canonical
browser diagnostic contract. Update the mpegts.js diagnostic summaries in
`AGENTS.md` and `CLAUDE.md` because they describe the affected player engines
and evidence boundaries. No `player-controls-contract.md` change is needed
because the controls contract does not change.

Add a `fix(playback)` note under `.changes/` because users receive accurate HTTP
status, safer technical details, and more precise mpegts.js diagnoses.
