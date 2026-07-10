# mpv frame-copy spike

Standalone prototype for the frame-copy unification of embedded MPV
(analysis: `.plans/2026-07-10-embedded-mpv-frame-copy-unification.md`).
Instead of compositing a native mpv surface under a transparent Electron
window, the helper renders mpv offscreen and copies frames into the web UI:

```
mpv_helper (links libmpv)                Electron viewer
  decode (hwdec) + offscreen GL FBO        shm_reader.node: memcpy newest
  async PBO readback (3-deep ring)         frame -> ArrayBuffer
  BGRA frames -> shm ring (3 slots)        renderer: texSubImage2D in rAF
  audio -> OS directly                     -> WebGL canvas (BGRA swizzle)
        |                                      ^
        +------ POSIX shm ring buffer ---------+
```

macOS only for now. No Electron-app integration, no controls — this exists
to measure whether the copy pipeline meets the go/no-go gates.

## Build and run

Requires Homebrew `mpv` (libmpv + headers) and Node headers for the addon
build (`NODE_INC` in the Makefile, defaults to nvm's v22.14.0).

```bash
./run.sh /path/to/video.mkv 3840x2160
./run.sh 'av://lavfi:testsrc2=size=1920x1080:rate=60'   # synthetic source
HELPER_ARGS='--hwdec videotoolbox --loop' ./run.sh /tmp/clip.mp4 3840x2160
```

`run.sh` builds both binaries, starts the helper, then opens the Electron
viewer (binary auto-detected from the repo `node_modules`, override with
`ELECTRON=`). The helper prints producer stats to stderr once per second;
the viewer prints `STATS` lines to stdout every 2 s and shows the same in an
on-screen HUD. `PIXELPROBE` is a one-shot image sanity check (spread > 0
means real frames, not black).

Key design points implemented here:

- **Render at viewport size**: `--size WxH` is the FBO size; mpv scales on
  the GPU before readback, so a 4K source in a 720p viewport costs 720p.
- **Async PBO readback**: `glReadPixels` goes into a 3-deep PBO ring; the
  previous frame's PBO is mapped/copied while the new readback is in flight.
- **3-slot shm ring with per-slot seqlock**: the reader takes the newest
  complete frame and drops stale ones, so latency cannot accumulate.
- **Audio never crosses the boundary**: the helper plays it directly.
- **mpv keeps its own frame pacing**: the render call blocks for mpv's
  target time (default `block_for_target_time`), so the helper's `render ms`
  figure includes that pacing wait — it is not GPU cost.
- **The addon must memcpy**: Electron's V8 memory cage forbids external
  ArrayBuffers over shm, so zero-copy into JS is impossible. The measured
  path is readback -> shm -> renderer ArrayBuffer -> GPU texture upload.

## First measurements (2026-07-10, MacBook Pro M1 Pro, 120 Hz display)

> Canonical measurement log (per machine, with repro commands): `RESULTS.md`.
> Append future runs there — especially the pending Intel Mac / Windows iGPU
> baselines.

| Scenario | Producer | Viewer new-frame fps | copy ms avg/p95 | upload ms avg/p95 | produce→uploaded age ms avg/p95 | torn |
| --- | --- | --- | --- | --- | --- | --- |
| 1080p60 testsrc2 (sw) | 60.0 fps | 59.8 | 0.28 / 0.35 | 0.29 / 0.40 | 4.2 / 6.8 | 0 |
| 4K60 testsrc2 (sw) | 60.0 fps | 60.0 | 1.17 / 1.35 | 3.8 / 4.5 | 11.0 / 12.7 | 0 |
| 4K60 HEVC 25 Mbit (hwdec=videotoolbox) | 60.0 fps | 59.9 | 1.2 / 1.6 | 3.3 / 4.1 | 9.8 / 11.7 | 0 |

Helper-side PBO map+copy at 4K: ~1.0–1.8 ms avg. CPU during 4K60 HEVC:
helper ~18 %, Electron renderer ~24 % of one core. The only fps dip observed
coincided with the `--loop` file restart (decoder reinit), not the copy path.

Takeaway so far: on Apple Silicon the copy tax is far below the analysis
doc's worst-case budget (33 MB memcpy ≈ 1.2 ms, not 6–8 ms; end-to-end added
latency ≈ 10 ms, not 40–60 ms). The remaining open gates are weaker hardware
and long-run pacing, not raw throughput on modern Macs.

## Still to measure (go/no-go gates from the analysis doc)

- Intel Mac and mid-range Windows laptop (iGPU) — the actual risk hardware.
- Long-run frame-time variance (judder), not average fps; 50 Hz content on a
  60 Hz display.
- 4K HDR (tonemapping to SDR before readback).
- End-to-end latency flash test (photodiode/screen-capture method) and
  audio/video sync offset to calibrate `--audio-delay`.
- Battery drain delta vs the native-surface approach.

## Known limitations of this spike

- macOS-only helper (CGL); Windows needs WGL/D3D, Linux EGL — same protocol.
- `latestSeq`/`copyLatest` poll in rAF; no wakeup channel (fine at 60 fps).
- Viewer canvas redraws every rAF tick even without a new frame.
- No reconnect handling if the helper restarts (viewer keeps last mapping).
