---
type: fix
area: database
---

If the library database cannot be opened at startup, for example while an older IPTVnator is still closing, IPTVnator now retries, shows an error instead of failing silently, and opens the library again on the next action once the file is available, without a restart.
