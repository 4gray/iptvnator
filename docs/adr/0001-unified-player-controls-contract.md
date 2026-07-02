---
status: proposed
date: 2026-06-30
deciders: maintainer
consulted: -
informed: -
---

# 1. Unified, engine-agnostic player-controls contract

> [!WARNING]
> **Status: Proposed — not implemented on `master`.**
> This decision is implemented on a separate branch and demonstrated in the proposal video. It is not part of the shipped
> app until accepted and merged.

## Context and Problem Statement

IPTVnator renders a different control UI per playback engine. The embedded-MPV
player carried its own bespoke ~743-line component that fused five concerns
(native-surface lifecycle, bounds/compositing, the controls UI, transient UI
state, and recording display), while each web engine (Video.js, html5+hls.js,
ArtPlayer) renders its own vendor skin. The controls a user sees — their look,
behaviour, and keyboard shortcuts — therefore change depending on which engine a
stream happens to use.

Three problems follow from this:

- **Inconsistent UX.** No shared look, shortcuts, or feature set across engines.
- **No reuse / no single place to build features.** A control (recording,
  episode navigation, …) has to be re-implemented per engine, or simply doesn't
  exist on some.
- **Coupling blocks future work.** Fusing controls with session/compositing
  concerns is what made the MPV controls un-floatable and helped block background
  playback (the player was owned by a routed leaf Angular destroys on navigation).

How should the player layer be structured so every engine presents the same
controls while each remains free to render and composite its own way?

## Decision Drivers

- Consistent controls, behaviour, and keyboard shortcuts across every engine.
- "Build once, get everywhere" — a feature added once lights up for all players.
- Ownership — controls should be our component, not a locked-down vendor skin.
- A clean extension point for new engines.
- Maintainability — break up the ~743-line component into focused files.
- Forward-compatibility with background playback (lifecycle-agnostic controls).

## Considered Options

1. **Keep per-engine vendor skins** (status quo).
2. **Standardize every engine on one vendor's skin** (e.g. drive all web players
   and MPV through ArtPlayer's UI).
3. **Engine-agnostic `PlayerController` contract + one shared
   `app-player-controls` component + thin per-engine adapters.**

## Decision Outcome

Chosen option: **Option 3 — an engine-agnostic contract with a single shared
controls component and per-engine adapters.**

The contract is three things: `capabilities` (Signal), `state` (Signal), and
`commands` (imperative, fire-and-forget). Capabilities are booleans that gate
which controls render, so each engine exposes exactly what it supports. One
presentation-only `app-player-controls` component binds purely to a
`PlayerController` and owns only transient UI (menus, auto-hide, feedback,
keyboard shortcuts, fullscreen). Each engine ships a small adapter:
`EmbeddedMpvControlsAdapter` (libmpv session via IPC) and a single
`WebVideoControlsAdapter` (any `<video>`-backed engine — Video.js, html5+hls.js,
ArtPlayer). Adding an engine means writing one adapter.

The contract carries **no component-lifecycle assumptions**, which is the
groundwork for background playback (see
[ADR-0002](./0002-embedded-mpv-immersive-compositing.md) for the MPV compositing
that this enables): a controller can later be hosted by a persistent host above
the router so the session keeps playing across navigation, without changing the
contract or the controls component.

The full contract API, file map, and background-playback seam analysis live with
the implementation on a separate branch.

### Consequences

- Good — identical UX, behaviour, and shortcuts across all engines.
- Good — features are built once in the shared component and apply everywhere.
- Good — appearance and behaviour are fully ours (an Angular component).
- Good — new engines implement a small adapter; controls/compositing don't change.
- Good — the ~743-line MPV component is split into focused, single-purpose files.
- Good — lifecycle-agnostic contract makes background playback a contained
  follow-up rather than a rewrite.
- Bad — more moving parts (contract + adapters + a shared component) than a
  per-engine skin; mitigated by smaller, focused files and these docs.
- Bad — rolling the shared controls onto the web engines is itself a UX change;
  it is therefore gated behind a default-off flag and staged per engine.

## Pros and Cons of the Options

### Option 1 — keep per-engine vendor skins

- Good — zero work; no risk.
- Bad — perpetuates inconsistent UX and prevents shared features.

### Option 2 — standardize on one vendor's skin

- Good — one UI without writing a controls component.
- Bad — a vendor skin can't match Material styling or app features (recording,
  series navigation), and locks us into that vendor's capabilities and lifecycle.
- Bad — does not fit the embedded-MPV engine (no `<video>`), which is the player
  that most needs custom controls.

### Option 3 — contract + shared component + adapters (chosen)

- Good — see Consequences.
- Bad — indirection cost, mitigated by file size and docs.

## More Information

- Implemented on a separate branch (with full
  contract API, adapters, and tests); demonstrated in the proposal video.
- Related: [ADR-0002 — Embedded-MPV immersive overlay compositing](./0002-embedded-mpv-immersive-compositing.md),
  [ADR-0003 — Real macOS native fullscreen for embedded MPV](./0003-macos-native-fullscreen-embedded-mpv.md)
- Rollout flag: `WEB_PLAYER_SHARED_CONTROLS_ENABLED` (default off).
