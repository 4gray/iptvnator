#!/usr/bin/env bash
# Build and run the full spike: helper (producer) + Electron viewer (consumer).
#
#   ./run.sh <media-url-or-path> [WxH]
#   ./run.sh 'av://lavfi:testsrc2=size=1920x1080:rate=60' 1920x1080
#
# Env overrides: ELECTRON (viewer binary), SPIKE_SHM (ring name),
# HELPER_ARGS (extra helper flags, e.g. "--hwdec videotoolbox-copy --loop").
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
MEDIA="${1:?usage: run.sh <media-url-or-path> [WxH]}"
SIZE="${2:-1920x1080}"
SHM="${SPIKE_SHM:-/mpv-frame-spike}"

make -C "$DIR"

if [[ -z "${ELECTRON:-}" ]]; then
    for candidate in \
        "$DIR/../../node_modules/.bin/electron" \
        "$DIR/../../../../../node_modules/.bin/electron"; do
        if [[ -x "$candidate" ]]; then
            ELECTRON="$candidate"
            break
        fi
    done
fi
if [[ -z "${ELECTRON:-}" ]]; then
    echo "electron binary not found; set ELECTRON=/path/to/electron" >&2
    exit 1
fi

# shellcheck disable=SC2086
"$DIR/build/mpv_helper" "$MEDIA" --size "$SIZE" --shm "$SHM" ${HELPER_ARGS:-} &
HELPER_PID=$!
trap 'kill "$HELPER_PID" 2>/dev/null || true' EXIT

SPIKE_SHM="$SHM" "$ELECTRON" "$DIR/viewer/main.js"
