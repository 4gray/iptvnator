---
type: fix
area: playback
---

Arrow keys and the ±10 s buttons in the Embedded MPV player now move by their
full step every time. Pressing an arrow repeatedly, or holding it, used to
advance only about a second per press because each step was computed from a
stale position; steps are now relative seeks executed by mpv itself, so rapid
presses add up.
