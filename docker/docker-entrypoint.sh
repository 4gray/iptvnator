#!/bin/sh
set -eu

: "${PORT:=3000}"
: "${BACKEND_URL:=/api}"
: "${CLIENT_URL:=http://localhost:4333}"

export PORT BACKEND_URL CLIENT_URL

nginx_template="/etc/nginx/http.d/default.conf.template"
nginx_config="/etc/nginx/http.d/default.conf"

if ! grep -q '\${PORT}' "$nginx_template"; then
  echo "nginx template is missing the \${PORT} backend placeholder" >&2
  exit 1
fi

envsubst '${PORT}' < "$nginx_template" > "$nginx_config"

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

node <<'NODE'
const http = require('node:http');

const port = Number.parseInt(process.env.PORT || '3000', 10);
const deadline = Date.now() + 30_000;
const retryDelayMs = 250;

function retry(error) {
  if (Date.now() >= deadline) {
    const reason = error?.message ? `: ${error.message}` : '';
    console.error(`web-backend did not become ready on 127.0.0.1:${port}${reason}`);
    process.exit(1);
  }

  setTimeout(check, retryDelayMs);
}

function check() {
  const request = http.get(
    {
      host: '127.0.0.1',
      path: '/health',
      port,
      timeout: 1000,
    },
    (response) => {
      response.resume();
      if (
        response.statusCode &&
        response.statusCode >= 200 &&
        response.statusCode < 500
      ) {
        process.exit(0);
      }

      retry(new Error(`HTTP ${response.statusCode}`));
    }
  );

  request.on('timeout', () => {
    request.destroy(new Error('timeout'));
  });
  request.on('error', retry);
}

check();
NODE

nginx -g 'daemon off;'
