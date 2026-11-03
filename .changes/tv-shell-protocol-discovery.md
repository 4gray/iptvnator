---
type: fix
area: tv-shell
---

Android TV connection testing recognizes an HTTP server entered as HTTPS. HTTP fallback stays limited to an initial refused connection or a confirmed protocol mismatch; redirects and certificate failures never authorize a downgrade.
