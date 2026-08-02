---
type: fix
area: playback
issues: [849, 910, 732]
---

Stalker streams that require the portal session now play in the built-in
players (HTML5, Video.js, ArtPlayer), not only in VLC/MPV: the player's
requests carry the portal cookie and token, scoped to that stream and
dropped when the player closes or the channel changes. VOD, series and
radio get the same headers live TV had — also from Favorites and Recently
Viewed.
