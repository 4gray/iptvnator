---
type: fix
area: xtream
---

Failed catalog scan retries preserve later history edits, playback progress and category visibility, including history clears. Older pending scans migrate before retry or export. Ordinary Refresh uses the same protection, and explicit backup retries reset stale recovery state before applying the archive. Exports use current state.
