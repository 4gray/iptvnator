---
type: fix
area: stalker
issues: [1158]
---

Stalker portals whose server redirects between http/https or between ports no
longer lose their session mid-request. Since 0.22 such redirects silently
dropped the portal's MAC cookie and auth token, so categories failed to load
and streams never reached any player; the session now survives every redirect
that stays on the portal's own host.
