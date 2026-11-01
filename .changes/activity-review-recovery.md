---
type: fix
area: activity
---

Progress and resets preserve the latest action through offline failures, opt-out, delayed writes and stale source responses. Retired queues no longer keep a recovered connection offline. Stalker backups include progress, watched marks and episode resets, and restore locally without uploading activity. Choosing local playback after an offline conflict preserves its watched state.
