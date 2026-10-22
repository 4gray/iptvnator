---
type: perf
area: tmdb
---

On large libraries the TMDB trending and recommendation rails, and the "In your library" lookups on Discover, actor and Similar views, no longer hold up the rest of the app while they search your playlists: the search now runs in small steps that let other work in between.
