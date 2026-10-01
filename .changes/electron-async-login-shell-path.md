---
type: perf
area: electron
---

On macOS and Linux the app shows your sources sooner after launch: looking up
the PATH from your login shell (used to find MPV and VLC) no longer freezes the
app while the shell starts, which took one to two seconds with a typical zsh
setup.
