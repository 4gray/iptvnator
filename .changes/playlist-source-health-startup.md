---
type: fix
area: playlist
---

Sources no longer show as "Not responding" right after startup when they are only slow to answer: a check that runs out of its quick budget is retried with the longer one, as Retry does, before the source is flagged.
