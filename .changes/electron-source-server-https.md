---
type: fix
area: electron
---

Desktop connections to an IPTVnator server now trust certificate authorities from the operating system, including the macOS Keychain. An unreachable server shows a connection error without an Electron crash dialog.
