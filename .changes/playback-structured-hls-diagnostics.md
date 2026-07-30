---
type: fix
area: playback
---

HLS failures now use confirmed player evidence such as the failed stage, timeout, and HTTP status. Recoverable retries stay silent, and technical details no longer include raw provider error payloads.
