---
type: perf
area: m3u
---

Cancelling a large M3U refresh now stops its background worker before parsed
channels can be copied or saved, keeping the interface responsive and leaving
the existing playlist unchanged.
