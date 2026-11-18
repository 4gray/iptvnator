---
type: fix
area: playlist
issues: [1677]
---

Changing an M3U playlist's URL or file now waits for the new source to load
before saying it worked. If it cannot be loaded, the dialog stays open and says
the playlist still shows the channels from the previous source.
