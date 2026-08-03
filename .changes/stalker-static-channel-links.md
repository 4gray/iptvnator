---
type: fix
area: stalker
---

Stalker channels that the portal serves directly now start without an extra
link request to the portal, so they open faster and no longer fail when that
request does. Channels the portal does proxy still get their temporary link,
and radio stations the portal proxies now get one too instead of playing a URL
the portal never meant to serve.
