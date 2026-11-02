---
type: fix
area: self-hosted
---

Local-only progress stays tied to its source account when an endpoint or account changes. Failed local writes retain a recoverable position until the main store acknowledges it, and disabling waits for outstanding writes.
