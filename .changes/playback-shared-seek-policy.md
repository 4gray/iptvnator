---
type: fix
area: playback
---

Player controls share live/VOD seek rules across browser video, embedded MPV and the floating player. Buffered live seeking stays within the current contiguous range, unavailable seeks are rejected, and floating VOD skip controls preserve repeated relative seeks.
