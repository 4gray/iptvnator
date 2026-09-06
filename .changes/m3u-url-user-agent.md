---
type: fix
area: m3u
issues: [465, 1120]
---

M3U URL imports now accept a custom User-Agent for providers that require it before downloading the playlist. The value is saved and reused for playlist refreshes in the desktop app and self-hosted web app.
