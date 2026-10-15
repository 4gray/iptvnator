#!/usr/bin/env bash
# IPTVnator self-hosted PWA + web backend on a dedicated Debian/Ubuntu system
# (made for a Proxmox LXC; also a Debian 12/13 or Ubuntu 22.04+ container or VM
# of its own: IPTVnator becomes nginx's default site on port 80). Installs on the
# first run, updates on every later run. Run as root inside the container:
#
#   bash install.sh                  install or update
#   bash install.sh --save-settings  only check and save the settings (create-lxc.sh
#                                    does this before the container has a network)
#
# What it does, mirroring the official Docker image (docker/Dockerfile):
#   1. pulls 4gray/iptvnator:<tag> from Docker Hub with the registry API (curl + jq,
#      no Docker needed) and extracts the built PWA and the web backend from it;
#   2. serves the PWA with nginx on port 80 and proxies /api to the backend;
#   3. runs the backend with Node.js as a systemd service, bound to 127.0.0.1 only.
#
# Settings (environment variables, all optional). Each run keeps the values of
# the previous one (saved in /etc/iptvnator) unless a variable is set, so an
# update needs none of them; set one to change it, or set it empty to reset it.
#   IPTVNATOR_IMAGE      image name              (default 4gray/iptvnator)
#   IPTVNATOR_IMAGE_TAG  image tag               (default latest; e.g. stable, 0.25.0)
#   PORT                 backend port, loopback  (default 3000)
#   CLIENT_URL           allowed browser origins for the backend CORS, comma-separated
#                        (default http://<this host's first IP>; set the public URL
#                        when a reverse proxy is in front)
#   IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS  1 when your IPTV provider lives on the
#                        LAN (default 0: the backend refuses private targets)
#   IPTVNATOR_STORAGE    server: playlists, favourites and progress live in a database
#                        on this machine, shared by every browser (default, as in the
#                        Docker image); none: each browser keeps its own
#   IPTVNATOR_ACCESS_TOKEN  when set, every browser asks for this token once
#                        (needs IPTVNATOR_STORAGE=server)
#   IPTVNATOR_MAX_DOCUMENT_MB  largest stored playlist in MB (default 64)
#   IPTVNATOR_BACKEND_START_TIMEOUT  seconds to wait for the backend (default 300;
#                        database migrations run before it answers)
#   NODE_MAJOR           Node.js major from NodeSource (default 24)
#   IPTVNATOR_SCRIPTS_BASE  where the update command downloads install.sh again
#                        (default https://raw.githubusercontent.com/4gray/iptvnator/master/proxmox)
set -euo pipefail

WEB_ROOT=/var/www/iptvnator
APP_DIR=/opt/iptvnator
ETC_DIR=/etc/iptvnator
DATA_DIR=/var/lib/iptvnator # the unit's StateDirectory
SERVICE=iptvnator-backend
REGISTRY=https://registry-1.docker.io
AUTH=https://auth.docker.io
BACKEND_URL=/api
# Saved between runs: installer settings in install.env, backend ones in backend.env.
# CLIENT_URL is saved as given (often empty) in install.env; backend.env holds the
# value in use, so a default follows the machine's address.
INSTALL_KEYS=(IPTVNATOR_IMAGE IPTVNATOR_IMAGE_TAG NODE_MAJOR IPTVNATOR_BACKEND_START_TIMEOUT IPTVNATOR_SCRIPTS_BASE CLIENT_URL)
BACKEND_KEYS=(PORT IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS IPTVNATOR_STORAGE IPTVNATOR_ACCESS_TOKEN IPTVNATOR_MAX_DOCUMENT_MB)
DEFAULT_SCRIPTS_BASE=https://raw.githubusercontent.com/4gray/iptvnator/master/proxmox

IMAGE="${IPTVNATOR_IMAGE:-4gray/iptvnator}"
TAG="${IPTVNATOR_IMAGE_TAG:-latest}"

