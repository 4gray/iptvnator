---
type: fix
area: self-hosted
---

Local resets remain retryable if storage fails while synchronization is being disabled. Earlier pending saves finish before a reset, so they cannot restore progress that was just cleared.
