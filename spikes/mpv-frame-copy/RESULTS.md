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

Reference worst-case budget from the analysis doc, for orientation:
33 MB 4K memcpy est. 6–8 ms (measured ≈1.2 ms); end-to-end added latency
est. 40–60 ms (measured ≈10 ms produce→uploaded, before compositor).

## Intel Mac — PENDING (device to be sourced)

Target scenarios: same three rows as above (hwdec=videotoolbox on Intel
iGPU is the interesting case) + windowed vs fullscreen.

## Windows mid-range laptop (iGPU) — PENDING

Blocked on the Windows helper port (WGL or D3D11 readback path).
