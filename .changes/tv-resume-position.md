---
type: fix
area: tv
---

TV films and episodes retry resume when the native player is not ready to seek. Saved progress is protected until the seek succeeds; failed restoration preserves the old position and offers a retry. Resume also works when the saved duration is unknown, and timeline seeks receive the same protection.
