# Structured Shaka Diagnostics

## Context

PR #1314 stopped treating an ambiguous native `MediaError` as codec evidence
and retained explicit HTTP evidence. PR #1316 added an allowlisted hls.js
boundary for HTML5 and ArtPlayer. PR #1317 added an allowlisted Video.js/VHS
boundary for the default player. Shaka remains the only web source engine that
copies an arbitrary message and serialized `error.data` into a diagnostic.

The locked workspace installs Shaka Player `5.2.2`. The audit used the
installed package's public declarations, `shaka.util.Error` JSDoc, compiled
runtime exports, and the load/error paths in the installed source. The public
runtime reports:

- `shaka.Player.version === "v5.2.2"`;
- severity values `RECOVERABLE=1` and `CRITICAL=2`;
- category values `NETWORK=1`, `TEXT=2`, `MEDIA=3`, `MANIFEST=4`,
  `STREAMING=5`, `DRM=6`, `PLAYER=7`, `CAST=8`, `STORAGE=9`, and `ADS=10`;
- numeric `shaka.util.Error.Code` values documented by the installed public
  API.

The existing `ShakaVideoSession` binds the public `Player#error` event before
calling `load()`, and also observes the public `load()` rejection. Those paths
have different terminal meaning and must not be collapsed into a
severity-only gate.

## Goals

- Convert Shaka errors into a minimal allowlisted `ShakaPlaybackEvidence`
  value before classification or UI rendering.
- Retain only validated public severity, category, and code values, an
  explicit lifecycle disposition, a code-proven stage/failure kind, and a
  documented HTTP status.
- Classify only exact Shaka 5.2.2 category/code pairs.
- Keep insufficient or inconsistent evidence unknown.
- Keep recoverable player events from becoming terminal IPTVnator
  diagnostics.
- Treat a rejected `Player.load()` as terminal even when the final public
  Shaka error still carries `RECOVERABLE`.
- Prevent messages, URLs, headers, bodies, license/key payloads, credentials,
  and arbitrary objects from reaching stored or rendered diagnostics.
- Version-lock the allowlist and tests to the installed Shaka public API.

## Non-goals

- Changing hls.js or Video.js/VHS evidence contracts.
- Redesigning mpegts.js diagnostics.
- Adding top-level diagnostic codes, history, persistence, correlation,
  probes, automatic engine failover, or a cross-player recommendation matrix.
- Inspecting Shaka private loaders, networking state, parser internals, or
  retry counters.
- Changing VOD multi-source auto-failover.
- Inferring CORS, codec, DRM, container, or stage from message text.

## Approaches Considered

### Public error boundary with lifecycle disposition (selected)

Normalize the public `severity`, `category`, `code`, and only the documented
HTTP-status slot into `ShakaPlaybackEvidence`. The session supplies
`recoverable` for a recoverable event and `terminal` for a critical event or a
rejected load. Classification and technical details accept only the sanitized
evidence.

This preserves the strongest stable facts while making unsafe fields
structurally unavailable to downstream code. It also represents the important
case where Shaka's final network error remains severity-recoverable but the
load promise has terminated.

### Severity-only event and rejection gate

Suppressing every `severity=RECOVERABLE` error would hide a terminal manifest
load failure after Shaka exhausts retries. Treating every error as terminal
would tear down a player that Shaka is still recovering. The route that
delivers the error is therefore required evidence.

### Inspect request/parser internals

Private networking and parser state could reveal request types and richer
stages, but it also exposes URLs, headers, response data, license payloads, and
unstable implementation details. This is rejected by the privacy and public
contract requirements.

### Stop after the audit

Stopping would be correct if the public API could not distinguish safe facts
or terminal lifecycle. The installed API exposes exact enums, documented
status layouts, and distinct event/rejection semantics, so a stable focused
improvement is available.

## Installed Runtime And Event Ordering

Shaka 5.2.2 documents recoverable severity as an error from which the player
is attempting to recover. It explicitly warns that some media-segment retry
paths may never escalate to a critical error.

The installed runtime orders errors as follows:

