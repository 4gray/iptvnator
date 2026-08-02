---
type: fix
area: pwa
---

The self-hosted web app now talks to Stalker portals exactly like the desktop
app: MAG User-Agent, full STB cookie, serial-number header, and the
`JsHttpRequest` marker every real client sends — so portals that worked only in
the desktop app now work in the PWA too. Portal credentials (MAC and session
token) no longer travel in the portal request URL, keeping them out of server
logs.
