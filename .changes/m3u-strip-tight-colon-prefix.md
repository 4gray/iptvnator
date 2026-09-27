---
type: fix
area: m3u
---

"Strip country prefixes from channel names" now also handles playlists that write the tag without a space after the colon, like `TR:TRT 1 HD` or `DE:NAT GEO WILD`. Previously the setting quietly did nothing on those lists. Channel names that merely contain a colon, such as `NCIS:Los Angeles`, are left alone.
