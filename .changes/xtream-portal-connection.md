---
type: fix
area: xtream
---

Portals sitting behind Cloudflare or a similar firewall connect again. Those
setups answered the app with a challenge page instead of data, so "Test
connection" failed on portals that worked fine in every other player; requests
now identify themselves the way an ordinary IPTV player does.
