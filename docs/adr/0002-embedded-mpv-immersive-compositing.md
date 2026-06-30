---
status: proposed
date: 2026-06-30
deciders: maintainer
consulted: -
informed: -
---

# 2. Embedded-MPV immersive overlay compositing

> [!WARNING]
> **Status: Proposed — not implemented on `master`.**
> This decision is implemented on a separate branch (macOS) and demonstrated in the proposal video. It is not part of the
> shipped app until accepted and merged.

## Context and Problem Statement

The embedded-MPV player renders a native libmpv surface that paints **outside**
the web compositor. DOM elements therefore cannot reliably `z-index` over it —
the "airspace" limitation. This is what made true overlay controls impossible and
forced the original workaround: a **docked strip** that shrinks the native video
to expose a control band. That approach has a fatal UX cost — opening any
dropdown/menu shrinks the video away, so there is effectively *no video whenever
a control is open*.

The goal ([ADR-0001](./0001-unified-player-controls-contract.md)) is for the
shared `app-player-controls` to float over **full-bleed** video as ordinary DOM.
How should the native MPV surface be composited so that DOM controls float over
it, video stays full-bleed, and input "just works"?

## Decision Drivers

- True floating controls over **full-bleed** video (no shrink, no dock).
- Controls, menus, and dialogs are normal DOM that reliably receive input.
- Video never disappears when a control opens.
- No per-route panel maintenance as new routes are added.
- White controls over a transparent-black → transparent gradient scrim.
- Compatible with future background playback (hide ≠ dispose).

## Considered Options

1. **Docked strip** — native surface `NSWindowAbove`, video shrinks to expose a
   control band (the status quo workaround).
2. **Native surface above the web layer** (full-bleed) — controls would be hidden
   behind the video.
3. **Child-window overlay** — a `focusable:false` macOS window for the controls.
4. **mpv OSC (Lua) native controls** — use mpv's own on-screen controller.
5. **Immersive overlay** — native surface composited **below** the WebContents on
   a `transparent: true` window, revealed through a transparent **hole** in a
   single global backdrop, with DOM controls floating on top.

A sub-decision under Option 5: how to keep the rest of the app opaque while the
video shows through — **per-panel repaint** vs **one global backdrop with a hole**.

## Decision Outcome

Chosen option: **Option 5 — immersive overlay (native below a transparent
window, revealed through a backdrop hole).**

The native libmpv surface is inserted `NSWindowBelow` the WebContents and is
always full-bleed. While a frame is on screen, the video's ancestor elements are
made transparent and a single global backdrop (`EmbeddedMpvImmersiveService` +
`embedded-mpv-immersive-backdrop`) paints an opaque field with one transparent
hole at the measured video rect (`box-shadow: 0 0 0 100vmax`). The inline
`app-player-controls` float over the hole as ordinary DOM; menus and modals paint
normally on top. The hole uses the same `measureBounds` rect that drives the
native surface bounds, so hole and video move as one.

For the sub-decision, **one global backdrop with a hole** is chosen over
per-panel repaint: making the video's ancestors transparent unavoidably removes
the backing of sibling panels, and enumerating every route's panels to repaint
them is fragile and needs maintaining two lists. The backdrop-with-hole inverts
it — keep the app opaque by default and subtract one rectangle — so new routes
need no CSS.

The native/IPC and cross-platform internals, and the full decision log, live with
the implementation on a separate branch.

### Consequences

- Good — the only option that gives true floating DOM controls over full-bleed
  video; input "just works" because controls live in the main, key window.
- Good — no per-route panel work; new routes need no CSS.
- Good — the native surface is decoupled from disposal (hide ≠ dispose), which
  helps future background playback.
- Bad — **macOS-only.** It relies on a `transparent: true` window and native
  compositing; Windows/Linux embedded MPV use the `--wid` path and are unaffected.
- Bad — the transparent main window on macOS has a blast radius: `titleBarOverlay`
  is dropped there (native traffic lights are kept). This is an app-window
  setting, not local to the player.
- Bad — while a video plays, panels show the single backdrop color instead of the
  subtle tonal layering (negligible in light theme, more visible in dark).
- Bad — the native-through-the-hole compositing requires on-device macOS
  verification (not covered by unit tests/build).

## Pros and Cons of the Options

### Option 1 — docked strip (status quo)

- Good — reliable, no transparency, cross-platform.
- Bad — video never truly fills the screen and **disappears whenever a control
  opens**. Rejected by the user as poor UX.

### Option 2 — native above the web layer

- Good — full-bleed video, no transparency tricks.
- Bad — DOM controls are hidden behind the video. Non-starter.

### Option 3 — child-window overlay

- Good — DOM controls, full-bleed video.
- Bad — a `focusable:false` window never receives continuous `mouseMoved`, so
  controls reveal only on screen-enter and clicks/fullscreen are unreliable.
  Rejected after on-device testing.

### Option 4 — mpv OSC (Lua)

- Good — no airspace problem at all (mpv draws its own controls).
- Bad — can't match Material styling or app features (series-nav, recording).
  Rejected.

### Option 5 — immersive overlay (chosen)

- Good / Bad — see Consequences.

## More Information

- Implemented (macOS) on a separate branch;
  demonstrated in the proposal video.
- Related: [ADR-0001 — Unified player-controls contract](./0001-unified-player-controls-contract.md),
  [ADR-0003 — Real macOS native fullscreen for embedded MPV](./0003-macos-native-fullscreen-embedded-mpv.md)
