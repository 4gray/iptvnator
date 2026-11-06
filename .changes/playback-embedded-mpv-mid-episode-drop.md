---
type: fix
area: playback
issues: [1902]
---

Embedded MPV no longer skips to the next episode when the provider drops the
connection in the middle of an episode. It now reconnects and continues the
episode where it stopped; a movie interrupted the same way resumes as well.
