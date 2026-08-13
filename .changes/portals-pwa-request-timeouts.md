---
type: fix
area: portals
---

In the self-hosted web version, a provider that accepted a connection and then
went silent could hang a request until the operating system gave up, with no
way to cancel it. Requests now time out on the same schedule as the desktop app,
and a host that fails to answer twice is skipped for a short while instead of
stalling every following request.
