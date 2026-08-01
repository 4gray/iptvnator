---
type: fix
area: playback
---

Stalker live TV plays again in the embedded MPV player. The MAG250 user agent
contains a comma (`KHTML, like Gecko`), which MPV splits in its comma-separated
`--http-header-fields` list, truncating `X-User-Agent` so strict portals reject
the stream with HTTP 400. Commas and backslashes in header values are now
escaped on the Windows/Linux and macOS embedded-MPV paths.
