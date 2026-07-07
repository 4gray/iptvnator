# Player Controls & Embedded-MPV Overlay — Refactor Summary

Concise reference for the player-controls contract refactor and the embedded-MPV
"immersive overlay" it enabled. For the full contract API see
[`player-controls-contract.md`](./player-controls-contract.md); for the native
layer see [`embedded-mpv-native.md`](./embedded-mpv-native.md).

---

## 1. Goal

- Give every player a clean, shared **controls contract** instead of per-engine control skins.
- Make the embedded-MPV controls a **true overlay** floating over full-bleed video (white controls, bottom gradient scrim).
- Keep the design **compatible with future background playback** (player owned above the router).

---

## 2. The Controls Contract (foundation)

- `PlayerController` = three things: `capabilities` (Signal), `state` (Signal), `commands` (imperative).
- Capabilities are **flags** — a control renders only if its flag is true.
- `app-player-controls` is **presentation-only**: binds to a `PlayerController`, owns only transient UI (menus, feedback, auto-hide, keyboard shortcuts, fullscreen).
- Each engine ships a thin **adapter** implementing `PlayerController`; the contract has **no component-lifecycle assumptions**.

### Adapters

- **Embedded MPV** — `EmbeddedMpvControlsAdapter` wraps `EmbeddedMpvSessionController` (IPC to the native session).
- **Web players** (Video.js / html5 / ArtPlayer) — one engine-agnostic `WebVideoControlsAdapter` over the `<video>` element, gated behind the `WEB_PLAYER_SHARED_CONTROLS` flag (default off).

---

## 3. Embedded-MPV Overlay — Chosen Approach

**Native video composites BELOW the web layer; controls are normal DOM in the main window.**

### How it works

