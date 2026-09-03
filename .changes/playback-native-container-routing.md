---
type: fix
area: playback
---

The built-in HTML5 player now plays `.mkv`, `.webm`, `.avi`, `.mov` and other
non-HLS video files directly instead of handing them to the HLS engine, which
failed with a "network or provider loading error" on many Xtream episodes and
movies. ArtPlayer and the HTML5 player now choose their engine by the same rule.
