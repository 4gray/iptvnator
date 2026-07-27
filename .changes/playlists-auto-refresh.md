---
type: fix
area: playlists
issues: [931]
---

One unreachable playlist no longer holds up the rest. Refreshes give up after 30
seconds and run a few at a time, so your other playlists still update, and the
message on startup names how many actually failed instead of always claiming
success.
