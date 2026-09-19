---
type: fix
area: shell
---

Reloading the desktop app while on any page no longer breaks it: View › Reload
on macOS used to leave a blank, dead window until restart, and the reload
offered by the settings unsaved-changes dialog did nothing. Both now reload the
app back onto the page you were on.
