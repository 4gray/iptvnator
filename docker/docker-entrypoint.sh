#!/bin/sh
set -eu

export PORT="${PORT:-3000}"
export BACKEND_URL="${BACKEND_URL:-/api}"

envsubst '${PORT}' < /etc/nginx/http.d/default.conf.template > /etc/nginx/http.d/default.conf

node <<'NODE'
const fs = require('node:fs');

fs.writeFileSync(
    '/usr/share/nginx/html/assets/app-config.js',
    `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify(
        { BACKEND_URL: process.env.BACKEND_URL || '/api' },
        null,
        2
    )};\n`
);
NODE

node /opt/iptvnator/web-backend/main.cjs &
BACKEND_PID=$!

cleanup_done=0
cleanup() {
    if [ "$cleanup_done" -eq 1 ]; then
        return
    fi

    cleanup_done=1
    trap - INT TERM EXIT

    if [ -n "${NGINX_PID:-}" ]; then
        kill "$NGINX_PID" 2>/dev/null || true
        wait "$NGINX_PID" 2>/dev/null || true
    fi

    if [ -n "${BACKEND_PID:-}" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
}

handle_signal() {
    cleanup
    exit 0
}

process_is_running() {
    if [ ! -r "/proc/$1/stat" ]; then
        return 1
    fi

    state="$(awk '{ print $3 }' "/proc/$1/stat" 2>/dev/null || true)"
    [ -n "$state" ] && [ "$state" != "Z" ]
}

trap handle_signal INT TERM
trap cleanup EXIT

backend_ready=0

for _ in $(seq 1 30); do
    if wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
        backend_ready=1
        break
    fi

    if ! process_is_running "$BACKEND_PID"; then
        set +e
        wait "$BACKEND_PID"
        BACKEND_STATUS=$?
        set -e
        exit "$BACKEND_STATUS"
    fi

    sleep 1
done

if [ "$backend_ready" -ne 1 ]; then
    echo "IPTVnator web backend did not become healthy on port ${PORT}."
    exit 1
fi

nginx -g 'daemon off;' &
NGINX_PID=$!

while :; do
    if ! process_is_running "$BACKEND_PID"; then
        set +e
        wait "$BACKEND_PID"
        EXIT_STATUS=$?
        set -e
        echo "IPTVnator web backend exited with status ${EXIT_STATUS}."
        exit "$EXIT_STATUS"
    fi

    if ! process_is_running "$NGINX_PID"; then
        set +e
        wait "$NGINX_PID"
        EXIT_STATUS=$?
        set -e
        echo "nginx exited with status ${EXIT_STATUS}."
        exit "$EXIT_STATUS"
    fi

    sleep 1
done
