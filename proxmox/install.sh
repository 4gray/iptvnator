#!/usr/bin/env bash
# IPTVnator self-hosted PWA + web backend on a Debian/Ubuntu system (made for a
# Proxmox LXC, works on any Debian 12/13 or Ubuntu 22.04+ box). Installs on the
# first run, updates on every later run. Run as root inside the container:
#
#   bash install.sh
#
# What it does, mirroring the official Docker image (docker/Dockerfile):
#   1. pulls 4gray/iptvnator:<tag> from Docker Hub with the registry API (curl + jq,
#      no Docker needed) and extracts the built PWA and the web backend from it;
#   2. serves the PWA with nginx on port 80 and proxies /api to the backend;
#   3. runs the backend with Node.js as a systemd service, bound to 127.0.0.1 only.
#
# Environment (all optional):
#   IPTVNATOR_IMAGE      image name              (default 4gray/iptvnator)
#   IPTVNATOR_IMAGE_TAG  image tag               (default latest; e.g. stable, 0.25.0)
#   PORT                 backend port, loopback  (default 3000)
#   CLIENT_URL           allowed browser origins for the backend CORS, comma-separated
#                        (default http://<this host's first IP>; set the public URL
#                        when a reverse proxy is in front)
#   IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS  1 when your IPTV provider lives on the
#                        LAN (default 0: the backend refuses private targets)
#   NODE_MAJOR           Node.js major from NodeSource (default 24)
set -euo pipefail

IMAGE="${IPTVNATOR_IMAGE:-4gray/iptvnator}"
TAG="${IPTVNATOR_IMAGE_TAG:-latest}"
PORT="${PORT:-3000}"
BACKEND_URL="${BACKEND_URL:-/api}"
CLIENT_URL="${CLIENT_URL:-}"
ALLOW_PRIVATE="${IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS:-0}"
NODE_MAJOR="${NODE_MAJOR:-24}"

WEB_ROOT=/var/www/iptvnator
APP_DIR=/opt/iptvnator
ETC_DIR=/etc/iptvnator
SERVICE=iptvnator-backend
REGISTRY=https://registry-1.docker.io
AUTH=https://auth.docker.io

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --------------------------------------------------------------- packages
install_packages() {
    export DEBIAN_FRONTEND=noninteractive
    log "Installing packages (nginx, curl, jq)"
    apt-get update -q
    apt-get install -y -q --no-install-recommends ca-certificates curl gnupg jq nginx tar gzip zstd
}

install_node() {
    if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
        log "Node.js $(node --version) already installed"
        return
    fi
    log "Installing Node.js ${NODE_MAJOR} from NodeSource"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -q nodejs
}

# ------------------------------------------------------------ image pull
image_arch() {
    case "$(uname -m)" in
        x86_64) echo amd64 ;;
        aarch64 | arm64) echo arm64 ;;
        *) die "unsupported CPU architecture: $(uname -m)" ;;
    esac
}

registry_token() {
    curl -fsSL --retry 5 --retry-delay 3 "$AUTH/token?service=registry.docker.io&scope=repository:$IMAGE:pull" | jq -r '.token'
}

# Downloads IMAGE:TAG for this architecture and unpacks its layers into $1.
fetch_image() {
    local dest="$1" token manifest media digest layer_media layer blob accept
    accept='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'
    token="$(registry_token)"
    if [ -z "$token" ] || [ "$token" = null ]; then
        die "could not get a Docker Hub token"
    fi
    manifest="$(curl -fsSL --retry 5 --retry-delay 3 -H "Authorization: Bearer $token" -H "Accept: $accept" "$REGISTRY/v2/$IMAGE/manifests/$TAG")"
    media="$(jq -r '.mediaType // ""' <<<"$manifest")"
    if [[ "$media" == *image.index* || "$media" == *manifest.list* ]]; then
        digest="$(jq -r --arg a "$(image_arch)" '[.manifests[] | select(.platform.os == "linux" and .platform.architecture == $a)][0].digest // ""' <<<"$manifest")"
        [ -n "$digest" ] || die "$IMAGE:$TAG has no linux/$(image_arch) image"
        manifest="$(curl -fsSL --retry 5 --retry-delay 3 -H "Authorization: Bearer $token" -H "Accept: $accept" "$REGISTRY/v2/$IMAGE/manifests/$digest")"
    fi
    IMAGE_DIGEST="$(jq -r '.config.digest // "unknown"' <<<"$manifest")"
    mkdir -p "$dest"
    blob="$(mktemp)"
    while read -r -u 3 layer layer_media; do
        [ -n "$layer" ] || continue
        log "Layer ${layer:7:12}"
        # The registry answers with a redirect to a CDN; curl drops the token on the cross-host hop.
        curl -fsSL --retry 5 --retry-delay 3 -H "Authorization: Bearer $token" "$REGISTRY/v2/$IMAGE/blobs/$layer" -o "$blob"
        local decompress="-z"
        [[ "$layer_media" == *zstd* ]] && decompress="--zstd"
        # Whiteouts: an upper layer deletes paths of a lower one before adding its own files.
        local whiteouts
        whiteouts="$(tar -t "$decompress" -f "$blob" | grep -E '(^|/)\.wh\.' || true)"
        local wh base dir
        while read -r wh; do
            [ -n "$wh" ] || continue
            base="$(basename "$wh")"
            dir="$(dirname "$wh")"
            if [ "$base" = ".wh..wh..opq" ]; then
                find "$dest/$dir" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
            else
                rm -rf "${dest:?}/$dir/${base#.wh.}"
            fi
        done <<<"$whiteouts"
        tar -x "$decompress" -f "$blob" -C "$dest" --exclude='*/.wh.*' --exclude='.wh.*'
    done 3< <(jq -r '.layers[] | "\(.digest) \(.mediaType)"' <<<"$manifest")
    rm -f "$blob"
}

