---
type: feature
area: stalker
---

Stalker setup now accepts hosts or `/c`, discovers the working API endpoint and
authentication mode, and rechecks edited connection details. Canceled or failed
edits leave saved and active sessions unchanged. Completed edits reject old
configuration requests and late responses. Timed-out authentication stays
fenced until its transport settles.
