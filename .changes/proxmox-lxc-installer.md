---
type: feature
area: proxmox
---

The self-hosted browser app can now be installed in a Proxmox LXC container
with one command: `proxmox/create-lxc.sh` creates a small Debian container and
runs the official image's app and backend without Docker, with the same
shared server library and optional access token. Running it again updates it
and keeps the settings and the data.
