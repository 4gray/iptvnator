# Proposal: A Unified Player-Controls Architecture

> **This is a direction proposal, not a code merge.** The implementation lives on
> a separate branch and is shown in the attached video. This PR contains only the
> **docs** that describe where I'd like the player layer to go. The goal is for
> the maintainer to decide whether IPTVnator should move this way **before** any
> implementation PR is opened upstream.

## TL;DR

IPTVnator has one player UI per engine: the embedded-MPV player had its own
bespoke controls, and each web engine (Video.js, hls.js/HTML5, ArtPlayer) renders
its own vendor skin. The controls a user sees therefore change depending on which
player a stream happens to use.

This proposes **one engine-agnostic player-controls layer** that every engine
reuses through a thin adapter, plus a true-overlay embedded-MPV player with real
macOS native fullscreen. Same look, same shortcuts, same features — everywhere —
and fully ours to style and extend.

## How we got here (short version)

1. Started as a "simple" macOS bug: embedded-MPV fullscreen showed black bars and
   near-invisible controls.
2. Root cause is structural: the native libmpv surface paints **outside** the web
   compositor, so DOM controls can't `z-index` over it (the "airspace" limit).
   The old workaround **docked** the controls — the video shrinks to expose a
   control strip, and the video disappears whenever a popover opens.
3. Fixing it properly meant choosing a real compositing strategy (native surface
   above vs. below the web layer vs. a child window) and landing on an
   **immersive overlay**: native video composited *below* a transparent window,
   revealed through a hole in a global backdrop, with DOM controls floating on
   top — and **real macOS native fullscreen** instead of DOM fullscreen.
4. Once the controls floated freely, it was a small step to make *every* player
   share the same controls component.

(See `docs/architecture/player-controls-refactor.md` for the full decision log.)

## What this proposes

A three-layer design (detailed in `docs/architecture/player-controls-contract.md`):

- **Contract** — `PlayerController` = `capabilities` (Signal) + `state` (Signal)
  + `commands` (imperative). Engine- and lifecycle-agnostic.
- **Default controls** — one presentation-only `app-player-controls` component
  (menus, auto-hide, keyboard shortcuts, feedback). No playback/session state.
- **Per-engine adapters** — `EmbeddedMpvControlsAdapter`, `WebVideoControlsAdapter`.
  Adding an engine = writing one adapter.

Embedded-MPV specifics (macOS) in `docs/architecture/embedded-mpv-native.md`:
immersive overlay (native `NSWindowBelow`, full-bleed, backdrop hole) and real
native fullscreen via `win.setFullScreen`.

## Status of the design

| Piece | State |
|---|---|
| Controls contract + shared component + adapters | Built |
| Embedded-MPV true-overlay (immersive) | Built (macOS) |
| Real macOS native fullscreen | Built |
| Web players on shared controls | Built, behind a **default-off** flag |
| Background playback (keep playing across navigation) | **Not built** — design kept ready |

## Required vs. optional (if the maintainer says "yes")

### Required to land the core goal
- The **contract + shared controls component + adapters** (the reusable seam).
- The **embedded-MPV immersive overlay + native fullscreen** (so MPV controls
  actually float and fullscreen works on macOS).
- **Docs** for the contract and the compositing/fullscreen behavior (this PR).

### Optional / staged (not required to adopt the direction)
- **Rolling out shared controls to the web engines.** Implemented but gated by
  `WEB_PLAYER_SHARED_CONTROLS_ENABLED` (default **off**) — flip per-engine when
  ready; zero change for web users until then.
- **Background playback** (keep a stream playing across view navigation, or a
  bottom mini-bar). The contract is deliberately lifecycle-agnostic and the
  session-disposal seam is isolated, so this is a contained follow-up.
- **Cross-platform embedded-MPV immersive/native-fullscreen** (currently macOS;
  Windows/Linux embedded MPV is unaffected and keeps working as today).
- **Picture-in-picture** as the web-engine answer to background playback
  (web `<video>` is route-scoped and can't trivially survive navigation).

## Advantages

- **Consistent UX** — identical controls, behavior, and keyboard shortcuts across
  every engine.
- **Build once, get everywhere** — a feature (recording, episode nav, …) added to
  the shared component lights up for all players.
- **Fully ours** — appearance and functionality are our Angular component, not a
  locked-down vendor skin.
- **Clean extension point** — new engines implement a small adapter; the controls
  and compositing don't change.
- **Safer maintenance** — the old ~743-line embedded-MPV component was split into
  focused, single-purpose files (contract, adapters, services, compositor).
- **Forward-compatible** — the lifecycle-agnostic contract is the groundwork for
  background playback without another rewrite.

## Downsides / trade-offs / risks

- **Embedded-MPV immersive + native fullscreen is macOS-only.** It relies on a
  `transparent: true` window and native compositing; Windows/Linux embedded MPV
  keep their current behavior. (Web players are cross-platform.)
- **Transparent main window on macOS** has a blast radius: `titleBarOverlay` is
  dropped there (native traffic lights are kept). This is an app-window setting,
  not local to the player.
- **Brief video pause during the fullscreen transition** — inherent to macOS's
  native-fullscreen snapshot animation; the built-in HTML5 player does the same.
- **More moving parts** — a contract + adapters + an immersive overlay is more
  indirection than per-engine skins. Mitigated by smaller, focused files + docs.
- **Web shared-controls rollout is a UX change** when enabled — hence the
  default-off flag and per-engine staging.
- **Background playback is not delivered here** — only made reachable.

## Open questions for the maintainer

1. Is a single shared controls UX across all engines the direction you want, or
   do you prefer keeping per-engine vendor skins for the web players?
2. Is macOS-first acceptable for the embedded-MPV immersive/native-fullscreen
   experience, with Windows/Linux following later?
3. Should the web shared-controls flag stay off (opt-in) for now, or is a staged
   default-on rollout desirable?
4. Is background playback a goal worth keeping the architecture aligned for?

## Reference docs in this PR

- `docs/architecture/player-controls-contract.md` — the contract, the shared
  component, the adapters, the flags, and background-playback readiness.
- `docs/architecture/player-controls-refactor.md` — the immersive overlay design
  and the full decision log (what was tried and rejected, and why).
- `docs/architecture/embedded-mpv-native.md` — native/IPC internals, the immersive
  compositing path, and native fullscreen (updated to reflect this direction).
