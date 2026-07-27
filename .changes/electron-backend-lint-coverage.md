---
type: internal
area: electron-backend
---

Lint now covers the whole Electron backend instead of a single file, and two
teardown paths that silently discarded their failure reason — closing an
external player session and disposing an embedded mpv session — now report it.
Both still finish the teardown exactly as before.
