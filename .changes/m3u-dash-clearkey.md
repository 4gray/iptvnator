---
type: feature
area: m3u
issues: [86, 614, 656, 733, 752]
---

MPEG-DASH channels play in the built-in player, ClearKey-encrypted ones
included — the keys are read from the playlist's #KODIPROP lines, whether they
sit above or below the channel entry. Streams locked with Widevine or PlayReady
still cannot be played, but they now say so instead of failing silently.
