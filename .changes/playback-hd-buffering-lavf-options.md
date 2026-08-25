---
type: perf
area: playback
---

HD channels now keep playing through brief network drops instead of failing
the playback session. The embedded MPV cache buffers 30 seconds of stream
ahead of the playhead, which smooths out jittery connections without
introducing noticeable startup delay.
