---
type: fix
area: portals
issues: [1438]
---

Xtream and Stalker portals no longer enter a connection cooldown merely because several parallel requests fail in the same millisecond. This fixes false unavailability in both the desktop app and the self-hosted web version.
