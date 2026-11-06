---
type: fix
area: playback
---

Switching away from a live MPEG-TS channel that had frozen now closes its
connection right away. Before, the frozen stream kept its connection open
until the app restarted, so a provider that allows one connection per
account could cut the next channel.
