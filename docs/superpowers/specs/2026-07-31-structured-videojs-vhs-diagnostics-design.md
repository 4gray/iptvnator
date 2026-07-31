# Structured Video.js/VHS Diagnostics

## Context

PR #1314 made generic native playback diagnostics preserve Video.js HTTP
status and `metadata.errorType`, and stopped treating an ambiguous
`MediaError` code 4 as codec evidence. PR #1316 added a separate structured
hls.js boundary for the HTML5 and ArtPlayer engines. Video.js remains the
default web player, but its HLS/DASH implementation is VHS rather than hls.js,
so the hls.js evidence contract does not apply to it.

The locked workspace installs:

- Video.js `8.23.9`;
- bundled `@videojs/http-streaming` (VHS) `3.17.5`;
- an unrelated Video.js `7.21.7` / VHS `2.16.3` pair nested under the legacy
  aspect-ratio plugin.

The application imports the root Video.js `8.23.9` build. Its package declares
VHS `^3.17.5`, and pnpm resolves that dependency to `3.17.5`.

The audit compared the installed sources with the exact upstream tags:

- Video.js `v8.23.9`, commit
  `81b3cb429fae8dd00659ac5d3b0b1d2d20a283cb`;
- VHS `v3.17.5`, commit
  `a9f9d7ac0264b373f14da1bb2f2e7fe8f2775c4f`.

The installed VHS `error-codes.js`, `videojs-http-streaming.js`, and
`playlist-controller.js` match the tagged sources.

## Goals

- Add a minimal allowlisted evidence boundary for terminal Video.js/VHS
  errors.
- Retain only public Video.js `MediaError` fields and exact public
  `videojs.Error` identifiers.
- Classify only exact confirmed values; unknown values remain unknown.
- Keep recoverable VHS playlist/segment handling from becoming a terminal
  IPTVnator diagnostic.
- Avoid retaining or rendering VHS/provider URLs, headers, xhr objects,
  response bodies, messages, credentials, or arbitrary metadata.
- Correct the misleading case where VHS promotes a generic internal object or
  string to code 3 even though no media-decode cause was established.
- Keep generic native Video.js playback behavior unchanged when VHS is not the
  active source handler.

## Non-goals

- Changing the hls.js evidence contract from PR #1316.
- A Shaka or mpegts.js diagnostic redesign.
- Inferring CORS, mixed content, CSP, private-network access, codec, DRM, or a
  request stage from messages or indirect signals.
- Reading VHS playlist loaders, segment loaders, request objects, or other
  private implementation state.
- Listening to undocumented VHS retry/exclusion events in production.
- Diagnostic history, persistence, correlation, stream probes, automatic
  failover, or a cross-player recommendation matrix.

## Approaches Considered

### Public Video.js error boundary (selected)

Read `player.error()` inside the public `Player#error` listener. When the
documented `player.tech().vhs` runtime property is present, sanitize the error
into a small `VhsPlaybackEvidence` object. Validate `metadata.errorType`
against the exact values exported by `videojs.Error`, validate the standard
`MediaError` code and HTTP status, and derive a stage only where the public
engine identifier itself names that stage.

This approach adds structured evidence without depending on VHS loaders or
request objects. It also lets generic non-VHS Video.js errors continue through
the existing native classifier.

### Observe VHS xhr hooks

VHS documents `vhs.xhr.onRequest` and `onResponse`, but request hooks would
require correlating mutable request objects with a later terminal error. They
also expose URLs, headers, response objects, and provider payloads at exactly
the boundary that must stay sanitized. Request completion is not terminal
playback disposition: VHS may retry, exclude a rendition, or recover. This
approach is rejected.

### Read VHS loaders and retry events

The installed implementation carries precise `requestType`, xhr, playlist,
segment, and key context internally. Those objects and their event ordering
are not part of the documented stable error API. Depending on
`playlistController_`, loader error objects, `retryplaylist`, or
`excludeplaylist` would violate the scope constraint and make updates to VHS
risky. This approach is rejected.

### Stop after the audit

