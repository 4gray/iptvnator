# Video.js Shared Controls Replacement Design

## Context

PR #1153 proposed wiring Video.js into the shared `app-player-controls`
layer. Its Video.js-specific ideas remain useful, but the stacked PR also
contains superseded embedded-MPV and HTML5 work and cannot be merged directly.

The replacement is built on the current `master`, after:

- #1193 established frame-copy embedded MPV with shared controls.
- #1194 established the current web-player controls contract, authoritative
  live/VOD metadata, diagnostic interaction gating, and source-owned cleanup.

The shared-controls feature flag remains disabled by default. Flag-off behavior
must stay unchanged.

## Goals

- Render the shared controls over Video.js when the feature flag is enabled.
- Preserve the native Video.js chrome and legacy series navigation when it is
  disabled.
- Expose Video.js audio and subtitle tracks through the common adapter.
- Rebind all DOM-backed state when Video.js replaces its Tech `<video>`.
- Keep diagnostics usable by disabling player interaction and exiting only the
  fullscreen session owned by the Video.js shell.
- Reduce `vjs-player.component.ts` below the 400-line hard limit.

## Non-goals

- Enable shared web controls by default.
- Add Video.js quality selection to the generic controls contract.
- Add generic aspect-ratio or PiP commands.
- Generalize the HTML5 text-track helper before a second implementation proves
  the abstractions are identical.

## Key lifecycle decision

Video.js 8.23.4 replaces the Tech `<video>` after `player.reset()`. A one-time
adapter attachment is therefore invalid.

The replacement must treat the Tech video as a session-owned resource:

1. Acquire it from `player.tech({ IWillNotUseThisInPlugins: true }).el()`.
2. Detach listeners and the adapter from the previous element.
3. Attach them to the current element.
4. Repeat after every `playerreset`.
5. Destroy the bridge/session before `player.dispose()`.

Raw MPEG-TS startup must wait for `playerreset`, but Video.js does not attach a
request token to that event and can defer `reset()` behind a pending
`play()`. The component therefore pauses first, coalesces reset-required source
changes, and calls `reset()` only after `player.paused()` is true. Every
`playerreset` rebinds the current Tech and applies the latest desired source,
so a late reset cannot restore a superseded source.

## Component boundaries

### `vjs-player.types.ts`

Owns the focused Video.js API types used by the component and collaborators.

### `vjs-video-element-session.ts`

Owns native Tech video listeners used in both flag states:

- `loadeddata` / `playing` clear playback diagnostics.
- `ended` emits the playback-ended output.

### `vjs-player-reset-coordinator.ts`

Owns pause-before-reset ordering, coalescing, actual-volume snapshots, reset
volume-change suppression, and whether the desired source is already applied
to the current Tech. This also prevents a pre-ready `playerreset` from starting
raw MPEG-TS twice.

- Rebind detaches the old video before attaching the new one.

### `vjs-audio-tracks.ts`

Owns:

- legacy Video.js audio-menu logging/setup;
- stable per-source IDs for shared controls;
- valid selection and exact track-list listener cleanup.

Invalid or stale IDs are no-ops.

### `vjs-text-tracks.ts`

Uses `player.textTracks()` because VHS remote subtitles are represented there.
It:

- exposes only `captions` and `subtitles`;
- assigns stable per-source IDs with a `WeakMap`;
- treats `-1` as explicit off;
- keeps explicit off through preference and track-list events;
- suppresses the selected default track while global captions are disabled;
- disables non-selected tracks so VHS does not keep multiple tracks active.

### `vjs-mpegts-session.ts`

Owns raw MPEG-TS create/attach/load/play, VOD duration normalization,
diagnostics, listener cleanup, and idempotent teardown.

### `vjs-player-controls.bridge.ts`

Owns the component-scoped `WebVideoControlsAdapter` binding:

- attaches to the current Tech video;
- rebinds only when the Tech element changes;
- delegates audio/subtitle access to the track collaborators;
- uses `player.duration()` as the corrected duration source;
- clears source-specific IDs before source replacement;
- refreshes live/VOD and caption inputs;
- detaches exactly once on destroy.

## Interaction ownership

When shared controls are enabled:

- the template does not expose native `controls`;
- Video.js receives `controls: false`;
- Video.js `userActions.click`, `doubleClick`, and `hotkeys` are disabled;
- Video.js spatial navigation is disabled;
- the stable `.vjs-player-shell` is the shared interaction/fullscreen surface;
- `showControls` and `shortcutsEnabled` follow `interactionEnabled`;
- a diagnostic exits fullscreen only when that shell owns
  `document.fullscreenElement`.

When the flag is disabled, existing Video.js options, chrome, plugins, and
legacy series navigation remain unchanged.

## Source transitions

### Normal Video.js source

1. Clear source-specific bridge/track state.
2. Destroy any raw MPEG-TS session.
3. Call `player.src(newSource)`.
4. Activate the new bridge source and refresh classification.

### Raw MPEG-TS source or empty source

1. Clear source-specific bridge/track state.
2. Destroy the current raw MPEG-TS session.
3. Record the latest desired source and request one coalesced reset.
4. Snapshot the actual Video.js volume and pause active playback.
5. Call `player.reset()` only after `player.paused()` is true.
6. On any `playerreset`, suppress/reset Video.js's temporary volume=1 change,
   restore the snapshot, and rebind the current Tech video.
7. Apply only the latest desired source and start mpegts.js when applicable.

If authoritative `isLive` metadata changes for an active raw MPEG-TS URL, the
same reset flow restarts mpegts.js with the corrected live/VOD mode and duration
listener policy.

## Testing strategy

- Focused unit suites for video-session, audio tracks, text tracks, MPEG-TS,
  and the controls bridge.
- Component integration tests for both flag states, fullscreen/diagnostic
  gating, reset ordering, and output forwarding.
- Host tests that pass `interactionEnabled` and `showCaptions` to both
  Video.js template branches.
- Existing `ui-playback` tests/lint, workspace typecheck, coverage, full lint,
  Web E2E, and Electron E2E before merge.

## Attribution

The replacement preserves the useful Video.js-specific direction from Lars
Emig's #1153, especially the audio-track extraction and default-off dual-chrome
model, while rebuilding it against the current lifecycle and controls
architecture.
