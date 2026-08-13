---
type: fix
area: playback
issues: [1095]
---

The screen no longer dims or goes to sleep while a built-in player is playing
video — including on Linux desktops, where the system idle timer used to
ignore the app. Pausing or stopping hands control back to the system
immediately, and radio playback deliberately leaves the display free to
sleep. Works in both the desktop app and the PWA.
