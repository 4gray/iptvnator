---
type: perf
area: web
---

The app loads about 15% less code before it shows its first screen: form
field, dialog, tooltip and progress-bar code, the animation engine and the
theme colours of unused components now load only when something needs them,
so every launch has less to download and parse.
