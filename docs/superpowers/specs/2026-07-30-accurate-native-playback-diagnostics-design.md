# Accurate Native Playback Diagnostics

## Context

Issue #1159 reports that an unavailable HLS URL is presented as an unsupported
codec. Video.js can surface a failed request as `MediaError` code 4
(`MEDIA_ERR_SRC_NOT_SUPPORTED`), but that code does not prove that the source's
codec is incompatible. The current native classifier treats every code-4
failure that is not a known unsupported container as `unsupported-codec`, so an
`.m3u8` request with an HTTP failure receives misleading codec wording and a
native-player recommendation.

The local Video.js boundary also narrows `player.error()` to `code` and
`message`, even though Video.js errors may expose an HTTP `status` and
structured `metadata`. That prevents the shared diagnostic from retaining an
explicit response status such as 404.

## Goals

- Never claim that an ambiguous native code-4 failure proves an unsupported
  codec.
- Preserve a valid HTTP error status reported by Video.js and classify it as a
  provider/network loading failure.
- Show the HTTP status prominently and in technical details without adding a
  new top-level diagnostic code or new translated prose.
- Keep confirmed unsupported-container and independently confirmed
  unsupported-codec diagnostics unchanged.
- Add regression coverage for the issue's HLS/404 shape.

## Non-goals

- Redesign the complete playback diagnostic taxonomy.
- Capture the richer hls.js, Shaka, mpegts.js, Embedded MPV, MPV, or VLC error
  models.
- Add confidence levels, per-player fallback likelihood, recoverable warning
  history, stream probes, or automatic player failover.
- Persist or correlate playback attempts across engines.
- Infer an HTTP status, CORS failure, codec failure, or provider outage when the
  runtime does not expose structured evidence.

## Diagnostic Contract

Extend the native error input with the safe Video.js fields needed by the
classifier:

- optional numeric `status`;
- optional metadata containing a bounded vendor `errorType`.

Extend `PlaybackDiagnostic` with:

- optional `httpStatus`;
- optional `nativeErrorType`.

Only integer HTTP error statuses from 400 through 599 are accepted as evidence.
Status `0`, missing values, success statuses, redirects, strings, and
out-of-range values remain unknown. Arbitrary metadata, response bodies,
headers, and URLs are not copied into the diagnostic because they may contain
credentials or provider data. A metadata error type is retained only when it
matches the vendor-identifier form `[A-Za-z0-9._:-]{1,128}`; every other value
is ignored rather than truncated or rendered.

## Classification Rules

Native classification uses the following precedence:

1. An explicit valid HTTP error status produces `network-error`, retains the
   status, and does not recommend an external player. The same URL and request
   context are expected to fail independently of the decoder.
2. Native code 2 keeps the existing network/browser-access classification.
3. Native code 3 keeps the existing media-decode classification.
4. Native code 4 remains `unsupported-container` only when source metadata
   independently identifies a container already known to be unsuitable for the
   browser path.
5. Every other native code-4 failure becomes `unknown-playback-error` and does
   not recommend an external player. The UI must not substitute a codec or
   network guess.
6. Other native errors keep the existing unknown classification.

`unsupported-codec` remains available when codec incompatibility is supported
by independent evidence, such as the HLS incompatible-codec error details or
the existing manifest codec capability check.

## Video.js Boundary

The focused `VideoJsPlayer` error type retains `status` and the safe metadata
error type instead of narrowing the error to `code` and `message`.
`VjsPlayerComponent` continues to pass `player.error()` into the shared native
classifier; no Video.js-specific classifier or duplicate UI path is added.

This PR does not subscribe to additional VHS request events. If Video.js does
not expose an HTTP status on its terminal error, the result deliberately stays
ambiguous.

## User Interface

An HTTP-backed `network-error` uses the existing translated network title and
description. Its visible diagnostic metadata shows `HTTP <status>` before
container or MIME information, so the issue's unavailable HLS source displays
`HTTP 404` rather than `m3u8`. The existing translated “Error details” row
combines the safe HTTP status and Video.js error type when present, avoiding
new translation keys.

An ambiguous code-4 failure uses the existing unknown-playback title and
description. Because no external fallback is recommended without codec,
container, decode, or browser-access evidence, the surface retains retry/copy
actions but does not present MPV or VLC as a likely fix.

No new translation keys or layout changes are required.

## Testing

Use test-driven development:

- Add a classifier regression proving that code 4 plus `.m3u8` and status 404
  becomes `network-error`, retains `httpStatus: 404`, and does not recommend an
  external player.
- Add a classifier regression proving that code 4 plus `.m3u8` without a valid
  status becomes `unknown-playback-error`, not `unsupported-codec`.
- Prove that status `0` is not presented as an HTTP response.
- Keep the existing known-container code-4 case as
  `unsupported-container`.
- Update the Video.js component test to prove that `status` and the safe
  metadata error type cross the component boundary.
- Update focused diagnostic-view tests to prove that `HTTP 404` is visible and
  the new technical fields are rendered.

Run the `ui-playback` unit test and lint targets, the workspace typecheck
target, i18n drift validation, and release-note validation. No new E2E flow is
required because the diagnostic overlay layout and user interaction are
unchanged; the classifier, component boundary, and rendered metadata are
covered by focused unit/component tests.

## Documentation And Release Note

Update `docs/architecture/embedded-inline-playback.md` to document the
evidence requirement for native code 4 and preservation of explicit HTTP
statuses. Add one `fix` release note under `.changes/` for issue #1159.

## Alternatives Considered

- **Copy-only fix:** Mapping every code-4 failure to the existing unknown text
  would remove the false codec claim, but would continue discarding an explicit
  404 and provide less useful support information.
- **Full diagnostic redesign:** Adding the complete HTTP/manifest/decode
  taxonomy and all player adapters would improve coverage, but it is too broad
  for the focused regression fix and will be handled in separate work.
