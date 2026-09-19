---
type: fix
area: updater
---

"What's new" no longer fails with a raw error for a build published after the app started: the release list is re-read from GitHub when the requested version is missing, so a freshly offered nightly shows its notes. When a version really has no release, the dialog now says so in plain words and links to the channel's releases page.
