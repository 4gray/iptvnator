---
type: fix
area: activity
---

Progress and resets preserve the latest action through offline failures, opt-out and delayed writes. Account changes retire old activity queues, and retired queues no longer keep recovered connections offline. Stalker reset imports stay cleared; backups preserve progress, watched marks and resets without uploading restored activity. Local conflict choices preserve watched state.
