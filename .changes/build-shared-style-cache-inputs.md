---
type: internal
area: build
---

Shared UI stylesheets are now part of the build cache key. Edits to them
previously produced a cache hit, so a style fix could be silently missing from
a rebuilt app until the cache was bypassed. A CI check now fails any stylesheet
import that escapes its build's inputs.
