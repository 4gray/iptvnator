# IPTVnator in a Proxmox LXC

Two scripts that run the **self-hosted IPTVnator** (the browser PWA plus its
web backend, the same pieces as the [Docker image](../docker/README.md)) in a
small Debian container on Proxmox VE, without Docker:

- `create-lxc.sh` runs on the **Proxmox host**: it creates an unprivileged
  Debian 12 container (1 GB RAM, 4 GB disk, DHCP) and runs the installer in it.
- `install.sh` runs **inside the container**. It pulls the official
  `4gray/iptvnator` image from Docker Hub with the registry API (curl and jq,
  no Docker), extracts the built PWA and the web backend from it, serves the
  PWA with nginx on port 80, proxies `/api` to the backend and runs the backend
  as a systemd service bound to `127.0.0.1`, with the same settings as the
  image. Running it again updates to the current image and keeps the settings
  and the data. It also works on another dedicated Debian 12/13 or Ubuntu
  22.04+ container or VM: IPTVnator becomes nginx's default site on port 80.
  It replaces Debian's default site only when that file is untouched, and stops
  (leaving nginx as it was) when the default site was edited or nginx rejects
  the new site, e.g. because another site is already `default_server`.

## Install

On the Proxmox host (shell of the node, as root):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/4gray/iptvnator/master/proxmox/create-lxc.sh)"
```

The script prints the container's URL (`http://<ip>/`), its root password and
the update command. Settings are environment variables, for example a fixed IP,
a different id and an access token:

```bash
CTID=120 NET="ip=192.168.1.50/24,gw=192.168.1.1" IPTVNATOR_ACCESS_TOKEN=choose-a-long-token \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/4gray/iptvnator/master/proxmox/create-lxc.sh)"
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `CTID` | next free id | Container id |
| `CT_HOSTNAME` | `iptvnator` | Hostname |
| `STORAGE` / `TEMPLATE_STORAGE` | first active container storage (`local-lvm`, `local-zfs`...) / `local`, else the first active template storage (`local-btrfs`...) | Where the rootfs and the template go |
| `BRIDGE` / `NET` | `vmbr0` / `ip=dhcp` | Network; `NET="ip=10.0.0.5/24,gw=10.0.0.1"` for a static address |
| `DISK_GB` / `MEMORY_MB` / `SWAP_MB` / `CORES` | `4` / `1024` / `512` / `2` | Resources |
| `CT_PASSWORD` | generated | Root password of the container (printed as soon as the container exists) |
| `CLIENT_URL` | `http://<container ip>` | Browser origins the backend accepts (comma-separated); set the public URL behind a reverse proxy |
| `PORT` | `3000` | Backend port (loopback only) |
| `IPTVNATOR_IMAGE_TAG` | `latest` | Image tag: `latest` (every merge on master), `stable`, or a version such as `0.25.0` |
| `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS` | `0` | `1` when your IPTV provider is on your LAN (the backend refuses private addresses otherwise); its streams then play only when the app is opened on a LAN address, because Chrome blocks a page on a public address from loading from private ones |
| `IPTVNATOR_STORAGE` | `server` | `server`: one library on the container, shared by every browser (see below); `none`: each browser keeps its own |
| `IPTVNATOR_ACCESS_TOKEN` | unset | Each browser asks for this token once before it shows anything; every backend route then requires it. Needs `IPTVNATOR_STORAGE=server`; at least 8 characters among letters, digits and `. _ ~ + / = -` (e.g. `openssl rand -base64 32`) |
| `IPTVNATOR_MAX_DOCUMENT_MB` | `64` | Largest stored playlist; nginx's `client_max_body_size` follows it |
| `IPTVNATOR_BACKEND_START_TIMEOUT` | `300` | Seconds the installer waits for the backend (database migrations run first) |

## Update and settings

The update downloads the current installer, then runs it; it pulls the current
image:

```bash
pct exec <CTID> -- bash -c 'curl -fsSL https://raw.githubusercontent.com/4gray/iptvnator/master/proxmox/install.sh -o /root/iptvnator-install.sh && bash /root/iptvnator-install.sh'
```

The settings are checked before the container is created and saved in it before
anything is downloaded, so if an installation stops half-way,
`pct exec <CTID> -- bash /root/iptvnator-install.sh` resumes it. Each installer
run keeps the settings of the previous one, and the database in
`/var/lib/iptvnator` is never touched. To change a setting, run the installer with it; set it empty
to go back to the default:

```bash
pct exec <CTID> -- env IPTVNATOR_ACCESS_TOKEN=choose-a-long-token bash /root/iptvnator-install.sh
pct exec <CTID> -- env IPTVNATOR_ACCESS_TOKEN= bash /root/iptvnator-install.sh
```

## Server storage

With `IPTVNATOR_STORAGE=server` (the default, as in the Docker image) the
playlists, M3U favourites and history, and Xtream favourites, recently viewed
items and playback positions live in `/var/lib/iptvnator/databases/iptvnator.db`,
and every phone, TV browser and computer that opens the instance sees the same
library. Settings, parental locks and UI preferences stay per browser. The first
browser that opens an empty instance offers to move the playlists it already
has; Settings → Server merges the others and exports a backup.

Provider credentials are stored unencrypted in that database. Set
`IPTVNATOR_ACCESS_TOKEN` before the instance is reachable from outside your LAN,
and use a reverse proxy with HTTPS for that. Back the database up with Settings → Server → Export backup (no need to stop
anything), with a Proxmox backup of the container, or by copying the
`/var/lib/iptvnator/databases` folder while the backend is stopped
(`systemctl stop iptvnator-backend`): files copied while it runs can be out of
step with the `-wal` journal.

Server storage needs an image that has it (`latest` does); with an older tag the
installer warns and each browser keeps its own data.

## Notes

- Port 80 is the only thing exposed; the backend listens on `127.0.0.1:<PORT>`
  only (a Node preload shim pins the Express `listen()` to loopback).
- Several people can use the same instance. There are no user accounts: with
  server storage everyone shares one library, and the access token protects the
  whole instance, not one person's data.
- Video does not go through the container: each browser plays streams straight
  from the provider, so every viewer counts as one connection on the
  subscription. Behind an HTTPS reverse proxy, plain `http://` streams become
  mixed content and Chrome blocks them unless the provider also serves HTTPS.
- Limits of the PWA apply: no XMLTV EPG, no downloads, no Embedded MPV and no
  managed MPV/VLC launching. If a stream does not play in the browser, copy its
  URL and open it in an external player such as MPV, VLC or IINA.
- Files: `/var/www/iptvnator` (PWA), `/opt/iptvnator/web-backend` (backend),
  `/var/lib/iptvnator` (database), `/etc/iptvnator/backend.env` and
  `install.env` (settings, rewritten by each installer run),
  `/etc/nginx/sites-available/iptvnator`.
