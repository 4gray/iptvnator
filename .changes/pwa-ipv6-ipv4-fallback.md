---
type: fix
area: pwa
issues: [1400]
---

The self-hosted web backend now gives each provider connection attempt enough
time to fall back from an unreachable IPv6 route to working IPv4 — common
behind VPN containers like Gluetun — instead of failing with a bare
"Bad Gateway". Provider errors now name the underlying network code (for
example ETIMEDOUT) in the app and in the container logs.
