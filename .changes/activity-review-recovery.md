---
type: fix
area: activity
---

Progress and resets preserve the latest action through offline failures, opt-out, delayed writes and concurrent checkpoints. Account changes retire old queues; recovered connections no longer stay offline. Native SQLite progress imports and Stalker backups handle unknown durations and empty episode fields. Reset imports stay cleared, and local conflict choices preserve watched state.