- **Native:** the libmpv surface is inserted `NSWindowBelow` the Electron WebContents (`embedded_mpv.mm`), and is always full-bleed.
- **Window:** macOS main window is `transparent:true` (so the web layer can be see-through to the native surface); `titleBarOverlay` is dropped on macOS (incompatible with transparency); native traffic lights kept via `titleBarStyle:'hidden'`.
- **Tunnel:** while a video frame is on screen, a single structural rule — `body.embedded-mpv-immersive :has(app-embedded-mpv-player) { background: transparent !important }` — makes **every ancestor** of the live player transparent (plus an explicit clear on `body`, which `:has` can't reach from itself) so the native surface shows through.
- **Opacity:** the app stays opaque via **one global backdrop** — `app-embedded-mpv-immersive-backdrop` paints an opaque field with a single transparent **hole** at the measured video rect (`box-shadow: 0 0 0 100vmax`). Panels behind the transparent ancestors show the backdrop; only the hole shows video.
- **Hole = video:** the hole uses the same `measureBounds(viewport)` rect that drives the native surface bounds, re-synced on the controller's `boundsTick` — so hole and video move as one.
- **Controls:** `app-player-controls` renders inline in the main window and floats over the hole — ordinary DOM, so move-to-reveal / clicks / fullscreen all work natively.
- **Single owner:** `EmbeddedMpvImmersiveService` owns the cross-cutting transparency (signals `active` / `fullscreen` / `rect` + body classes). Components only call it.

### Lifecycle gates

- Tunnel + backdrop activate **only when a frame is visible** (`status === playing | paused`) — never during loading/idle/error, so the UI is never see-through without video.
- **Fullscreen:** real macOS **native fullscreen** of the Electron window (`setMainWindowFullScreen` → `win.setFullScreen`), supplied to `app-player-controls` via the optional `PlayerFullscreenController` delegate (web/PWA players omit it and keep built-in DOM fullscreen). On enter the player applies the CSS cover, hides chrome (`body.embedded-mpv-fullscreen`, backdrop off), and puts the native surface in autoresize **fill** mode with its render **frozen** so the last frame scales cleanly through macOS's snapshot animation — the video briefly pauses during the transition, as the HTML5 player also does. The OS-fullscreen call is deferred a couple of frames so macOS snapshots a clean full-bleed window (avoids a corner-image/flicker). The player **reconciles OS-initiated exits** (green button / Ctrl+Cmd+F / ESC) via `onWindowStateChange`, and drops the window out of fullscreen on teardown so it is never stranded.

---

## 4. Why This Approach

### Why "native below the UI" (not above)

- **mpv OSC (Lua):** can't match Material styling or app features (series-nav, recording). Rejected.
- **Child window overlay:** a `focusable:false` macOS window never receives continuous `mouseMoved` — controls only revealed on screen-enter, clicks/fullscreen unreliable. Rejected after on-device testing.
- **Native above + docked strip:** clean and no transparency, but the video shrinks to expose controls (visible inset) — rejected by the user as poor UX.
- **Native below (chosen):** the only option giving a true float with real DOM controls; input "just works" because controls live in the main, key window.

### Why "one backdrop with a hole" (not per-panel repaint)

- Making the video's ancestors transparent unavoidably removes the backing of sibling panels → they bleed to desktop.
- **Per-panel repaint** fixes bleed but requires enumerating every route's panels (live/VOD/series/M3U) — fragile, two lists to maintain. Rejected.
- **Backdrop + hole** inverts it: keep the app opaque by default, subtract one rectangle. **No per-route panel work**; new routes need no CSS. Route wrappers that paint an opaque plate around the player (e.g. a `#000` bed) are handled structurally: `body.embedded-mpv-immersive :has(app-embedded-mpv-player)` clears the background of every ancestor of the live player, so any wrapper plate on the chain is neutralized without maintaining a selector list. Two caveats: pseudo-element plates (`::before`/`::after`) on ancestors are **not** covered (the dev-mode opaque-cover guard flags them), and a future dialog-hosted player would make the CDK overlay containers transparent and needs an explicit exception. Sibling panels are unaffected — they keep their own backgrounds over the backdrop; DOM players are unaffected since the rule only matches while `<app-embedded-mpv-player>` exists.

---

## 5. Background-Playback Readiness (deferred, documented)

- The contract, controls component, and adapter carry no router/leaf-component assumptions.
- The MPV session lives in the main process; the renderer controller can be hoisted above the router and the session kept alive on navigation — a contained later change, not a rewrite.

---

## 6. Key Files

- Contract: `libs/ui/playback/src/lib/player-controls/` (model, `app-player-controls`, helpers).
- MPV: `libs/ui/playback/src/lib/embedded-mpv-player/` — `embedded-mpv-controls.adapter`, `embedded-mpv-session-controller`, `embedded-mpv-compositor`, `embedded-mpv-immersive.service`, `embedded-mpv-immersive-backdrop.component`.
- Web: `libs/ui/playback/src/lib/player-controls/web-video-controls.adapter.ts` (flag `web-player-controls.flag.ts`).
- Tunnel CSS: `apps/web/src/styles.scss` (`body.embedded-mpv-immersive` / `body.embedded-mpv-fullscreen`).
- Window + native: `apps/electron-backend/src/app/app.ts` (`transparent:true`), `apps/electron-backend/native/src/embedded_mpv.mm` (`NSWindowBelow`).

---

## 7. Constraints & Caveats

- Transparency is **macOS-only**; Windows/Linux use the `--wid` native path and stay opaque.
- On macOS, `transparent:true` (and the dropped `titleBarOverlay`) applies to **all users unconditionally** — not just those with `IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT` set — because `transparent` is fixed at window creation and cannot be toggled at runtime.
- While a video plays, panels show the single backdrop color (`--app-content-bg`) instead of the subtle rail/content tonal layering — negligible in light theme, more visible in dark.
- The native-through-the-hole compositing, traffic-light chrome, and hole/video congruence require **on-device macOS verification** (not covered by unit tests/build).
