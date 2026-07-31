---
type: fix
area: playback
---

The default web player now reports safer, more accurate streaming errors:
confirmed network and encrypted-segment failures keep structured details,
while ambiguous Video.js errors remain unknown instead of suggesting the
wrong cause.
