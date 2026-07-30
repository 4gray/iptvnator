# Structured HLS Diagnostics

## Context

PR #1314 made native media diagnostics evidence-based, but the HLS path still
normalizes `type`, `details`, `message`, and an arbitrary `error` payload into
one string. `classifyHlsPlaybackIssue` then searches that string for broad
fragments such as `network`, `status`, and `codec`. This can misclassify a
provider message, and serializing arbitrary values can retain URLs,
credentials, response content, loader context, or other provider data.

IPTVnator currently installs hls.js 1.6.16. Its public `ErrorData` supplies
structured `type`, `details`, `fatal`, and an optional `response.code`.
Specific `ErrorDetails` values also identify the manifest, level, segment, key,
or media stage. The same payload contains unsafe or unbounded fields, including
`error`, `reason`, `networkDetails`, `context`, `loader`, `url`, and response
URL/text/data, which are not needed for classification.

Both the HTML5 player and ArtPlayer subscribe to `Hls.Events.ERROR`. They
currently ignore `fatal: false` before calling the classifier, but each adapter
builds the broad string input independently.

## Goals

- Create one structured HLS evidence boundary for the installed hls.js error
  shape.
- Retain only allowlisted engine type/detail identifiers, the final
  fatal/recoverable disposition, a stage derived from exact details, a
  structured failure kind, and a validated HTTP status when present.
- Classify HLS failures from exact engine values rather than substring
  heuristics.
- Keep insufficient evidence explicitly unknown.
- Ensure recoverable hls.js events never become terminal playback diagnostics.
- Use the same extraction and classification path in HTML5 and ArtPlayer.
- Show only the sanitized evidence in technical diagnostic details.

## Non-goals

- Diagnostic history, persistence, correlation, or telemetry.
- Additional manifest or stream probes.
- Automatic player failover.
- A Shaka or mpegts.js diagnostic redesign.
- A cross-player confidence or likelihood matrix.
- Inferring browser access failures from status zero, `TypeError`, or error
  message text.
- Changing hls.js retry, level-switch, or recovery behavior.

## Approaches Considered

### Boundary sanitizer (selected)

Convert hls.js `ErrorData` into a small `HlsPlaybackEvidence` value at the
adapter boundary. The classifier accepts only that value. This centralizes the
allowlist, makes unsafe fields structurally unavailable to classification and
UI code, and gives HTML5 and ArtPlayer identical behavior.

### Pass `ErrorData` directly

This would preserve the strongest TypeScript relationship with hls.js, but it
would leave every consumer able to read or render URLs, loader state, headers,
response payloads, and arbitrary errors. It also makes privacy depend on each
future call site remembering the same exclusions.

### Keep the broad input and tighten string tests

Exact comparisons could improve classification, but the adapters would still
copy arbitrary messages and objects into diagnostics. This would not establish
the requested safe evidence contract.

## Evidence Contract

`HlsPlaybackEvidence` contains:

- `engineType`: one of the installed hls.js `ErrorTypes` values, otherwise
  `unknown`;
- `engineDetails`: one of the installed hls.js `ErrorDetails` values,
  including its existing `unknown` value;
- `disposition`: `fatal` when `ErrorData.fatal === true`, otherwise
  `recoverable`;
- `stage`: `manifest`, `level`, `segment`, `key`, `media`, or `unknown`;
- `failure`: `http`, `timeout`, `network`, `access`, or `unknown`;
- optional `httpStatus`: an integer from 100 through 599 copied only from
  `ErrorData.response.code`.

The `access` value is part of the contract but hls.js 1.6.16 does not expose a
reliable structured CORS, mixed-content, CSP, or private-network-access code.
Status zero and generic fetch failures can also mean DNS, offline, connection,
or abort failures. The extractor therefore does not emit `access` for current
runtime shapes; it uses `network` or `unknown` and never inspects message text.

The extractor does not copy:

- `ErrorData.url`;
- `context`, including request URLs and headers;
- `networkDetails` or loader instances;
- `response.url`, `response.text`, or `response.data`;
- `error`, deprecated `err`, `reason`, events, fragments, or arbitrary values.

The existing playback metadata still carries the active source URL for the
pre-existing Retry, Copy URL, and explicit external-player workflows. No HLS
error URL is copied into evidence or shown in technical details.

## Stage Mapping

