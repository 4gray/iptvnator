---
type: fix
area: tmdb
---

Russian titles containing "й" or "ё" and Arabic titles with hamza letters now
match on TMDB. The search used to send a folded spelling — dropping the breve
from "й", for instance — that TMDB never recognised, and cached the miss for a
week; those cached misses are cleared on the next start.
