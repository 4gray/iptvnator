---
type: fix
area: web-backend
issues: [1436]
---

The self-hosted backend now checks every provider redirect and pins connections to validated addresses, preventing redirects or DNS changes from bypassing private-network restrictions. Trusted LAN access remains available through the existing opt-in.