Stages are derived only from exact `ErrorDetails` values:

- `manifest`: manifest load, timeout, parsing, and incompatible-codec details;
- `level`: level load, timeout, parsing, empty, and switch details, plus
  audio/subtitle track playlist load details;
- `segment`: fragment load, timeout, parsing, decrypt, and gap details;
- `key`: key load/timeout and key-system details;
- `media`: buffer, mux/remux, attach-media, and playback-stall details;
- `unknown`: internal, aborted, interstitial, unrecognized, or otherwise
  unmapped details.

This mapping describes the engine stage, not root-cause likelihood. For
example, a segment-stage timeout is still classified as a network timeout.

## Failure Mapping

Failure kind uses this precedence:

1. Exact timeout details produce `timeout`.
2. A validated 4xx or 5xx `response.code` produces `http`.
3. Exact network load-error details, or the exact `networkError` engine type,
   produce `network`.
4. No current hls.js 1.6.16 field independently proves `access`.
5. Everything else is `unknown`.

A 1xx, 2xx, or 3xx status remains retained as factual response metadata but
does not by itself produce an HTTP-failure kind.

## Classification

`classifyHlsPlaybackIssue` returns `PlaybackDiagnostic | null`:

1. `recoverable` returns `null` before classification.
2. Exact incompatible/add-codec details produce `unsupported-codec`.
3. Exact key-system or fragment-decrypt evidence produces
   `drm-or-encryption`.
4. Exact network type, load/timeout details, or HTTP failure evidence produces
   `network-error`.
5. Exact media or mux type produces `media-decode-error`.
6. Everything else produces `unknown-playback-error`.

The HLS path does not emit `browser-access-error` without structured access
evidence. It also does not classify `keyLoadError` as DRM: failure to fetch an
encryption key is network evidence, while `fragDecryptError` and key-system
details are encryption/DRM evidence.

The normalized `PlaybackDiagnostic` retains the sanitized HLS evidence and
copies its validated HTTP status into the existing top-level `httpStatus`
field. External fallback recommendations continue to derive from the final
diagnostic code.

## Adapter Flow

HTML5 and ArtPlayer both use:

1. `createHlsPlaybackEvidence(data)`;
2. `classifyHlsPlaybackIssue(evidence, sourceMetadata)`;
3. emit only when the classifier returns a diagnostic.

The fatal gate therefore lives in the shared classifier rather than being
duplicated in the two adapters. hls.js registers its final error-controller
listener during construction, before IPTVnator subscribes, so the application
observes the final `fatal` value after retry/alternate handling has had a
chance to update it.

## User Interface

The existing technical “Error details” row renders a deterministic, safe HLS
summary made only from the evidence fields, for example:

`stage=manifest · failure=http · type=networkError · details=manifestLoadError · disposition=fatal · HTTP 404`

No HLS error message, URL, header, body, response text, or arbitrary provider
payload appears. HLS startup development logs are event-only and omit
provider-supplied channel names and source URLs. Existing title/description and
HTTP metadata rendering remain unchanged, so no new translation keys or layout
changes are required.

## Testing

Use test-driven development:

- Add extractor tests using hls.js 1.6.16-shaped manifest, level, segment, key,
  media, HTTP, timeout, and unknown payloads.
- Prove unrecognized runtime values become `unknown`.
- Prove response URLs/text/data, request context/headers, error messages,
  network details, and credential-shaped payloads do not appear in evidence or
  rendered details.
- Add classifier tests for exact codec, DRM, network, media, and unknown
  values.
- Prove misleading strings cannot override structured engine values.
- Prove recoverable events return `null`.
- Update HTML5 and ArtPlayer integration tests to cover fatal HTTP evidence and
  recoverable suppression through the shared path.
- Add a focused view test for the deterministic safe HLS summary.

Run the complete `ui-playback` unit target, its lint target, the web typecheck,
i18n drift validation, and release-note validation. No E2E is required because
the player workflow and diagnostic controls are unchanged; adapter, classifier,
and rendered-detail behavior are covered at their closest unit/component
boundaries.

## Documentation And Release Note

Update `docs/architecture/embedded-inline-playback.md`, the canonical playback
diagnostic description, to replace raw HLS details with the structured
contract. Add a `fix(playback)` release note because users receive more accurate
HLS diagnoses and safer technical details.
