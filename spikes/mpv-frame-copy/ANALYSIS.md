# Embedded MPV: frame-copy unification — analysis handoff

> Committed for history: this is the 2026-07-10 analysis that kicked off the
> spike and the integration on this branch. Current state lives in
> README.md/RESULTS.md/DESIGN.md next to this file and in
> `docs/architecture/embedded-mpv-native.md` ("Frame-Copy Engine").

Status: **analysis/decision doc, no code yet.** This distills a working session
(2026-07-10) comparing the embedded-MPV approaches and designing the next step.
A fresh agent/developer session should be able to continue from this file alone.

## Context

- Contributor **larsemig** proposed a unified player-controls architecture in
  [PR #1105](https://github.com/4gray/iptvnator/pull/1105) (docs-only, direction
  approved) and implemented it as a stacked 7-PR series:
  [#1148](https://github.com/4gray/iptvnator/pull/1148) shared controls layer,
  [#1149](https://github.com/4gray/iptvnator/pull/1149) session-controller decompose,
  [#1150](https://github.com/4gray/iptvnator/pull/1150) immersive overlay (macOS),
  [#1151](https://github.com/4gray/iptvnator/pull/1151) native macOS fullscreen,
  [#1152](https://github.com/4gray/iptvnator/pull/1152)–[#1154](https://github.com/4gray/iptvnator/pull/1154)
  HTML5/Video.js/ArtPlayer on shared controls (flag `WEB_PLAYER_SHARED_CONTROLS`, default OFF).
- All 7 PRs are OPEN (as of 2026-07-10). Master still has the pre-series
  ("docked controls") approach documented in `docs/architecture/embedded-mpv-native.md`.

## Comparison verdict

The series is really **two independent things**:

1. **Shared engine-agnostic controls contract** (`PlayerController`:
   capabilities/state/commands + thin per-engine adapters) — low-risk, valuable,
   survives any change of rendering mechanics. Recommendation: merge PRs 1, 2, 5, 6, 7.
2. **Immersive compositing** (native mpv surface `NSWindowBelow` the WebContents,
   `transparent:true` main window, structural CSS "tunnel" via
   `:has(app-embedded-mpv-player)`, backdrop-with-hole) — the risky part.
   Two field bugs already found by 4gray in #1154:
   - opaque page wrappers painting black over the video (fixed structurally);
   - transparent "hole to the desktop" until the user scrolls — a Chromium
     compositor damage-tracking bug class, not fixable app-side.
   Worst for prod: `transparent:true` is set at window creation and therefore
   applies to **all macOS users unconditionally**, flag or no flag.
   Recommendation: do not ship PRs 3–4 as-is; keep as experiment.

## Next step: frame-copy prototype (larsemig's own follow-up idea)

Idea from [his comment on #1154](https://github.com/4gray/iptvnator/pull/1154#issuecomment-4932807350):
render natively in the background, copy frames into the web UI, drop the
transparent window entirely. Assessment: correct direction — trades
unpredictable compositor bugs for a predictable performance tax, and it is the
only realistic path to one architecture on macOS/Windows/Linux.

### Target architecture (prototype the end-state directly)

```
mpv-helper process (links libmpv)          Electron
  decode (hwdec=*-copy)                      native addon: map shm,
  render offscreen GL FBO -> async PBO       memcpy frame -> ArrayBuffer
  readback (or SW render)                    renderer: WebGL texture upload
  audio -> OS directly                       in rAF -> <canvas>; controls = DOM
        |                                        ^
        +---- shared-memory ring buffer ---------+
        +---- JSON IPC (reuse Linux protocol in
              embedded_mpv_wid_common.h) -------->
```

Key design points:

- **Helper process, not in-process libmpv**: in-process is forbidden on Linux
  (ffmpeg/GL symbol clash with Electron — see `embedded-mpv-native.md`), and a
  helper gives crash isolation everywhere + lets Linux finally bundle libmpv
  (full feature set, Flatpak/Snap become possible, no system-mpv-on-PATH).
- **Render at viewport size, not source size** — mpv scales on GPU before
  readback; 4K source in a 720p window costs 720p. Full price only in 4K fullscreen.
- **Audio untouched** (helper plays directly); compensate video-path latency
  with calibrated mpv `--audio-delay` to restore lip-sync.
- **3-frame ring buffer** in shm; reader takes latest complete frame, drops
  stale ones (prevents latency accumulation).
- The controls layer from the PR series is reused as-is (adapter over the same
  `PlayerController` contract); tunnel/backdrop/immersive code becomes unnecessary.

### 4K numbers and risks

- 3840×2160 RGBA = 33 MB/frame; ~2 GB/s per copy at 50–60 fps; 2–3 copies in
  the path (readback, shm→buffer, texture upload).
- Added latency ≈ 2–3 frames (~40–60 ms): async PBO readback +1 frame, memcpy
  ~6–8 ms, rAF alignment 0–17 ms, Chromium compositor +1 frame. Fixed latency
  is NOT the problem for IPTV (audio-delay compensates lip-sync).
- Real risks: **frame pacing/judder** on weak hardware (Intel iGPU, old
  Intel Macs) if the per-frame budget isn't met consistently; **50→60 Hz
  cadence** judder (mpv's display-resync is lost with manual rAF presentation);
  **HDR** must be tonemapped (canvas is SDR); battery cost of extra GB/s.

### Prototype plan and go/no-go gates

1. Spike without Electron (~days): helper renders to shm; bare Chromium page draws.
2. Measure on: Apple Silicon, Intel Mac, mid-range Windows laptop (iGPU).
   Scenarios: 1080p60, 4K25/50 SDR, 4K HDR; windowed + fullscreen.
3. Gates: sustained fps with low frame-time variance (not average fps!),
   CPU/GPU %, end-to-end latency (flash test), battery drain.
4. Only on green numbers: integrate behind its own flag; docked path stays as fallback.
   If weak hardware fails: still viable as main path with auto-fallback to
   docked/external player for 4K fullscreen.

## Coordination

larsemig offered to hand over or assist (see #1154 thread). Suggested reply:
convert the offer into a joint frame-copy spike rather than a branch handover.
