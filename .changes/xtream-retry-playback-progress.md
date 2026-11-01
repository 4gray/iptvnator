---
type: fix
area: xtream
---

Retrying a failed catalog scan keeps playback progress recorded after the failure, including positions from other catalogs and explicit removals. Backups exported while a scan awaits retry include the current progress.
