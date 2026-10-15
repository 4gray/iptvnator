#!/usr/bin/env bash
# Creates a Debian LXC on a Proxmox VE host and installs IPTVnator (the
# self-hosted PWA + web backend) in it. Run as root on the Proxmox host:
#
#   bash create-lxc.sh
#
# Environment (all optional):
#   CTID              container id            (default: next free id)
#   CT_HOSTNAME       hostname                (default iptvnator)
#   STORAGE           rootfs storage          (default: the first active storage for containers,
#                                              e.g. local-lvm, local-zfs, local-btrfs)
#   TEMPLATE_STORAGE  template storage        (default local)
#   BRIDGE            network bridge          (default vmbr0)
#   NET               net0 address settings   (default ip=dhcp; e.g. ip=192.168.1.50/24,gw=192.168.1.1)
#   DISK_GB, MEMORY_MB, SWAP_MB, CORES        (default 4, 1024, 512, 2)
#   CT_PASSWORD       root password           (default: generated and printed)
#   INSTALL_SCRIPT    local path to install.sh (default: the one next to this script,
#                     else downloaded from SCRIPTS_BASE)
#   SCRIPTS_BASE      where install.sh is downloaded from (default: IPTVnator's master branch);
#                     the container's update command downloads it from there again
#   CLIENT_URL, PORT, IPTVNATOR_IMAGE, IPTVNATOR_IMAGE_TAG,
#   IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS, IPTVNATOR_STORAGE, IPTVNATOR_ACCESS_TOKEN,
#   IPTVNATOR_MAX_DOCUMENT_MB, IPTVNATOR_BACKEND_START_TIMEOUT, NODE_MAJOR
#                     passed through to install.sh when set (see its header)
set -euo pipefail

CTID="${CTID:-}"
CT_HOSTNAME="${CT_HOSTNAME:-iptvnator}"
STORAGE="${STORAGE:-}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
NET="${NET:-ip=dhcp}"
DISK_GB="${DISK_GB:-4}"
MEMORY_MB="${MEMORY_MB:-1024}"
SWAP_MB="${SWAP_MB:-512}"
CORES="${CORES:-2}"
CT_PASSWORD="${CT_PASSWORD:-}"
INSTALL_SCRIPT="${INSTALL_SCRIPT:-}"
SCRIPTS_BASE="${SCRIPTS_BASE:-https://raw.githubusercontent.com/4gray/iptvnator/master/proxmox}"
PASSTHROUGH=(CLIENT_URL PORT IPTVNATOR_IMAGE IPTVNATOR_IMAGE_TAG IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS
    IPTVNATOR_STORAGE IPTVNATOR_ACCESS_TOKEN IPTVNATOR_MAX_DOCUMENT_MB IPTVNATOR_BACKEND_START_TIMEOUT NODE_MAJOR)

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this script as root on the Proxmox host"
command -v pct >/dev/null 2>&1 || die "pct not found: run this on a Proxmox VE host"

TMP="$(mktemp -d)"
CREATED=""
on_exit() {
    local status=$?
    rm -rf "$TMP"
    if [ "$status" -ne 0 ] && [ -n "$CREATED" ]; then
        cat >&2 <<MSG

Container $CTID was created but the installation did not finish.
  root password   $CT_PASSWORD
  retry           pct exec $CTID -- bash /root/iptvnator-install.sh
  remove          pct stop $CTID && pct destroy $CTID
MSG
    fi
}
trap on_exit EXIT

# ------------------------------------------------- installer and settings
# The installer comes first: the settings are checked with its own rules
# before anything is created on the host.
if [ -z "$INSTALL_SCRIPT" ] && [ "$(basename -- "$0")" = create-lxc.sh ] && [ -f "$(dirname -- "$0")/install.sh" ]; then
    INSTALL_SCRIPT="$(dirname -- "$0")/install.sh" # run from a checkout
fi
if [ -n "$INSTALL_SCRIPT" ]; then
    cp "$INSTALL_SCRIPT" "$TMP/install.sh"
else
    log "Downloading install.sh from $SCRIPTS_BASE"
    curl -fsSL "$SCRIPTS_BASE/install.sh" -o "$TMP/install.sh"
