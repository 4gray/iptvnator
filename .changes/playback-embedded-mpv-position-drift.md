---
type: fix
area: playback
issues: [1428]
---

The embedded MPV video no longer drifts out of its frame when the layout
shifts around it — for example when the channel sidebar or the EPG panel
finishes loading after playback has started. The player now notices such
moves and snaps the video back into place within half a second.
