# Frame-Copy Shared Controls Design

## Status

Approved as part of the embedded-MPV merge plan: reuse the shared player
contract from #1148, keep the frame-copy renderer from #1169/#1171/#1175, and
replace the obsolete transparent-window/native-fullscreen direction from
#1150/#1151.

## Goal

Use `app-player-controls` as the controls UI for embedded MPV when the active
engine is `frame-copy`, while preserving the current compositor-safe controls
dock and behavior for the `native` engine.

## Non-goals

- Do not make the Electron `BrowserWindow` transparent.
- Do not place the macOS native MPV surface below Chromium.
- Do not add native fullscreen IPC, fill-mode IPC, native-view attachment
  APIs, or bounds-tick machinery.
- Do not change the shared `PlayerController` contract.
- Do not migrate the native-view engine to overlay controls.
- Do not change HTML5, Video.js, or ArtPlayer in this PR.

## Alternatives

### 1. Rebase and merge old #1150

Rejected. Its component and layout depend on a transparent macOS window,
`NSWindowBelow`, immersive backdrop/tunnel services, and compositor hooks that
#1149 deliberately removed. It also predates the frame-copy canvas.

### 2. Extend shared controls with native fullscreen delegates

Rejected. #1148 intentionally owns fullscreen through the DOM Fullscreen API.
Adding a native delegate would expand the shared contract and Electron IPC for
one engine while the frame-copy canvas already behaves like normal DOM.

### 3. Frame-copy-only shared-controls adapter

Selected. The frame-copy canvas can use ordinary DOM stacking and DOM
fullscreen. The native-view engine retains its existing dock and compositor
workarounds. This is the smallest change that validates the shared-controls
architecture in production playback without reviving the discarded overlay
design.

## Architecture

### Embedded MPV adapter

Add a component-scoped `EmbeddedMpvControlsAdapter` implementing
`PlayerController`.

The adapter reads the canonical state and commands from
`EmbeddedMpvSessionController`. The host configures it once with signal
references for:

- the current `ResolvedPortalPlayback`;
- optional `SeriesPlaybackNavigation`; and
- the recording folder.

The adapter derives:

- status and translated status message;
- position, duration, live/VOD classification, and seekability;
- volume;
- translated audio/subtitle track labels;
- playback-speed and aspect-ratio presets;
- recording capability, active state, elapsed time, and feedback message; and
- previous/next episode availability.

Every control command delegates to the session controller. Async command
failures remain contained by the existing command runner. Recording feedback is
owned by the adapter only for the shared-controls path; the native controls
keep their existing component-owned feedback.

Translation-dependent state reacts to language, translation-file, and default
language events. Recording intervals and dismissal timers are released when
the component-scoped adapter is destroyed.

### Host selection

`EmbeddedMpvPlayerComponent` chooses exactly one controls system:

- `support.engine === 'frame-copy'`: render `app-player-controls` over the
  existing canvas and pass the player root as `playerSurface`;
- every other embedded-MPV engine: render the current bespoke controls dock.

The frame-copy canvas uses the full player box. The native engine continues to
reserve the controls-dock height and keeps modal hiding and popover cutouts.

The legacy shortcut, pointer, click, double-click, cursor, and document-pointer
handlers become unavailable while frame-copy shared controls are active. This
prevents duplicate commands because `PlayerControlsComponent` owns those
interactions for its surface.

The existing component-level `fullscreenchange` listener remains responsible
for triggering embedded-MPV bounds synchronization. For frame-copy it does not
reveal the legacy controls; `PlayerControlsComponent` handles its own
fullscreen presentation state.

### Loading and error presentation

The current centered loading, stalled, unsupported, and error surfaces remain
in `EmbeddedMpvPlayerComponent`. Shared controls receive the same status through
the adapter so their visibility logic stays consistent, but this PR does not
redesign the central status layer.

### Series navigation

Shared-controls previous/next outputs forward through the component's existing
guarded episode outputs. Live playback never advertises series navigation.

## Error handling

- Missing or unsupported embedded MPV maps to the existing translated status
  messages.
- Command promises remain fire-and-forget at the shared contract boundary.
- Recording start/stop failures produce persistent messages; successful stop
  messages auto-dismiss after five seconds.
- A newer recording message cancels the previous dismissal timer.
- Destroying the adapter clears timers so late callbacks cannot update a dead
  view.

## Testing

### Adapter unit coverage

- capability mapping;
- live/VOD and series-navigation mapping;
- state/status mapping;
- translated track labels and translation-event reactivity;
- every delegated command;
- recording success/failure messages;
- elapsed recording time;
- stale timer protection and destroy cleanup.

### Host integration coverage

- frame-copy renders the canvas plus shared controls and no legacy dock;
- native renders the legacy dock and no shared controls;
- shared surface clicks, double-clicks, and keyboard shortcuts execute once;
- `showControls=false` detaches shared surface and shortcut behavior;
- DOM fullscreen targets the player root and still triggers bounds sync;
- previous/next outputs preserve navigation guards;
- changing the reported engine never leaves both controls systems active.

### Regression and validation

Keep existing native embedded-MPV tests by making their support fixtures
explicitly report `engine: 'native'`. Run focused UI playback tests and lint,
repository typecheck/i18n checks, the Electron smoke E2E, and manual/CDP checks
when a local frame-copy runtime is available.

## Documentation impact

Update the canonical controls and embedded-MPV architecture documents to state
that frame-copy is the first shared-controls consumer while native-view remains
on its dock. Update `AGENTS.md` and `CLAUDE.md` because both describe the
embedded-MPV/player-controls ownership boundary.
