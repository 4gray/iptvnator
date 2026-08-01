---
type: fix
area: downloads
issues: [897, 1289]
---

Xtream movie and episode downloads now keep their provider-compatible identity from the first request through legacy retries after source removal. Recoverable connection drops retain validated partials and show a credential-safe code; Retry resumes only with ETag or Last-Modified, otherwise it safely restarts.
