#!/usr/bin/env bash
# Build the spike and run the full RESULTS.md scenario suite automatically,
# writing all metrics into one results-<host>-<date>.txt file to send back.
#
#   ./collect-results.sh           # quick suite (~4 min, 30 s per scenario)
#   ./collect-results.sh --long    # + 10-minute 4K60 HEVC long run
#
# Prereqs on the target machine: Xcode Command Line Tools and Homebrew mpv
# (`brew install mpv`). Electron and media clips are bundled (or resolved
# from the repo / generated with ffmpeg when running from a checkout).
# Viewer windows will open and close on their own during the run.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

DURATION="${DURATION:-30}"
LONG=0
[[ "${1:-}" == "--long" ]] && LONG=1

if ! xcode-select -p >/dev/null 2>&1; then
    echo "Xcode Command Line Tools required: run 'xcode-select --install'" >&2
    exit 1
fi
MPV_PREFIX=""
for prefix in "$(brew --prefix 2>/dev/null || true)" /opt/local; do
    if [[ -n "$prefix" ]] && ls "$prefix"/lib/libmpv*.dylib >/dev/null 2>&1; then
        MPV_PREFIX="$prefix"
        break
    fi
done
if [[ -z "$MPV_PREFIX" ]]; then
    echo "libmpv not found. Install it with Homebrew ('brew install mpv') or," >&2
    echo "on legacy macOS (e.g. High Sierra), MacPorts: 'sudo port install mpv +libmpv'" >&2
    exit 1
fi

make

if [[ -z "${ELECTRON:-}" ]]; then
    for candidate in \
        "$DIR/electron/Electron.app/Contents/MacOS/Electron" \
        "$DIR/../../node_modules/.bin/electron" \
        "$DIR/../../../../../node_modules/.bin/electron"; do
        if [[ -x "$candidate" ]]; then
            ELECTRON="$candidate"
            break
        fi
    done
fi
if [[ -z "${ELECTRON:-}" ]]; then
    echo "Electron not found; set ELECTRON=/path/to/electron" >&2
    exit 1
fi
if [[ "$ELECTRON" == "$DIR/electron/"* ]]; then
    # Bundled runtime may carry a quarantine attribute after transfer.
    xattr -cr "$DIR/electron/Electron.app" 2>/dev/null || true
fi

# Media clips: bundled under media/, otherwise generate with ffmpeg.
mkdir -p media
if [[ ! -f media/spike-4k-hevc.mp4 ]] && command -v ffmpeg >/dev/null; then
    echo "generating media/spike-4k-hevc.mp4 ..."
    ffmpeg -v error -y -f lavfi -i "testsrc2=size=3840x2160:rate=60" -t 12 \
        -c:v hevc_videotoolbox -b:v 25M -tag:v hvc1 -pix_fmt yuv420p \
        media/spike-4k-hevc.mp4
fi
if [[ ! -f media/spike-4k-hdr10.mp4 && -f media/spike-4k-hevc.mp4 ]] &&
    command -v ffmpeg >/dev/null; then
    echo "generating media/spike-4k-hdr10.mp4 ..."
    ffmpeg -v error -y -f lavfi -i "testsrc2=size=3840x2160:rate=25" -t 10 \
        -c:v hevc_videotoolbox -profile:v main10 -pix_fmt p010le -b:v 30M \
        -tag:v hvc1 /tmp/spike-hdr-base.mp4
    ffmpeg -v error -y -i /tmp/spike-hdr-base.mp4 -c:v copy \
        -bsf:v "hevc_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9" \
        media/spike-4k-hdr10.mp4
fi

OUT="$DIR/results-$(hostname -s)-$(date +%Y%m%d-%H%M).txt"
{
    echo "# mpv frame-copy spike results"
    echo "date: $(date)"
    echo "cpu: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
    echo "os: $(sw_vers -productName) $(sw_vers -productVersion)"
    system_profiler SPDisplaysDataType 2>/dev/null |
        grep -E "Chipset Model|Resolution|UI Looks like" | sed 's/^ *//' || true
} > "$OUT"

run_scenario() { # name media size extra_helper_args duration
    local name="$1" media="$2" size="$3" extra="$4" dur="$5"
    echo "== $name (${dur}s) =="
    printf '\n## %s\n' "$name" >> "$OUT"
    local hlog vlog
    hlog="$(mktemp /tmp/spike-helper.XXXXXX)"
    vlog="$(mktemp /tmp/spike-viewer.XXXXXX)"
    # shellcheck disable=SC2086
    ./build/mpv_helper "$media" --size "$size" --no-audio $extra \
        > "$hlog" 2>&1 &
    local hpid=$!
    disown "$hpid"
    sleep 2
    SPIKE_SHM=/mpv-frame-spike "$ELECTRON" "$DIR/viewer/main.js" \
        > "$vlog" 2>&1 &
    local vpid=$!
    disown "$vpid"
    sleep "$dur"
    kill "$vpid" 2>/dev/null || true
    kill -INT "$hpid" 2>/dev/null || true
    sleep 1
    kill -9 "$hpid" "$vpid" 2>/dev/null || true
    grep -E "PIXELPROBE|STATS|LONGRUN" "$vlog" |
        sed 's/^\[viewer\] //' | tail -24 >> "$OUT"
    grep -E "^\[helper\] (GL renderer|fps=)" "$hlog" | tail -6 >> "$OUT"
    rm -f "$hlog" "$vlog"
}

run_scenario "1080p60 testsrc2 sw" \
    'av://lavfi:testsrc2=size=1920x1080:rate=60' 1920x1080 "" "$DURATION"
run_scenario "4K60 testsrc2 sw" \
    'av://lavfi:testsrc2=size=3840x2160:rate=60' 3840x2160 "" "$DURATION"
run_scenario "1080p50 cadence" \
    'av://lavfi:testsrc2=size=1920x1080:rate=50' 1920x1080 "" "$DURATION"
if [[ -f media/spike-4k-hevc.mp4 ]]; then
    run_scenario "4K60 HEVC hwdec=videotoolbox" \
        media/spike-4k-hevc.mp4 3840x2160 "--hwdec videotoolbox --loop" "$DURATION"
    run_scenario "4K60 HEVC -> 720p viewport" \
        media/spike-4k-hevc.mp4 1280x720 "--hwdec videotoolbox --loop" "$DURATION"
else
    echo "WARN: media/spike-4k-hevc.mp4 missing, HEVC scenarios skipped" | tee -a "$OUT"
fi
if [[ -f media/spike-4k-hdr10.mp4 ]]; then
    run_scenario "4K25 HDR10 tonemap hwdec" \
        media/spike-4k-hdr10.mp4 3840x2160 "--hwdec videotoolbox --loop" "$DURATION"
else
    echo "WARN: media/spike-4k-hdr10.mp4 missing, HDR scenario skipped" | tee -a "$OUT"
fi
if [[ "$LONG" == 1 && -f media/spike-4k-hevc.mp4 ]]; then
    run_scenario "LONGRUN 10min 4K60 HEVC hwdec" \
        media/spike-4k-hevc.mp4 3840x2160 "--hwdec videotoolbox --loop" 600
fi

echo
echo "Done. Send this file back:"
echo "  $OUT"
