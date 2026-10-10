---
type: perf
area: database
---

The app starts faster on large libraries: the catalog is no longer scanned for duplicates on every launch, and reading the playlist list no longer walks every M3U playlist's channel data (a one-time rebuild of the playlists table on the first start after the update).
