# Video.js Shared Controls Replacement Implementation Plan

> Execute with test-driven development. Each behavior change starts with a
> focused failing test, then the minimum implementation, then targeted and broad
> verification.

## Task 1: Extract focused Video.js types

Files:

- Add `libs/ui/playback/src/lib/vjs-player/vjs-player.types.ts`.
- Update `vjs-player.component.ts` imports.

Steps:

1. Move only the API shapes shared by collaborators.
2. Preserve existing runtime behavior.
3. Run the existing Video.js component spec.

## Task 2: Extract and harden audio-track ownership

Files:

- Add `vjs-audio-tracks.ts`.
- Add `vjs-audio-tracks.spec.ts`.
- Update `vjs-player.component.ts`.

Tests first:

- project labels and stable IDs;
- select exactly one valid track;
- stale/invalid ID is a no-op;
- legacy menu remains available flag-off;
- add/remove/change/labelchange refresh through stable callbacks;
- identity-aware bind and exact cleanup.

Implementation:

- Preserve the useful logging/menu behavior from #1153.
- Reset IDs at each source boundary.
- Use the same collaborator in legacy and shared modes.

## Task 3: Add Video.js subtitle-track ownership

Files:

- Add `vjs-text-tracks.ts`.
- Add `vjs-text-tracks.spec.ts`.

Tests first:

- filter captions/subtitles;
- stable IDs within a source;
- select one track and disable the rest;
- `-1` explicitly disables all tracks;
- stale ID is a no-op;
- global caption suppression/restoration;
- explicit off survives preference and track-list events;
- source reset and exact listener cleanup.

Implementation:

- Use `player.textTracks()`.
- Keep the helper Video.js-specific.

## Task 4: Extract raw MPEG-TS session

Files:

- Add `vjs-mpegts-session.ts`.
- Add `vjs-mpegts-session.spec.ts`.
- Remove the corresponding code from `vjs-player.component.ts`.

Tests first:

- source detection including query-declared HLS;
- authoritative live/VOD option;
- attach/load/play on the supplied current Tech video;
- VOD duration normalization;
- error classification;
- missing video handling;
- idempotent destroy and exact listener cleanup.

Implementation:

- Keep raw MPEG-TS attachment in the session and put pause/coalesced-reset
  ordering in a focused reset coordinator.
- Make `start` accept the current Tech video explicitly.

## Task 5: Add a rebindable Tech video session

Files:

- Add `vjs-video-element-session.ts`.
- Add `vjs-video-element-session.spec.ts`.

Tests first:

- attach once;
- rebind A → B removes all listeners from A and adds them once to B;
- loaded/playing clear the diagnostic;
- ended emits once;
- destroy is idempotent.

## Task 6: Add the shared-controls bridge

Files:

- Add `vjs-player-controls.bridge.ts`.
- Add `vjs-player-controls.bridge.spec.ts`.

Tests first:

- attach to the current Tech video;
- adapter accessors expose live/VOD, duration, audio, and subtitles;
- rebind detaches A and attaches B exactly once;
- source clear resets track state;
- input refresh reapplies captions and classification;
- destroy cleans track listeners and adapter exactly once.

Implementation:

- Use the component-scoped `WebVideoControlsAdapter`.
- Delegate track ownership to the focused collaborators.

## Task 7: Integrate the component and host

Files:

- Update `vjs-player.component.ts`, `.html`, and focused specs.
- Add `vjs-player.component.shared-controls.spec.ts`.
- Update `web-player-view.component.html`.
- Update `web-player-view.component.shared-controls.spec.ts`.

Tests first:

- flag-off preserves Video.js chrome and legacy navigation;
- flag-on renders exactly one shared controls UI;
- flag-on disables native controls, Video.js gestures/hotkeys, and spatial nav;
- shared controls use the real shell;
- diagnostic gating disables controls/shortcuts and exits owned fullscreen;
- both host Video.js branches receive `showCaptions` and
  `interactionEnabled`;
- `playerreset` rebinds the video session and controls bridge;
- reset-required changes coalesce while applying only the latest desired
  source;
- active playback pauses before `reset()`, and reset volume=1 never overwrites
  the user's actual volume;
- pre-ready reset does not start MPEG-TS twice;
- raw MPEG-TS restarts when authoritative live/VOD metadata changes.

Implementation ordering:

1. Create Video.js and register stable player lifecycle handlers.
2. On initial ready, bind the current Tech video and active source.
3. Before reset, snapshot actual volume, pause, and coalesce the latest desired
   source.
4. On any `playerreset`, restore volume, rebind sessions, and apply only the
   latest desired source before starting MPEG-TS.
5. Track whether the current Tech already has its source so pre-ready reset
   cannot double-start playback.
6. Destroy coordinator/bridge/session collaborators before `player.dispose()`.

## Task 8: Reduce file baselines and update canonical docs

Files:

- Update `tools/eslint/max-lines-baseline.mjs`.
- Update `docs/architecture/player-controls-contract.md`.
- Update `AGENTS.md` and `CLAUDE.md` only where their current shared-controls
  description becomes stale.
- Update `web-player-controls.flag.ts` documentation.

Checks:

- `vjs-player.component.ts` is below 400 lines.
- Split the component spec if needed and remove stale max-lines baselines.

## Task 9: Verification and PR loop

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache
pnpm nx lint ui-playback --skip-nx-cache
pnpm run typecheck:ci
pnpm run coverage:ci
pnpm run lint
git diff --check
```

Then:

1. Push the replacement branch.
2. Open a replacement PR that credits #1153 and states it supersedes it.
3. Trigger fresh Codex and Greptile reviews.
4. Resolve only verified findings.
5. Require full green CI.
6. Squash merge the replacement.
7. Close #1153 with thanks and a link to the merged replacement.
