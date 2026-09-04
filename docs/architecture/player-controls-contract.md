# Player-Controls Contract

This document is the canonical reference for IPTVnator's additive,
engine-agnostic player-controls contract and shared default controls.
Embedded MPV rendering and native-view bounds behavior remain documented in
[embedded-mpv-native.md](./embedded-mpv-native.md).

## Current status

The shared-controls foundation supports four runtime consumers and includes:

- the `PlayerController` contract, default state, and capability presets;
- the standalone `app-player-controls` presentation component and its
  transient-state collaborators;
- a generic `WebVideoControlsAdapter` plus small host helpers;
- standard element picture-in-picture through that adapter for the guarded web
  consumers;
- a persisted, default-on web-player preference (opt-out) resolved through an
  immutable per-host rollout token;
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
native video controls. Its neutral source bridge supplies HLS/Shaka/native tracks,
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
web-video source bridge exposes HLS/Shaka/native tracks, caption preference, and
MPEG-TS VOD duration to the adapter. Its video session owns native media and
ArtPlayer event listeners. Shared mode uses authoritative live/VOD metadata,
reapplies the app volume directly to the media element after ArtPlayer restores
its own stored volume, disables vendor chrome/hotkeys, and places a transparent
event-capture layer over ArtPlayer so shared controls exclusively own surface
clicks and double-clicks. Playback diagnostics gate shared interaction and exit
only the shared controls' resolved fullscreen owner (the host-supplied
`fullscreenTarget`, else the ArtPlayer shell). Source replacement and teardown
remove exact listeners and engines, and destroyed sessions ignore stale delayed
`customType` callbacks. When the host token resolves to false, the existing
ArtPlayer skin, source behavior, and legacy series navigation remain unchanged.

With shared controls enabled, HTML5, Video.js, and ArtPlayer expose standard
element picture-in-picture through the adapter's attached `<video>`. Shared
ArtPlayer keeps its vendor `pip` option disabled so the shared button is the
only PiP owner. The preference-off native/vendor paths remain unchanged.
Embedded MPV advertises no PiP capability and its command is a no-op.

`Settings.webPlayerSharedControls` is default-ON: an absent stored value means
the user never chose and gets the shared controls; only an explicit boolean
`false` (the Settings > Playback checkbox) opts back into the legacy vendor
chrome. Every normalization site (`SettingsStore` load/update/read and the
settings form) coerces with `!== false` for exactly this reason — a stored
settings object from before the default flip has no key at all, and `=== true`
would silently strand those users on the old default. `WebPlayerViewComponent`
snapshots the preference into `WEB_PLAYER_SHARED_CONTROLS` when a new player
host is created, so HTML5, Video.js, and ArtPlayer switch atomically without an
application restart. The parent `/workspace` route awaits the initial
`SettingsStore` load, including for cold-start direct links to workspace
children, before any player host can take this snapshot. Existing sessions
never change controls mode in place.

The shared-controls architecture remains engine-selective: frame-copy can use
normal DOM layering, while the native platform view cannot. The integration
also includes a recording coordinator that correlates asynchronous snapshots
with the active playback/session owner, serializes toggles, and cancels pending
ownership when the session, playback, engine, or component changes.

## Diagnostics And Recovery Ownership Boundary

`PlayerController` remains a sibling of playback diagnostics and recovery
recommendations. It owns engine-neutral playback state, capabilities, and
commands for the shared controls; it does not classify errors, call
`recommendPlaybackRecovery()`, rank actions, track recovery attempts, choose a
temporary player, or own content-session policy.

Those pure contracts and policies live in `@iptvnator/playback/util` (Nx
project `playback-util`). `WebPlayerViewComponent` owns their in-memory,
session-local application. No diagnostic or recommendation state or command is
added to `PlayerController`.

The only controls-layer participation is interaction gating. While the sibling
diagnostic panel is visible, a web-player host disables shared surface and
keyboard ownership and exits only the resolved fullscreen owner's DOM
fullscreen (the host-supplied `fullscreenTarget`, else its own shell) so the
recovery actions remain reachable. Clearing the diagnostic restores those paths; it
does not make the controls contract an owner of the recovery lifecycle.

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
`audioTracks`, `subtitles`, `externalSubtitles`, `subtitleDelay`,
`subtitleStyle`, `qualityLevels`, `playbackSpeed`, `aspectRatio`,
`recording`, `pictureInPicture`, `fullscreen`, and `seriesNavigation`.

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
- pre-labelled quality levels and the ABR/auto flag;
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
- `seekTo` / `seekBy` — `seekBy` is a relative command; Embedded MPV forwards
  the delta to mpv itself instead of adding it to the snapshot position (see
  `embedded-mpv-native.md`, "Resume And Track Handling")
