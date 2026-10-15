---
type: perf
area: database
---

The second launch after setting up a new library no longer rebuilds the whole title search index before the app opens, which took several seconds on large catalogs (about 4.5 s per million titles).