Stopping would be correct if the public API exposed nothing beyond PR #1314.
The audit found a safe increment: `videojs.Error` is a public exact-value
allowlist, `player.error()` is populated before `Player#error`, and active VHS
can be detected through a documented runtime property. That is enough to
structure evidence, suppress unsafe message/metadata retention, and avoid a
false generic code-3 decode diagnosis.

## Stable Public Evidence

Video.js `8.23.9` documents and types these public fields:

- `player.error()` returns the current Video.js `MediaError`;
- `MediaError.code` carries standard codes 0 through 5;
- `MediaError.status` is an optional plugin-supplied status;
- `MediaError.metadata.errorType` is expected to align with
  `videojs.Error`;
- `Player#error` is emitted after `player.error_` has been replaced with the
  new `MediaError`;
- `player.tech().vhs` is a documented VHS runtime property while VHS is in
  use.

Video.js `8.23.9` publicly exports these exact `videojs.Error` values:

- `networkbadstatus`;
- `networkrequestfailed`;
- `networkrequestaborted`;
- `networkrequesttimeout`;
- `networkbodyparserfailed`;
- `streaminghlsplaylistparsererror`;
- `streamingdashmanifestparsererror`;
- `streamingcontentsteeringparsererror`;
- `streamingvttparsererror`;
- `streamingfailedtoselectnextsegment`;
- `streamingfailedtodecryptsegment`;
- `streamingfailedtotransmuxsegment`;
- `streamingfailedtoappendsegment`;
- `streamingcodecschangeerror`.

The allowlist is intentionally version-locked. A regression test compares it
with the installed `videojs.Error` export so a dependency update requires a
new audit instead of silently accepting new engine values.

## Rejected Evidence

VHS `3.17.5` internally adds fields such as `requestType`, `uri`, `headers`,
`error`, xhr objects, response text, playlist objects, and segment context.
Those values can contain credentials or provider data and are not required by
the public Video.js `ErrorMetadata` contract. The boundary must not read or
copy them.

The following are also rejected:

- error `message`, because VHS messages embed request URLs;
- `responseText`, response data, and response bodies;
- request/response headers;
- arbitrary metadata keys or provider objects;
- `requestType`, because its propagation through `player.error()` is an
  implementation detail rather than a documented stable contract;
- status zero as CORS or browser-access evidence;
- message fragments as codec, DRM, network, access, or stage evidence.

The existing `PlaybackDiagnostic.sourceUrl` remains available to the
pre-existing Retry, Copy URL, and explicit external-player workflows. No URL
from the Video.js/VHS error object is copied into evidence or technical
details.

## Evidence Contract

`VhsPlaybackEvidence` contains:

- `engineType`: one exact installed `videojs.Error` value, otherwise
  `unknown`;
- `mediaErrorCode`: a validated standard `MediaError` code 0 through 5,
  otherwise `unknown`;
- `disposition`: `terminal`;
- `stage`: `manifest`, `playlist`, `segment`, or `unknown`;
- optional `httpStatus`: an integer from 400 through 599 copied only from the
  public top-level `MediaError.status`.

There is no recoverable evidence object. IPTVnator creates this boundary only
from the public `Player#error` event after Video.js has stored the final error.
Recoverable VHS handling remains inside VHS and produces no terminal
diagnostic.

## Stage Mapping

Stage is derived only from exact public engine identifiers:

- `streaminghlsplaylistparsererror` → `playlist`;
- `streamingdashmanifestparsererror` → `manifest`;
- `streamingfailedtoselectnextsegment` → `segment`;
- `streamingfailedtodecryptsegment` → `segment`;
- `streamingfailedtotransmuxsegment` → `segment`;
- `streamingfailedtoappendsegment` → `segment`;
- all network identifiers, content-steering/VTT parser errors, codec-change
  errors, and unrecognized values → `unknown`.

Network errors remain stage-unknown even if internal metadata happens to carry
`requestType: hls-playlist`, `hls-segment`, or `hls-key`. The public error
contract does not guarantee those values.

## Classification

