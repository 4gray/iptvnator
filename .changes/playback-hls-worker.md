---
type: perf
area: playback
---

In the browser and self-hosted versions and on Fire TV / Android TV, HLS
channels with MPEG-TS segments played with the HTML5 or ArtPlayer engine are
prepared off the interface thread, so the app keeps answering the remote or
the mouse while a channel starts.
