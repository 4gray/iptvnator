---
type: fix
area: backup
issues: [1017]
---

Backups carry hidden Xtream categories correctly. An export used to lose which
categories you had hidden, and restoring such a backup then hid every category
of that kind.
