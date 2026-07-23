# DVR Recording

This document describes the first DVR implementation: persisted recording
schedules, the Electron scheduler, the embedded-MPV/VLC recording engines, and
the recording library.

Related:

- [SQLite DB Worker](./sqlite-db-worker.md)
- [Nx Workspace Boundaries](./nx-workspace-boundaries.md)
- [Embedded MPV Native](./embedded-mpv-native.md)

## Scope And Runtime Limits

DVR is an Electron-only capability. The PWA and self-hosted web build do not
have access to the native recording engines, local filesystem actions, or the
main-process scheduler.

Scheduled recordings currently require IPTVnator to be running at the start
and throughout the recording window. The scheduler persists schedules across
restarts, but it is not an operating-system background service:

- a future `scheduled` row is armed again when the application starts
- a schedule whose complete recording window elapsed while the app was closed
  becomes `missed`
- a row left in `recording` by an application restart becomes `interrupted`
- quitting IPTVnator waits for active recording processes to stop before the
  Electron process exits

This is a local DVR. There is no server-side or cloud recording hand-off.

## User Flow

The EPG program dialog exposes a recording action when the current runtime and
provider can supply a recordable live-stream URL. The M3U and Xtream live views
translate the selected program and channel into a `ScheduleRecordingRequest`.
The request includes the program time window, source identity, display
metadata, and a resolved live playback snapshot.

Stalker/Ministra playback links returned by `create_link` are short-lived.
Consequently, Stalker only permits recording the current program; scheduling a
future Stalker program is deliberately disabled. Supporting it safely requires
a future main-process provider resolver that obtains a fresh playback URL when
the timer fires.

M3U and Xtream future schedules currently persist the resolved stream URL at
schedule time. Providers that rotate credentials or issue short-lived signed
URLs can therefore fail when a later timer starts. A future source-resolver
boundary should refresh those URLs at recording start.

The recording library is lazy-loaded at `/workspace/recordings`. It offers:

- `All`: active items first, followed by past recording attempts
- `Upcoming`: `scheduled` and `recording` items in ascending start-time order
- `Library`: terminal items for which a recorded file is available
- cancel for active entries
- play and reveal-in-folder actions for available files
- remove from library for terminal entries

Library load and engine-probe failures are localized renderer states with a
retry action. A failed engine probe is not cached permanently, so installing or
reconfiguring VLC while IPTVnator is open can be detected without restarting.
Concurrent retry clicks share one support/load operation and enter the loading
state before the support probe begins.
Per-record action locks prevent duplicate cancel, play, reveal, and remove IPC
requests. The routed page follows the active locale's LTR/RTL direction.

The route is guarded out of the PWA. In Electron, the library remains usable
when no recording engine is currently installed: existing entries can still be
listed, played, revealed, or removed. Engine availability gates only new
schedules and starts.

Removing an entry from the library deletes the SQLite metadata only. It does
not delete the recorded media file from disk. The playlist/source identifiers
stored on a recording are snapshots rather than foreign keys. Deleting a
playlist first cancels its active schedules and clears their playback secrets,
but keeps terminal recording rows and existing media files.

## Ownership

### Renderer libraries

- `libs/recording/data-access` owns `RecordingService`, runtime capability
  checks, the semantic preload calls, and reactive recording state.
- `libs/recording/feature` owns the routed recording-library UI.
- `libs/ui/epg` owns the provider-neutral EPG recording request event and
  program-dialog action.
- M3U, Xtream, and Stalker live feature hosts resolve provider-specific
  playback details before calling the provider-neutral recording action port.

The renderer never talks to the recording table through generic DB IPC.

### Shared contracts and schema

- `libs/shared/interfaces/src/lib/recording.interface.ts` contains the public
  and persisted recording contracts.
- `libs/shared/database/src/lib/recording-schema.ts` contains the canonical
  Drizzle table definition.
- `libs/shared/database/src/lib/connection.ts` creates the table and indexes
  for fresh or existing databases.

