---
type: perf
area: portals
---

Unreachable Xtream and Stalker portals no longer cost a 30-second wait per
request. After a host fails to answer twice, further requests to it fail
immediately for 30 seconds, so browsing a dead portal stops filling the screen
with long spinners. Retrying, testing the connection, or editing the portal
address contacts it again right away.
