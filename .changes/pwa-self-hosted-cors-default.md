---
type: fix
area: pwa
---

Self-hosted web backends started without `CLIENT_URL` now allow the documented
`http://localhost:4333` origin instead of the retired public demo URL, so a
manual (non-Docker) deployment no longer fails every provider request with a
CORS error.
