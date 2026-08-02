---
type: fix
area: embedded-mpv
issues: [1139, 1145]
---

On Windows and Linux displays scaled above 100%, the Embedded MPV video was
drawn toward the top-left corner at a fraction of its size, in windowed and
fullscreen mode alike. The video now fills the player area correctly at any
display scale and page zoom, with no need for a high-DPI compatibility
workaround.
