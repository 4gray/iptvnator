---
type: fix
area: host-health
issues: [1439]
---

Portal recovery now waits for an active probe to finish before sending another request, even when redirects or a slow response take longer than 45 seconds. Completed and cancelled requests release the probe slot reliably.
