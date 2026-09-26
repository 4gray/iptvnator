---
type: perf
area: electron
---

The desktop app now opens its window before it prepares the portal, program
guide, download, player and update machinery, and does that preparation while
the window is already loading, so the first screen appears sooner.
