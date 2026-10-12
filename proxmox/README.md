# IPTVnator in a Proxmox LXC

Two scripts that run the **self-hosted IPTVnator** (the browser PWA plus its
web backend, the same pieces as the [Docker image](../docker/README.md)) in a
small Debian container on Proxmox VE, without Docker:

- `create-lxc.sh` runs on the **Proxmox host**: it creates an unprivileged
  Debian 12 container (512 MB RAM, 4 GB disk, DHCP) and runs the installer in it.
- `install.sh` runs **inside the container** (or on any Debian 12/13 or Ubuntu
  22.04+ machine). It pulls the official `4gray/iptvnator` image from Docker Hub
  with the registry API (curl and jq, no Docker), extracts the built PWA and the
  web backend from it, serves the PWA with nginx on port 80, proxies `/api` to
  the backend and runs the backend as a systemd service bound to `127.0.0.1`.
  Running it again updates to the current image.

## Install

On the Proxmox host (shell of the node, as root):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/ange-primiterra/iptvnator/proxmox-lxc/proxmox/create-lxc.sh)"
```

The script prints the container's URL (`http://<ip>/`), its root password and
the update command. Settings are environment variables, for example a fixed IP,
more memory and a different id:

```bash
CTID=120 NET="ip=192.168.1.50/24,gw=192.168.1.1" MEMORY_MB=1024 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/ange-primiterra/iptvnator/proxmox-lxc/proxmox/create-lxc.sh)"
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `CTID` | next free id | Container id |
| `CT_HOSTNAME` | `iptvnator` | Hostname |
| `STORAGE` / `TEMPLATE_STORAGE` | `local-lvm` / `local` | Where the rootfs and the template go |
| `BRIDGE` / `NET` | `vmbr0` / `ip=dhcp` | Network; `NET="ip=10.0.0.5/24,gw=10.0.0.1"` for a static address |
| `DISK_GB` / `MEMORY_MB` / `SWAP_MB` / `CORES` | `4` / `512` / `512` / `2` | Resources |
| `CT_PASSWORD` | generated | Root password of the container |
| `CLIENT_URL` | `http://<container ip>` | Browser origins the backend accepts (comma-separated); set the public URL behind a reverse proxy |
| `PORT` | `3000` | Backend port (loopback only) |
| `IPTVNATOR_IMAGE_TAG` | `latest` | Image tag: `latest` (every merge on master), `stable`, or a version such as `0.25.0` |
| `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS` | `0` | `1` when your IPTV provider is on your LAN (the backend refuses private addresses otherwise) |

## Update

```bash
pct exec <CTID> -- bash /root/iptvnator-install.sh
```

Playlists, favourites and settings live in each browser (IndexedDB /
localStorage), so an update never touches them.

## Notes

- Port 80 is the only thing exposed; the backend listens on `127.0.0.1:<PORT>`
  only (a Node preload shim pins the Express `listen()` to loopback).
- Several people can use the same instance: the backend is stateless, each
  browser keeps its own data. There are no accounts; put a reverse proxy with
  authentication in front if the instance is reachable from outside the LAN.
- Video does not go through the container: each browser plays streams straight
  from the provider, so every viewer counts as one connection on the
  subscription. Behind an HTTPS reverse proxy, plain `http://` streams become
  mixed content and Chrome blocks them unless the provider also serves HTTPS.
- Limits of the PWA apply: no XMLTV EPG, no downloads, no embedded MPV; streams the
  browser cannot play (raw `.ts`) are opened in an external player.
- Files: `/var/www/iptvnator` (PWA), `/opt/iptvnator/web-backend` (backend),
  `/etc/iptvnator/backend.env` (settings, then `systemctl restart
  iptvnator-backend`), `/etc/nginx/sites-available/iptvnator`.