### Electron main process

- `recording-scheduler.service.ts` owns the semantic scheduler API;
  `recording-scheduler.runtime.ts` owns timers, recovery, state transitions,
  shutdown reconciliation, and per-record serialization;
  `recording-scheduling-gate.ts` serializes schedule creation with playlist
  lifecycle operations; pure validation and public DTO projection live in
  `recording-scheduler.utils.ts`.
- `recording-engine.ts` selects embedded MPV first and falls back to the
  dedicated VLC engine.
- `vlc-recording-engine.ts` owns headless VLC process startup, recording output,
  stop escalation, and installed/configured binary probing.
- `recording-repository.ts` is the scheduler's typed persistence boundary.
- `database/operations/recording.operations.ts` owns SQL mapping and CRUD.
- `events/database/recordings.events.ts` exposes semantic scheduling, list,
  cancel, remove, play, reveal, and support IPC.

Every `DatabaseWorkerClient` request waits for main-process database
initialization and schema migration before the worker can be created. Scheduler
recovery then runs against the migrated schema. Recovery failure is isolated so
DVR recovery cannot prevent the rest of IPTVnator from starting. App shutdown
blocks new schedules, clears timers, waits for in-flight scheduler operations
with bounded waits, stops active engines, persists their final file metadata as
`interrupted`, clears playback secrets, and closes any remaining engine sessions
before Electron quits.

## State Model

The persisted statuses are:

| Status        | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `scheduled`   | Validated and waiting for its effective start time           |
| `recording`   | The selected native engine is actively writing the stream    |
| `completed`   | The engine stopped at the effective end time                 |
| `failed`      | Starting, recording, stopping, or persistence failed         |
| `canceled`    | The user canceled an upcoming or active recording            |
| `missed`      | The effective recording window elapsed before it could start |
| `interrupted` | The app restarted after the row had entered `recording`      |

Terminal statuses are `completed`, `failed`, `canceled`, `missed`, and
`interrupted`. Recording start and end padding are persisted in seconds and
are limited to 0–3600 seconds on each side. The scheduler supports long future
delays by re-arming timers beyond the platform timeout limit.

Per-record operation serialization prevents start/cancel/finish races. A global
scheduling lifecycle gate additionally serializes schedule creation with
playlist deletion and delete-all snapshots: an in-flight schedule is either
observed and canceled by deletion or sees the playlist blocked before it writes.
If an engine starts or stops successfully but persisting its final metadata
fails, the scheduler retains the engine's path and byte count while marking the
row `failed`, including the application-shutdown fallback.

## Recording Engine

`DesktopRecordingEngine` prefers `EmbeddedMpvRecordingEngine`. It creates a
separate hidden embedded-MPV session for each active recording. The session is
positioned outside the visible window and does not reuse or interrupt the
user's visible player session. These sessions are main-process-owned: their
stream URLs, target paths, and session identifiers are not broadcast to the
renderer, and renderer MPV IPC cannot mutate or dispose them.
Native start and stop calls set MPV's `stream-record` property synchronously;
the TypeScript engine only reports success after the native call is accepted.
An empty finalized output is treated as failure. Hidden main-process recording
sessions do not acquire the visible-player `prevent-display-sleep` blocker;
`DesktopRecordingEngine` separately holds `prevent-app-suspension` while DVR is
active.

When embedded MPV recording is unavailable, `VlcRecordingEngine` probes the
installed or configured VLC executable and launches one dedicated, headless
process per recording. VLC remuxes the input into MPEG-TS without displaying a
player window. The stream URL and supported headers are written to a transient
mode-`0600` M3U control file instead of VLC's process arguments. Stop requests
VLC's RC interface to quit cleanly, waits for file finalization, and escalates
to a forced process stop after a timeout. The control file is removed on start
failure, normal stop, unexpected exit, and shutdown. Stale private input files
left by a hard crash are removed on a later engine startup once they are old and
their owning process is no longer alive. RC pipe failures fall back to process
signals. A process that still has not exited after forced termination remains
tracked and causes stop to fail instead of being reported as finalized. A
zero-byte output is a failure. The same stop sequence runs during application
shutdown.

