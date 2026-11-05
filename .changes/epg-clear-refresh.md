---
type: fix
area: epg
---

Clearing the programme guide now stops active and queued imports before deleting cached data, so old imports cannot refill it. Refresh now reloads a guide even when its cached data is less than 12 hours old. Refresh All processes sources one at a time instead of starting competing imports.
