---
type: perf
area: web
---

The app no longer ships its whole `package.json` inside the startup bundle,
only its version number, which trims about 11 KB from every launch.