fi
(
    # shellcheck source=/dev/null
    source "$TMP/install.sh"
    # shellcheck disable=SC2034 # read by resolve_settings: no saved settings on the host
    ETC_DIR="$TMP/no-saved-settings"
    resolve_settings
) || die "fix the setting above and run this script again"

# ----------------------------------------------------------------- host
if [ -z "$CTID" ]; then
    CTID="$(pvesh get /cluster/nextid)"
fi
if pct status "$CTID" >/dev/null 2>&1; then
    die "container $CTID already exists (set CTID to another id)"
fi

if [ -z "$STORAGE" ]; then
    STORAGE="$(pvesm status --content rootdir --enabled 1 2>/dev/null | awk 'NR > 1 && $3 == "active" { print $1; exit }')"
    [ -n "$STORAGE" ] || die "no active storage for containers on this host (pvesm status --content rootdir)"
elif ! pvesm status --content rootdir --enabled 1 2>/dev/null | awk -v s="$STORAGE" 'NR > 1 && $1 == s { found = 1 } END { exit !found }'; then
    die "storage '$STORAGE' cannot hold containers here; available: $(pvesm status --content rootdir --enabled 1 2>/dev/null | awk 'NR > 1 { printf "%s ", $1 }')"
fi

if [ -z "$CT_PASSWORD" ]; then
    CT_PASSWORD="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-16)"
    GENERATED_PASSWORD=1
fi

log "Looking for the latest Debian 12 template"
pveam update >/dev/null
TEMPLATE="$(pveam available --section system | awk '$2 ~ /^debian-12-standard_/ { print $2 }' | sort -V | tail -1 || true)"
[ -n "$TEMPLATE" ] || die "no debian-12-standard template available (check the host's internet access)"
if ! pveam list "$TEMPLATE_STORAGE" | grep -qF "$TEMPLATE"; then
    log "Downloading $TEMPLATE to $TEMPLATE_STORAGE"
    pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

log "Creating container $CTID ($CT_HOSTNAME on $STORAGE, ${MEMORY_MB} MB RAM, ${DISK_GB} GB disk, $NET)"
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
CREATED=1
log "Container $CTID created, root password: $CT_PASSWORD"

log "Waiting for the container's network"
for _ in $(seq 1 60); do
    if pct exec "$CTID" -- sh -c 'getent hosts deb.debian.org >/dev/null 2>&1'; then
        break
    fi
    sleep 2
done
pct exec "$CTID" -- sh -c 'getent hosts deb.debian.org >/dev/null 2>&1' || die "the container has no network (DHCP? bridge $BRIDGE?)"

pct push "$CTID" "$TMP/install.sh" /root/iptvnator-install.sh --perms 0755

log "Installing IPTVnator inside the container (a few minutes)"
# Only the settings given here; install.sh applies its own defaults to the rest.
INSTALL_ENV=()
for name in "${PASSTHROUGH[@]}"; do
    if [ -n "${!name+x}" ]; then INSTALL_ENV+=("$name=${!name}"); fi
done
# Where the container's update command fetches the installer again.
[ -n "$INSTALL_SCRIPT" ] || INSTALL_ENV+=("IPTVNATOR_SCRIPTS_BASE=$SCRIPTS_BASE")
pct exec "$CTID" -- env "${INSTALL_ENV[@]}" bash /root/iptvnator-install.sh

if [ -n "$INSTALL_SCRIPT" ]; then
    UPDATE="pct exec $CTID -- bash /root/iptvnator-install.sh"
else
    UPDATE="pct exec $CTID -- bash -c 'curl -fsSL $SCRIPTS_BASE/install.sh -o /root/iptvnator-install.sh && bash /root/iptvnator-install.sh'"
fi
IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
cat <<MSG

Done. IPTVnator runs in container $CTID:  http://${IP:-<container-ip>}/
  root password   ${CT_PASSWORD}$( [ -n "${GENERATED_PASSWORD:-}" ] && printf '  (generated: note it down)' )
  console         pct enter $CTID
  update          $UPDATE
                  (settings and data are kept; to change a setting, run the
                  installer with it, e.g. pct exec $CTID -- env IPTVNATOR_ACCESS_TOKEN=... bash /root/iptvnator-install.sh)
  data            /var/lib/iptvnator in the container (server storage database)
  remove          pct stop $CTID && pct destroy $CTID
MSG
