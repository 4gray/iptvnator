---
type: fix
area: stalker
issues: [850, 686, 755]
---

Stalker portals are no longer classified by their URL shape: importing probes
the real API endpoint (`portal.php` vs `server/load.php`) and checks whether
the portal actually requires authentication. Canonical Ministra URLs finally
load content, `…/c` addresses resolve correctly, and misclassified existing
portals repair themselves on first failure — keeping favorites and history.
