---
type: fix
area: stalker
issues: [1158]
---

Stalker portals whose server redirects to https or to another port no longer
lose their session mid-request. Since 0.22 such redirects silently dropped the
portal's MAC cookie and auth token, so categories failed to load and streams
never reached any player. Downgrade redirects from https to plain http still
strip credentials, so a secure session is never sent in cleartext.