If VLC cannot be confirmed stopped, both the VLC session and the desktop
engine's `prevent-app-suspension` blocker remain active. The scheduler leaves the
row in `recording` state so cancel can be retried instead of orphaning a live
process behind a terminal library entry. Automatic end and engine-failure paths
retry the stop operation while the engine still reports an active session.

The VLC 3 fallback can reliably forward User-Agent and Referer. It explicitly
rejects streams that require Origin, Authorization, Cookie, or other custom
HTTP headers; those streams require embedded MPV. VLC recording through a
Flatpak host is intentionally unsupported until signal forwarding and host
filesystem visibility have a verified contract.

Before accepting a schedule, the scheduler requires at least one supported
engine and performs request-specific preflight, so a VLC-only runtime rejects
headers it cannot forward before persisting a future schedule. Accepted stream
protocols are restricted to `http`, `https`, `rtmp`, `rtmps`, `rtsp`, `rtp`,
and `udp`. A `prevent-app-suspension` power-save blocker remains active while
any recording engine is writing.

## SQLite And IPC Boundary

The `recordings` table stores schedule metadata, state timestamps, the resolved
playback snapshot needed by the engine, and local file metadata. Its indexes
cover playlist lookup, status/start scheduling, and completion time.

The following database-worker operations are main-process-only:

1. `DB_CREATE_RECORDING`
2. `DB_GET_RECORDING`
3. `DB_LIST_RECORDINGS`
4. `DB_UPDATE_RECORDING`
5. `DB_DELETE_RECORDING`

They are intentionally excluded from `DB_RENDERER_WORKER_OPERATIONS`. Renderer
code uses the higher-level `recordings*` preload methods so it cannot directly
change scheduler state or submit arbitrary persisted file paths.

## Security And Privacy Contract

`PersistedRecordingItem` is a trusted main-process shape. It can contain the
resolved stream URL, request headers, recording directory, and absolute file
path. These values can expose credentials or local filesystem information and
must never be returned to the renderer.

`RecordingItem` is the sanitized public DTO. It contains display and state
metadata plus a `fileAvailable` boolean, but omits playback secrets and local
paths. Play and reveal-in-folder accept a recording ID; the main process looks
up and validates the trusted path before performing the filesystem action.

When a recording reaches a terminal status, the scheduler clears its persisted
stream URL, headers, and recording-directory snapshot. This minimizes the time
that provider credentials remain in SQLite.

SQL tracing logs statement shape only: expanded quoted string and blob literals
are replaced with placeholders, and database paths are redacted. Trace flags
must not become a credential or local-path disclosure channel.

SQLite remains a local plaintext database. On POSIX systems IPTVnator enforces
mode `0700` on its data/database directories and `0600` on the database, WAL,
and shared-memory files. The VLC control file uses `0600` as well. These
permissions protect against other local accounts but are not application-level
encryption.

Pre-release DVR databases that created `stream_url` as `NOT NULL` are rebuilt
once at startup with nullable playback-snapshot columns. Existing schedules and
library metadata are preserved so canceling an old row can still clear its
credentials.

A normal Electron exit and ordinary process-exit handling terminate VLC
children. An operating-system force kill (`SIGKILL`) cannot run application
cleanup; fully crash-proof orphan reconciliation remains future hardening and
must use a verified persisted process identity rather than trusting a reused
PID.

## Extension Notes

Before adding operating-system wake or server-side DVR, separate scheduling
intent from the current in-process timer implementation.
Before enabling future Stalker recording, add a trusted source resolver that
refreshes `create_link` at start time instead of persisting a short-lived URL.
The same resolver boundary can later refresh expiring signed M3U or Xtream URLs.
