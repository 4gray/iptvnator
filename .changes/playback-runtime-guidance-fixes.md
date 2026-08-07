---
type: fix
area: playback
---

Playback recovery now removes old error actions as soon as a new source or player starts, even while Electron prepares stream headers. Stalker series playing inline now picks up refreshed episode names and navigation, and safely disables episode commands if the playing episode disappears.
