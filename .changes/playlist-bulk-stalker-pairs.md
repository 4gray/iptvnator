---
type: fix
area: playlist
---

Bulk import now reads provider list files whose rows look like
`http://panel/c | 00:1A:79:…`. Each row keeps the portal printed on its own
line, so a Stalker file covering several panels no longer previews as rows
without a portal that cannot be imported.
