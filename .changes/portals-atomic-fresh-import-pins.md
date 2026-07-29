---
type: fix
area: portals
---

Importing an Xtream backup now restores all preferred VOD sources together. If
restoration or cleanup fails, the catalog stays retryable and remains blocked
until the parked state is safely consumed, preventing stale replay from
overwriting newer choices.
