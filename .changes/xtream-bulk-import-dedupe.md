---
type: fix
area: xtream
---

Bulk import of a portal list no longer imports each Xtream link twice: the
detected portal row replaces the duplicate plain-playlist row, so large lists
import once and the app stays responsive instead of freezing mid-import. Long
portal lists are no longer truncated at 16 links — real bulk files now detect
every source.
