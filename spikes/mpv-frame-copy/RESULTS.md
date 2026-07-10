# Frame-copy spike — measurement log

One section per machine. Append new runs here; do not overwrite old ones —
this file is the cross-hardware comparison baseline for the go/no-go
decision (gates in README.md and
`.plans/2026-07-10-embedded-mpv-frame-copy-unification.md`).

How to reproduce a row:

```bash
# synthetic (no decode load):
./run.sh 'av://lavfi:testsrc2=size=3840x2160:rate=60' 3840x2160
# real 4K60 HEVC with hw decode (generate once):
ffmpeg -y -f lavfi -i "testsrc2=size=3840x2160:rate=60" -t 12 \
  -c:v hevc_videotoolbox -b:v 25M -tag:v hvc1 -pix_fmt yuv420p /tmp/spike-4k-hevc.mp4
HELPER_ARGS='--hwdec videotoolbox --no-audio --loop' ./run.sh /tmp/spike-4k-hevc.mp4 3840x2160
```

Read `STATS` lines from viewer stdout after they stabilize (skip the first
window); helper stats are on its stderr. CPU: `ps -o %cpu -p <pid>` for the
helper and the `Electron Helper (Renderer)` process during playback.

Column meanings: *new fps* — frames actually reaching the canvas; *copy* —
shm→ArrayBuffer memcpy in the addon; *upload* — `texSubImage2D` wall time;
*age* — produce→uploaded latency (helper memcpy done → texture updated,
same CLOCK_MONOTONIC_RAW clock).

## MacBook Pro M1 Pro (arm64), macOS, 120 Hz internal display — 2026-07-10

Source: commit `7e39d2e5`, libmpv 2.3.0 (Homebrew mpv 0.39.0), Electron 41.7.2.

| Scenario | Producer fps | New fps | copy ms avg/p95 | upload ms avg/p95 | age ms avg/p95 | torn | CPU helper / renderer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1080p60 testsrc2, sw decode | 60.0 | 59.8 | 0.28 / 0.35 | 0.29 / 0.40 | 4.2 / 6.8 | 0 | — |
| 4K60 testsrc2, sw decode | 60.0 | 60.0 | 1.17 / 1.35 | 3.8 / 4.5 | 11.0 / 12.7 | 0 | — |
| 4K60 HEVC 25 Mbit, hwdec=videotoolbox | 60.0 | 59.9 | 1.2 / 1.6 | 3.3 / 4.1 | 9.8 / 11.7 | 0 | ~18 % / ~24 % |

Helper-side PBO map+copy at 4K: 1.0–1.8 ms avg. Only fps dip observed was at
the `--loop` file restart (decoder reinit), not in the copy path.

### Pacing / judder and HDR (2026-07-10, same machine, viewer with interval instrumentation)

Metrics: *present iv sd* — stddev of intervals between texture uploads
(viewer clock, rAF-quantized); *src iv sd* — stddev of intervals between
produced frames (helper clock); *late1.5x* — present intervals > 1.5× the
producer's median interval (a missed beat).

| Scenario | New fps | present iv sd | src iv sd | late (steady state) | Notes |
| --- | --- | --- | --- | --- | --- |
| 4K60 HEVC hwdec (steady state) | 60.0 | 0.5–1.4 ms | 0.7–1.2 ms | 0–1 per 2 s | worst intervals only at `--loop` restart |
| 1080p50 testsrc2 (50→120 Hz cadence) | 50.0 | ~4.1 ms | ~1.9 ms | 0; LONGRUN 30 s: 0.13 % (startup only) | sd is 120 Hz rAF grid quantization (16.7/25 ms alternation around 20 ms), not lost frames |
| 1080p25 testsrc2 | 25.0 | ~4.1 ms | ~2.7 ms | 0 | same grid effect |
| 4K25 HDR10 PQ/BT.2020 HEVC hwdec | 25.0 | ~5.5 ms | ~4.3 ms | 0 | mpv tonemaps to SDR before readback (PIXELPROBE spread 255); copy/upload costs unchanged |

### Viewport-size scaling check (2026-07-10)

Design claim "render at viewport size, pay viewport price" confirmed:
the same 4K60 HEVC clip rendered into a 1280×720 FBO costs helper
map+copy 0.17 ms (vs 1.5 ms at 4K), viewer copy 0.16 ms (vs 1.2),
upload 0.17 ms (vs 3.5), steady 60 fps. Full 4K price is only paid in
4K-sized viewports (i.e. fullscreen on a 4K display).

### 10-minute long run — 4K60 HEVC hwdec, `--loop` (2026-07-10)

Final cumulative line at t=574 s: 33 501 frames, avg 58.32 fps,
late1.5x 0.475 %, late2.5x 0.20 %, worst interval 2306 ms, dropped 261,
torn 0.

Reading the anomalies before quoting the headline numbers:

- All 261 dropped frames and the single 2.3 s worst-interval stall happened
  in the **first ~60 s** (startup/warmup); from t=93 s to the end — zero
  drops over ~8.5 minutes.
- The steady-state late frames (~102 × late1.5x, ~43 × late2.5x after
  warmup ≈ 0.36 % / 0.15 %) track the `--loop` restarts of the 12 s test
  clip (~48 restarts, each a decoder reinit hiccup) — a test-clip artifact,
  not a pipeline property. A real long-form stream should be cleaner.
- torn=0 across the whole run: the seqlock ring never produced a torn read.

Cadence verdict on this hardware: the producer keeps a clean source cadence
(mpv's own pacing survives); the only jitter is display-grid quantization in
the rAF presenter, bounded by one 120 Hz tick (~8.3 ms). A future refinement
could reduce it with display-rate matching, but nothing here blocks the gate.

HDR clip generation for repro:

```bash
ffmpeg -y -f lavfi -i "testsrc2=size=3840x2160:rate=25" -t 10 \
  -c:v hevc_videotoolbox -profile:v main10 -pix_fmt p010le -b:v 30M -tag:v hvc1 /tmp/spike-4k-hdr.mp4
ffmpeg -y -i /tmp/spike-4k-hdr.mp4 -c:v copy \
  -bsf:v "hevc_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9" \
  /tmp/spike-4k-hdr10.mp4   # videotoolbox omits VUI color tags; inject HDR10 ones
```

Reference worst-case budget from the analysis doc, for orientation:
33 MB 4K memcpy est. 6–8 ms (measured ≈1.2 ms); end-to-end added latency
est. 40–60 ms (measured ≈10 ms produce→uploaded, before compositor).

## Intel Mac — PENDING (device to be sourced)

Target scenarios: same three rows as above (hwdec=videotoolbox on Intel
iGPU is the interesting case) + windowed vs fullscreen.

## Windows mid-range laptop (iGPU) — PENDING

Blocked on the Windows helper port (WGL or D3D11 readback path).
