---
type: fix
area: playback
---

On Linux, the app no longer switches a saved Embedded MPV player back to the
default player when your login shell is slow to start. It now keeps your
choice until it knows for certain whether mpv is installed.
