---
type: fix
area: playback
---

Video.js now shows its own control bar (play/pause, seek, volume, quality,
fullscreen) on Live TV channels. Previously live streams played with no visible
controls at all, because switching to a live source rebuilt the video element
and the controls never came back.
