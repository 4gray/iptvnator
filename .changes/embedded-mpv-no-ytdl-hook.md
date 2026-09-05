---
type: fix
area: embedded-mpv
---

When a stream refuses the connection, the embedded MPV player (frame-copy
engine) no longer hands the URL to yt-dlp before giving up: the failure
shows up right away and its error no longer reads "youtube-dl failed:
unexpected error occurred", matching the native-view engines and the
external MPV player.
