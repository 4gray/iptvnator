---
type: fix
area: portals
---

Cancelling a portal request or hitting an expired login no longer floods the
desktop log with stack traces: a cancelled Stalker or Xtream request stays
silent, an HTTP 401/403 is a single warning, and the message shown for a
refused request now names the real status instead of a generic connection
failure.
