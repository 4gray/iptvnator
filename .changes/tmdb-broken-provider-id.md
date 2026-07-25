---
type: fix
area: tmdb
---

Movies whose provider ships a dead or wrong TMDB id are enriched again. The
id is weighed against the title and release year: a dead one falls back to
the title search, a stale one that clearly points at another film loses to
it, and a working id is no longer thrown away just because the provider
spells the title differently.
