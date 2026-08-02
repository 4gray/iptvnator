---
type: fix
area: stalker
---

Stalker portals now receive channel commands exactly as a real set-top box
sends them: already-encoded parts of a channel's `cmd` are no longer
double-encoded, so strict portals and reseller panels that compare the command
literally work again. Playing Stalker channels from Favorites or global
collections now also handles portals that answer with relative stream paths.
