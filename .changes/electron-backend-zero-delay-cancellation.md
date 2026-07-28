---
type: fix
area: electron-backend
---

Cancelling a large Xtream import now stops database work even while it is
running at full speed, instead of letting the import finish before processing
the cancel request.
