---
type: internal
area: build
---

Electron development serve no longer crashes while Vite transforms a large
lazy chunk. The pinned Vite release now carries a backtracking-safe transform
filter fix, with a regression check guarding dependency updates.
