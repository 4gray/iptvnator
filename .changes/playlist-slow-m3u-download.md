---
type: fix
area: playlist
---

M3U URL imports and manual refreshes give slow providers up to two minutes to start sending the playlist, including on standalone Android TV and Fire TV. Hosted imports through Docker or Cloudflare and TV clients allow extra time for downloading and parsing.
