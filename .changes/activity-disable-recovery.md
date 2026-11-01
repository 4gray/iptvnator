---
type: fix
area: self-hosted
---

Keeping queued resets local no longer restores server progress. Disabling activity sync pauses uploads and finishes only after saving local activity; interrupted or failed saves retry without hiding shared progress.
