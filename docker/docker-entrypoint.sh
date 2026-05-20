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
    fi

    if [ -n "${BACKEND_PID:-}" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
}

trap cleanup INT TERM EXIT

backend_ready=0

for _ in $(seq 1 30); do
    if wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
        backend_ready=1
        break
    fi

    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        wait "$BACKEND_PID"
        exit $?
    fi

    sleep 1
done

if [ "$backend_ready" -ne 1 ]; then
    echo "IPTVnator web backend did not become healthy on port ${PORT}."
    exit 1
fi

nginx -g 'daemon off;' &
NGINX_PID=$!

wait "$NGINX_PID"
