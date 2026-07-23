# Local Timeshift Buffer

IPTVnator's local timeshift is an opt-in Electron feature that lets users
pause and rewind a live channel without relying on provider catch-up support.
It is separate from `Channel.timeshift`, which describes provider-side
catch-up metadata.

## Supported Playback Paths

The same main-process buffer feeds every built-in inline video player:

- Video.js
- HTML5/HLS.js
- ArtPlayer
- Embedded MPV

Live video from M3U playlists, Xtream, and Stalker can use the buffer. M3U
items are marked live only in live-TV playback contexts; M3U radio and
collection VOD/series items do not become timeshift-eligible.

ArtPlayer leaves its visual live mode while the buffer is active so its
timeline remains visible. Embedded MPV permits seeking on a live playback only
when the local buffer is active and MPV reports a positive duration. Normal
live playback remains non-seekable in both players.

Once a local session is ready, all four inline players show the same compact
`LIVE` action with a red on-air dot. Activating it seeks to the latest seekable
buffer position and resumes playback. The action stays hidden when Timeshift is
disabled, still starting, unavailable, or not applicable to the current media.

External MPV and VLC windows are not part of the first implementation. Their
process-owned timelines do not provide the same renderer-controlled
pause/seek lifecycle. Radio, VOD, series episodes, and provider catch-up
playback continue to use their existing paths without a local buffer.

## Data Flow

1. `LocalTimeshiftCoordinator` in `libs/ui/playback/src/lib/timeshift/`
   observes the resolved playback, selected player, and normalized settings.
2. For an explicitly live stream, it asks the Electron preload bridge to start
   a renderer-owned session. The original URL and request headers cross IPC
   only in this request.
3. `LocalTimeshiftService` starts FFmpeg without a shell. FFmpeg copies the
   first video and audio streams into four-second MPEG-TS HLS segments. To keep
   startup and channel changes fast, input probing is bounded
   (`-probesize`/`-analyzeduration` below FFmpeg's defaults) and the first
   segments are cut shorter (`-hls_init_time 1`) before converging to four
   seconds. On stop, the graceful SIGTERM window is short (500 ms default)
   because the discarded buffer does not need a clean FFmpeg flush.
   Superseded starts skip that grace window entirely so rapid channel changes
   do not queue behind an incomplete buffer. When a renderer stops its own
   session during a channel change, the owner slot is released immediately and
   FFmpeg/server/directory teardown continues in the background, so the
   replacement session's start is not serialized behind it.
4. A token-protected HTTP server bound to `127.0.0.1` serves the sliding HLS
   playlist and segments to the selected inline player.
5. When playback changes, the view is destroyed, or the app quits, IPTVnator
   stops FFmpeg, closes the HTTP server, and recursively removes that session's
   temporary directory.

The playlist uses `delete_segments`, `temp_file`, `omit_endlist`, and
`independent_segments`. Its list size is derived from the configured duration,
so old media is removed instead of growing the buffer indefinitely. Startup
waits until the playlist references a completed segment; the original stream
is used as a safe fallback when support detection or startup fails.

Rapid channel changes can arrive before FFmpeg publishes its first playlist.
Calling `stopLocalTimeshift()` without a public session id cancels the pending
operation for the calling renderer before its replacement starts. A public
session id can stop only a session owned by that renderer.

## Security Boundaries

- The local HTTP server binds only to IPv4 loopback and uses an unguessable
  per-session token in the path.
- Only the generated playlist, segment, and init-file names are served; path
  traversal and arbitrary directory reads are rejected.
- Responses disable caching, support byte ranges, and allow CORS only for the
  packaged `null` origin or loopback development origins.
- FFmpeg is spawned with `shell: false`. Source URLs and HTTP header names and
  values reject CR, LF, and NUL characters.
- Renderer-safe session snapshots expose the tokenized playback URL and buffer
  metrics, but never the upstream URL, request headers, buffer directory, or
  filesystem paths.
- Start requests accept only explicit live playback over HTTP(S), RTMP(S),
  RTSP, or UDP. Local `file:` URLs are rejected.

## Settings And Runtime Dependency

`Settings.localTimeshift` contains:

- `enabled` — defaults to `false`
- `maxDurationMinutes` — an integer from 5 through 180, default 30
- `bufferDirectory` — empty uses `tmpdir()/iptvnator-timeshift`; a configured
  directory becomes the parent for isolated `session-*` directories

The controls appear only in Electron when Video.js, HTML5, ArtPlayer, or
Embedded MPV is selected. Settings loading and saving normalize legacy,
partial, and invalid values.

FFmpeg must be available through `FFMPEG_PATH`, the process `PATH`, or a known
platform install location. The support probe runs before the first session. If
FFmpeg is absent, playback falls back to the original live stream and no buffer
is created.

## Main Files

- `apps/electron-backend/src/app/services/local-timeshift.service.ts` — session
  ownership, FFmpeg/HTTP lifecycle, cleanup, and renderer-safe snapshots
- `apps/electron-backend/src/app/services/local-timeshift-ffmpeg.ts` — support
  detection, safe headers, and bounded HLS arguments
- `apps/electron-backend/src/app/services/local-timeshift-http-server.ts` —
  loopback media server and range/CORS handling
- `apps/electron-backend/src/app/events/local-timeshift.events.ts` — semantic
  renderer-owned IPC handlers
- `libs/ui/playback/src/lib/timeshift/local-timeshift-coordinator.ts` — player
  source switching, fallback, channel-change cancellation, and teardown
- `apps/web/src/app/settings/settings-playback-section.component.html` —
  Electron-only controls

## Validation Expectations

Changes to this subsystem should cover FFmpeg argument construction, header
validation, bounded playlist behavior, HTTP token/path/range/CORS handling,
process startup and teardown, renderer ownership, pending-start cancellation,
coordinator fallback and stale-session behavior, all four player integrations,
settings normalization/persistence, and Electron E2E or CDP validation.
