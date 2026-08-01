---
type: fix
area: playback
issues: [910]
---

External MPV and the embedded MPV frame-copy engine no longer truncate HTTP
headers that contain commas — most notably the Stalker MAG user agent. Strict
portals validated that header and rejected live streams with HTTP 400, so
channels that only worked in VLC now also play through MPV. Completes the same
fix that landed for the native embedded MPV view.
