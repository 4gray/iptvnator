# Player-Controls Contract

This document is the canonical reference for IPTVnator's additive,
engine-agnostic player-controls contract and shared default controls.
Embedded MPV rendering and native-view bounds behavior remain documented in
[embedded-mpv-native.md](./embedded-mpv-native.md).

## Current status

The shared-controls foundation from PR #1148 now supports four runtime
consumers and includes:

- the `PlayerController` contract, default state, and capability presets;
- the standalone `app-player-controls` presentation component and its
  transient-state collaborators;
- a generic `WebVideoControlsAdapter` plus small host helpers;
- standard element picture-in-picture through that adapter for the guarded web
  consumers;
- a persisted, default-off web-player preference resolved through an immutable
  per-host rollout token;
- the component-scoped `EmbeddedMpvControlsAdapter`;
- an `EmbeddedMpvPlayerComponent` host integration for the frame-copy engine;
- a preference-guarded `HtmlVideoPlayerComponent` integration backed by
  `WebVideoControlsAdapter` and a player-local engine bridge;
- a preference-guarded `VjsPlayerComponent` integration backed by a
  component-scoped `WebVideoControlsAdapter` and Video.js bridge;
- a preference-guarded `ArtPlayerComponent` integration backed by a
  component-scoped `WebVideoControlsAdapter`, neutral web-video source bridge,
  and player-local source/video sessions; and
- focused unit/component tests.

When Embedded MPV reports `engine: 'frame-copy'`, the component mounts
`app-player-controls` over the DOM canvas and routes state and commands through
`EmbeddedMpvControlsAdapter`. When it reports the native-view engine, the
component keeps the existing compositor-safe controls dock. Exactly one of
those control systems is active at a time.

When `WEB_PLAYER_SHARED_CONTROLS` is enabled, the built-in HTML5 player mounts
the same presentation component over its real player shell and disables the
native video controls. Its neutral source bridge supplies HLS/native tracks,
corrected MPEG-TS VOD duration, and authoritative live/VOD metadata to the
generic web adapter. When the host token resolves to false, the native controls
and legacy series navigation remain unchanged and the adapter is not attached.

Video.js consumes the same token and shared presentation atomically. Its bridge
binds the adapter to the current Video.js Tech `<video>` and rebinds after
`playerreset`, while focused collaborators expose Video.js audio/text tracks
and manage raw MPEG-TS playback. When the host token resolves to false, Video.js
keeps its existing skin and legacy series navigation.

ArtPlayer is the fourth consumer. Its source session owns HLS, MPEG-TS, native
source selection, and delayed `customType` callbacks, while the neutral
web-video source bridge exposes HLS/native tracks, caption preference, and
MPEG-TS VOD duration to the adapter. Its video session owns native media and
ArtPlayer event listeners. Shared mode uses authoritative live/VOD metadata,
reapplies the app volume directly to the media element after ArtPlayer restores
its own stored volume, disables vendor chrome/hotkeys, and places a transparent
event-capture layer over ArtPlayer so shared controls exclusively own surface
clicks and double-clicks. Playback diagnostics gate shared interaction and exit
only the ArtPlayer shell's own fullscreen. Source replacement and teardown
remove exact listeners and engines, and destroyed sessions ignore stale delayed
`customType` callbacks. When the host token resolves to false, the existing
ArtPlayer skin, source behavior, and legacy series navigation remain unchanged.

With shared controls enabled, HTML5, Video.js, and ArtPlayer expose standard
element picture-in-picture through the adapter's attached `<video>`. Shared
ArtPlayer keeps its vendor `pip` option disabled so the shared button is the
only PiP owner. The preference-off native/vendor paths remain unchanged.
Embedded MPV advertises no PiP capability and its command is a no-op.

`Settings.webPlayerSharedControls` remains default-off. `WebPlayerViewComponent`
snapshots it into `WEB_PLAYER_SHARED_CONTROLS` when a new player host is
created, so HTML5, Video.js, and ArtPlayer switch atomically without an
application restart. The parent `/workspace` route awaits the initial
`SettingsStore` load, including for cold-start direct links to workspace
children, before any player host can take this snapshot. Existing sessions
never change controls mode in place.

