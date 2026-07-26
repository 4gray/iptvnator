---
type: fix
area: playback
issues: [1155]
---

The "Show subtitles" setting now works in the built-in players: turning it off
hides subtitles a stream switched on by itself, and the preference finally
applies on Xtream and Stalker pages too. Previously it only reached the M3U
player, and even there Video.js and ArtPlayer ignored it. The player's own
subtitle menu still overrides the setting for the current stream.
