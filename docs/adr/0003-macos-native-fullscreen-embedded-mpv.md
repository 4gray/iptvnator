---
status: proposed
date: 2026-06-30
deciders: maintainer
consulted: -
informed: -
---

# 3. Real macOS native fullscreen for embedded MPV

> [!WARNING]
> **Status: Proposed — not implemented on `master`.**
> This decision is implemented on a separate branch (macOS) and demonstrated in the proposal video. It is not part of the
> shipped app until accepted and merged.

## Context and Problem Statement

With the immersive overlay ([ADR-0002](./0002-embedded-mpv-immersive-compositing.md)),
the embedded-MPV player runs on a `transparent: true` window with the native
libmpv surface composited below the WebContents. Fullscreen still needs to work
and, per the requirement, must be **real macOS native fullscreen** (its own
Space), not a faked CSS cover.

DOM `requestFullscreen()` — the path the web engines use — ghosts/blacks out on
this transparent, native-below surface: the browser's fullscreen layer does not
composite correctly with the underlying native view. How should the embedded-MPV
player enter fullscreen?

## Decision Drivers

- **Real macOS native fullscreen (own Space) is a fixed requirement**, not a
  nice-to-have.
- No black screen / no persistent glitches during the transition.
- Clean exit via every path: the controls button, the green traffic-light, ESC,
  and ⌃⌘F.
- The shared controls component should stay engine-agnostic — the MPV-specific
  fullscreen mechanism must not leak into it.

## Considered Options

1. **DOM `requestFullscreen()` on the player surface** (the web-engine path).
2. **CSS "cover" fullscreen** — expand the element to fill the window without
   entering a real macOS fullscreen Space.
3. **Real macOS native fullscreen** of the Electron window via
   `win.setFullScreen`, supplied to the controls through an optional
   `PlayerFullscreenController` delegate.

## Decision Outcome

Chosen option: **Option 3 — real macOS native fullscreen via `win.setFullScreen`,
injected through an optional `PlayerFullscreenController` delegate.**

The shared `app-player-controls` runs DOM fullscreen by default (the built-in
`ControlsFullscreen` helper), which the web/PWA players keep. A host may instead
supply a `PlayerFullscreenController` delegate; the embedded-MPV player supplies
one that drives `setMainWindowFullScreen` → `win.setFullScreen`. This keeps the
contract and the controls component engine-agnostic while giving MPV a real
fullscreen Space.

To avoid transition glitches, on enter the native surface is put into autoresize
**fill** mode with its render **frozen** so the last frame scales cleanly through
macOS's snapshot animation, and the OS-fullscreen call is deferred a couple of
frames so macOS snapshots a clean full-bleed window. The video briefly pauses
during the transition — the built-in HTML5 player does the same. The player
**reconciles OS-initiated exits** (green button / ⌃⌘F / ESC) via
`onWindowStateChange`, and drops the window out of fullscreen on teardown so it is
never left stranded.

The `PlayerFullscreenController` delegate, the freeze/reconciliation logic, and
the tests live with the implementation on a separate branch.

### Consequences

- Good — a true macOS fullscreen Space, meeting the hard requirement.
- Good — the controls component stays engine-agnostic; only MPV opts into the
  delegate.
- Good — clean exit/reconciliation across button, green-button, ESC, and ⌃⌘F; the
  window is never stranded in fullscreen on teardown.
- Bad — a brief video pause during the transition (inherent to the macOS
  snapshot animation; HTML5 player does the same).
- Bad — macOS-only; the freeze/reconciliation logic is specific to this path.
- Bad — requires on-device macOS verification (animation/compositing not covered
  by unit tests/build).

## Pros and Cons of the Options

### Option 1 — DOM `requestFullscreen()`

- Good — zero extra mechanism; already used by the web engines.
- Bad — ghosts/blacks out on the transparent, native-below surface. Does not
  produce a usable fullscreen for embedded MPV.

### Option 2 — CSS "cover" fullscreen

- Good — avoids the transparent-window fullscreen issue and any transition pause.
- Bad — **not a real macOS fullscreen Space**, which the requirement forbids.

### Option 3 — native `win.setFullScreen` via delegate (chosen)

- Good / Bad — see Consequences.

## More Information

- Implemented (macOS) on a separate branch;
  demonstrated in the proposal video.
- Related: [ADR-0001 — Unified player-controls contract](./0001-unified-player-controls-contract.md),
  [ADR-0002 — Embedded-MPV immersive overlay compositing](./0002-embedded-mpv-immersive-compositing.md)
