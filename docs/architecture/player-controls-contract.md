# Player-Controls Contract

This document is the canonical reference for IPTVnator's additive,
engine-agnostic player-controls contract and shared default controls.
Embedded MPV rendering and native-view bounds behavior remain documented in
[embedded-mpv-native.md](./embedded-mpv-native.md).

## Current status

The shared-controls foundation from PR #1148 now has two runtime consumers:

- the `PlayerController` contract, default state, and capability presets;
- the standalone `app-player-controls` presentation component and its
  transient-state collaborators;
- a generic `WebVideoControlsAdapter` plus small host helpers;
- a default-off web rollout token;
- the component-scoped `EmbeddedMpvControlsAdapter`;
- an `EmbeddedMpvPlayerComponent` host integration for the frame-copy engine;
- a feature-flagged `HtmlVideoPlayerComponent` integration backed by
  `WebVideoControlsAdapter` and a player-local engine bridge; and
- focused unit/component tests.

When Embedded MPV reports `engine: 'frame-copy'`, the component mounts
`app-player-controls` over the DOM canvas and routes state and commands through
`EmbeddedMpvControlsAdapter`. When it reports the native-view engine, the
component keeps the existing compositor-safe controls dock. Exactly one of
those control systems is active at a time.

When `WEB_PLAYER_SHARED_CONTROLS` is enabled, the built-in HTML5 player mounts
the same presentation component over its real player shell and disables the
native video controls. Its local bridge supplies HLS/native tracks, corrected
MPEG-TS VOD duration, and authoritative live/VOD metadata to the generic web
adapter. When the flag is disabled, the native controls and legacy series
navigation remain unchanged and the adapter is not attached.

Video.js and ArtPlayer do not consume the shared layer yet. Their existing
skins remain active, and `WEB_PLAYER_SHARED_CONTROLS_ENABLED` remains
default-off, so the guarded HTML5 integration does not change normal runtime
behavior.

This rollout is intentionally engine-selective: frame-copy can use normal DOM
layering, while the native platform view cannot. The integration also includes
a recording coordinator that correlates asynchronous snapshots with the active
playback/session owner, serializes toggles, and cancels pending ownership when
the session, playback, engine, or component changes.

## Why this exists

Historically each playback engine owned both media integration and controls UI.
That made behavior drift likely and made a controls redesign depend on each
engine's implementation details.

The shared contract separates:

- **presentation** — what the controls render and which interactions they own;
- **state and capabilities** — the engine-neutral snapshot the UI reads; and
- **commands** — the small imperative surface an engine adapter implements.

Rendering and compositing remain engine responsibilities. In particular, the
contract does not make a native video surface behave like DOM content.

## Landed architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ app-player-controls                                                  │
│ Standalone shared presentation component                            │
│ Menus · feedback · auto-hide · DOM fullscreen · shortcuts · scrub UI│
└───────────────────────────────┬──────────────────────────────────────┘
                                │ input.required<PlayerController>()
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ PlayerController                                                     │
│ capabilities: Signal<PlayerControlsCapabilities>                    │
│ state:        Signal<PlayerControlsState>                           │
│ commands:     PlayerControlsCommands                                │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                   adapters implement this boundary
                                │
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
┌──────────────────────────────┐     ┌──────────────────────────────┐
│ WebVideoControlsAdapter      │     │ EmbeddedMpvControlsAdapter   │
│ Generic, component-scoped    │     │ Component-scoped             │
└──────────────┬───────────────┘     └──────────────┬───────────────┘
               │                                    │
               ▼                                    ▼
