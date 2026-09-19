---
type: fix
area: tmdb
---

Russian titles containing "й" or "ё" ("Фейк", "Волшебный участок", "Молодой
Шерлок") and Arabic titles with hamza letters ("أطرق بابي") now match on TMDB.
The search used to send a folded spelling ("феик") that TMDB never recognised
and cached the miss for a week; those cached misses are cleared on the next
start.
