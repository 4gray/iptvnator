---
type: fix
area: portals
---

A slow Xtream or Stalker panel is no longer mistaken for a dead one: a request
that reached the panel and then timed out no longer trips the 30-second
"portal is not responding" pause, which only fires when the panel never
accepts the connection. The desktop app also gives IPv4 fallback the same
2.5-second budget as the self-hosted backend, so dual-stack panels behind
VPNs stop failing in bursts.
