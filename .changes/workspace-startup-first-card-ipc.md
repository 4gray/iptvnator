---
type: perf
area: workspace
---

On launch the workspace reads the source list once instead of twice before its first source card (journey J1, `renderer.ipcCallsToFirstCard`), and M3U favorites stop re-checking the finished playlist migration for every playlist.
