---
type: fix
area: xtream
issues: [1562]
---

Catch-up (timeshift) from the Favorites and Recent tabs now asks the panel for the programme you clicked: the start time is rendered in the panel's own timezone instead of your computer's. The panel's timezone is remembered per source, survives restarts, and panels that report an unusual timezone name are handled through their clock.
