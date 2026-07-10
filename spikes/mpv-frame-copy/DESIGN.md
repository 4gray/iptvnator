# Frame-copy engine — integration design (draft)

Status: **draft for discussion**, based on the spike in this directory
(measurements: `RESULTS.md`; analysis:
`.plans/2026-07-10-embedded-mpv-frame-copy-unification.md`). Not committed
to `docs/architecture/` yet because nothing here ships; graduate it there
when integration starts.

## Goal

One embedded-playback rendering architecture on macOS, Windows, and Linux:
mpv renders in a helper process, frames are copied into the web UI as a
normal `<canvas>`. This replaces, eventually:

- macOS: `NSOpenGLView` layered under/over Chromium (fragile against OS
  compositor changes — see the macOS 26.2 layering regression) and the
  immersive `transparent:true` experiment (PRs #1150–#1151);
- Windows: `--wid` against a child `HWND` (native surface stacking, no DOM
  overlays);
- Linux: out-of-process `mpv --wid=<x11-window>` (X11-only, system mpv
  required, reduced feature set).

## Process model

- `iptvnator-mpv-helper` — a per-session process shipped with the app,
  linking the bundled libmpv on **all three platforms**. In-process libmpv
  is forbidden on Linux (ffmpeg/GL symbol clash with Electron), but a
  helper process is exactly the isolation that makes it legal — so Linux
  finally gets the full libmpv feature set (subtitles, speed, aspect,
  recording), native-Wayland stops mattering (no window embedding at all),
  and Flatpak/Snap become possible.
- Spawned/owned by the existing `EmbeddedMpvNativeService` successor in the
  Electron main process. Helper crash = session `error` event + UI fallback;
  the Electron process is never taken down by libmpv.
- The native addon shrinks to a thin shm reader (map + copyLatest), as in
  the spike. Process spawning/control needs no native code (Node
  `child_process` + stdio).

## Control protocol

- JSON lines over the helper's stdin/stdout, evolving the command set the
  Linux `--wid` backend already speaks over its socket
  (`embedded_mpv_wid_common.h`): `loadfile` (with start offset, headers,
  user-agent, referrer), `pause`, `seek`, `volume`, `aid`/`sid`/`speed`/
  `video-aspect-override`, `stream-record`, `quit`.
- Unlike the Linux socket backend, the helper links libmpv, so it pushes
  property events (status, time-pos/duration, track-list, eof-reached)
  instead of being polled with a scalar-only parser. Status mapping
  (`ended` vs `idle` vs `error`, `MPV_END_FILE_REASON_*`, `eof-reached`
  with `keep-open`) is ported unchanged from `embedded_mpv.mm`.
- The main process keeps translating to the existing
  `EmbeddedMpvSession` contract — the preload/renderer API surface does not
  change, so `EmbeddedMpvPlayerComponent` and the PR-series
  `PlayerController` adapter sit on top unmodified.

## Video path

- shm ring exactly as in the spike: 3 slots, per-slot seqlock, BGRA frames
  at **viewport size** (claim verified: 4K source in a 720p viewport costs
  720p — RESULTS.md).
- Renderer: WebGL2 canvas inside the player component, rAF-polling
  `latestSeq` (spike-proven at 60 fps; a wakeup channel is a later
  optimization, as is skipping redraws when no new frame arrived).
- **This deletes the compositor-workaround machinery**: no bounds-sync on
  scroll/resize, no `HIDDEN_BOUNDS` when dialogs open, no 300 px popover
  cutout, no reserved control dock — controls and dialogs are ordinary DOM
  above a canvas.
- Resize: renderer reports new bounds (debounced ~100 ms) → helper
  recreates FBO/PBOs and a new shm generation
  (`/iptvnator-mpv-<sessionId>-<gen>`); the viewer remaps on the control
  event announcing the new generation and keeps presenting the old frame
  (CSS-scaled) until the first new-generation frame lands.

## Audio and A/V sync

Audio never crosses the boundary — the helper plays it through the OS
directly. The video path adds ~10 ms on M1 (measure per platform); a
calibrated default `--audio-delay` compensates lip-sync. Calibration method
(flash test) is still an open gate.

## HDR

mpv tonemaps HDR→SDR before readback (verified with 4K25 HDR10 PQ/BT.2020
at full rate). The canvas stays SDR; HDR passthrough is explicitly out of
scope for v1.

## Packaging

- macOS/Windows: the existing vendored-LGPL libmpv staging
  (`tools/embedded-mpv/`, `vendor/embedded-mpv/`) is reused as-is; the
  helper binary is one more artifact built per platform/arch next to
  `embedded_mpv.node`.
- Linux: the helper links the **bundled** libmpv — the
  `external-mpv-process` manifest and the system-mpv-on-PATH requirement
  disappear. Linux staging switches from "headers only" to the same
  vendored-runtime flow as macOS.
- Windows shm: POSIX `shm_open` on macOS/Linux, `CreateFileMapping` named
  sections on Windows behind the same header layout.

## Platform bring-up order

1. macOS: spike is the implementation seed (CGL headless + PBO ring).
2. Windows: WGL headless context (hidden window) + same GL readback path;
   `MPV_RENDER_API_TYPE_SW` is the fallback bring-up option if WGL fights,
   at the cost of CPU-side scaling.
3. Linux: EGL headless (surfaceless platform) — also drops the
   Xwayland-only constraint.

## Rollout

- Behind its own experiment flag (settings + env), default OFF. The current
  docked native path stays the default until the hardware gates pass.
- Relationship to the PR series: the shared-controls PRs (#1148, #1149,
  #1152–#1154) merge independently — the frame-copy player is just another
  `PlayerController` engine. The immersive/transparent-window PRs
  (#1150–#1151) stay experimental and are superseded by this path.

## Open gates before default-ON

- Intel Mac / Windows iGPU numbers (pending hardware; RESULTS.md has the
  repro recipe).
- Latency flash test + per-platform `--audio-delay` calibration.
- Battery drain delta vs the native-surface approach.
- Windows/Linux helper ports validated on real machines.
