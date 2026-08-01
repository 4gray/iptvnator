---
type: fix
area: playback
issues: [1159]
---

MPEG-TS playback errors now show exact engine evidence, including HTTP status,
without exposing provider response details. Format, codec, truncated-stream,
and MediaSource failures now produce more accurate fallback guidance.
