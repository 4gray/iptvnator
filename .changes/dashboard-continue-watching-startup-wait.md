---
type: perf
area: dashboard
---

Continue Watching and the hero banner no longer sit on a skeleton for many seconds after startup on large libraries: the dashboard reads every playlist's watch progress in one go, and the TMDB trending and recommendation rails wait for it before they search the catalog.
