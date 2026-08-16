---
type: fix
area: downloads
---

Downloads from portals that cut long connections no longer die with "aborted": the app now reconnects automatically and continues from where the transfer stopped. Resume also works on servers that send no ETag/Last-Modified — the app re-checks a 256 KiB overlap against the saved partial before appending, and only gives up after repeated reconnects make no progress.