- `setVolume`
- `setAudioTrack` / `setSubtitleTrack`
- `addExternalSubtitleFile` / `setSubtitleDelay` / `setSubtitleStyle`
- `setQualityLevel` (`AUTO_QUALITY_LEVEL_ID` = `-1` re-enables auto)
- `setPlaybackSpeed`
- `setAspectRatio`
- `toggleRecording`
- `togglePictureInPicture`

Episode navigation is deliberately exposed as component outputs
(`previousEpisodeRequested` and `nextEpisodeRequested`) because the owning
playlist/portal feature decides which item to play.

Fullscreen is also outside the engine command contract. The landed component
uses `ControlsFullscreen`, which operates on one DOM element through
`requestFullscreen()` / `document.exitFullscreen()`: the optional
`fullscreenTarget` input when the host supplies one, else the `playerSurface`.
There is no fullscreen delegate or native-fullscreen IPC path.
`ControlsFullscreen.sync()` reconciles state when that element attaches or
changes, including when it is already fullscreen. The Embedded MPV host's
existing `fullscreenchange` listener still triggers bounds sync so frame-copy
render size follows the fullscreen DOM surface.

The owner matters because `WebPlayerViewComponent` remounts the engine
component for every playback application (`@for ... track application.token`:
next episode, channel zap, alternative source, retry) and the Fullscreen API
exits the moment its element leaves the document. A shell-owned fullscreen
therefore ended with every switch. `WebPlayerViewComponent` now passes its own
host element (`fullscreenSurface`) as `fullscreenTarget` to HTML5, Video.js,
ArtPlayer, and Embedded MPV; that element spans all applications of one mount,
so a fullscreen entered on episode 1 is still active when episode 2's engine
mounts, and the fresh controls adopt it through `sync()` on attach. The
`playerSurface` (pointer/click/cursor ownership) stays the engine shell. The
vendor-chrome opt-out keeps engine-owned fullscreen and still loses it on a
switch — see "Known differences".

One dependency this uncovered: `WebPlayerViewComponent.channel` and
`vjsOptions` are signals. In Electron the source is handed to the engine inside
the stream-header IPC promise, after the pass that mounted the application,
and the view sits under OnPush hosts (`PortalInlinePlayerComponent`); as plain
fields they were only rendered when something else dirtied the subtree — which
used to be the stage resize caused by the fullscreen exit on every switch. A
remounted engine inside a still-active fullscreen has no such trigger.

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
- `ControlsSurface` — pointer/click/double-click surface interactions;
- `ControlsTimeline` — scrub state and timeline projections; and
- `controls-view-model.ts` — derived display state.

### Fullscreen media title

The component accepts an optional `mediaTitle` input
(`PlayerMediaTitle { primary, secondary? }`) with display-ready strings — the
movie title, channel name, or series name, plus an optional second line such
as the `S01E03` episode label. The overlay renders at the top of the player
only in fullscreen while the controls are revealed, follows the same
auto-hide transition as the bottom bar, and is pointer-transparent. Outside
fullscreen the surrounding page chrome already names the content, so the
overlay stays hidden.

Hosts supply the value: `WebPlayerViewComponent` derives a single-line title
from the resolved playback (skipping raw stream-URL fallbacks) unless its own
`mediaTitle` input was set, and `PortalInlinePlayerComponent` builds the
two-line series form from its `seriesTitle` input plus the episode metadata
label. The Xtream and Stalker series detail views pass the series name via
`seriesTitle`; movie and live hosts need no extra wiring because
`playback.title` already names the content.

### Keyboard ownership

Unmodified Space/K, F, arrow keys, and M are playback shortcuts. Playback keys
with Meta/Cmd, Control, or Alt are ignored and are not prevented, so app and OS
accelerators retain ownership. Escape remains available to close controls
popovers even when a modifier is held or playback shortcuts are unavailable.
Buttons, form controls, links, ARIA menu controls, and content-editable targets
are also ignored anywhere in the event's composed path.

