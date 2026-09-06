---
type: fix
area: xtream
issues: [1513]
---

Xtream Live TV in Auto can try advertised TS once when HLS initially fails with an HTTP error in a web player. The selected player and stream headers are kept. Settings explain the manual TS workaround for external players, Embedded MPV, and HLS retries that never report a terminal failure.
