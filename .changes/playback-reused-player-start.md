---
type: fix
area: playback
---

With "Reuse player instance" on, the next episode, "Play from beginning" and
a resumed episode sent to MPV or VLC now start where they should. The reused
player kept the first launch's resume offset for every later title.
