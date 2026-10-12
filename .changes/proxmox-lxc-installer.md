---
type: feature
area: proxmox
---

The self-hosted browser app can now be installed in a Proxmox LXC container
with one command: `proxmox/create-lxc.sh` creates a small Debian container,
pulls the official Docker image's files without Docker and serves the app with
nginx and a systemd-managed backend. Running the installer again updates it.
