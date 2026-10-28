#!/usr/bin/env bash
# Copies a built IPTVnator PWA (dist/apps/web of `pnpm nx build web --configuration=pwa`)
# into the Android project's assets so the APK ships it.
#   tv-shell/scripts/bundle-pwa.sh /path/to/iptvnator/dist/apps/web
set -euo pipefail
SRC="${1:?usage: bundle-pwa.sh <dist/apps/web>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/../android/app/src/main/assets/www"
test -f "$SRC/index.html" || { echo "no index.html in $SRC — build the PWA first (pnpm nx build web --configuration=pwa)"; exit 1; }
mkdir -p "$DEST"
# Purge the previous bundle but keep the tracked placeholder; AAPT ignores dotfiles,
# so .gitkeep never ships in the APK.
find "$DEST" -mindepth 1 ! -path "$DEST/.gitkeep" -delete
cp -R "$SRC"/. "$DEST"/
# Service worker files are never served by the shell; drop them to keep the APK small.
rm -f "$DEST"/ngsw-worker.js "$DEST"/ngsw.json "$DEST"/safety-worker.js "$DEST"/worker-basic.min.js
echo "PWA bundled into $DEST ($(du -sh "$DEST" | cut -f1), $(find "$DEST" -type f | wc -l) files)"