1. `PreloadManager.onError()` rejects its success promise for a critical
   error, destroys preload work, and synchronously dispatches the public
   `error` event.
2. The existing session's event listener therefore observes that critical
   event before the `await player.load()` continuation handles the rejection.
3. Session teardown changes the current-player identity; the later rejection
   is ignored, preventing a duplicate diagnostic.
4. Direct manifest/parser failures can reject the preload/load promise without
   dispatching a player error. The load-rejection path must classify them.
5. The networking engine retries errors while their public severity is
   recoverable. When attempts are exhausted it throws the last error without
   rewriting its severity. A rejected `load()` is therefore terminal by
   lifecycle even if evidence says `severity=recoverable`.
6. A recoverable public player event is not terminal and must leave the
   current engine attached.

`LOAD_INTERRUPTED` is suppressed only when the exact public triple is
`CRITICAL + PLAYER + LOAD_INTERRUPTED`; an arbitrary object containing the
number `7000` is not enough.

## Version-locked Public Contract

The production allowlist contains the exact Shaka 5.2.2 severity/category
values and the public online-playback error codes used by the boundary. A
contract test loads the installed compiled package in a child Node process,
asserts `v5.2.2`, compares the full severity/category maps, and verifies every
allowlisted code name/value against `shaka.util.Error.Code`.

The explicit version assertion makes a dependency upgrade fail before new or
changed codes are silently accepted. An upgrade requires reviewing the new
public JSDoc layouts and lifecycle before updating the lock.

## Evidence Contract

`ShakaPlaybackEvidence` contains:

- `severity`: `recoverable`, `critical`, or `unknown`;
- `category`: one validated public category name in lowercase, otherwise
  `unknown`;
- `engineCode`: one allowlisted public numeric code, otherwise `unknown`;
- `disposition`: `terminal` or `recoverable`, supplied by the session route;
- `stage`: `manifest`, `segment`, `media`, `license`, or `unknown`;
- `failure`: `network`, `drm`, `manifest`, `media`, or `unknown`;
- optional `httpStatus`: an integer from 100 through 599.

The boundary does not retain:

- `error.message`;
- arbitrary or serialized `error.data`;
- request, redirect, manifest, segment, license, or certificate URLs;
- request or response headers;
- response text, bodies, or binary data;
- browser exceptions and events;
- DRM session metadata, keys, licenses, provider payloads, or credentials;
- unknown object properties.

The existing `PlaybackDiagnostic.sourceUrl` remains the active source metadata
used by Retry, Copy URL, explicit external-player actions, and the existing VOD
failover flow. No URL is copied from a Shaka error.

## HTTP Status Extraction

Shaka 5.2.2 publicly documents:

- `BAD_HTTP_STATUS` (`NETWORK`, code `1001`): `error.data[1]` is the status;
- `LICENSE_REQUEST_FAILED` (`DRM`, code `6007`): `error.data[0]` is a nested
  Shaka networking error;
- `SERVER_CERTIFICATE_REQUEST_FAILED` (`DRM`, code `6017`):
  `error.data[0]` is a nested Shaka networking error.

The boundary reads a status only from an exact `NETWORK + BAD_HTTP_STATUS`
shape, directly or through those two exact documented nested-error layouts.
It validates the integer protocol range and copies only the number. Status-like
values in any other data position or arbitrary object are ignored.

## Failure And Stage Mapping

Failure uses exact category/code pairs:

- allowlisted online network codes in the `NETWORK` category → `network`;
- allowlisted DRM codes in the `DRM` category → `drm`;
- exact manifest encryption/key-system codes → `drm`;
- exact media codes in the `MEDIA` category → `media`;
- exact manifest/parsing codes in the `MANIFEST` category → `manifest`;
- `DASH_UNSUPPORTED_CONTAINER` and
  `CONTENT_UNSUPPORTED_BY_BROWSER` → `media`, because the public descriptions
  prove a media support failure but the latter does not distinguish container
  from codec;
- inconsistent category/code pairs, internal/test-only ambiguity, and
  `RESTRICTIONS_CANNOT_BE_MET` → `unknown`.

