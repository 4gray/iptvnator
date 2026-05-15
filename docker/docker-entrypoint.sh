#!/bin/sh
set -eu

: "${PORT:=3000}"
: "${BACKEND_URL:=/api}"
: "${CLIENT_URL:=http://localhost:4333}"

export PORT BACKEND_URL CLIENT_URL

sed -i "s#127.0.0.1:3000#127.0.0.1:${PORT}#g" /etc/nginx/http.d/default.conf

node <<'NODE'
const fs = require('node:fs');

const configPath = '/usr/share/nginx/html/assets/app-config.js';
const config = { BACKEND_URL: process.env.BACKEND_URL || '/api' };

fs.mkdirSync('/usr/share/nginx/html/assets', { recursive: true });
fs.writeFileSync(
  configPath,
  `window.__IPTVNATOR_CONFIG__ = Object.assign({}, window.__IPTVNATOR_CONFIG__, ${JSON.stringify(config)});\n`
);
NODE

node /opt/iptvnator/web-backend/main.cjs &
backend_pid="$!"

shutdown() {
  kill "$backend_pid" 2>/dev/null || true
}

trap shutdown INT TERM EXIT

nginx -g 'daemon off;'
