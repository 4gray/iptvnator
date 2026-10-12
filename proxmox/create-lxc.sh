#!/usr/bin/env bash
# Creates a Debian LXC on a Proxmox VE host and installs IPTVnator (the
# self-hosted PWA + web backend) in it. Run as root on the Proxmox host:
#
#   bash create-lxc.sh
#
# Environment (all optional):
#   CTID              container id            (default: next free id)
#   CT_HOSTNAME       hostname                (default iptvnator)
#   STORAGE           rootfs storage          (default local-lvm)
#   TEMPLATE_STORAGE  template storage        (default local)
#   BRIDGE            network bridge          (default vmbr0)
#   NET               net0 address settings   (default ip=dhcp; e.g. ip=192.168.1.50/24,gw=192.168.1.1)
#   DISK_GB, MEMORY_MB, SWAP_MB, CORES        (default 4, 512, 512, 2)
#   CT_PASSWORD       root password           (default: generated and printed)
#   INSTALL_SCRIPT    local path to install.sh (default: downloaded from SCRIPTS_BASE)
#   SCRIPTS_BASE      where install.sh is downloaded from
#   CLIENT_URL, PORT, IPTVNATOR_IMAGE_TAG, IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS
#                     passed through to install.sh (see its header)
set -euo pipefail

CTID="${CTID:-}"
CT_HOSTNAME="${CT_HOSTNAME:-iptvnator}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
NET="${NET:-ip=dhcp}"
DISK_GB="${DISK_GB:-4}"
MEMORY_MB="${MEMORY_MB:-512}"
SWAP_MB="${SWAP_MB:-512}"
CORES="${CORES:-2}"
CT_PASSWORD="${CT_PASSWORD:-}"
INSTALL_SCRIPT="${INSTALL_SCRIPT:-}"
SCRIPTS_BASE="${SCRIPTS_BASE:-https://raw.githubusercontent.com/ange-primiterra/iptvnator/proxmox-lxc/proxmox}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this script as root on the Proxmox host"
command -v pct >/dev/null 2>&1 || die "pct not found: run this on a Proxmox VE host"

if [ -z "$CTID" ]; then
    CTID="$(pvesh get /cluster/nextid)"
fi
pct status "$CTID" >/dev/null 2>&1 && die "container $CTID already exists (set CTID to another id)"

if [ -z "$CT_PASSWORD" ]; then
    CT_PASSWORD="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-16)"
    GENERATED_PASSWORD=1
fi

log "Looking for the latest Debian 12 template"
pveam update >/dev/null
TEMPLATE="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-12-standard_' | sort -V | tail -1)"
[ -n "$TEMPLATE" ] || die "no debian-12-standard template available (check the host's internet access)"
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
    log "Downloading $TEMPLATE to $TEMPLATE_STORAGE"
    pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

log "Creating container $CTID ($CT_HOSTNAME, ${MEMORY_MB} MB RAM, ${DISK_GB} GB disk, $NET)"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
    --hostname "$CT_HOSTNAME" \
    --ostype debian \
    --cores "$CORES" \
    --memory "$MEMORY_MB" \
    --swap "$SWAP_MB" \
    --rootfs "$STORAGE:$DISK_GB" \
    --net0 "name=eth0,bridge=$BRIDGE,$NET" \
    --unprivileged 1 \
    --features nesting=1 \
    --onboot 1 \
    --password "$CT_PASSWORD" \
    --description "IPTVnator PWA + web backend, installed by proxmox/create-lxc.sh" \
    --start 1

log "Waiting for the container's network"
for _ in $(seq 1 60); do
    if pct exec "$CTID" -- sh -c 'getent hosts deb.debian.org >/dev/null 2>&1'; then
        break
    fi
    sleep 2
done
pct exec "$CTID" -- sh -c 'getent hosts deb.debian.org >/dev/null 2>&1' || die "the container has no network (DHCP? bridge $BRIDGE?)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [ -n "$INSTALL_SCRIPT" ]; then
    cp "$INSTALL_SCRIPT" "$TMP/install.sh"
else
    log "Downloading install.sh from $SCRIPTS_BASE"
    curl -fsSL "$SCRIPTS_BASE/install.sh" -o "$TMP/install.sh"
fi
pct push "$CTID" "$TMP/install.sh" /root/iptvnator-install.sh --perms 0755

log "Installing IPTVnator inside the container (a few minutes)"
pct exec "$CTID" -- env \
    CLIENT_URL="${CLIENT_URL:-}" \
    PORT="${PORT:-3000}" \
    IPTVNATOR_IMAGE_TAG="${IPTVNATOR_IMAGE_TAG:-latest}" \
    IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS="${IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS:-0}" \
    bash /root/iptvnator-install.sh

IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
cat <<MSG

Done. IPTVnator runs in container $CTID:  http://${IP:-<container-ip>}/
  root password   ${CT_PASSWORD}$( [ -n "${GENERATED_PASSWORD:-}" ] && printf '  (generated: note it down)' )
  console         pct enter $CTID
  update          pct exec $CTID -- bash /root/iptvnator-install.sh
  remove          pct stop $CTID && pct destroy $CTID
MSG