# ---------------------------------------------------------------- deploy
replace_dir() { # replace_dir <source> <target>: atomic swap, no partial state on failure
    local src="$1" target="$2"
    rm -rf "$target.new" "$target.old"
    cp -a "$src" "$target.new"
    [ -d "$target" ] && mv "$target" "$target.old"
    mv "$target.new" "$target"
    rm -rf "$target.old"
}

deploy_image() {
    local tmp
    tmp="$(mktemp -d)"
    log "Pulling $IMAGE:$TAG from Docker Hub"
    fetch_image "$tmp/rootfs"
    [ -f "$tmp/rootfs/usr/share/nginx/html/index.html" ] || die "unexpected image layout: no /usr/share/nginx/html/index.html"
    [ -f "$tmp/rootfs/opt/iptvnator/web-backend/main.cjs" ] || die "unexpected image layout: no /opt/iptvnator/web-backend/main.cjs"
    mkdir -p "$APP_DIR" "$ETC_DIR" "$(dirname "$WEB_ROOT")"
    replace_dir "$tmp/rootfs/usr/share/nginx/html" "$WEB_ROOT"
    replace_dir "$tmp/rootfs/opt/iptvnator/web-backend" "$APP_DIR/web-backend"
    chown -R root:root "$WEB_ROOT" "$APP_DIR/web-backend"
    chmod -R a+rX "$WEB_ROOT" "$APP_DIR/web-backend"
    printf '%s:%s@%s\n%s\n' "$IMAGE" "$TAG" "$IMAGE_DIGEST" "$(date -u +%FT%TZ)" > "$ETC_DIR/installed"
    rm -rf "$tmp"
}

configure() {
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -n "$CLIENT_URL" ] || CLIENT_URL="http://${ip:-localhost}"

    log "Configuring the backend (port $PORT, CLIENT_URL=$CLIENT_URL)"
    id -u iptvnator >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin iptvnator
    mkdir -p "$ETC_DIR"
    cat > "$ETC_DIR/backend.env" <<ENV
PORT=$PORT
CLIENT_URL=$CLIENT_URL
IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=$ALLOW_PRIVATE
NODE_ENV=production
ENV
    chown root:iptvnator "$ETC_DIR/backend.env"
    chmod 640 "$ETC_DIR/backend.env"

    # The backend calls app.listen(port) on every interface; nginx is its only client,
    # so a preload shim pins it to 127.0.0.1 (the Docker image gets that from port mapping).
    cat > "$APP_DIR/bind-loopback.cjs" <<'JS'
// Loaded through NODE_OPTIONS=--require: force a bare listen(port[, cb]) onto 127.0.0.1.
const net = require('node:net');
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
        return listen.call(this, args[0], '127.0.0.1', typeof args[1] === 'function' ? args[1] : undefined);
    }
    return listen.apply(this, args);
};
JS

    # Same file the Docker entrypoint writes: tells the PWA where the backend is.
    printf 'window.__IPTVNATOR_CONFIG__ = %s;\n' "$(jq -nc --arg url "$BACKEND_URL" '{BACKEND_URL: $url}')" > "$WEB_ROOT/assets/app-config.js"

    cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=IPTVnator web backend (M3U parsing, Xtream and Stalker proxies)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=iptvnator
Group=iptvnator
EnvironmentFile=$ETC_DIR/backend.env
Environment=NODE_OPTIONS=--require=$APP_DIR/bind-loopback.cjs
WorkingDirectory=$APP_DIR/web-backend
ExecStart=$(command -v node) $APP_DIR/web-backend/main.cjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true

[Install]
WantedBy=multi-user.target
UNIT

    # Same server block as docker/nginx.conf, with the port rendered in.
    cat > /etc/nginx/sites-available/iptvnator <<NGINX
server {
    listen       80 default_server;
    listen  [::]:80 default_server;
    server_name  _;

    root   $WEB_ROOT;
    index  index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:$PORT/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /assets/app-config.js {
        add_header Cache-Control "no-store";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX
    ln -sf /etc/nginx/sites-available/iptvnator /etc/nginx/sites-enabled/iptvnator
    rm -f /etc/nginx/sites-enabled/default
    nginx -t
}

start_services() {
    log "Starting services"
    systemctl daemon-reload
    systemctl enable --now nginx >/dev/null
    systemctl reload nginx
    systemctl enable "$SERVICE" >/dev/null
    systemctl restart "$SERVICE"
    local _
    for _ in $(seq 1 30); do
        if curl -fsS "http://127.0.0.1/api/health" >/dev/null 2>&1; then
            log "Backend healthy"
            return
        fi
        sleep 1
    done
    journalctl -u "$SERVICE" --no-pager -n 30 || true
    die "the backend did not answer on http://127.0.0.1/api/health"
}

summary() {
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    cat <<MSG

IPTVnator is ready:  http://${ip:-<container-ip>}/
  image      $(head -1 "$ETC_DIR/installed")
  backend    systemctl status $SERVICE   (port $PORT, 127.0.0.1 only)
  settings   $ETC_DIR/backend.env        (then: systemctl restart $SERVICE)
  update     run this script again
MSG
}

main() {
    [ "$(id -u)" -eq 0 ] || die "run this script as root"
    command -v apt-get >/dev/null 2>&1 || die "this script needs a Debian or Ubuntu system"
    install_packages
    install_node
    deploy_image
    configure
    start_services
    summary
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