┌──────────────────────────────┐     ┌──────────────────────────────┐
│ HtmlVideoPlayerComponent     │     │ EmbeddedMpvPlayerComponent   │
│ flag on: shared controls     │     │ frame-copy: shared controls  │
│ flag off: native controls    │     │ native-view: legacy dock     │
└──────────────────────────────┘     └──────────────────────────────┘
```

The embedded host selects controls from the reported engine before rendering
them. It never mounts the shared overlay and legacy dock together.
The HTML5 host likewise selects native or shared controls before rendering and
never attaches the web adapter while the native path is active.

## The contract

The contract is defined in
`libs/ui/playback/src/lib/player-controls/player-controls.model.ts`.

```ts
interface PlayerController {
    readonly capabilities: Signal<PlayerControlsCapabilities>;
    readonly state: Signal<PlayerControlsState>;
    readonly commands: PlayerControlsCommands;
}
```

### Capabilities

`PlayerControlsCapabilities` contains booleans for `seek`, `volume`,
`audioTracks`, `subtitles`, `playbackSpeed`, `aspectRatio`, `recording`,
`fullscreen`, and `seriesNavigation`.

The default is all-false. An adapter enables only features that its engine and
current runtime support. Capability flags primarily control whether optional UI
is rendered; state such as `canSeek`, `canPreviousEpisode`, and
`canNextEpisode` guards the corresponding action at runtime.

### State

`PlayerControlsState` is one reactive engine-neutral snapshot:

- playback status, loading/error message, and stalled state;
- current position, optional duration, live/VOD classification, and seekability;
- volume;
- pre-labelled audio/subtitle tracks and subtitle-enabled state;
- playback speed and aspect-ratio selections/presets;
- recording state; and
- previous/next episode availability.

Adapters translate engine types into this model. The controls component must not
import Video.js, hls.js, ArtPlayer, libmpv, Electron IPC, or native-view types.
Recording state may expose a `transitionKey` that identifies its current
playback/session owner. When that key changes, shared feedback adopts the new
active baseline without flashing a start or saved transition from the previous
owner.

### Commands

`PlayerControlsCommands` is an imperative, fire-and-forget surface:

- `togglePlay`
- `seekTo` / `seekBy`
- `setVolume`
- `setAudioTrack` / `setSubtitleTrack`
- `setPlaybackSpeed`
- `setAspectRatio`
- `toggleRecording`

Episode navigation is deliberately exposed as component outputs
(`previousEpisodeRequested` and `nextEpisodeRequested`) because the owning
playlist/portal feature decides which item to play.

Fullscreen is also outside the engine command contract. The landed component
uses `ControlsFullscreen`, which operates on the supplied DOM player surface
through `requestFullscreen()` / `document.exitFullscreen()`. There is no
fullscreen delegate or native-fullscreen IPC path. `ControlsFullscreen.sync()`
reconciles state when a surface attaches or changes, including when that
surface is already fullscreen. The Embedded MPV host's existing
`fullscreenchange` listener still triggers bounds sync so frame-copy render
size follows the fullscreen DOM surface.

## Shared default controls

`PlayerControlsComponent` is a standalone presentation component. The
frame-copy Embedded MPV host mounts it over its DOM canvas, and the guarded
HTML5 host mounts it over `.html-video-player-shell`.

It owns only transient presentation behavior:

- `ControlsMenuState` — single-open popovers;
- `ControlsFeedback` — temporary action feedback;
- `ControlsVisibility` — reveal and auto-hide state;
- `ControlsFullscreen` — DOM fullscreen;
- `ControlsVolume` — persisted/optimistic volume state reconciled from
  controller state;
- `ControlsShortcuts` — document keyboard routing;
- `ControlsSurface` — pointer/click/double-click surface interactions; and
- `controls-view-model.ts` — derived display state.

### Keyboard ownership

Unmodified Space/K, F, arrow keys, and M are playback shortcuts. Playback keys
with Meta/Cmd, Control, or Alt are ignored and are not prevented, so app and OS
accelerators retain ownership. Escape remains available to close controls
popovers even when a modifier is held or playback shortcuts are unavailable.
Buttons, form controls, links, ARIA menu controls, and content-editable targets
are also ignored anywhere in the event's composed path.

Action-specific keys are prevented only when the active controller can handle
them: seek requires both capability and current seekability, volume/mute
requires volume capability, and fullscreen requires an available DOM
fullscreen path. Unsupported keys retain their browser or application default.

When multiple shared-controls instances are mounted, the first attached
instance owns shortcuts initially. Pointer, focus, or control interaction
activates that instance through the normal reveal path. If the active instance
becomes unavailable, playback shortcuts fall back to the most recently attached
available instance; detaching the active instance also transfers ownership.
Escape remains a global dismissal action and closes popovers on every mounted
controls instance.

Auto-hide pauses while the pointer is over the controls bar or keyboard focus
is anywhere inside it. Focus entering a hidden bar reveals it; moving focus
between controls does not restart hiding, and leaving the bar resumes the normal
hide delay. In fullscreen playback, hiding the controls also hides the pointer
over both the controls host and the supplied player surface; revealing controls
or destroying the component restores the surface's previous inline cursor.

Open popovers are reconciled against the current capability and state snapshot.
If controls are hidden, a capability is removed, or the corresponding track
list becomes unavailable, the stale popover closes instead of pinning the
controls visible or consuming the next surface click.

Setting `showControls` to false also detaches playback-surface pointer, click,
and double-click handling. A hidden shared-controls instance therefore cannot
reveal, pause, or fullscreen the player underneath another UI layer.

The frame-copy Embedded MPV host also disables shared playback shortcuts while
a modal/backdrop overlay is active, so transport, seek, volume, and fullscreen
actions cannot leak through it. Escape keeps the shared component's generic
popover-dismissal behavior.

The HTML5 host applies the same ownership rule while its playback diagnostic is
visible: `WebPlayerViewComponent` passes
`interactionEnabled = visiblePlaybackDiagnostic() === null`, and the HTML5
component binds that value to both `showControls` and `shortcutsEnabled`.
If that shell owns DOM fullscreen, the host exits fullscreen before hiding the
controls so the sibling diagnostic banner and its retry/fallback actions remain
visible; fullscreen owned by another element is left untouched. Retrying
playback or clearing the diagnostic restores both interaction paths.

Frame-copy recording transitions use the adapter's playback/session identity as
their `transitionKey`. Session disposal, retry, channel changes, and engine
handoff therefore clear stale recording ownership without showing a false
`RECORDING_SAVED` confirmation.

### Timeline scrubbing

Timeline input is previewed locally while the user drags. The slider value,
played progress, accessible value text, and current-time label all render the
preview. The component sends exactly one `seekTo` command on the committed
`change` event, then clears the preview and returns to controller-reported
state. Non-finite values are ignored and finite values are clamped to the
available `[0, duration]` range.

The scrub slider and seek shortcuts require both the `seek` capability and
seekable runtime state. When seek is unsupported, the slider is omitted while
live and recording status remain visible. Volume shortcuts likewise require the
`volume` capability.

When a volume-capable controller first attaches, an existing `localStorage`
volume preference is applied before the first controller snapshot can reconcile
the optimistic value. With no saved preference, the controller snapshot remains
authoritative. If the same controller loses and later regains the volume
capability, initialization runs again for the new capability epoch. The volume
slider intentionally remains continuous: each volume `input` applies the
optimistic volume immediately.

## Web adapter and HTML5 engine bridge

`WebVideoControlsAdapter` can translate an `HTMLVideoElement` into the shared
contract. It uses DOM/media events and accepts optional engine-specific track
accessors through `WebVideoControlsOptions`, so the adapter itself stays usable
in the PWA and does not import a concrete web engine.

Native media events refresh the adapter automatically. An engine host must call
the public `refresh()` hook after engine-specific getters change
without a corresponding media event, including track lists, corrected duration,
or live/VOD classification. Source, readiness, progress, seeking, and playback
events that can invalidate the snapshot are observed directly.

Audio and subtitle capabilities are advertised only when the injected getter
returns a selectable list and the corresponding setter exists. Track setters
may complete synchronously or asynchronously; the adapter refreshes after
successful completion and contains synchronous throws or rejected promises
while an engine is changing source.

An injected non-`NaN` duration is authoritative, including positive infinity;
`NaN` falls back to the video element. Without an explicit `isLive` accessor,
only positive infinity implies live playback, so unknown duration is not
temporarily mislabeled as live. An attached element with no resource maps to
`idle`, paused preload/warm-up remains playable, and only actively playing media
with insufficient data maps to `loading`.

`HtmlVideoPlayerControlsBridge` attaches the adapter to the HTML5 video element
and delegates engine-specific work to focused HLS and native-text-track
collaborators. HLS track IDs remain the list indices accepted by hls.js. Native
caption/subtitle IDs remain stable for the lifetime of a source through a
`WeakMap`, even when the browser removes or reorders tracks. Source replacement
removes track listeners before the old HLS instance is destroyed, resets any
per-source subtitle override, and leaves exactly one engine source bound.

Live/VOD classification comes from `WebPlayerViewComponent.resolvedIsLive`:
explicit `ResolvedPortalPlayback.isLive` wins, otherwise content metadata means
VOD and its absence means live. The same computed value configures Video.js,
the HTML5 bridge, and mpegts.js; media duration is never used to infer the
classification.

Raw MPEG-TS VOD can expose `video.duration === Infinity`. For that source only,
the bridge uses the first finite positive value from `video.duration`, the last
valid seekable end, or the last valid buffered end. Without a known duration it
keeps the source classified as VOD while seeking remains unavailable.

`web-video-controls.host.ts` still contains small generic
attachment/projection helpers. Video.js and ArtPlayer do not call them yet.

The rollout symbols are:

| Symbol                               |       Default | Current effect                                                                                                       |
| ------------------------------------ | ------------: | -------------------------------------------------------------------------------------------------------------------- |
| `WEB_PLAYER_SHARED_CONTROLS_ENABLED` |       `false` | Keeps existing web-player skins active in normal runtime builds.                                                     |
| `WEB_PLAYER_SHARED_CONTROLS`         | default above | Injectable/test-overridable view consumed by the HTML5 host to switch atomically between native and shared controls. |

## Embedded MPV rendering constraints

The shared contract does not replace either Embedded MPV renderer. The host
uses the renderer's reported engine to choose the compatible controls UI.

### Frame-copy engine

The experimental frame-copy engine uploads helper-produced frames to
`<canvas data-embedded-mpv-frame>`. The canvas is ordinary DOM, so controls,
dialogs, and other DOM layers can stack above it normally. This path is the
first runtime consumer of `app-player-controls`, backed by a component-scoped
`EmbeddedMpvControlsAdapter`.

The shared controls receive the whole player root as their DOM surface. Turning
`showControls` off detaches surface interaction and playback-shortcut
ownership; Escape remains available for generic popover dismissal.
Backdrop-bearing overlays disable playback shortcuts. Fullscreen uses the DOM
Fullscreen API on that root, while the Embedded MPV component continues bounds
sync so the helper renders at the current viewport size.

Recording snapshots arrive independently from command promise settlement. The
adapter therefore treats snapshots as observations rather than acknowledgments
by themselves: it accepts only fresh same-session transitions, permits only one
pending toggle, waits for command settlement and the expected state, preserves
addon error text, and cancels pending state/feedback when playback, session, or
engine ownership changes. Command replies are reconciled by snapshot freshness:
a same-session broadcast that arrived while IPC was pending wins over an older
or same-timestamp reply, so a latched recording acknowledgement cannot be rolled
back to the command's stale baseline.

### Native-view engine

The native MPV surface paints outside Chromium's DOM stacking model. It keeps
the compositor-safe fixed controls dock below the viewport. Modal overlays hide
the native surface with `HIDDEN_BOUNDS`, and control popovers reserve a bottom
cutout so their DOM region remains interactive.

The transparent BrowserWindow / `NSWindowBelow` tunnel-and-backdrop approach is
not the shipped architecture. The shared-controls integration does not add
transparency changes, backdrop holes, native fullscreen IPC, native-view
attachment APIs, or bounds-tick machinery.

See [embedded-mpv-native.md](./embedded-mpv-native.md) for the authoritative
renderer, bounds, and platform details.

## Follow-up integrations

The remaining design seams are:

1. **Video.js and ArtPlayer** — add engine-specific adapters/bridges, consume
   the rollout token, and remove each engine skin only when shared controls are
   active.
2. **Native-view UI** — retain the compositor-safe dock unless the native
   engine's compositing architecture changes independently. A native-view
   migration is not part of the frame-copy rollout.
3. **Background playback** — introduce a persistent player/session host above
   route-scoped views. The contract is lifecycle-agnostic; this integration
   does not add that host or change current teardown behavior.

## File map

Landed in #1148:

```text
libs/ui/playback/src/lib/player-controls/
├── player-controls.model.ts
├── player-controls-defaults.ts
├── player-controls.component.ts
├── player-controls.component.html
├── player-controls.component.scss
├── controls-feedback.ts
├── controls-format.utils.ts
├── controls-fullscreen.ts
├── controls-menu-selection.ts
├── controls-menu-state.ts
├── controls-shortcuts.ts
├── controls-surface.ts
├── controls-view-model.ts
├── controls-visibility.ts
├── controls-volume.ts
├── web-player-controls.flag.ts
├── web-video-controls.adapter.ts
├── web-video-controls.host.ts
└── index.ts
```

Focused specs live beside these files. The subtree is exported from
`libs/ui/playback/src/index.ts`.

The Embedded MPV integration lives in:

```text
libs/ui/playback/src/lib/embedded-mpv-player/
├── embedded-mpv-controls.adapter.ts
├── embedded-mpv-controls-recording.ts
├── embedded-mpv-controls-recording-feedback.ts
├── embedded-mpv-player.component.ts
├── embedded-mpv-player.component.html
└── embedded-mpv-session-controller.ts
```

The adapter and recording helpers are component-scoped through
`EmbeddedMpvPlayerComponent`.

The guarded HTML5 integration lives in:

```text
libs/ui/playback/src/lib/html-video-player/
├── html-video-player-controls.bridge.ts
├── html-video-player-hls-controls.ts
├── html-video-player-native-text-tracks.ts
├── html-video-player.component.ts
└── html-video-player.component.html
```

`HtmlVideoPlayerComponent` provides a component-scoped
`WebVideoControlsAdapter`. The bridge and its collaborators are player-local
because HLS/native track identity, caption preference, and cleanup are tied to
one active source. Video.js/ArtPlayer skin removal and persistent/background
player ownership have not landed.
