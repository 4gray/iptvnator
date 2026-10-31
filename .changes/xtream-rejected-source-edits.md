---
type: fix
area: xtream
---

Re-enabling a catalog waits for the source edit to be accepted before replacing cached content. A rejected edit keeps the original catalog and viewing history intact.
Interrupted scans clear incomplete catalog writes before retrying and retain saved history until the full catalog returns.