The shared-controls architecture remains engine-selective: frame-copy can use
normal DOM layering, while the native platform view cannot. The integration
also includes a recording coordinator that correlates asynchronous snapshots
with the active playback/session owner, serializes toggles, and cancels pending
ownership when the session, playback, engine, or component changes.

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
│ Per-host preference snapshot │     │ EmbeddedMpvPlayerComponent   │
│ HTML5 + Video.js + ArtPlayer │     │ frame-copy: shared controls  │
│ true: shared controls        │     │ native-view: legacy dock     │
│ false: existing controls     │     └──────────────────────────────┘
└──────────────────────────────┘
```

The embedded host selects controls from the reported engine before rendering
them. It never mounts the shared overlay and legacy dock together.
The HTML5, Video.js, and ArtPlayer hosts likewise select their existing or
shared controls before rendering and never attach the web adapter while the
preference-off path is active.

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
`pictureInPicture`, `fullscreen`, and `seriesNavigation`.

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
- recording state;
- picture-in-picture active state and runtime availability; and
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
- `togglePictureInPicture`

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
HTML5, Video.js, and ArtPlayer hosts mount it over
`.html-video-player-shell`, `.vjs-player-shell`, and `.art-player-shell`,
respectively.

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

The HTML5, Video.js, and ArtPlayer hosts apply the same ownership rule while a
playback diagnostic is visible: `WebPlayerViewComponent` passes
`interactionEnabled = visiblePlaybackDiagnostic() === null`, and all three
components bind that value to `showControls` and
`shortcutsEnabled`. If the active player shell owns DOM fullscreen, its host
exits fullscreen before hiding the controls so the sibling diagnostic banner
and its retry/fallback actions remain visible; fullscreen owned by another
element is left untouched. Retrying playback or clearing the diagnostic
restores both interaction paths.

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

## Web adapter and web-engine bridges

`WebVideoControlsAdapter` can translate an `HTMLVideoElement` into the shared
contract. It uses DOM/media events and accepts optional engine-specific track
accessors through `WebVideoControlsOptions`, so the adapter itself stays usable
in the PWA and does not import a concrete web engine.

### Standard element picture-in-picture

Picture-in-picture is part of the existing default-off shared web-controls
rollout. It is available through standard element PiP for HTML5, Video.js, and
ArtPlayer only when their host snapshot enables `WEB_PLAYER_SHARED_CONTROLS`.
The preference-off HTML5 native controls, Video.js skin, and ArtPlayer vendor
controls keep their previous behavior. Shared ArtPlayer explicitly keeps vendor
`pip: false`, leaving the shared action as the single PiP owner.

The contract exposes:

- capability `pictureInPicture`;
- state `pictureInPictureActive` and `canPictureInPicture`; and
- command `togglePictureInPicture()`.

The shared button renders only when the capability is present, immediately
before fullscreen. It uses the active state for pressed, icon, and enter/exit
semantics. When inactive, entry requires
`readyState >= HTMLMediaElement.HAVE_METADATA`; when active, exact-owner exit
remains available regardless of entry readiness or request support, provided
the exit API exists. Any pending PiP operation disables the action.

`WebVideoControlsAdapter` delegates standard PiP API access and operation
lifecycle to `WebVideoPictureInPictureController`, which reads the adapter's
current binding and the attached `HTMLVideoElement`'s `ownerDocument`. Browser
`enterpictureinpicture`/`leavepictureinpicture` events and the document's exact
`pictureInPictureElement` remain authoritative; command completion never
optimistically changes the active state.

The controller invokes `requestPictureInPicture()` or `exitPictureInPicture()`
synchronously from `togglePictureInPicture()` so browser user activation is
preserved, then contains asynchronous settlement. Only one enter/exit operation
may be pending. A binding generation plus exact video identity prevents a stale
completion from clearing or changing the new binding. Replacement or teardown
exits PiP only when the old video is the document's exact owner; a stale
successful entry receives the same exact-owner cleanup and never exits an
unrelated PiP element.

Video.js Tech reset and ArtPlayer video rebuild paths detach the old binding,
perform exact-owner cleanup, and bind the replacement video. HTML5 source
changes on a retained video target, along with ordinary same-element
source/media events, preserve active PiP.

Standard element PiP displays the browser/OS video surface, not Angular shared
control chrome. Subtitle rendering in that surface is browser-dependent.
AirPlay, Cast, Document Picture-in-Picture, a PiP keyboard shortcut, and an
Embedded MPV popup or native mini-window are out of scope.

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

`WebVideoSourceControlsBridge` is the neutral source bridge shared by the HTML5
and ArtPlayer integrations. The HTML5-local bridge/helper filenames remain
compatibility aliases. The bridge attaches the adapter to the host video element
and delegates HLS and native-text-track behavior to focused collaborators. HLS
track IDs remain the list indices accepted by hls.js. Native caption/subtitle
IDs remain stable for the lifetime of a source through a `WeakMap`, even when
the browser removes or reorders tracks. Source replacement removes track
listeners before the old HLS instance is destroyed, resets per-source subtitle
state, and leaves exactly one engine source bound.

Live/VOD classification comes from `WebPlayerViewComponent.resolvedIsLive`:
explicit `ResolvedPortalPlayback.isLive` wins, otherwise content metadata means
VOD and its absence means live. The same computed value configures Video.js,
the HTML5 and ArtPlayer bridges, ArtPlayer itself, and mpegts.js; media duration
is never used to infer the classification. Changing authoritative metadata
restarts an active source when its engine must be recreated with a different
live/VOD mode.

Raw MPEG-TS VOD can expose `video.duration === Infinity`. For that source only,
the neutral bridge used by HTML5 and ArtPlayer uses the first finite positive
value from `video.duration`, the last valid seekable end, or the last valid
buffered end. Without a known duration it keeps the source classified as VOD
while seeking remains unavailable.

`VjsPlayerControlsBridge` attaches the component-scoped adapter to the current
Video.js Tech `<video>`. Video.js can replace that element during `reset()`, so
the component reacquires it after `playerreset`, rebinds native media events,
and attaches the bridge to the replacement before activating the new source.
Audio and subtitle helpers assign source-lifetime IDs through `WeakMap`s, so
track reordering or list refreshes do not change the IDs exposed to shared
controls.

Video.js subtitle selection preserves an explicit shared-controls override,
including the `-1` off selection. Without an override, disabling the global
caption preference suppresses the currently showing track and restores that
same track when the preference returns, if it still belongs to the active
source. Source changes reset both stable-ID maps and per-source subtitle state.
The bridge reads duration through `player.duration()` because Video.js may
correct or project a value that differs from the current Tech element.

For reset-driven source changes, raw MPEG-TS activation is deferred until
`playerreset`. Video.js can otherwise defer `reset()` behind a pending
`play()`, so a dedicated coordinator pauses first and calls `reset()` only
after `player.paused()` is true. Multiple reset-required changes coalesce, and
every `playerreset` rebinds the current Tech before applying only the latest
desired source. The coordinator snapshots actual Video.js volume, suppresses
the reset-generated volume=1 event, restores the snapshot, and tracks whether a
pre-ready reset already applied the source. An authoritative live/VOD metadata
change restarts active raw MPEG-TS with the corrected mode. For MPEG-TS VOD,
the session projects the last finite seekable or buffered end through
`player.duration()`.

`web-video-controls.host.ts` still contains small generic
attachment/projection helpers. Video.js uses its dedicated bridge directly.
HTML5 and ArtPlayer share the neutral source bridge and HLS/native-track
collaborators under `web-video-support/`.

The rollout symbols and setting are:

| Symbol / setting                     |          Default | Current effect                                                          |
| ------------------------------------ | ---------------: | ----------------------------------------------------------------------- |
| `Settings.webPlayerSharedControls`   |          `false` | Persisted experimental opt-in shown for HTML5, Video.js, and ArtPlayer. |
| `WEB_PLAYER_SHARED_CONTROLS_ENABLED` |          `false` | Default-off fallback for direct component use and focused tests.        |
| `WEB_PLAYER_SHARED_CONTROLS`         | session snapshot | Component-scoped immutable value consumed by the three web engines.     |

With the token enabled, Video.js also disables native controls, Video.js
single-click and double-click actions, Video.js hotkeys, and spatial navigation.
This leaves surface clicks, double-click fullscreen, and playback shortcuts
owned exclusively by `app-player-controls`. With the token disabled, existing
Video.js options, plugins, skin, audio-track menu, and series navigation remain
unchanged.

With the token enabled, ArtPlayer disables optional vendor chrome, hotkeys, and
gestures. A transparent capture layer above ArtPlayer's video surface blocks
its always-installed click and double-click handlers while still bubbling
events to the shared controls surface. The shared path reapplies the app volume
directly to `player.video` after ArtPlayer restores `artplayer_settings.volume`,
so vendor storage cannot override the app-wide preference. With the token
disabled, the existing ArtPlayer options, HLS audio settings, skin, source
semantics, stored volume behavior, and series navigation remain unchanged.

## Embedded MPV rendering constraints

The shared contract does not replace either Embedded MPV renderer. The host
uses the renderer's reported engine to choose the compatible controls UI.

The web-player preference does not affect Embedded MPV. Frame-copy always uses
the shared DOM controls, while native-view keeps its compositor-safe legacy
dock.

`EmbeddedMpvControlsAdapter` reports `pictureInPicture: false`,
`pictureInPictureActive: false`, and `canPictureInPicture: false`;
`togglePictureInPicture()` is a no-op. Neither renderer opens an MPV
popup/mini-window.

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
the native surface with `HIDDEN_BOUNDS`; control menus render as horizontal
panels inside the fixed-height dock strip, so they stay interactive without
any bounds change.

The transparent BrowserWindow / `NSWindowBelow` tunnel-and-backdrop approach is
not the shipped architecture. The shared-controls integration does not add
transparency changes, backdrop holes, native fullscreen IPC, native-view
attachment APIs, or bounds-tick machinery.

See [embedded-mpv-native.md](./embedded-mpv-native.md) for the authoritative
renderer, bounds, and platform details.

## Follow-up integrations

The remaining design seams are:

1. **Native-view UI** — retain the compositor-safe dock unless the native
   engine's compositing architecture changes independently. A native-view
   migration is not part of the frame-copy rollout.
2. **Background playback** — introduce a persistent player/session host above
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
├── web-video-controls.media-helpers.ts
├── web-video-picture-in-picture.controller.ts
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

The neutral web-video source support shared by HTML5 and ArtPlayer lives in:

```text
libs/ui/playback/src/lib/web-video-support/
├── web-video-hls-controls.ts
├── web-video-native-text-tracks.ts
└── web-video-source-controls.bridge.ts
```

The bridge owns source-local HLS/native track projection, caption preference
and explicit subtitle-off state, MPEG-TS VOD duration correction, adapter
refresh, and exact track-list listener cleanup.

The guarded HTML5 integration lives in:

```text
libs/ui/playback/src/lib/html-video-player/
├── html-video-element-session.ts
├── html-video-player-controls.bridge.ts
├── html-video-player-hls-controls.ts
├── html-video-player-native-text-tracks.ts
├── html-video-player.component.ts
└── html-video-player.component.html
```

`HtmlVideoPlayerComponent` provides a component-scoped
`WebVideoControlsAdapter`. Its bridge/helper filenames re-export the neutral
web-video support so existing imports and focused specs remain stable.
`HtmlVideoElementSession` separately owns native video-event attachment,
persisted volume, start-time/time/ended propagation, and the preference-off
post-play caption behavior.

The guarded Video.js integration lives in:

```text
libs/ui/playback/src/lib/vjs-player/
├── vjs-audio-tracks.ts
├── vjs-mpegts-session.ts
├── vjs-player-controls.bridge.ts
├── vjs-player-reset-coordinator.ts
├── vjs-player-setup.ts
├── vjs-player.component.ts
├── vjs-player.component.html
├── vjs-text-tracks.ts
└── vjs-video-element-session.ts
```

`VjsPlayerComponent` provides a component-scoped `WebVideoControlsAdapter`.
Its bridge and track helpers own current-Tech attachment, source-lifetime track
identity, caption preference/override projection, and exact listener cleanup.
`VjsMpegTsSession` owns raw MPEG-TS attachment and VOD duration correction,
`VjsPlayerResetCoordinator` owns pause/coalesced-reset ordering and volume
preservation, while `VjsVideoElementSession` owns native Tech-element
playback/ended events.

The guarded ArtPlayer integration lives in:

```text
libs/ui/playback/src/lib/art-player/
├── art-player-audio-tracks.ts
├── art-player-setup.ts
├── art-player-source-session.ts
├── art-player-video-session.ts
├── art-player.component.ts
├── art-player.component.html
└── art-player.component.scss
```

`ArtPlayerComponent` provides a component-scoped `WebVideoControlsAdapter`.
`ArtPlayerSourceSession` owns HLS/MPEG-TS/native engines, the neutral source
bridge, exact engine/listener cleanup, and a destroyed-session guard for
ArtPlayer's delayed `customType` dispatch. `ArtPlayerVideoSession` owns native
media errors, readiness, volume persistence, ended/time updates, and exact
event cleanup. The setup helper preserves the legacy option set when the host
token resolves to false and disables vendor interaction owners when it resolves
to true; the component's transparent capture layer blocks ArtPlayer's core
surface handlers.

Focused specs cover each web engine's preference-off compatibility path,
shared-controls rendering and diagnostic interaction gating, source/element
replacement, track-list lifecycle and stable IDs, caption preference and
explicit-off behavior, MPEG-TS live/VOD handling and duration projection,
volume preservation/authority, stale ArtPlayer `customType` callbacks, and
collaborator teardown. Persistent/background player ownership has not landed.
