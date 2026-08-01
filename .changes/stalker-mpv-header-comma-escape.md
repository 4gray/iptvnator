---
type: fix
area: playback
---

Stalker live TV channels play again in the embedded MPV player. The MAG250
user agent sent to portals contains a comma (`... (KHTML, like Gecko) MAG250`),
and MPV splits its `--http-header-fields` list on commas, so the `X-User-Agent`
header was truncated and strict portals rejected the stream with HTTP 400.
Commas and backslashes in header values are now escaped before MPV parses them,
on the Windows/Linux and macOS embedded-MPV paths.
