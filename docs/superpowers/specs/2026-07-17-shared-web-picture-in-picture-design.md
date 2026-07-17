# Shared Web Picture-in-Picture Design

## Status

Selected as the first follow-up to the shared web-player controls rollout.

## Goal

Restore Picture-in-Picture (PiP) in IPTVnator's shared controls for the three
`<video>`-backed web engines:

- HTML5/hls.js;
- Video.js; and
- ArtPlayer.

The feature must use the same button, accessibility behavior, capability
gating, and lifecycle rules in all three engines.

## Non-goals

- Do not add PiP, a popup, or an always-on-top mini-player for Embedded MPV.
- Do not add AirPlay or Cast.
- Do not implement Document Picture-in-Picture.
- Do not move IPTVnator's Angular controls into the operating-system PiP
  window.
- Do not add a PiP keyboard shortcut.
- Do not change the default-off rollout behavior of shared web controls.
- Do not alter the existing vendor/native controls when shared controls are
  disabled.

## Architecture decision

PiP becomes an explicit part of the engine-neutral `PlayerController`
contract:

```ts
interface PlayerControlsCapabilities {
    pictureInPicture: boolean;
}

interface PlayerControlsState {
    pictureInPictureActive: boolean;
    canPictureInPicture: boolean;
}

interface PlayerControlsCommands {
    togglePictureInPicture(): void;
}
```

`WebVideoControlsAdapter` owns the standard browser PiP integration because it
already owns and rebinds the current `HTMLVideoElement`. This is especially
important for Video.js, which can replace its Tech `<video>` after
`playerreset`.

The shared presentation remains independent of HTML5, Video.js, and ArtPlayer:
it reads the generic capability/state and invokes the generic command.

Embedded MPV advertises `pictureInPicture: false`, reports inactive/unavailable
state, and implements a no-op command. This is contract compatibility only; no
Embedded MPV PiP surface or popup is introduced.

### Rejected alternatives

Passing a separate `HTMLVideoElement` input to `app-player-controls` would keep
PiP outside the controller, like DOM fullscreen, but would require bespoke
target wiring and replacement handling in every web-player host.

Calling Video.js and ArtPlayer vendor PiP APIs directly would duplicate
feature detection, ownership, failure handling, and lifecycle behavior. It
would also leave the HTML5 player on a separate implementation.

## Capability and state semantics

`pictureInPictureActive` is true only when
`document.pictureInPictureElement === attachedVideo`.

The adapter can request PiP when all of the following hold:

- an `HTMLVideoElement` is attached;
- `document.pictureInPictureEnabled === true`;
- `video.requestPictureInPicture` is a function;
- `document.exitPictureInPicture` is a function; and
- `video.disablePictureInPicture !== true`.

The `pictureInPicture` capability is true when the adapter can request PiP or
when the attached video is already active and the browser still exposes
`document.exitPictureInPicture()`. This keeps the exit action available if the
element's disable flag or the document support flag changes after entry.

`canPictureInPicture` is false while an enter/exit operation is pending.
Otherwise, it is true when:

- the attached video is already the active PiP owner and the browser exposes
  `document.exitPictureInPicture()`, so the user can exit; or
- the adapter can request PiP and the video has loaded metadata
  (`readyState >= 1`, equivalent to `HTMLMediaElement.HAVE_METADATA`).

Browser `enterpictureinpicture` and `leavepictureinpicture` events are
authoritative. The adapter does not optimistically report an active state
before the browser confirms entry. Settled promises trigger a reconciliation
refresh as a fallback for unusual browser event ordering.

## Command behavior

`togglePictureInPicture()` is fire-and-forget, matching the existing command
contract:

- when the attached video owns PiP, call `document.exitPictureInPicture()`;
- otherwise, call `video.requestPictureInPicture()`;
- ignore the command when capability/readiness gating fails;
- ignore an additional toggle while an enter/exit operation is pending;
- contain synchronous exceptions and rejected promises; and
- never emit an unhandled rejection.

The request call starts synchronously inside the button click so browser user
activation is preserved.

Fullscreen and PiP remain separate browser-managed presentation modes.
IPTVnator does not await one transition before requesting the other, because
that can consume the initiating user activation. The adapter and fullscreen
helper reconcile the browser's resulting events.

## Lifecycle and ownership

The adapter attaches exact `enterpictureinpicture` and
`leavepictureinpicture` listeners to its current video alongside the existing
media listeners.

Source replacement on the same video element does not exit PiP. This allows a
normal HTML5 or Video.js source change that retains its current video element
to continue in the existing PiP window and show the new source. ArtPlayer
currently rebuilds its player and video element on channel changes, so that
replacement follows the owned-target cleanup below and exits PiP.