Stage is narrower than failure:

- exact manifest codes → `manifest`;
- exact segment/index/init parsing codes and `SEGMENT_MISSING` → `segment`;
- exact MediaSource/video pipeline codes → `media`;
- exact license request/response/server-selection/expiry codes → `license`;
- everything else → `unknown`.

Messages and arbitrary data never affect either value.

## User-facing Classification

No new top-level diagnostic code is needed:

1. `failure=network` → `network-error`.
2. `failure=drm` → `drm-or-encryption`.
3. Exact `DASH_UNSUPPORTED_CONTAINER` →
   `unsupported-container`.
4. Exact MediaSource operation or video-element failure codes that identify
   the media pipeline → `media-decode-error`.
5. Manifest parsing, generic media parsing/transformation, ambiguous
   browser-content support, restrictions, unknown values, and inconsistent
   pairs → `unknown-playback-error`.

Shaka 5.2.2 has no exact public code that distinguishes an unsupported codec
from an unsupported container for the generic
`CONTENT_UNSUPPORTED_BY_BROWSER` case. It therefore remains unknown instead of
becoming a false codec or container diagnosis. No Shaka path emits
`browser-access-error` without a structured public access code.

## Session And Adapter Flow

`ShakaVideoSession` owns disposition:

- module-load rejection, unsupported browser capability, and `load()`
  rejection are terminal;
- a public error event is terminal only for the exact critical severity;
- a recoverable event is passed through the shared evidence/classifier gate,
  returns no diagnostic, and leaves the player attached;
- an event with unknown severity is ignored because terminal state is not
  proven;
- a terminal diagnostic tears down the engine once;
- ClearKey sources keep the existing rule that external fallback is
  unavailable because the external player never receives key configuration.

HTML5 and ArtPlayer keep their current Shaka session adapters. The structured
diagnostic travels through their existing `emitPlaybackIssue` callbacks; no
player-selection, source-selection, or VOD failover behavior changes.

Unsupported playlist DRM remains a pre-engine app diagnostic, but its
technical detail becomes a fixed safe description instead of echoing the
provider-supplied license string.

## User Interface

The existing technical “Error details” row renders only
`ShakaPlaybackEvidence`, for example:

`stage=unknown · failure=network · severity=recoverable · category=network · code=1001 · disposition=terminal · HTTP 503`

When structured Shaka evidence exists, legacy `details` and native message
fields are ignored even if a caller accidentally supplies them. Existing
titles, descriptions, HTTP badge, Retry, Copy URL, explicit MPV/VLC actions,
and layout remain unchanged. No translation or visual styling change is
required.

## Testing

Use test-driven development:

- Compare the allowlist/version with the real installed Shaka 5.2.2 runtime.
- Exercise real documented direct and nested HTTP error shapes.
- Prove all unsafe data fields and misleading messages are excluded.
- Cover exact network, DRM, manifest, container, media, restrictions,
  mismatched, and unknown classification.
- Prove recoverable classification returns no terminal diagnostic.
- Prove a recoverable-severity load rejection is terminal by lifecycle.
- Prove recoverable and unknown-severity events leave the session running.
- Prove a critical event during an in-flight load emits once and teardown does
  not duplicate the later rejection.
- Cover ClearKey fallback suppression and ArtPlayer adapter routing.
- Prove the rendered detail row uses only sanitized Shaka evidence.

Run the complete `ui-playback` unit target, its lint target, web typecheck,
i18n validation, release-note validation, and the repository test-impact pass.
No E2E is required because the player workflow, controls, source routing, and
integration lifecycle are unchanged; the event/rejection semantics are
covered at the session and adapter boundaries.

## Documentation And Release Note

Update `docs/architecture/embedded-inline-playback.md` as the canonical
browser diagnostic contract and the Shaka engine section in
`docs/architecture/m3u-playlist-module.md`. Keep the Shaka summaries in
`CLAUDE.md` and `AGENTS.md` current. Add a `fix(playback)` release note because
users receive safer technical details and more accurate Shaka diagnoses.