WEB_ROOT=/var/www/iptvnator
APP_DIR=/opt/iptvnator
ETC_DIR=/etc/iptvnator
SERVICE=iptvnator-backend
REGISTRY=https://registry-1.docker.io
AUTH=https://auth.docker.io

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- settings
# load_saved <file> <keys...>: a key that is unset in the environment takes its
# saved value. The file is parsed, never sourced.
load_saved() {
    local file="$1" line key value
    shift
    [ -f "$file" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in *=*) ;; *) continue ;; esac
        key="${line%%=*}"
        value="${line#*=}" # everything after the first '=': base64 tokens end in '='
        case " $* " in *" $key "*) ;; *) continue ;; esac
        if [ -z "${!key+x}" ]; then
            printf -v "$key" '%s' "$value"
            export "${key?}"
        fi
    done < "$file"
}

# saved_value <file> <key>: the saved value of one key, parsed like load_saved.
saved_value() {
    local line
    [ -f "$1" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        if [ "${line%%=*}" = "$2" ] && [[ "$line" == *=* ]]; then
            printf '%s' "${line#*=}"
            return 0
        fi
    done < "$1"
}

resolve_settings() {
    local had_client_url="${CLIENT_URL+x}"
    load_saved "$ETC_DIR/install.env" "${INSTALL_KEYS[@]}"
    load_saved "$ETC_DIR/backend.env" "${BACKEND_KEYS[@]}"
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    DEFAULT_CLIENT_URL="http://${ip:-localhost}"
    if [ -z "$had_client_url" ] && ! grep -qs '^CLIENT_URL=' "$ETC_DIR/install.env"; then
        # Earlier installs kept only the value in use, in backend.env: keep it
        # unless it has the shape of the computed default (http://<address>).
        local in_use
        in_use="$(saved_value "$ETC_DIR/backend.env" CLIENT_URL)"
        [[ "$in_use" =~ ^http://([0-9.]+|localhost)$ ]] || CLIENT_URL="$in_use"
    fi
    IMAGE="${IPTVNATOR_IMAGE:-4gray/iptvnator}"
    TAG="${IPTVNATOR_IMAGE_TAG:-latest}"
    NODE_MAJOR="${NODE_MAJOR:-24}"
    START_TIMEOUT="${IPTVNATOR_BACKEND_START_TIMEOUT:-300}"
    PORT="${PORT:-3000}"
    CLIENT_URL="${CLIENT_URL:-}"
    ALLOW_PRIVATE="${IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS:-0}"
    STORAGE="${IPTVNATOR_STORAGE:-server}"
    TOKEN="${IPTVNATOR_ACCESS_TOKEN:-}"
    MAX_DOCUMENT_MB="${IPTVNATOR_MAX_DOCUMENT_MB:-64}"
    SCRIPTS_BASE="${IPTVNATOR_SCRIPTS_BASE:-$DEFAULT_SCRIPTS_BASE}"

    local name value
    for name in PORT MAX_DOCUMENT_MB START_TIMEOUT NODE_MAJOR; do
        value="${!name}"
        [[ "$value" =~ ^[1-9][0-9]*$ ]] || die "$name must be a positive number (got '$value')"
    done
    case "$STORAGE" in server | none) ;; *) die "IPTVNATOR_STORAGE must be server or none (got '$STORAGE')" ;; esac
    case "$ALLOW_PRIVATE" in 0 | 1 | true | false) ;; *) die "IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS must be 0 or 1" ;; esac
    if [ -n "$TOKEN" ]; then
        [ "$STORAGE" = server ] || die "IPTVNATOR_ACCESS_TOKEN needs IPTVNATOR_STORAGE=server (the browser app asks for the token only then)"
        [[ "$TOKEN" =~ ^[A-Za-z0-9._~+/=-]{8,}$ ]] || die "IPTVNATOR_ACCESS_TOKEN: at least 8 characters among letters, digits and . _ ~ + / = -"
    fi
    [[ "$CLIENT_URL" =~ ^[^[:space:]]*$ ]] || die "CLIENT_URL must not contain spaces (comma-separate several origins)"
    [[ "$TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]*$ ]] || die "IPTVNATOR_IMAGE_TAG is not a valid tag: '$TAG'"
    [[ "$IMAGE" =~ ^[a-z0-9]+([._/-][a-z0-9]+)*$ ]] || die "IPTVNATOR_IMAGE is not a Docker Hub image name: '$IMAGE'"
    [[ "$SCRIPTS_BASE" =~ ^https://[^[:space:]\'\"]+$ ]] || die "IPTVNATOR_SCRIPTS_BASE must be an https:// URL"
}

# Saved before anything is downloaded, so a run that fails half-way is retried
# with `bash install.sh` alone. backend.env is created private in a subshell, then
# opened to the service group and moved in place: the token is never world-readable.
save_settings() {
    id -u iptvnator >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin iptvnator
    install -d -m 0755 "$ETC_DIR"
    {
        printf 'IPTVNATOR_IMAGE=%s\n' "$IMAGE"
        printf 'IPTVNATOR_IMAGE_TAG=%s\n' "$TAG"
        printf 'NODE_MAJOR=%s\n' "$NODE_MAJOR"
        printf 'IPTVNATOR_BACKEND_START_TIMEOUT=%s\n' "$START_TIMEOUT"
        printf 'IPTVNATOR_SCRIPTS_BASE=%s\n' "$SCRIPTS_BASE"
        printf 'CLIENT_URL=%s\n' "$CLIENT_URL"
    } > "$ETC_DIR/install.env"
    (
        umask 077
        {
            printf 'PORT=%s\n' "$PORT"
            printf 'CLIENT_URL=%s\n' "${CLIENT_URL:-$DEFAULT_CLIENT_URL}"
            printf 'IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=%s\n' "$ALLOW_PRIVATE"
            printf 'IPTVNATOR_STORAGE=%s\n' "$STORAGE"
            printf 'IPTVNATOR_DATA_DIR=%s\n' "$DATA_DIR"
            printf 'IPTVNATOR_MAX_DOCUMENT_MB=%s\n' "$MAX_DOCUMENT_MB"
            [ -z "$TOKEN" ] || printf 'IPTVNATOR_ACCESS_TOKEN=%s\n' "$TOKEN"
            printf 'NODE_ENV=production\n'
        } > "$ETC_DIR/backend.env.new"
    )
    chown root:iptvnator "$ETC_DIR/backend.env.new"
    chmod 640 "$ETC_DIR/backend.env.new"
    mv "$ETC_DIR/backend.env.new" "$ETC_DIR/backend.env"
}

# --------------------------------------------------------------- packages
install_packages() {
    export DEBIAN_FRONTEND=noninteractive
    log "Installing packages (nginx, curl, jq)"
    apt-get update -q
    apt-get install -y -q --no-install-recommends ca-certificates curl gnupg jq nginx tar gzip zstd
}

# Sets NODE_BIN to a Node.js 22+ the iptvnator service user can run: a system one
# (not nvm/volta/fnm under /root or /home), else NodeSource's /usr/bin/node.
install_node() {
    local candidate
    candidate="$(command -v node 2>/dev/null || true)"
    [ -z "$candidate" ] || candidate="$(readlink -f "$candidate")"
    case "$candidate" in
        "" | /root/* | /home/*) ;;
        *)
            if "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
                NODE_BIN="$candidate"
                log "Node.js $("$NODE_BIN" --version) already installed ($NODE_BIN)"
                return
            fi
            ;;
    esac
    log "Installing Node.js ${NODE_MAJOR} from NodeSource"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -q nodejs
    NODE_BIN=/usr/bin/node
    [ -x "$NODE_BIN" ] || die "NodeSource did not install $NODE_BIN"
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
        # A token lasts 300 s and a slow link needs longer for the whole image: one per
        # layer (token requests do not count as pulls). The registry answers with a
        # redirect to a CDN; curl drops the token on the cross-host hop.
        token="$(registry_token)"
        if [ -z "$token" ] || [ "$token" = null ]; then
            die "could not get a Docker Hub token"
        fi
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
    install -d -m 0755 "$APP_DIR" "$(dirname "$WEB_ROOT")"
    install -d -m 0755 "$ETC_DIR"
    replace_dir "$tmp/rootfs/usr/share/nginx/html" "$WEB_ROOT"
    replace_dir "$tmp/rootfs/opt/iptvnator/web-backend" "$APP_DIR/web-backend"
    chown -R root:root "$WEB_ROOT" "$APP_DIR/web-backend"
    chmod -R a+rX "$WEB_ROOT" "$APP_DIR/web-backend"
    printf '%s:%s@%s\n%s\n' "$IMAGE" "$TAG" "$IMAGE_DIGEST" "$(date -u +%FT%TZ)" > "$ETC_DIR/installed"
    rm -rf "$tmp"
}

configure() {
    log "Configuring the backend (port $PORT, storage $STORAGE, CLIENT_URL=${CLIENT_URL:-$DEFAULT_CLIENT_URL})"
    runuser -u iptvnator -- "$NODE_BIN" --version >/dev/null 2>&1 || die "the iptvnator user cannot run $NODE_BIN"

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
Description=IPTVnator web backend (playlist storage, M3U parsing, Xtream and Stalker proxies)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=iptvnator
Group=iptvnator
EnvironmentFile=$ETC_DIR/backend.env
Environment=NODE_OPTIONS=--require=$APP_DIR/bind-loopback.cjs
WorkingDirectory=$APP_DIR/web-backend
ExecStart=$NODE_BIN $APP_DIR/web-backend/main.cjs
Restart=always
RestartSec=3
# $DATA_DIR, writable by the service only: the server storage database
# (databases/iptvnator.db) lives there and survives updates.
StateDirectory=iptvnator
StateDirectoryMode=0750
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true

[Install]
WantedBy=multi-user.target
UNIT

    # IPTVnator becomes nginx's default site on port 80: the installer is meant for a
    # dedicated container or VM. Debian's stock default site is replaced, never an
    # edited one, and a configuration nginx rejects is rolled back.
    local available=/etc/nginx/sites-available enabled=/etc/nginx/sites-enabled had_default=0
    if [ -e "$enabled/default" ]; then
        if [ "$(readlink -f "$enabled/default")" != "$available/default" ] || ! stock_default_site "$available/default"; then
            die "nginx's default site was changed on this machine; this installer serves IPTVnator as the default site on port 80 and is meant for a dedicated container or VM"
        fi
        had_default=1
    fi
    [ ! -f "$available/iptvnator" ] || cp -p "$available/iptvnator" "$available/iptvnator.previous"
    # IPv6 only when the kernel has it: nginx refuses to start on [::]:80 otherwise
    # (a host booted with ipv6.disable=1).
    local listen6="    # no IPv6 on this system"
    [ ! -e /proc/net/if_inet6 ] || listen6="    listen  [::]:80 default_server;"
    # Same server block as docker/nginx.conf, with the port rendered in.
    cat > "$available/iptvnator" <<NGINX
server {
    listen       80 default_server;
$listen6
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
        # Playlist documents carry whole M3U payloads (IPTVNATOR_MAX_DOCUMENT_MB).
        client_max_body_size ${MAX_DOCUMENT_MB}m;
        proxy_read_timeout 120s;
        gzip on;
        gzip_proxied any;
        gzip_types application/json;
        gzip_min_length 1024;
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
    ln -sf "$available/iptvnator" "$enabled/iptvnator"
    rm -f "$enabled/default"
    if ! nginx -t; then
        if [ -f "$available/iptvnator.previous" ]; then
            mv "$available/iptvnator.previous" "$available/iptvnator"
        else
            rm -f "$enabled/iptvnator" "$available/iptvnator"
        fi
        [ "$had_default" = 0 ] || ln -sf "$available/default" "$enabled/default"
        die "nginx rejected the configuration (its message is above; another site that is already default_server on port 80 is the usual cause); the previous configuration is back"
    fi
    rm -f "$available/iptvnator.previous"
}

# True when Debian's default site is the file nginx-common shipped (its conffile checksum).
stock_default_site() {
    local file="$1" sum
    sum="$(dpkg-query -W -f='${Conffiles}\n' nginx-common 2>/dev/null | awk -v f="$file" '$1 == f { print $2; exit }')"
    [ -n "$sum" ] && [ "$(md5sum < "$file" | cut -d' ' -f1)" = "$sum" ]
}

start_services() {
    log "Starting services"
    systemctl daemon-reload
    systemctl enable --now nginx >/dev/null
    systemctl reload nginx
    systemctl enable "$SERVICE" >/dev/null
    systemctl stop "$SERVICE" 2>/dev/null || true
    # The backend shares the machine's loopback (Docker gives it its own): refuse a
    # port another program holds, or that program would answer the health check.
    if command -v ss >/dev/null 2>&1 && [ -n "$(ss -Hltn "sport = :$PORT" 2>/dev/null)" ]; then
        die "port $PORT is already used by another program; choose another one with PORT=..."
    fi
    systemctl start "$SERVICE"
    # With server storage the backend migrates its database before it listens.
    local _ restarts
    for _ in $(seq 1 "$START_TIMEOUT"); do
        if curl -fsS "http://127.0.0.1/api/health" 2>/dev/null | jq -e '.service == "iptvnator-web-backend"' >/dev/null 2>&1; then
            log "Backend healthy"
            return
        fi
        restarts="$(systemctl show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)"
        [ "${restarts:-0}" -lt 3 ] || break # crash loop: no point in waiting
        sleep 1
    done
    journalctl -u "$SERVICE" --no-pager -n 30 || true
    die "the backend did not answer on http://127.0.0.1/api/health (see the log above)"
}

# The image decides what the backend offers: an image older than server
# storage ignores IPTVNATOR_STORAGE and IPTVNATOR_ACCESS_TOKEN.
check_instance() {
    local info
    info="$(curl -fsS "http://127.0.0.1/api/v1/instance" 2>/dev/null || true)"
    if [ "$STORAGE" = server ] && [ "$(jq -r '.storage // empty' <<<"$info" 2>/dev/null)" != server ]; then
        printf '\033[1;33mwarning:\033[0m %s\n' "$IMAGE:$TAG has no server storage: each browser keeps its own data." >&2
    fi
    if [ -n "$TOKEN" ] && [ "$(jq -r '.auth // empty' <<<"$info" 2>/dev/null)" != token ]; then
        printf '\033[1;33mwarning:\033[0m %s\n' "$IMAGE:$TAG does not enforce IPTVNATOR_ACCESS_TOKEN: the instance is open to anyone who reaches it." >&2
    fi
}

summary() {
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    cat <<MSG

IPTVnator is ready:  http://${ip:-<container-ip>}/
  image      $(head -1 "$ETC_DIR/installed")
  backend    systemctl status $SERVICE   (port $PORT, 127.0.0.1 only)
  storage    $( [ "$STORAGE" = server ] && printf 'server: %s/databases/iptvnator.db, shared by every browser' "$DATA_DIR" || printf 'none: each browser keeps its own data' )
  access     $( [ -n "$TOKEN" ] && printf 'token required (IPTVNATOR_ACCESS_TOKEN)' || printf 'open to anyone who reaches port 80' )
  update     $(update_command)
             (settings and data are kept; put e.g. IPTVNATOR_ACCESS_TOKEN=... before
             the last bash to change a setting)
MSG
}

# The update fetches the current installer first, so fixes reach existing installs.
update_command() {
    local self=/root/iptvnator-install.sh
    [ ! -f "$0" ] || self="$(readlink -f "$0")"
    printf "bash -c 'curl -fsSL %s/install.sh -o %s && bash %s'" "$SCRIPTS_BASE" "$self" "$self"
}

main() {
    umask 022 # the service user must read what is installed, whatever root's umask
    [ "$(id -u)" -eq 0 ] || die "run this script as root"
    command -v apt-get >/dev/null 2>&1 || die "this script needs a Debian or Ubuntu system"
    resolve_settings
    save_settings
    if [ "${1:-}" = --save-settings ]; then
        log "Settings saved in $ETC_DIR"
        return
    fi
    install_packages
    install_node
    deploy_image
    configure
    start_services
    check_instance
    summary
}

# Run unless sourced (tests source it for its functions); also through bash -c "$(curl ...)".
if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
    main "$@"
fi
