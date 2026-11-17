---
type: fix
area: epg
---

Keep the live EPG timeline focused on the current calendar day when an on-air programme crosses midnight. The initial virtualized viewport and auto-focus now share the same rollover-safe target, with a regression test; ordinary same-day centring is unchanged.
