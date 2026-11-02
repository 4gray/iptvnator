---
type: fix
area: tv-shell
---

Android TV accepts provider JSON with a UTF-8 BOM. Interrupted or corrupted provider responses report an error instead of being treated as a successful playlist import or refresh.
