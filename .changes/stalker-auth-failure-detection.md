---
type: fix
area: stalker
---

A Stalker portal is no longer re-probed and reclassified because something
in front of it — a proxy or firewall, not the portal — answered with a short
"Access denied" page. Only the portal's own authorization replies count now.
