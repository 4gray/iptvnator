---
type: fix
area: playback
issues: [1159]
---

Unavailable streams no longer appear as unsupported codecs. When Video.js exposes a server error such as HTTP 404, the player shows that status; otherwise ambiguous source errors remain unidentified instead of guessing.
