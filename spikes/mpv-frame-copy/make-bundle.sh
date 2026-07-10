#!/usr/bin/env bash
# Assemble a self-contained tarball of the spike for a machine without
# Node/pnpm (e.g. the Intel Mac measurement run). The bundle carries the
# spike sources, vendored N-API headers, pre-generated test clips, and an
# official Electron dist download; the target machine only needs Xcode
# Command Line Tools and `brew install mpv`.
#
#   ./make-bundle.sh [x64|arm64]      # Electron arch of the TARGET machine
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

ARCH="${1:-x64}"
ELECTRON_VERSION="41.7.2"
BUNDLE_ROOT="build/bundle/mpv-frame-copy-spike"
TARBALL="build/mpv-frame-copy-spike-macos-$ARCH.tar.gz"

rm -rf build/bundle
mkdir -p "$BUNDLE_ROOT"

cp -R common helper viewer Makefile run.sh collect-results.sh \
    README.md RESULTS.md DESIGN.md "$BUNDLE_ROOT/"

# N-API headers so the addon builds without any Node installation.
NODE_INC="$(node -p "require('path').join(process.execPath, '..', '..', 'include', 'node')" 2>/dev/null || true)"
if [[ -z "$NODE_INC" || ! -f "$NODE_INC/node_api.h" ]]; then
    echo "need a Node >= 18 on PATH to source N-API headers" >&2
    exit 1
fi
mkdir -p "$BUNDLE_ROOT/vendor/node-headers"
cp "$NODE_INC"/node_api.h "$NODE_INC"/node_api_types.h \
    "$NODE_INC"/js_native_api.h "$NODE_INC"/js_native_api_types.h \
    "$BUNDLE_ROOT/vendor/node-headers/"

# Pre-generate the test clips so the target needs no ffmpeg.
mkdir -p media
if [[ ! -f media/spike-4k-hevc.mp4 ]]; then
    echo "generating media/spike-4k-hevc.mp4 ..."
    ffmpeg -v error -y -f lavfi -i "testsrc2=size=3840x2160:rate=60" -t 12 \
        -c:v hevc_videotoolbox -b:v 25M -tag:v hvc1 -pix_fmt yuv420p \
        media/spike-4k-hevc.mp4
fi
if [[ ! -f media/spike-4k-hdr10.mp4 ]]; then
    echo "generating media/spike-4k-hdr10.mp4 ..."
    ffmpeg -v error -y -f lavfi -i "testsrc2=size=3840x2160:rate=25" -t 10 \
        -c:v hevc_videotoolbox -profile:v main10 -pix_fmt p010le -b:v 30M \
        -tag:v hvc1 /tmp/spike-hdr-base.mp4
    ffmpeg -v error -y -i /tmp/spike-hdr-base.mp4 -c:v copy \
        -bsf:v "hevc_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9" \
        media/spike-4k-hdr10.mp4
fi
mkdir -p "$BUNDLE_ROOT/media"
cp media/spike-4k-hevc.mp4 media/spike-4k-hdr10.mp4 "$BUNDLE_ROOT/media/"

# Official Electron dist for the target arch (no npm involved).
ELECTRON_ZIP="build/electron-v$ELECTRON_VERSION-darwin-$ARCH.zip"
if [[ ! -f "$ELECTRON_ZIP" ]]; then
    echo "downloading electron v$ELECTRON_VERSION darwin-$ARCH ..."
    curl -fL --retry 3 -o "$ELECTRON_ZIP" \
        "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-darwin-$ARCH.zip"
fi
mkdir -p "$BUNDLE_ROOT/electron"
unzip -q "$ELECTRON_ZIP" -d "$BUNDLE_ROOT/electron"

cat > "$BUNDLE_ROOT/START-HERE.md" <<'EOF'
# mpv frame-copy spike — self-contained measurement bundle

Target-machine prerequisites (no Node/pnpm needed):

1. Xcode Command Line Tools: `xcode-select --install`
2. Homebrew mpv: `brew install mpv`

Then:

```bash
./collect-results.sh          # ~4 min, all scenarios
./collect-results.sh --long   # + 10-minute 4K60 long run (recommended)
```

Viewer windows open and close by themselves during the run. At the end the
script prints the path of a `results-<host>-<date>.txt` file — send that
file back. Detailed docs: README.md; baseline numbers: RESULTS.md.
EOF

tar -czf "$TARBALL" -C build/bundle mpv-frame-copy-spike
echo
echo "bundle ready: $DIR/$TARBALL"
du -h "$TARBALL" | cut -f1
