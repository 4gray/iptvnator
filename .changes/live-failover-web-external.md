---
type: feature
area: playback
---

Live channel failover now also covers the built-in web players and external
MPV/VLC, not only the embedded player: a live channel that fails is retried
three times and then switched to the same channel in another source. External
players are covered for launch failures, stream-open errors and unexpected
exits — a stream that opens and then silently stalls is not detected there.
