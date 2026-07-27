---
type: fix
area: epg
---

A database error while looking up manual EPG channel mappings no longer breaks
the request that triggered it. Searching for a channel in the "Map EPG channel"
dialog, or saving and removing a mapping, now degrades gracefully instead of
failing outright.
