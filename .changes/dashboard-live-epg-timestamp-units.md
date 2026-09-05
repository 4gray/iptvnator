---
type: internal
area: dashboard
---

The dashboard's live "now playing" time range and progress bar now read
pre-computed EPG timestamps as unix seconds, matching the rest of the EPG
code. Today's dashboard lookups never carry those fields, so nothing changes
on screen; this closes the gap before a future data path supplies them.
