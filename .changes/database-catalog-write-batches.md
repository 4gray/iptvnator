---
type: perf
area: database
issues: [1292]
---

Refreshing or removing a large Xtream playlist is several times faster: the
"Removing cached content" stage and the re-import now commit around 5,000
rows at a time instead of 100, and progress updates arrive at most ten times a
second instead of once per batch.