A player whose host sits inside an `inert` region ignores every shortcut,
including Escape: `inert` strips pointer and Tab access but document-level
listeners still fire, so the optional `hostElement` handler on
`ControlsShortcutHandlers` lets the shortcuts opt out while a modal surface
above the player (e.g. the workspace's phone context drawer) owns the
keyboard. `EmbeddedMpvShortcutHandlers` (the native-view legacy dock) and
the radio audio player's document-level volume/mute keys apply the same
rule.

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
hide delay. Only keyboard-originated focus pins the bar: Chromium also moves
focus to a clicked `<button>`, and that focus is a side effect of the click,
so `ControlsSurface.wasPointerInteraction` attributes a `focusin` to the press
when a `pointerdown` was recorded within the last second whose target lies
inside the newly focused element. A press moves focus at most once and does so
synchronously, so the record is discarded on the first bar focus event it is
asked about, matching or not, and on any key press; nothing a later Tab or
Shift+Tab focuses can be attributed to a stale press, not even the control
the press hit while it was already focused and hence produced no focus event.
Such focus reveals like any pointer activity and the bar hides on the normal
delay while the button stays the active element; a Tab shortly after a click
on the video still counts as keyboard navigation because the press did not
land inside the focused control. A key press that bubbles out of a control
inside the bar (Space or Enter on the still-focused button, arrows on a
slider) hands ownership back to the keyboard and pins the bar exactly as Tab
focus does, because operating a focused control produces no focus event. A
pointer press anywhere in the bar also releases an existing keyboard pin: the
press may produce no focus event at all (clicking the control that already has
focus) or only a transfer inside the bar, which `focusout` ignores by design,
so the pin cannot be cleared from focus events alone. Without
this distinction the fullscreen button kept the controls on screen until a
click on the viewport took focus away — and that click also paused playback.

The focus a pointer click leaves on a control is released once the click
completes (`onBarClick` → `ControlsSurface.releasePointerFocus`). A focused
control captures the keyboard: Space and Enter activate it again, and
`ControlsShortcuts` yields to any interactive element in the key's path, so
after a click on the fullscreen button Space left fullscreen instead of
pausing and the seek, volume, and mute keys did nothing.
`ControlsSurface.wasPointerClick` attributes the click by its `pointerType`
(non-empty for a pointer; empty for Enter/Space activation and
`element.click()`), and a legacy `MouseEvent` click by a recent press inside
the clicked element, answered once per press and discarded on any key press.
Keyboard activation therefore keeps focus where Tab put it. Only buttons and
range sliders are released; text entry would keep its focus, and the bar
holds none. Chromium keeps its sequential focus navigation starting point at
the blurred control, so a later Tab continues from it exactly as if it were
still focused; the clicked button's tooltip hides with the focus. The release
dispatches a `focusout` while the pointer still rests on the control, so the
volume anchor's `focusout` handler skips its popover close for it
(`wasPointerFocusRelease`), while focus leaving by keyboard still closes the
popover. A press that never completes into a click (released off the
control) is the one case that still leaves pointer-originated focus behind,
which is why the key-press re-pin above remains.
In fullscreen playback, hiding the controls also hides the pointer
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
`shortcutsEnabled`. If the shared controls' fullscreen owner (the supplied
`fullscreenTarget`, else the player shell) is in DOM fullscreen, the host
exits fullscreen before hiding the controls so the diagnostic banner and its
recovery actions remain visible; fullscreen owned by another element is left
untouched. Retrying playback or clearing the diagnostic
restores both interaction paths.

Frame-copy recording transitions use the adapter's playback/session identity as
their `transitionKey`. Session disposal, retry, channel changes, and engine
handoff therefore clear stale recording ownership without showing a false
`RECORDING_SAVED` confirmation.

### Vendor-chrome (preference-off) keyboard shortcuts

With `webPlayerSharedControls` off, `app-player-controls` never renders, so no
`ControlsShortcuts` instance existed and the playback keys advertised in the
in-app help silently did nothing. The vendor-chrome HTML5, Video.js, and
ArtPlayer hosts therefore attach `LegacyPlayerShortcuts`
(`legacy-player-shortcuts.ts`) — a thin wrapper over the same
`ControlsShortcuts` arbitration and ignore rules — and forward the commands
straight to the engine:

