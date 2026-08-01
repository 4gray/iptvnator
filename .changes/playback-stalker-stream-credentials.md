---
type: fix
area: playback
issues: [849, 910, 732]
---

Stalker portal streams that require the portal session now play in the
built-in players (HTML5, Video.js, ArtPlayer), not only in VLC/MPV: the
player's own requests carry the portal cookie and token, scoped to that
stream and cleared when playback ends. VOD, series and radio streams get the
same portal headers live TV already had, including on same-host streaming
ports.
