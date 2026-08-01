---
type: fix
area: downloads
issues: [897, 1289]
---

Xtream movie downloads now use the same provider-compatible client identity as portal requests. If a connection drops after data has arrived, IPTVnator keeps the partial file, shows a credential-safe interruption code, and Retry resumes it with Range validation instead of starting over.
