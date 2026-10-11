#!/usr/bin/env bash
# Starts the mock provider and the dev server serving a built IPTVnator PWA.
#   WWW=/path/to/dist/apps/web ./run-dev.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WWW="${WWW:-$HERE/../www}"
PORT="${PORT:-43330}"
MOCK_PORT="${MOCK_PORT:-43331}"
node "$HERE/mock-provider.mjs" --port "$MOCK_PORT" &
MOCK_PID=$!
node "$HERE/server.mjs" --www "$WWW" --port "$PORT" &
SERVER_PID=$!
trap 'kill $MOCK_PID $SERVER_PID 2>/dev/null || true' EXIT
echo "mock provider pid=$MOCK_PID, dev server pid=$SERVER_PID"
wait