`classifyVhsPlaybackIssue` uses this precedence:

1. A validated HTTP 4xx/5xx status produces `network-error`.
2. Exact public network error types produce `network-error`.
3. Standard `MediaError` code 2 produces `network-error`.
4. Exact `streamingfailedtodecryptsegment` produces
   `drm-or-encryption`.
5. Standard `MediaError` code 5 produces `drm-or-encryption`.
6. A known browser-incompatible source container may still produce
   `unsupported-container`.
7. Everything else produces `unknown-playback-error`.

Generic VHS code 3 does not produce `media-decode-error`. VHS assigns code 3
to object errors without a code and to string errors before calling
`player.error()`, including the terminal “no available playlists” path.
Therefore code 3 is not sufficient decode evidence on the VHS path.

The boundary does not classify:

- codec incompatibility from codec-change, transmux, append, or message text;
- DRM from key-request/load failure;
- browser access from status zero or generic request failure;
- media decode from code 3 alone.

Generic Video.js playback without active VHS continues to use the existing
native classifier, so a native code 3 remains a media-decode diagnostic.

## Runtime And Event Ordering

VHS `3.17.5` handles playlist and segment failures before the public terminal
error:

- a failed rendition can be excluded and another selected;
- a single finite-exclusion rendition is retried;
- previously excluded renditions can be re-included;
- segment timeouts can trigger ABR recovery;
- aborted segment requests are ignored as non-errors;
- only an unrecoverable playlist-controller error reaches
  `player.error(...)`.

Video.js `8.23.9` constructs and stores the `MediaError`, then synchronously
fires `Player#error`. The component therefore reads the final public error
inside its existing listener and marks it terminal. IPTVnator does not
subscribe to internal VHS recovery events.

## Component Flow

`VjsPlayerComponent` keeps one `Player#error` listener:

1. Read `player.error()` before falling back to the native video error.
2. Detect active VHS through the documented `player.tech().vhs` runtime
   property.
3. With active VHS and a Video.js error, call
   `classifyVhsPlaybackIssue`.
4. Otherwise keep the existing `classifyNativePlaybackIssue` path.
5. Emit exactly one terminal diagnostic.

The component does not inspect `playlistController_`, loaders, xhr hooks,
request types, retry events, or error messages.

## User Interface

Add one deterministic Video.js/VHS technical-detail summary:

`stage=unknown · type=networkbadstatus · code=4 · disposition=terminal · HTTP 503`

The summary is built only from `VhsPlaybackEvidence`. It never includes the
Video.js message or arbitrary metadata. Existing diagnostic headings,
descriptions, HTTP badge, Retry, Copy URL, and explicit MPV/VLC actions remain
unchanged; no new translation keys or layout changes are needed.

## Testing

Use test-driven development:

- Compare the allowlist with the actual installed `videojs.Error` export.
- Exercise real Video.js public event ordering by setting an error on a real
  Video.js player and reading `player.error()` from its `error` listener.
- Use installed-runtime-shaped VHS errors for 5xx, request failure, timeout,
  playlist parsing, segment decrypt, generic code 3, and unknown provider
  metadata.
- Prove URLs, headers, response data, messages, credentials, request types,
  and arbitrary metadata do not survive the boundary or rendered details.
- Prove only exact public network/decrypt values affect classification.
- Prove a generic active-VHS code 3 stays unknown while non-VHS native code 3
  remains a media-decode diagnostic.
- Prove the component routes active VHS errors through the structured boundary
  and leaves generic Video.js errors on the native path.
- Prove technical details render only the sanitized VHS evidence.

Run the complete `ui-playback` unit target, its lint target, the web typecheck,
i18n validation, release-note validation, and the repository test-impact pass.
No E2E is required because the playback workflow, controls, routing, and
integration lifecycle are unchanged; the change is confined to the existing
terminal error boundary and technical details.

## Documentation And Release Note

Update `docs/architecture/embedded-inline-playback.md`, the canonical browser
playback diagnostic contract. Add a `fix(playback)` release note because users
receive more accurate default-player diagnoses and safer technical details.
