---
type: fix
area: playback
---

With "Reuse player instance" on, IPTVnator now waits for MPV to confirm each
command sent to the running player. A command MPV rejects or never answers
falls back to a fresh MPV launch instead of reporting the stream as opened
while nothing changed.
