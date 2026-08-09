---
type: feature
area: stalker
---

Stalker portals that ask for a login and password now work: the import dialog
gained username/password fields and the app completes the portal's do_auth
step. When a portal refuses access, its own explanation is shown instead of a
generic error, saved sessions resume without re-authenticating, and the
keep-alive ping follows the portal's cadence.
