---
type: fix
area: playback
---

Embedded MPV's frame-copy engine keeps the previous video frame visible while preparing a resized frame, preventing black flashes when resizing the window or showing and hiding sidebars. Switching streams clears the previous image while waiting for the new stream.