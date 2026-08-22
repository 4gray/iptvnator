---
type: feature
area: playback
issues: [1408]
---

The shared player controls' subtitle menu now loads external subtitle files
(.srt/.vtt in the built-in web players, plus .ass in Embedded MPV), adjusts the
subtitle timing offset in ±0.5 s steps, and sets the subtitle text size and
color — size/color persist across sessions and are shared between engines.
