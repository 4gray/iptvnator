---
type: internal
area: portals
---

Failed Stalker portal requests now log a compact, credential-free summary
(action, host, error code, HTTP status) in the desktop backend instead of
dumping the full multi-page network error object, matching the existing
Xtream request logging.
