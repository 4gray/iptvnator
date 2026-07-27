---
type: fix
area: playlist
---

Opening an .m3u/.m3u8 file from the command line or by double-clicking it now
actually imports the playlist — previously nothing happened at all. Opening a
playlist while IPTVnator is already running works too, and on macOS the file
arrives through the system "open with" event.