- **HTML5** (`html-video-legacy-shortcuts.ts`) acts on the native video
  element. Play goes through the component's session so playback diagnostics
  stay owned there, and F fullscreens the video element itself, matching what
  the native controls' own fullscreen button does.
- **Video.js** (`vjs-legacy-shortcuts.ts`) goes through the player API so the
  vendor control bar stays in sync; F uses the player's
  `requestFullscreen`/`exitFullscreen`. The legacy configuration still never
  enables `userActions.hotkeys`. The chrome also releases the focus a pointer
  interaction leaves on a control (`vjs-pointer-focus-release.ts`, the vendor
  counterpart of `ControlsSurface.releasePointerFocus`, sharing
  `pointer-focus-release.ts`'s `blurFocusedControl`): Chromium focuses a
  clicked control-bar `<button>` or slider, and a focused Video.js component
  captures the keyboard entirely — `Component.handleKeyDown` stops the
  propagation of every key and `ClickableComponent` turns Space and Enter into
  a click — so after a click on the fullscreen button Space left fullscreen
  instead of pausing and the document-level shortcuts never saw a key. The
  release is driven mainly by the focus landing, not the click: choosing a
  menu item moves focus to the menu button a tick after the click
  (`MenuItem.handleTapClick`) and that selection click never bubbles to the
  shell, so a click handler alone would be both too early and unreached. A
  `focusin` on an eligible control (a `<button>`, `role="button"` clickable, or
  slider; never a `role="menuitem*"`) is released when it is attributable to a
  recent `pointerdown` inside the shell not yet ended by a document `keydown`,
  so keyboard `Tab` focus is preserved. A `click` runs the same release,
  because clicking a control that was already focused (Tab, then a mouse click
  on it) moves no focus and fires no `focusin`; a keyboard-activation click
  carries no `pointerdown`, so attribution keeps that focus. The release is
  scoped to the `.vjs-control-bar`, the persistent chrome that hands keys back
  to the document; the player's other focusable surfaces manage their own
  focus and keep it — in particular the caption-settings dialog
  (`.vjs-text-track-settings`, a modal sibling of the control bar under
  `.video-js`) traps focus for its Escape/Tab handling, so its Reset button is
  left alone. Menu buttons live in the control bar and are not exempt: a
  Video.js popup is navigated through its focused item, not its button, so
  releasing the button never disturbs an open menu — opening focuses the item,
  and the button focus a pointer moves through (the transient press on open,
  item selection, and toggling an open menu shut) is released, which is what
  lets Space work again after a menu is dismissed by clicking its button a
  second time. ArtPlayer needs no
  counterpart (its controls are non-focusable divs), nor do the native HTML5
  controls (a click focuses the `<video>`, which the shortcuts do not treat as
  interactive).
- **ArtPlayer** (`art-player-legacy-shortcuts.ts`) uses the vendor setters its
  own hotkeys used (`toggle`, `forward`/`backward`, `volume`, `muted`,
  `fullscreen`), so ArtPlayer's notices and UI stay in sync. The legacy chrome
  now passes `hotkey: false` — ArtPlayer's focus-scoped hotkeys ignore
  `defaultPrevented` and would double-handle every key — and the wiring
  restores the one behavior lost with it: Escape exits `fullscreenWeb`.

Shared legacy rules: seek is gated on authoritative `isLive` plus a finite,
positive duration (ArtPlayer gates on `art.duration`, the same value its seek
setter clamps against, so an unknown duration never jumps to zero); volume
steps by ±5% and syncs muted state the way `applyVideoVolume` does (raising
out of mute unmutes, reaching zero mutes); M mirrors `ControlsVolume`'s mute
memory through `LegacyMuteMemory` — muting remembers the audible volume, and
unmuting while the volume sits at zero restores it (same 0.5 fallback), so M
can never leave the player silently "unmuted"; `isAvailable` is the host's
`interactionEnabled`, so a visible playback diagnostic disables the keys; and
Escape defaults to a no-op without consuming the key, because the vendor
chrome owns its own overlays. Instances attach in the component's legacy
branch and detach on destroy; the arbitration registry is shared with
shared-controls instances, so exactly one owner handles each key.

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

### Touch interaction semantics

`ControlsSurface` classifies every interaction by pointer type. Click events
carry `pointerType` in current engines; focus events and legacy MouseEvent
clicks are attributed to a touch when a touch `pointerdown` was recorded within
the last second (`wasTouchInteraction`). Three behaviors diverge from mouse:

- **Viewport taps toggle the overlay, never playback.** A tap while the
  controls are hidden only reveals them; a tap while they are visible hides
  them (through the same `canHide` policy that guards auto-hide, so a paused
  player or open menu stays visible). The mouse click-to-pause with its 250ms
  double-click deferral is mouse-only — the first tap on a hidden overlay must
  never pause the video. The synthetic `pointerenter`/`pointermove` a tap
  fires is ignored for reveal, or the tap's own click could never observe the
  hidden state.
- **The volume popover opens on tap, not hover.** With a mouse, hovering the
  volume button opens the slider popover and clicking toggles mute. On touch
  the hover-open path is suppressed and the first tap on the volume button
  opens the popover instead of muting; a tap while it is open toggles mute as
  the button's label says. Touch-attributed `focusout` does not schedule the
  popover close (outside taps and other menu buttons dismiss it), and neither
  does the `focusout` of a pointer focus release.
- **Coarse-pointer scrub sizing.** Under `@media (pointer: coarse)` the
  timeline/volume sliders grow their input hit strip to 28px and the thumb to
  18px; the 4px visual track is unchanged.

### Narrow-player layout

The controls host is a size query container (`player-controls`). At container
widths of 640px and below — phone-sized PWA viewports, but also small inline
players inside wide desktop windows — the single-row bar reflows to two rows:
the timeline takes a full-width first row, and the transport and actions
clusters split the second. The actions cluster's width is content-dependent
(volume, audio, subtitles, quality, speed, aspect, recording, PiP, and
fullscreen are all conditional), so in the narrow layout the cluster is
end-aligned, capped at the row width, and wraps when even a dedicated row cannot
hold it. Its popover anchors become static at this breakpoint so capability
panels position against the unclipped actions cluster and remain accessible
above every wrapped row. Icon buttons compact from 48px to 40px in this layout.
Between ~640px and the 720px viewport media query, the legacy single-row squeeze
(timeline absorbs the shrink) still applies.

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

### Caption preference in both modes

The `Settings.showCaptions` preference is **not** part of the rollout gate. It
is engine state, not controls UI, so HTML5, Video.js, and ArtPlayer apply it
whether or not their host snapshot enables `WEB_PLAYER_SHARED_CONTROLS`. Shared
controls route it through their controls bridge; the preference-off paths use
the same helpers without an adapter — `WebVideoSourceTracks` for HTML5 and
ArtPlayer, `VjsLegacyTracks` for Video.js. Both apply the preference when a
source binds and re-apply it as the engine adds or switches text tracks, which
a one-shot check at playback start could not do (#1155).

The two modes differ in **how long** the preference stays enforced, because
they differ in who owns the caption UI:

- **Shared controls: authoritative.** The preference holds for the whole
  session; user intent arrives through `setSubtitleTrack`, which records an
  explicit override (including `-1` for off) that wins until the source changes.
- **Vendor chrome: source-default.** The engine still renders its own caption
  menu, so the preference only seeds each new source and is released once the
  media element reports `playing`. Enforcing it for the whole session would
  make that menu inert.

The mode is selected by passing a `playbackStarted` probe to the track helpers;
shared controls omit it. All three helpers take it — HLS, native text tracks,
and Shaka. For DASH the seed happens inside `ShakaVideoSession.start()` once the
manifest is loaded, so the helper only has to stop re-suppressing afterwards. `WebVideoSourceTracks` owns the probe for HTML5 and
ArtPlayer (a `playing` listener on the media element, reset on every
`setSource`); `VjsLegacyTracks` owns it for Video.js (the player's own `playing`
event, reset on every `clear`). In source-default mode the HLS helper also
_deselects_ the track (`subtitleTrack = -1`) instead of hiding it: hls.js
applies `subtitleDisplay` to whatever the vendor menu picks, so suppressing
display would silently override the user, and a `-1` assignment additionally
clears hls.js' own default-track selection so it cannot reselect one later.

`WebPlayerViewComponent` reads the preference from `SettingsStore` rather than
from a host input, so every host — the M3U player, Xtream and Stalker live
layouts, and the portal detail inline player — gets it without wiring.

### Standard element picture-in-picture

Picture-in-picture is part of the default-on shared web-controls
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

### Quality (bitrate/level) selection

Quality selection is part of the shared controls and therefore rides the same
default-on `WEB_PLAYER_SHARED_CONTROLS` rollout. The contract exposes:

- capability `qualityLevels`;
- state `qualityLevels` (pre-labelled options such as "1080p") and
  `qualityAutoEnabled`; and
- command `setQualityLevel(id)`, where `AUTO_QUALITY_LEVEL_ID` (`-1`)
  re-enables the engine's adaptive (ABR) selection.

The capability derives from the manifest, not the content type: it is
advertised only when the current source exposes **more than one** video
rendition, so single-bitrate Xtream VOD files and raw MPEG-TS streams never
show the menu, while multi-variant live HLS does. The menu renders next to the
audio/subtitle menus with an Auto entry first; Auto is the default, a level
reports `selected` only while a manual choice is active, and the choice is
per-session — nothing is persisted to Settings.

Labels come from one shared helper (`quality-level-labels.ts` in
`web-video-support/`): frame height first ("1080p"), a 16:9 projection when
only the width is known, the bitrate when no dimension is known, and a bitrate
suffix only when two levels would otherwise collide on the same label.

Engine mechanics:

- **hls.js** (HTML5 and ArtPlayer via the neutral source bridge): levels are
  `hls.levels` with list-index ids; a manual switch assigns `hls.nextLevel`
  (switches at the next fragment instead of flushing the buffer), `-1` restores
  auto, and the selected level is read from the public `manualLevel`. The HLS
  refresh-event list additionally observes `MANIFEST_PARSED`,
  `LEVELS_UPDATED`, and `LEVEL_SWITCHED`.
- **Shaka (DASH)**: options are variant tracks pinned to the active variant's
  exact audio stream — variants are audio+video combinations, and picking a
  quality must not switch the audio track. The filter matches the active
  variant's `audioId` when Shaka reports one (two same-language audio tracks
  such as main vs. commentary share a language but never an id) and falls back
  to the language only when no id is available — sorted by resolution then
  bandwidth. Manual
  selection disables ABR via `configure({abr: {enabled: false}})` before
  `selectVariantTrack(track, true)`; the auto sentinel re-enables ABR. Manual
  state is keyed to the exact player instance, so a session restart (which
  creates a fresh player with ABR on) can never render a stale manual
  selection.
- **Video.js**: `VjsQualityLevels` projects the videojs-contrib-quality-levels
  list (registered by the component's plugin import). VHS has no manual-level
  setter, so a manual selection enables exactly one level and auto re-enables
  all. Manual intent is tracked explicitly by the picked level object — VHS
  also flips `enabled` off for renditions it temporarily excludes after
  delivery errors, so counting enabled levels would misreport a manual
  selection. A picked level that leaves the list, a source change, and
  `clear()` all revert to auto. A missing or throwing plugin degrades to no
  capability.
- **Embedded MPV and external players**: `qualityLevels` stays false —
  single-program transport streams have no rendition list to offer and no HLS
  level API is surfaced there. `EmbeddedMpvControlsAdapter.setQualityLevel` is
  a no-op.

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

| Symbol / setting                     |          Default | Current effect                                                           |
| ------------------------------------ | ---------------: | ------------------------------------------------------------------------ |
| `Settings.webPlayerSharedControls`   |           `true` | Persisted preference; the checkbox is the opt-out back to vendor chrome. |
| `WEB_PLAYER_SHARED_CONTROLS_ENABLED` |           `true` | Default-on fallback for direct component use and focused tests.          |
| `WEB_PLAYER_SHARED_CONTROLS`         | session snapshot | Component-scoped immutable value consumed by the three web engines.      |

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

### Known differences vs. vendor chrome (deliberate, opt-out retains them)

Flipping the default to shared controls drops a handful of vendor-chrome
features by design. They stay available through the Settings > Playback
opt-out and are candidates for later shared-controls work, not silent
regressions:

- **Video.js spatial navigation** (arrow-key/remote focus traversal of the
  Video.js control bar, wired in `vjs-player-setup.ts` /
  `vjs-player.types.ts`) is disabled in shared mode and has no shared-controls
  equivalent. Keyboard playback shortcuts (space, arrows, F, M) are owned by
  `ControlsShortcuts` instead; the shared bar is Tab-traversable.
- **ArtPlayer extras** not reproduced by the shared bar: screenshot capture,
  AirPlay, web fullscreen (`fullscreenWeb`, fill-the-page without OS
  fullscreen), the mini progress line shown while controls are hidden, and
  ArtPlayer's own mobile gesture/lock/auto-orientation handling (shared
  controls bring their own touch semantics above).
- **Vendor caption menus** behave as before in the opt-out path; shared mode
  is authoritative for the session as documented under "Caption preference in
  both modes".
- **Fullscreen across a source switch.** Vendor chrome puts its own engine
  element into fullscreen (`.video-js`, ArtPlayer's container, the native
  `<video>`), and that element is remounted for the next episode, channel, or
  alternative source, so the browser exits fullscreen on every switch. Shared
  controls fullscreen the host-owned `fullscreenTarget` instead and keep
  fullscreen across switches; re-requesting fullscreen for a remounted vendor
  engine is not possible for the autoplay hand-off, which has no user
  activation.

## Advanced subtitle support

The subtitle popover carries three capability-gated extensions beyond track
selection (#1408): loading an external subtitle file, adjusting the subtitle
timing offset, and styling subtitle text (size + color). Each is honest per
engine — an engine that cannot support a control simply never advertises the
capability, and the UI is not rendered.

Contract surface:

- capabilities `externalSubtitles`, `subtitleDelay`, `subtitleStyle`;
- state `subtitleDelaySeconds` (positive = subtitles appear later) and
  `subtitleStyle` (`PlayerSubtitleStyle { sizePercent, color }`); and
- commands `addExternalSubtitleFile()` (fire-and-forget; the adapter owns its
  environment's picker), `setSubtitleDelay(seconds)`, and
  `setSubtitleStyle(style)`.

The subtitle menu stays reachable with an empty track list whenever
`externalSubtitles` is set — loading a file is what creates the first track.
Delay and style rows keep the popover open, because these settings are tuned
iteratively against the running video (`ControlsSubtitleSettings` owns those
interactions); the load action closes it because a file dialog opens on top.

Persistence: the style (size/color) is a cross-engine preference stored under
the `subtitleStyle` localStorage key (`subtitle-style.ts`), the same mechanism
as the shared `volume` key, and is normalized/clamped on every read and write.
The delay and any loaded file are deliberately per-session/per-source — they
correct one specific stream.

The canonical `PlayerSubtitleStyle` shape and the clamp/normalize rules
(delay limit, size bounds, color validation) live in
`@iptvnator/shared/interfaces` (`subtitle-style.util.ts`). The renderer
applies them to user input and the Electron main process re-applies the exact
same implementation to untrusted IPC payloads — deliberate defense-in-depth
with a single source of truth, so widening a limit on one side cannot
silently re-clamp on the other.

Per-engine implementations:

- **HTML5 + ArtPlayer (shared-controls mode, neutral source bridge).** The
  picker is a renderer-side DOM file input (`.srt`/`.vtt` only; works in the
  PWA and Electron alike, and no filesystem path ever enters the app). File
  bytes are decoded encoding-aware (`decodeExternalSubtitleBytes`: UTF-16
  BOMs, strict UTF-8, then `chooseLegacySingleByteDecode`, which picks
  between Windows-1251 and Windows-1252 by the plausibility of the 1251
  candidate's decoded words — pure-Cyrillic words vote for 1251, words
  mixing Cyrillic with ASCII letters vote against (misread Latin text like
  "était" decodes to the mixed-script "йtait" that real subtitles never
  contain), and Cyrillic must also carry a meaningful share of all letters
  so an isolated accented CP1252 word ("À table" → "А table") cannot flip
  the file), because `Blob.text()`'s silent UTF-8 substitution turns common
  legacy-encoded SRT files into mojibake. `WebVideoExternalSubtitles` parses
  the file (`external-subtitle-cues.util.ts`) and renders it through a native
  `TextTrack` on the video element, so it works under every source kind. The
  native track enumeration excludes externally owned tracks — ownership is
  tracked for every track the session EVER created, because `addTextTrack`
  tracks cannot leave the element and per-source ownership would let stale or
  attach-failed tracks reappear as ghost engine tracks. `WebVideoSourceTracks`
  merges external tracks into the subtitle listing with IDs from 100000 up,
  routing selection so exactly one owner (engine or external) is active;
  external selection deselects the engine BEFORE setting track modes, since
  hls.js reacts to `subtitleTrack = -1` by disabling every subtitle-kind
  `TextTrack` on the element. A pick captures the source generation and is
  discarded if the stream changed while the dialog was open (mirroring the
  Embedded MPV runner's session recheck). The delay capability is
  runtime-gated on an external track being the SELECTED one — only owned cues
  can be re-timed exactly, and with an engine track active the row would be
  enabled yet visually inert. Negatively shifted cues keep their real
  (possibly negative) times, which are valid and simply never active;
  clamping them to t≈0 would stack every pre-roll cue at playback start.
  Style applies through a scoped `::cue` rule (`WebVideoSubtitleStyle`),
  which covers embedded, hls.js-managed, and external native cues. ASS
  rendering would need libass and is out of scope for the web engines.
- **Embedded MPV frame-copy.** The helper protocol gained `sub-add`,
  `sub-delay`, `sub-scale`, and `sub-color` commands. The picker is a
  main-process open dialog (`.srt/.ass/.ssa/.vtt/.sub` — mpv renders ASS
  natively), and the renderer only ever forwards the returned path over the
  dedicated IPC (`EMBEDDED_MPV_ADD_SUBTITLE` etc.); delay applies to every
  subtitle track. mpv does not report these values back through the session
  snapshot, so `EmbeddedMpvSubtitleSettings` keeps the authoritative
  renderer-side values: the delay resets per session, and a non-default
  persisted style is re-applied to each new session. `sub-color` affects
  mpv's text-subtitle rendering; ASS files keep their embedded styling.
  Runtime coverage: the packaged Linux frame-copy smoke
  (`apps/electron-backend-e2e/src/embedded-mpv-frame-copy-packaged.e2e.ts`)
  drives `addEmbeddedMpvSubtitle` with a fixture file against the real
  packaged helper and asserts the track appears in the session snapshot,
  plus round-trips the delay/style IPC. The native file dialog itself
  (`selectEmbeddedMpvSubtitleFile`) cannot be automated and is verified
  manually.
- **Not wired (capabilities stay false):** Video.js shared mode (its emulated
  text-track display needs a separate remote-track + CSS integration — a
  follow-up), the vendor-chrome (preference-off) web players by design, the
  Embedded MPV native-view legacy dock, the Linux out-of-process native path
  (which exports no subtitle commands), and external MPV/VLC, which own their
  own UI.

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
Fullscreen API on the host-supplied `fullscreenTarget` (the
`app-web-player-view` element, which survives the per-application remount),
falling back to the player root; the component's own `isFullscreen`,
`canFullscreen`, and toggle follow the same owner and re-read it on mount, so
a player remounted inside an active fullscreen starts fullscreen. The Embedded
MPV component continues bounds sync so the helper renders at the current
viewport size.

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
├── legacy-player-shortcuts.ts
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
├── quality-level-labels.ts
├── web-video-hls-controls.ts
├── web-video-native-text-tracks.ts
├── web-video-shaka-controls.ts
├── web-video-source-tracks.ts
└── web-video-source-controls.bridge.ts
```

`WebVideoSourceTracks` owns source-local HLS/Shaka/native track projection,
caption preference and explicit subtitle-off state, and exact track-list
listener cleanup. It has no controls dependency, so the preference-off players
use it directly. `WebVideoSourceControlsBridge` wraps it for shared controls
and adds adapter attach/detach, adapter refresh, and MPEG-TS VOD duration
correction.

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
persisted volume, and start-time/time/ended propagation. Captions are not its
concern in either mode: the component binds `WebVideoSourceTracks` alongside
its controls bridge and feeds both the same active source.

The guarded Video.js integration lives in:

```text
libs/ui/playback/src/lib/vjs-player/
├── vjs-audio-tracks.ts
├── vjs-legacy-tracks.ts
├── vjs-mpegts-session.ts
├── vjs-quality-levels.ts
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
`ArtPlayerSourceSession` owns HLS/DASH(Shaka)/MPEG-TS/native engines, the neutral source
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