When the adapter detaches or rebinds to a replacement video:

1. it removes listeners from the old video;
2. if and only if the old video currently owns PiP, it best-effort exits PiP;
3. it clears local active/pending state;
4. it invalidates old asynchronous completions; and
5. it binds the replacement video as the only authoritative target.

An unrelated document PiP element must never be closed by this adapter.
Stale events or promise completions from an old target must not mutate the new
target's state.

Video.js Tech replacement therefore exits PiP owned by the old Tech and does
not automatically enter PiP on the replacement Tech. Automatic re-entry would
require a new user gesture and is intentionally not attempted.

Destroying HTML5, Video.js, or ArtPlayer performs the same owned-target cleanup.
A playback diagnostic hiding shared controls does not itself close PiP; the
browser-provided PiP window still has its own close affordance, and target
teardown remains the ownership boundary.

## Shared controls UI

The PiP action is rendered immediately before fullscreen.

- It is omitted when `pictureInPicture` is false.
- It is disabled while `canPictureInPicture` is false.
- `aria-pressed` reflects `pictureInPictureActive`.
- Tooltip and accessible text use
  `EMBEDDED_MPV.PLAYER.ENTER_PICTURE_IN_PICTURE` and
  `EMBEDDED_MPV.PLAYER.EXIT_PICTURE_IN_PICTURE`.
- The inactive and active states use distinct Material icons.
- Clicking it reveals the controls and invokes the command exactly once.

Both translation keys are added to every locale file. No shortcut is added in
this change.

Standard element PiP displays video frames in an OS/browser-managed window. It
does not display IPTVnator's Angular control bar or other DOM overlays.
Subtitle display inside PiP remains dependent on browser support for the
active native text track.

## Engine behavior

### HTML5

The existing shared-controls bridge attaches `WebVideoControlsAdapter` to the
component's real `<video>`. No separate PiP host wiring is required.

### Video.js

The existing bridge attaches to the current Tech `<video>` and rebinds after
`playerreset`. The adapter's owned-target cleanup handles PiP during that
replacement. Video.js's vendor PiP button remains available when shared
controls are disabled.

### ArtPlayer

The existing neutral source bridge attaches to `player.video`. Shared mode
keeps ArtPlayer's vendor `pip: false` option so exactly one PiP button is
rendered. Legacy mode keeps the existing `pip: true` behavior.

### Embedded MPV

Both frame-copy and native-view Embedded MPV remain without PiP. No window,
popup, frame-copy routing, or native addon behavior is added.

## Error handling

PiP can fail because of missing metadata, browser policy, lost user activation,
or an OS-level denial. Such failures:

- do not change playback state;
- do not create persistent error UI;
- do not mark PiP active;
- clear the pending gate; and
- leave the button available for a later user retry when the runtime still
  reports support.

## Testing strategy

### Contract and shared UI

- defaults keep PiP capability/state false;
- the button is absent without capability;
- supported-but-not-ready state renders a disabled action;
- inactive and active labels/icons/`aria-pressed` are correct; and
- a click invokes `togglePictureInPicture()` once.

### Web adapter

- feature-detection matrix for document/video APIs and
  `disablePictureInPicture`;
- metadata readiness gating;
- request when inactive and exit when active;
- authoritative enter/leave event reconciliation;
- pending-toggle serialization;
- synchronous throw and rejected-promise containment;
- listener cleanup;
- same-element source refresh preserving active PiP;
- active old video to replacement video exits only the old owner;
- stale old-video events/completions cannot mutate the replacement; and
- detach never exits an unrelated PiP element.

### Engine integrations

- HTML5 shared mode exposes web PiP through its attached video;
- Video.js Tech replacement rebinds PiP authority and cleans up the old owner;
- ArtPlayer shared mode exposes shared PiP while vendor PiP stays disabled;
- ArtPlayer channel rebuild exits PiP owned by the replaced video;
- all three flag-off paths retain their existing native/vendor chrome; and
- Embedded MPV remains capability-false.

### Validation

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand
pnpm nx lint ui-playback --skip-nx-cache
pnpm nx build web --configuration=development --skip-nx-cache
```

Unit tests cannot prove that an OS-managed PiP window opens. Perform a manual
smoke test in a supported Chromium/Electron runtime for each web engine:

1. open a playable stream;
2. enter and exit PiP;
3. change source on the same element where applicable;
4. switch or destroy the player host; and
5. confirm the legacy controls path is unchanged.

## Documentation impact

Update `docs/architecture/player-controls-contract.md` with the capability,
state, command, lifecycle, and browser limitations. Mirror the concise shared
controls summary in `AGENTS.md` and `CLAUDE.md`.
