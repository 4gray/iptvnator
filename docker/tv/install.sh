#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ "$(id -u)" -ne 0 ]; then
    echo "Run this installer with sudo on the NAS."
    exit 1
fi
export PATH="/usr/local/bin:$PATH"
sha256sum -c SHA256SUMS
docker compose --env-file .env -f compose.yaml config --quiet
docker load -i image.tar
docker compose --env-file .env -f compose.yaml up -d --no-build
printf '%s\n' 'TV backend started. Existing IPTVnator and its data volume were not replaced.'
