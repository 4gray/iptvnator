---
type: perf
area: web
---

The app now loads date and time formatting data only for the language you
use instead of shipping all 18 languages in the startup bundle, so it has
less to download and parse on every launch; English needs none at all.
