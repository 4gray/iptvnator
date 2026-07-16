# Player-Controls Contract

This document is the canonical reference for IPTVnator's additive,
engine-agnostic player-controls contract and shared default controls.
Embedded MPV rendering and native-view bounds behavior remain documented in
[embedded-mpv-native.md](./embedded-mpv-native.md).

## Current status

PR #1148 lands a shared-controls foundation only:

- the `PlayerController` contract, default state, and capability presets;
- the standalone `app-player-controls` presentation component and its
  transient-state collaborators;
- a generic `WebVideoControlsAdapter` plus small host helpers;
- a default-off web rollout token; and
- focused unit/component tests.

No existing player consumes this layer yet. Video.js, html5+hls.js, ArtPlayer,
and embedded MPV keep their existing controls. The rollout token has no runtime
consumer in #1148, so changing it alone does not switch any player UI.
Engine-host wiring and an embedded-MPV adapter are follow-up work.

This distinction is intentional: the contract can be reviewed and hardened
without changing shipped playback behavior.

## Why this exists

Each playback engine currently owns both media integration and controls UI.
That makes behavior drift likely and makes a controls redesign depend on each
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
│ WebVideoControlsAdapter      │     │ Embedded-MPV adapter         │
│ Landed, generic, not wired   │     │ FOLLOW-UP: not implemented   │
└──────────────────────────────┘     └──────────────────────────────┘
```

The diagram shows the reusable boundary, not current runtime ownership. There
is no `app-player-controls` host in an existing engine component in #1148.

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
fullscreen delegate or native-fullscreen IPC path in #1148.

## Shared default controls

`PlayerControlsComponent` is a standalone presentation component designed for a
future engine host to mount over or beside its playback surface.

It owns only transient presentation behavior:

- `ControlsMenuState` — single-open popovers;
- `ControlsFeedback` — temporary action feedback;
- `ControlsVisibility` — reveal and auto-hide state;
- `ControlsFullscreen` — DOM fullscreen;
- `ControlsVolume` — optimistic volume state reconciled from controller state;
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

Auto-hide pauses while the pointer is over the controls bar or keyboard focus
is anywhere inside it. Focus entering a hidden bar reveals it; moving focus
between controls does not restart hiding, and leaving the bar resumes the normal
hide delay.

### Timeline scrubbing

Timeline input is previewed locally while the user drags. The slider value,
played progress, accessible value text, and current-time label all render the
preview. The component sends exactly one `seekTo` command on the committed
`change` event, then clears the preview and returns to controller-reported
state. Non-finite values are ignored and finite values are clamped to the
available `[0, duration]` range.

The volume slider intentionally remains continuous: each volume `input` applies
the optimistic volume immediately.

## Web adapter (landed, not wired)

`WebVideoControlsAdapter` can translate an `HTMLVideoElement` into the shared
contract. It uses DOM/media events and accepts optional engine-specific track
accessors through `WebVideoControlsOptions`, so the adapter itself stays usable
in the PWA and does not import a concrete web engine.

Native media events refresh the adapter automatically. A future engine host
must call the public `refresh()` hook after engine-specific getters change
without a corresponding media event, including track lists, corrected duration,
or live/VOD classification. Synchronous audio/subtitle selection commands
refresh automatically after the injected setter returns.

`web-video-controls.host.ts` contains small attachment/projection helpers for a
future host integration. No Video.js, html5+hls.js, or ArtPlayer component calls
those helpers in #1148.

The rollout symbols are:

| Symbol                               |       Default | Current effect                                                                      |
| ------------------------------------ | ------------: | ----------------------------------------------------------------------------------- |
| `WEB_PLAYER_SHARED_CONTROLS_ENABLED` |       `false` | Documents the intended rollout default.                                             |
| `WEB_PLAYER_SHARED_CONTROLS`         | default above | Injectable/test-overridable view of the default. No runtime player consumes it yet. |

A follow-up web integration must explicitly consume the token, attach the
adapter to the active video element, mount `app-player-controls`, and only then
disable the engine's existing skin.

## Embedded MPV rendering constraints

The shared contract does not replace the existing embedded-MPV renderer or
controls in #1148. Any follow-up embedded adapter must preserve the two current
rendering paths.

### Frame-copy engine

The experimental frame-copy engine uploads helper-produced frames to
`<canvas data-embedded-mpv-frame>`. The canvas is ordinary DOM, so controls,
dialogs, and other DOM layers can stack above it normally. This makes the
frame-copy path overlay-friendly, although the current embedded player still
uses its existing controls until follow-up shared-controls wiring lands.

### Native-view engine

The native MPV surface paints outside Chromium's DOM stacking model. It keeps
the compositor-safe fixed controls dock below the viewport. Modal overlays hide
the native surface with `HIDDEN_BOUNDS`, and control popovers reserve a bottom
cutout so their DOM region remains interactive.

The transparent BrowserWindow / `NSWindowBelow` tunnel-and-backdrop approach is
not the shipped architecture. #1148 does not add transparency changes, backdrop
holes, native fullscreen IPC, native-view attachment APIs, or bounds-tick
machinery.

See [embedded-mpv-native.md](./embedded-mpv-native.md) for the authoritative
renderer, bounds, and platform details.

## Follow-up integrations

The following are design seams, not shipped #1148 behavior:

1. **Web hosts** — mount the component, consume the rollout token, attach
   `WebVideoControlsAdapter`, and remove an engine skin only when the shared
   controls are active.
2. **Embedded-MPV adapter** — implement `PlayerController` over
   `EmbeddedMpvSessionController` without changing session ownership or native
   rendering behavior.
3. **Embedded-MPV layout** — use normal DOM layering for frame-copy; retain a
   compositor-safe dock for the native-view engine unless that engine's
   compositing architecture changes independently.
4. **Background playback** — introduce a persistent player/session host above
   route-scoped views. The contract is lifecycle-agnostic, but #1148 does not
   add that host or change current teardown behavior.

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

Not landed in #1148:

- an embedded-MPV `PlayerController` adapter;
- a shared-controls host inside an existing web or embedded player;
- removal/replacement of any current engine skin; and
- persistent/background player ownership.
