---
type: fix
area: downloads
---

Downloads can finish on filesystems that report EISDIR or UNKNOWN when hard links are unavailable. Finalization keeps the existing no-overwrite protection and retains the partial file if the fallback copy fails.
