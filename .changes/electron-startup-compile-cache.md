---
type: perf
area: electron
---

The desktop app now keeps a compiled copy of its startup code next to its
user data, so every launch after the first skips part of the JavaScript
compilation and reaches the window a little sooner. Set
`IPTVNATOR_DISABLE_COMPILE_CACHE=1` to turn this off.
