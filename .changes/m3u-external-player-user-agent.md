---
type: fix
area: m3u
issues: [1221]
---

When a channel plays in MPV, VLC or the embedded MPV player, the custom
User-Agent, Referer and Origin saved on the M3U playlist now reach the player.
Per-channel `#EXTVLCOPT` headers still win; the playlist values only fill the
gaps. VLC now also sends the Origin value as a real HTTP header, as MPV
already did.
