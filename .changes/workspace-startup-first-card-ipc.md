---
type: perf
area: workspace
---

The workspace shows its first source card sooner after launch (journey J1, `renderer.ipcCallsToFirstCard`): it reads the source list once instead of twice, and loads downloads, update status, recent items and favorites right after the first screen. Set `IPTVNATOR_DISABLE_STARTUP_DEFERRAL=1` to turn this off.
