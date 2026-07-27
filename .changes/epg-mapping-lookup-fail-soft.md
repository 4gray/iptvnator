---
type: fix
area: epg
---

A database error while reading or saving a manual EPG channel mapping no longer
surfaces as a failed request. Looking up, saving, deleting, and searching
mappings now fall back quietly, so a transient storage hiccup can no longer take
down the EPG panel or the "Map EPG channel" dialog.
