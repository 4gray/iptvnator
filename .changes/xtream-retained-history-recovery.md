---
type: fix
area: xtream
---

After a partially cancelled refresh, removing history from a disabled catalog keeps it removed from backups and later scans. Recovery retains history for missing content and hidden-category choices until their catalogs return. Watches made after clearing history also survive a later interrupted scan. Clearing a large source history avoids SQLite parameter limits.
