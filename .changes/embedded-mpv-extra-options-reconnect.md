---
type: feature
area: embedded-mpv
highlight: Embedded MPV reconnects dropped streams
---

The embedded MPV player now reloads a live stream that drops mid-playback on
its own, with increasing delays and an "attempt N of 6" line instead of a
dead error screen; a new Settings > Playback toggle turns this off. The same
section gains an advanced field for extra libmpv options (one key=value per
line) that applies on every engine, with a short network timeout on by default.
