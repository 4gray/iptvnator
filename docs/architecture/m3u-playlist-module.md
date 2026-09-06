# M3U Playlist Module Architecture

This document describes the M3U playlist module architecture, which handles traditional M3U/M3U8 playlists (as opposed to Xtream Codes or Stalker Portal).

## Overview

The M3U playlist module provides:

- Channel list display with virtual scrolling (90,000+ channels support)
- EPG (Electronic Program Guide) integration
- Favorites management with drag-and-drop reordering
- Channel grouping, search, and per-list channel sorting
- Per-playlist group visibility management in the groups view
- Video playback with multiple player backends

## Desktop upgrades from legacy profiles

v0.19.0 stores the complete source list in IndexedDB database `iptvnator`,
version 1, store `playlists`, key path `_id`. Source type is inferred from
`serverUrl` (Xtream), `macAddress` (Stalker), or the M3U fields; the last-used
source does not select which records are migrated. Settings live separately
in `ngStorage`, and player preferences also use localStorage. SQLite already
holds the Xtream catalogs opened in v0.19, including favorites and history;
it is not the authoritative inventory of configured sources.

The published v0.19 Linux DEB's `app.asar/package.json` names the app
`electron-backend`. Later packages set `productName: IPTVnator`. Electron
resolves different `userData` directories from those identities; a later
`app.setName('iptvnator')` does not reset the cached path. The shared
`~/.iptvnator/databases/iptvnator.db` is independent of that path, so cached
Xtream sources can remain visible while the complete IndexedDB list is in
the older profile. Linux usually places these profiles below `~/.config/`.
Snap/Flatpak confinement and a changed installation type can give them
different roots; recovery does not scan unrelated profiles or sandbox roots.

`electron-profile-bootstrap.ts` runs before eager main-process imports such
as `electron-conf`. If the current profile has no IndexedDB, Local Storage,
Preferences, or `config.json` yet, it reuses the known `electron-backend` profile containing
`IndexedDB/file__0.indexeddb.leveldb`, preserving its settings as well. It never
switches an already-used current profile. E2E overrides keep both profiles and
SQLite under the isolated test root.

`PlaylistsService` sends the complete current-profile IndexedDB list through
`DB_MIGRATE_APP_PLAYLISTS`. The worker validates every ID (including duplicates)
and commits all rows plus `m3u-playlists-indexeddb-to-sqlite-v1` in one synchronous
transaction. Any malformed source or failed write rolls back the entire batch;
restarting retries it. Original IndexedDB records remain in place. Full SQLite
rows with a `payload` are authoritative and are skipped. Cache-only Xtream rows
receive the IndexedDB source configuration (cached credentials can be stale),
retaining creation/import timestamps and all linked catalogs, favorites,
history and playback positions. No provider connection is needed. Migration
preserves stored data; it does not create missing provider catalogs or translate
unrelated historical formats into new features.

For an already-used current profile, a separate native recovery offer defaults
to **Keep current sources**. **Recover all missing sources** explicitly explains
that it may also restore sources intentionally deleted after upgrading. There
is no pre-existing deletion ledger that can distinguish these from omissions,
so recovery is never automatic. Close the old version before accepting.
Recovery opens a disposable copy of the old IndexedDB, never the original,
and keeps current settings and full source records. Its separate atomic receipt
`playlists-electron-backend-profile-v1` prevents any subsequent replay, including
after source deletion. Declining records `declined`; starting the app with
`--recover-legacy-playlists` offers it again. That switch does not bypass consent
or replay a completed recovery. A recovery read/write error leaves current
sources usable, reports the failure, writes no successful receipt, and can be
retried on restart.

If the old profile is absent, unreadable, in another sandbox, or was already
cleared by an earlier successful migration, missing source data cannot be
reconstructed from the current SQLite cache. Restore a backup or recreate those
sources; do not clear migration flags to force a blind replay.

SQL initialization also creates indexes on added columns only after the column
migrations. In particular, `idx_content_epg_channel` must follow the addition of
`content.epg_channel_id`; creating it in the initial CREATE TABLE pass aborts
initialization on the v0.19 schema before the playlist migration can run.

Validation: `electron-backend-e2e:e2e-ci--src/legacy-playlist-migration.e2e.ts`
seeds the exact v0.19 IndexedDB schema and verbatim SQL CREATE statements with
61 Stalker sources, three Xtream sources, M3U, and linked cached user data.
It exercises source-list UI, alternate last-used sources, retained settings,
recovery consent, existing data, write failure, restart, and deletion after
migration. Local macOS Electron verification does not substitute for installed
Linux Mint MATE, Snap, or Flatpak upgrade testing.

## Module Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VIDEO PLAYER PAGE                            │
│          libs/playlist/m3u/feature-player/src/lib/video-player/     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────────┐  ┌────────────────────┐ │
│  │   Sidebar   │  │    Video Player      │  │  EPG Timeline      │ │
│  │             │  │  (ArtPlayer/Video.js)│  │  (panel below)     │ │
│  │ ┌─────────┐ │  │                      │  │                    │ │
│  │ │Channel  │ │  │                      │  │                    │ │
│  │ │List     │ │  │                      │  │                    │ │
│  │ │Container│ │  │                      │  │                    │ │
│  │ └─────────┘ │  │                      │  │                    │ │
│  └─────────────┘  └──────────────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        NgRx STORE (m3u-state)                        │
│                         libs/m3u-state/                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Playlist │ │ Channel  │ │   EPG    │ │Favorites │ │  Filter  │  │
│  │ Reducer  │ │ Reducer  │ │ Reducer  │ │ Reducer  │ │ Reducer  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## M3U Parsing (`iptv-playlist-parser` fork)

All four parse call sites (Electron `playlist-source.ts` import, `playlist-refresh.worker.ts`, `web-backend` `/parse`, PWA `playlists.service.ts`) use the
[4gray/iptv-playlist-parser](https://github.com/4gray/iptv-playlist-parser) fork, pinned by commit SHA in `package.json`. The fork tracks upstream
`freearhey/iptv-playlist-parser` (currently synced to v0.15.2) plus three deliberate deltas iptvnator depends on:

- **`radio` attribute** — `item.radio` (string, `'true'` triggers the radio player, EPG suppression, and external-player gating app-wide). Upstream does not have this field; it must survive every upstream sync.
- **Pipe stripping** — `item.url` is cut at the first `|`; `|User-Agent=` / `|Referer=` params still land in `item.http`. Upstream 0.15.0 stopped stripping, but iptvnator consumes `item.url` verbatim in hls.js/mpv/vlc, catch-up URL building, and url-keyed favorites.
- **`#KODIPROP` lines before `#EXTINF` are preserved** (since `v0.15.2-iptvnator.2`) — Kodi property lines apply to the _next_ list entry, so ones placed above the `#EXTINF` are buffered and attached to that item's `raw` in file order (case-insensitive prefix); other stray `#` lines outside an open item are still dropped. The DASH + ClearKey feature extracts `inputstream.adaptive.license_*` config from `item.raw`, so this delta must survive every upstream sync.

There is intentionally **no URL validation** (upstream removed it in 0.15.0): any non-empty non-`#` line after `#EXTINF` becomes the item URL. This is what fixes issue #1189 (Pluto TV JWT URLs longer than validator's 2084-char IE-era limit used to be rejected, and the stalled item index collapsed the whole playlist into one channel). `#` comment lines and unknown directives are appended to `item.raw` and never treated as URLs.

The behavioral contract is guarded by `apps/web/src/app/iptv-playlist-parser.contract.spec.ts` (jest maps the module to the real parser source) and by the fork's own test suite.

## User-Agent for URL sources

The M3U URL form accepts an optional User-Agent, including after an Auto-detect
handoff. It reuses the playlist editor's translated label and hint. Import
trims the value; an empty or whitespace-only value leaves download defaults
unchanged. A successful import stores it as `Playlist.userAgent`, so the
existing source editor can update it without a schema migration. The editor
also exposes this field for URL sources in the PWA.

Electron carries it in `ElectronBridgePlaylistFetchOptions` alongside TLS
trust options. `playlist-source.ts` sets the HTTP header on the first fetch,
startup auto-update supplies each saved playlist's UA, and explicit refresh
passes it through `PlaylistRefreshPayload` to the refresh worker. The reducer
retains the current UA when a refresh result omits it, preserving repeated
refreshes and playback defaults within the same session. Requests
retain their validated redirect, private-network, TLS, timeout, and cancellation
policies. Download errors use the shared redactor before logging.

The self-hosted PWA passes the optional `userAgent` parameter to `/parse` using
the existing registered `targetId`; the backend sets the upstream header and
returns the value in the playlist. Refresh uses the saved value through the
same proxy. This requires the matching web backend. The browser never sets a
User-Agent header itself, and this does not add custom browser playback-header
support. Electron playback retains existing per-header precedence: channel
headers override playlist defaults. File, text, and portal imports are unchanged.

Regression coverage uses synthetic UA-gated HTTP endpoints in
`playlist-auto-refresh.e2e.ts` (Electron) and `self-hosted.e2e.ts` (PWA), plus
form, renderer, download, proxy, and refresh-action unit tests.

## Initial URL Import Performance Benchmark (Electron)

The Electron E2E project has a deterministic initial-import benchmark for
10,000-, 50,000-, and 100,000-channel M3U playlists. It uses only generated
fixtures served by an ephemeral `127.0.0.1` HTTP server; provider URLs,
credentials, and playlist data must never be used. Each formal scenario runs
one warm-up, five measured iterations, and one diagnostic iteration in a fresh
Electron process and data directory:

```bash
perf_output="$PWD/dist/performance/$(date -u +%Y%m%dT%H%M%SZ)-m3u-import"
IPTVNATOR_PERF_OUTPUT_DIR="$perf_output" \
IPTVNATOR_PERF_VARIANT=baseline \
pnpm nx run electron-backend-e2e:benchmark-m3u-import
```

Use a new output directory and `IPTVNATOR_PERF_VARIANT=after` for the identical
post-change run. Formal runs require a clean worktree and record the commit,
source-state hash, runtime, and exact fixture identity. A development smoke run
uses one warm-up, one measured iteration, and one diagnostic iteration per
size:

```bash
IPTVNATOR_PERF_OUTPUT_DIR="$PWD/dist/performance/<timestamp>-m3u-import-smoke" \
IPTVNATOR_PERF_VARIANT=smoke \
IPTVNATOR_PERF_SMOKE=1 \
pnpm nx run electron-backend-e2e:benchmark-m3u-import
```

Smoke runs may use a dirty worktree and validate only the harness; they cannot
support a performance claim. If another local application owns port 9222, smoke
only may set `IPTVNATOR_PERF_CDP_PORT` to an unused loopback port; formal runs
fail closed unless CDP uses `127.0.0.1:9222`. Raw captures and JSON results stay
under the gitignored `dist/performance/` tree; preflight rejects a symbolic
link in any existing output-path component before creating artifacts. Headline
distributions contain only the five measured runs: warm-up and diagnostic
profiles are never mixed into them.

The benchmark attributes these non-additive intervals:

| Field                              | Boundary                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `dataAcquireMs`                    | loopback response acquisition                                                                          |
| `m3uParsingMs`                     | parser call                                                                                            |
| `normalizationMs`                  | parsed-item normalization                                                                              |
| `mainToRendererCloneProxyMs`       | sum of normalized import-result delivery plus the upsert and GET main-response-to-preload-success legs |
| `storeImportDispatchMs`            | renderer import dispatch                                                                               |
| `rendererToMainCloneProxyMs`       | sum of the upsert and GET preload-source-to-main-request legs                                          |
| `mainToDatabaseWorkerCloneProxyMs` | sum of the upsert and GET main-request-to-worker-receive legs                                          |
| `playlistSerializationMs`          | database-worker playlist JSON serialization                                                            |
| `sqliteWriteMs`                    | SQLite upsert, including its autocommit                                                                |
| `sqliteReadMs`                     | SQLite read of the newly persisted playlist                                                            |
| `playlistDeserializationMs`        | database-worker `parseAppPlaylist`, including playlist JSON parsing                                    |
| `databaseWorkerToMainCloneProxyMs` | sum of the upsert and GET worker-response-post-to-main-response legs                                   |
| `storePublishChannelsMs`           | renderer channel publication                                                                           |
| `angularRenderingMs`               | publication end to the terminal two-frame paint proof                                                  |

`ipcStructuredCloneProxyMs` is the explicit sum of the four directional proxy
fields. Each directional field can combine the applicable initial-result,
upsert, and `DB_GET_APP_PLAYLIST` legs. The worker stamps
`responsePostedEpochMs` after request profiling is finalized and immediately
before each response is posted; the database-worker-to-main proxy ends when
main receives that response. These fields are attribution aids, not an additive
waterfall: scheduler work and gaps can remain inside total wall time, and a
proxy can include response construction, dispatch overhead, and structured
clone work. Initial import does not create indexes; `indexAndCommitMs` is
therefore `N/A` with
`indexes-not-created-during-import;sqlite-autocommit-included-in-sqlite-write`.

Instrumentation is development-only, opt-in, fail-neutral, and count-only. It
must not scan or log playlist payloads to generate metadata. Renderer
long-task, frame-gap, and heartbeat samples are clipped to the measured
operation boundary. The external heartbeat uses a fixed 50 ms deadline grid:
each renderer delivery records every elapsed deadline, and successful shutdown
performs one terminal-clipped drain after any in-flight delivery. The capture
fails closed unless the final sample count matches the complete operation
grid, preventing coordinated omission when an import blocks several ticks.
Main capture stops only after the upsert and route-reload GET responses plus
both asynchronous preload success markers have arrived, so return-clone
attribution cannot race capture shutdown. Formal comparison fails closed after
writing raw results if exact-window renderer RSS, database-worker peak
heap/external samples, or the database worker's explicit post-GC heap is
missing or incoherent. Both initial-import database requests in every measured
run must also contain coherent event-loop delay, event-loop utilization, and
thread-CPU metrics; the validity record exposes the exact expected and valid
request counts rather than silently dropping nullable samples. An iteration
failure idempotently stops renderer timers, closes trace listeners/output, and
starts best-effort probe/session teardown without waiting on a wedged renderer
before Electron is closed. A partial capture-start failure performs the same
rollback before it escapes to the benchmark lifecycle.
Diagnostic artifacts require separate renderer, main, and database-worker CPU
profiles plus renderer/main/database-worker heap snapshots and a Chromium
trace; raw profiles remain ignored.

## Playlist Refresh And Startup Auto-Update (Electron)

Two paths re-download an M3U playlist from its original source:

- **Explicit refresh** — `PLAYLIST_REFRESH` runs in `playlist-refresh.worker.ts`, reports
  progress through `PLAYLIST_REFRESH_EVENT`, and is cancellable via
  `PLAYLIST_CANCEL_REFRESH`. Cancellation is owned by the main process: it first
  sends the cooperative cancel message, then terminates the one-shot worker
  without waiting for its event loop. The cancel IPC resolves only after the
  worker has stopped, the correlated `cancelled` event has been emitted with the
  last known phase, and a structured cancellation result is ready. That result
  crosses both Electron IPC and the context bridge unchanged;
  `PlaylistRefreshService` converts it into a renderer-local `AbortError`.
  Relying on an error created in main or preload would lose its `name` at one of
  those serialization boundaries. A cancelled refresh must not update the
  renderer store or reach SQLite.
- **Startup auto-update** — after `loadPlaylistsSuccess`, `AppComponent` sends
  `AUTO_UPDATE_PLAYLISTS` for every playlist with `autoRefresh === true`. The main
  process fulfils it in `playlist-auto-update.ts` on top of `playlist-source.ts`.

Both share one download contract, because this path is unattended and a hostile or
dead source must never stall startup (issue #931):

- Every HTTP hop uses the idle timeout `PLAYLIST_FETCH_TIMEOUT_MS` (30s, exported by
  `playlist-source.ts`). Without it a host that accepts the connection and then goes
  silent keeps the request pending forever. Redirects are followed one hop at a time,
  so each hop is bounded separately.
- Auto-update refreshes at most `AUTO_UPDATE_CONCURRENCY` (3) playlists at a time.
  Sequential refreshes let one slow host delay every remaining playlist; an unbounded
  fan-out would download and parse arbitrarily many large M3U files in the main
  process at once.
- Each playlist's failure is isolated and logged; the successful ones are still
  returned, in the order they were requested. Playlists with neither a URL nor a file
  path are skipped with a warning.
- `preserveAutoUpdatedPlaylistFields()` re-applies the user-owned fields (`_id`,
  `autoRefresh`, `favorites`, `userAgent`) onto the freshly parsed playlist.
- Playlist URLs frequently carry Xtream-style `username`/`password` query parameters,
  so refresh logging goes through `redactSensitiveData()` from
  `@iptvnator/shared/logging`.

### Refresh Cancellation Performance Regression

The Electron E2E project includes a deterministic 100,000-channel cancellation
benchmark. It uses only a loopback synthetic M3U server, performs one warm-up,
five measured runs, and one diagnostic run, and writes summaries plus raw
profiles below the gitignored `dist/performance/` directory:

```bash
perf_output="$PWD/dist/performance/$(date -u +%Y%m%dT%H%M%SZ)-m3u-refresh-cancel"
IPTVNATOR_PERF_OUTPUT_DIR="$perf_output" \
IPTVNATOR_PERF_VARIANT=after \
pnpm nx run electron-backend-e2e:benchmark-m3u-refresh-cancellation
```

The output path must be an absolute, previously unused descendant of
`dist/performance/`. A formal run fails on a dirty worktree and records the
commit, source-state hash, OS/architecture, Node, Electron, and fixture identity
in its manifest. Commit the harness first and capture `baseline` from that clean
commit; commit the production change separately, rebuild, and capture `after`
with the same harness and machine. Set `IPTVNATOR_PERF_SMOKE=1` for one measured
run during harness development; smoke runs may be dirty and must not support
before/after claims.

The target reserves and verifies CDP port 9222, freezes renderer long-task,
frame-gap, and heartbeat probes before forced post-GC heap collection, and
builds the Electron main process, renderer, and workers with optimized,
source-mapped performance configurations before enabling opt-in worker
profiling. Renderer RSS is scoped to the Playwright page's exact
`BrowserWindow` and `webContents`: every sample matches `getOSProcessId()` to
one exact `app.getAppMetrics()` PID and creation time, while responsive and
unresponsive events come only from that window. Identity changes, missing or
ambiguous process metrics, and invalid working-set values fail closed with a
raw reason and nullable RSS; summaries exclude unavailable RSS instead of
reporting zero. Formal runs also list every invalid measured capture under
`summary.validity.rendererRss` and fail after persisting the raw summary unless
all measured iterations contribute one valid exact-window RSS value. Each
worker response retains a raw
request-scoped record containing request/operation identity, received/work/flush
timestamps, thread CPU, event-loop utilization, event-loop delay, and fixed
unavailability or invalid reasons. Missing or malformed profiling metadata
still produces an outcome with its request identity, nullable metrics, and a
fixed capture-unavailable reason. A worker terminated before it can flush the
capture reports the metric as unavailable rather than zero.

Database-worker post-GC heap is not inferred from a heap snapshot. The harness
selects exactly one current-generation database worker independently of its
sampling timer, waits for any in-flight sample plus one final sample, stops the
worker CPU profile, sends an explicit-GC one-shot probe over a transferred
`MessagePort`, and takes an optional diagnostic snapshot only afterward.
Capture stop first closes a synchronous request cutoff and stops the main CPU
profile, so worker profile writes and heap snapshots cannot appear as
application stacks in `main.cpuprofile`. A database request observed after that
cutoff cannot restart worker sampling or profiling; it records
`database-worker-activity-after-cutoff` and invalidates the post-GC value.
Worker artifacts include a stable isolate ordinal in their filename so an
invalid multiple-worker capture cannot overwrite another isolate's profile.
The raw heap and unavailability reason form a strict XOR; playlist workers
terminated during cancellation report `worker-force-terminated-before-gc`
instead of a snapshot-derived heap. Warm-up and measured cancellation invoke
the real worker termination before best-effort finalization so profiling cannot
delay headline acknowledgement metrics. The separate diagnostic iteration
stops its CPU profile before termination; its timings are excluded from
headline distributions. That pre-termination drain is bounded; timeout
invalidates the profile and worker termination still proceeds. Late
termination completions are generation-gated so they cannot mutate a reused
record or append timeline events after an atomic capture rollover. The
benchmark fails closed unless the diagnostic iteration observed cancellation,
its profile is inside the iteration directory and parses with non-empty nodes
and samples, and the dying worker has no heap snapshot.

Headline worker memory distributions include every matching isolate and
exclude only nullable unavailable values. This aggregation is not used as a
validity shortcut. Runs that reach database persistence must independently
contain exactly one database worker with a coherent numeric post-GC heap.
Parsing cancellation happens before the renderer dispatches persistence, so a
run with no database request is explicitly `N/A:
operation-cancelled-before-database-phase`, not a missing capture. Any database
activity in a run that observed the cancellation effect is unrelated
contamination and invalidates the run. Duplicate, busy, late, timed-out, or
malformed captures are listed under
`summary.validity.databaseWorkerPostGc` and invalidate the benchmark. The
benchmark writes `manifest.json` and `summary.json` first, then fails the formal
run so the raw evidence remains available without supporting a before/after
claim. A formal cancellation run also requires the cancellation effect in every
measured iteration. Database-worker values are comparable only when every
measured iteration reaches that phase and has one valid capture.

Seed setup runs inside its own capture generation. The harness requires an
observed seed database request, a completed playlist upsert, and no pending
request, then persists that generation as `seed-main-capture.json`. Main
capture finalization validates one idle database worker with a coherent
explicit-GC result and atomically rolls the clean cutoff into the measured
generation before yielding. A request before rollover remains late and rejects
the transition; a request after rollover belongs to the measured generation.
This prevents seed writes or an unobserved stop/start gap from crossing into
measured main RSS, worker peaks, or profiles; generation selection also
excludes the seed worker record. Since the production M3U database payload
deliberately omits the refresh operation ID, the benchmark correlates only a
valid preload `start` marker to the exact database operation and playlist. A
missing or ambiguous marker leaves the raw operation ID `null` with a fixed
reason; it does not infer identity from timing alone.

Headline worker fields named `*WorkerRequest*` are distributions of individual
request metrics. In particular, request p95/p99 distributions are not presented
as an operation-wide or process-wide percentile, and database request
percentiles are never collapsed with `Math.max`. Diagnostic CPU profiles, heap
snapshots, and Chromium traces are excluded from the five-run headline
distributions.

### Reporting The Auto-Update Result

Because auto-update isolates failures, it must also report them — otherwise a
dropped playlist is indistinguishable from a successful refresh. `autoUpdatePlaylists()`
returns `AutoUpdatePlaylistsResult`
(`libs/shared/interfaces/src/lib/playlist-auto-update.interface.ts`): the refreshed
`playlists` plus one `outcome` per requested playlist, in request order.

| Outcome status | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `updated`      | Source fetched/read and parsed; playlist is in `playlists`                      |
| `failed`       | Source unreachable, unreadable or unparsable                                    |
| `skipped`      | Playlist has neither a URL nor a file path, so there is nothing to refresh from |

`ElectronService` dispatches `updateManyPlaylists` with the refreshed playlists only,
logs the titles of unresolved playlists, then derives the snackbar from those outcomes
(`apps/web/src/app/services/auto-update-playlists-feedback.ts`):
`AUTO_REFRESH_UPDATE_SUCCESS` when everything updated,
`AUTO_REFRESH_UPDATE_PARTIAL` / `AUTO_REFRESH_UPDATE_FAILED` (error styling,
dismissable) when some or all playlists failed, and `AUTO_REFRESH_UPDATE_SKIPPED` when
the only unrefreshed playlists lacked a source. A batch that both failed and skipped
uses `AUTO_REFRESH_UPDATE_PARTIAL_WITH_SKIPPED`, because the plain partial message names
only `updated`/`total`/`failed` and would leave the skipped playlists as an unexplained
remainder. Every count the user sees must reconcile with `total`, and success is never
reported unconditionally — a silently dropped playlist used to look like a successful
refresh.
`playlist-auto-refresh.e2e.ts` guards this by restarting the app against a killed
playlist server.

## State Management (libs/m3u-state/)

### State Structure

```typescript
// libs/m3u-state/src/lib/state.ts
interface PlaylistState {
    active: Channel | undefined; // Active channel being played
    activePlaybackUrl: string | null;
    activeEpgProgram: EpgProgram | undefined;
    currentEpgProgram: EpgProgram | undefined;
    epgAvailable: boolean;
    channelsLoading: boolean; // Route still resolving channel data
    channels: Channel[]; // All channels from current playlist
    playlists: PlaylistMetaState; // Playlist metadata (entity adapter)
}

// libs/m3u-state/src/lib/playlists.state.ts
interface PlaylistMetaState extends EntityState<PlaylistMeta> {
    selectedId: string;
    allPlaylistsLoaded: boolean;
    selectedFilters: string[]; // 'm3u' | 'xtream' | 'stalker'
}
```

`PlaylistMeta` is the persisted playlist-facing subset of the playlist entity.
For M3U playlists it now also carries `hiddenGroupTitles?: string[]`, which is
used by the groups view to remember which group titles the user has hidden.

### Actions

| Action Group         | Actions                                                                                | Purpose                        |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| **PlaylistActions**  | `loadPlaylists`, `addPlaylist`, `removePlaylist`, `parsePlaylist`, `setActivePlaylist` | Playlist CRUD                  |
| **ChannelActions**   | `setChannels`, `setActiveChannel`, `setAdjacentChannelAsActive`                        | Channel selection & navigation |
| **EpgActions**       | `setActiveEpgProgram`, `setCurrentEpgProgram`, `setEpgAvailableFlag`                   | EPG state                      |
| **FavoritesActions** | `updateFavorites`, `setFavorites`, `hydrateFavorites`                                  | Favorites management           |
| **FilterActions**    | `setSelectedFilters`                                                                   | Playlist type filtering        |

### Key Selectors

```typescript
// Channel selectors
selectActive; // Current playing channel
selectChannelsLoading; // Channel list loading flag
selectChannels; // All channels array
selectFavorites; // Favorite channel URLs

// Playlist selectors
selectAllPlaylistsMeta; // All playlists
selectActivePlaylistId; // Selected playlist ID
selectActivePlaylist; // Active playlist object
selectPlaylistTitle; // Title with "Global favorites" fallback

// EPG selectors
selectIsEpgAvailable; // EPG data available flag
selectCurrentEpgProgram; // Current playing program
```

## Channel List Container

**Location**: `libs/ui/components/src/lib/channel-list-container/`

### Component Architecture

```
channel-list-container/
├── channel-list-container.component.ts   # Parent - shared state coordinator
├── channel-list-container.component.html
├── channel-list-container.component.scss
│
├── all-channels-view/                     # Virtual scroll + debounced search
│   ├── all-channels-view.component.ts
│   ├── all-channels-view.component.html
│   └── all-channels-view.component.scss
│
├── groups-view/                           # Expansion panels + infinite scroll
│   ├── groups-view.component.ts
│   ├── groups-view.component.html
│   └── groups-view.component.scss
│
├── favorites-view/                        # Drag-drop reordering
│   ├── favorites-view.component.ts
│   ├── favorites-view.component.html
│   └── favorites-view.component.scss
│
├── recent-view/                           # Recently viewed channels
│   ├── recent-view.component.ts
│   ├── recent-view.component.html
│   └── recent-view.component.scss
│
└── channel-list-item/                     # Individual channel display
    ├── channel-list-item.component.ts
    ├── channel-list-item.component.html
    └── channel-list-item.component.scss
```

### Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│              ChannelListContainerComponent                    │
│                      (Parent)                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Shared State (Signals):                                │  │
│  │  - channelEpgMap: Map<string, EpgProgram>              │  │
│  │  - progressTick: number (30s interval)                 │  │
│  │  - shouldShowEpg: boolean                              │  │
│  │  - favoriteIds: Set<string>                            │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                   │
│     ┌─────────────────────┼─────────────────────┐            │
│     ▼                     ▼                     ▼            │
│ ┌─────────┐         ┌──────────┐         ┌───────────┐      │
│ │   All   │         │  Groups  │         │ Favorites │      │
│ │Channels │         │   Tab    │         │    Tab    │      │
│ │  Tab    │         │          │         │           │      │
│ └────┬────┘         └────┬─────┘         └─────┬─────┘      │
│      │                   │                     │             │
│      └───────────────────┴─────────────────────┘             │
│                          │                                   │
│                          ▼                                   │
│              (channelSelected) output                        │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           ▼
                    Store Dispatch
              ChannelActions.setActiveChannel
```

### Loading States

- `M3uWorkspaceRouteSession` owns route-driven channel loading for the player/sidebar routes: `all` and `groups`.
- The route session sets `channelsLoading` before `getPlaylist()` resolves and clears it when `ChannelActions.setChannels` lands.
- The route session dispatches reducer-only `FavoritesActions.hydrateFavorites`
  after that persisted read. Hydration must not use the persistence-bearing
  `setFavorites` action: doing so reads and rewrites the complete M3U payload
  again just to store favorites that already came from SQLite.
- `ChannelListContainerComponent` now renders a dedicated skeleton state while `channelsLoading` is true.
- `ChannelListContainerComponent` no longer clears `channels` on destroy; route/session code is the single owner of shared list lifecycle during navigation.
- The dedicated `/workspace/playlists/:id/favorites` and `/workspace/playlists/:id/recent` collection routes do not drive the shared sidebar channel list; they default to the `playlist` scope so rail links always open the current playlist view, not the last persisted global scope.
- M3U favorites and recent collection rows preserve their full `Channel` payload on unified live items so the shared live list can open the read-only channel details context menu without reconstructing partial channel data.
- Recent live rows support context-menu removal in the unified all-playlists view; the row-level delete shortcut remains available on playlist-scoped M3U recent rows.
- Empty playlists and empty search results are no longer conflated:
    - loading: skeletons
    - empty source: no channels in the playlist after loading completes
    - empty search: no matches within an already loaded playlist

### Group Visibility Management

- `GroupsViewComponent` owns the M3U-only "Manage groups" action and dialog in
  `libs/ui/components/src/lib/channel-list-container/groups-view/`.
- The groups rail header also owns an inline search toggle that filters the
  currently visible groups without mutating the workspace-level route search
  term used by the broader channel views.
- The dialog operates on the full grouped dataset, while the left rail and
  channel pane render only groups whose titles are not listed in
  `hiddenGroupTitles`.
- `ChannelListContainerComponent` reads `hiddenGroupTitles` from the active M3U
  playlist metadata and passes it into the groups view. Saving dialog changes
  dispatches `PlaylistActions.updatePlaylistMeta`.
- `PlaylistsService.updatePlaylistMeta()` persists `hiddenGroupTitles` into the
  stored playlist payload, and M3U refresh/update flows preserve the existing
  value when refreshed playlist data omits the field.
- The groups route keeps the manage action reachable even when every group is
  hidden by separating "playlist has no groups" from "no visible/search-matching
  groups" empty states.

### Channel Sorting

- `AllChannelsViewComponent` owns sorting for the all-channels list and
  persists the selected mode under `m3u-all-channels-sort-mode`.
- `GroupsViewComponent` owns sorting for the selected group's channel pane and
  persists the selected mode under `m3u-groups-channel-sort-mode`.
- Both views support three modes: `Playlist Order`, `Name A-Z`, and `Name Z-A`.
  `Playlist Order` is the default and preserves the original channel order from
  the M3U playlist.
- Sorting is applied after the current search filter and before virtual-scroll
  rendering. Playlist order avoids cloning the full list when no search term is
  active.

### ChannelEpgMetadata Pattern

For performance optimization, EPG data is kept in a side-car map instead of
being cloned onto every channel (the older `EnrichedChannel` pattern that
spread-cloned every channel on every ~30 s tick was removed —
`channel-list-container/epg-enrichment.util.ts`):

```typescript
// libs/ui/components/src/lib/channel-list-container/epg-enrichment.util.ts
interface ChannelEpgMetadata {
    epgProgram: EpgProgram | null | undefined;
    progressPercentage: number; // Pre-computed by parent
}
```

The renderer now keeps two lookup maps for M3U collection views:

- `channelEpgMap` for current-program preview data
- `channelIconMap` for XMLTV channel icon fallback data

Logo resolution is runtime-only and follows this rule:

1. playlist `tvg-logo`
2. matched XMLTV `<channel><icon src="...">`
3. generic `live_tv` fallback in the list item component

EPG lookup keys use the same precedence in both program and icon paths:

1. `tvg-id`
2. `tvg-name`
3. channel name

All four collection tabs (all-channels, groups, favorites, recent) share a single
EPG-enrichment implementation in `channel-list-container/epg-enrichment.util.ts`,
fed the same `channelEpgMap`/`channelIconMap` from the container — there is no
per-tab EPG logic:

- `calculateEpgProgress(program, now?)` — clamped, **rounded** progress in
  `[0, 100]`, guarded against missing/invalid timestamps and zero-length
  programmes (never returns `NaN`).
- `resolveChannelEpgProgram(channel, channelEpgMap)` — the current programme for
  a channel by its lookup key (used by the per-item recent view).
- `buildChannelEpgMetadataMap(channelEpgMap, now?)` — the side-car
  `key → {epgProgram, progressPercentage}` map (used by all-channels/groups/
  favorites). Callers read their `progressTick()` signal first so the computed
  re-runs on the ~30s tick.

### EPG Panel (Timeline & List views)

The programme guide under the player renders in one of **two interchangeable
views**, chosen by the **`epgViewMode`** setting (`'timeline'` default, or
`'list'`; Settings → EPG → _Guide view_):

- **Timeline** — a horizontal **ribbon** (`app-epg-timeline`,
  `libs/ui/epg/src/lib/epg-timeline/`).
- **List** — a vertical, single-day **programme list** (`app-epg-list-view`,
  `libs/ui/epg/src/lib/epg-list-view/`) with a prev/today/next stepper.

Both are shared by all four live surfaces: the M3U video player, the unified live
tab, and the Xtream and Stalker live-stream layouts (replacing the former
vertical `app-epg-list` / `app-epg-view`). `EpgListViewComponent` mirrors
`EpgTimelineComponent`'s input/output contract **1:1**, so each host swaps them
with a plain `@if (epgViewMode() === 'list') { <app-epg-list-view … /> } @else {
<app-epg-timeline … /> }` — identical bindings in both branches. Hosts read
`epgViewMode` from `SettingsStore` (a signal), so flipping the setting swaps the
panel live. The setting flows end-to-end (`Settings.epgViewMode` →
`DEFAULT_SETTINGS` → `SettingsStore`/`StorageMap` → the segmented control in
`settings-epg-section`) and needs no backend change. The control is
**Electron-only in practice** — the EPG settings section (and the form control)
is gated behind `supportsEpg`, which is false in PWA; there the stored value
simply stays at the `'timeline'` default.

### EPG display offset

EPG display times also support a global **`Settings.epgOffsetMinutes`**
correction (Settings → EPG → _EPG time offset_; whole minutes, clamped to ±720,
default 0) for guides whose provider labels programme times with the wrong
timezone. It is **display-only**: parsed XMLTV values, SQLite rows, catch-up
URLs and recording snapshots keep the provider's own times, so changing it
never needs a guide refresh.

The contract lives in `libs/shared/interfaces/src/lib/epg-display-offset.util.ts`
and has two equivalent forms — **display** (`epgDisplayTimeMs`: shift a
programme by `+offset`, then compare with wall-clock now or format it) and
**clock** (`epgProviderClockMs`: express now as `now − offset` and compare with
the raw programme times). Every consumer applies exactly one form per
comparison; applying both doubles the shift.

- **Display form** — everything in `ui/epg` (`getProgramTimeMs` feeds the
  timeline geometry, list rows, date keys, dedup/equality, the collapsed
  header's range and progress) receives the offset as the `offsetMinutes`
  input from each host; `app-channel-list-item`, the dashboard time range and
  the recording detail shift their labels the same way. The programme dialog
  and the programme guide are opened imperatively, so they read
  `SettingsStore.resolvedEpgOffsetMinutes` themselves.
- **Clock form** — every "currently airing" decision, so the row picked as
  "now" is the one the UI renders as "now": the batched
  `GET_CURRENT_PROGRAMS_BATCH` lookup takes an explicit `nowMs`
  (`EpgService` passes its provider clock and tags its 60 s cache with the
  offset; `ChannelListContainerComponent` refetches when the setting changes),
  the channel-list progress bars, `XtreamStore.currentEpgItem`, the Xtream and
  Stalker sidebar previews (re-picked on a change; whenever the offset is
  non-zero the Xtream preview queue and the collection resolver cut their
  window out of the full guide at the provider clock with
  `windowEpgItemsAtProviderClock`, because `get_short_epg` always starts at
  the provider's own "now" and cannot reach the programme actually on air; a
  changed setting drops the queue's cut windows, cached empty results and
  failure cooldowns as one, and a request that completes after the change is
  retired and re-queued whatever its outcome), the M3U player's
  `setCurrentEpgProgram` mirror and recording-start snapshot, the unified
  collection resolver (`StreamResolverService.loadEpgForItems`), the dashboard
  live cards' progress, and the recording stop-time overlap
  (`filterRecordingProgramsOverlap`).

Deliberately unshifted: catch-up URLs (built from the raw `programActivated`
programme), recording snapshots (provider data; only their display is
shifted), and the remote-control payload. Known limit: Stalker's bulk
`get_epg_info` and `get_short_epg` also start at the portal's "now" and the app
uses no past-reaching Stalker endpoint, so with a positive offset a Stalker
sidebar row whose true programme lies in the portal's past shows no preview
rather than a wrong one; under a negative offset the short-EPG window is widened
instead (`shortEpgWindowSize`, 15-minute slots, capped at 50 — the sidebar queue,
the active channel's panel fallback and the collection resolver all use it) so
it still reaches the programme on air, and preview cache entries are tagged with
the offset they were fetched for. Like the view mode, the control is Electron-only in practice —
it sits behind `supportsEpg`.

Both components stay presentation-focused; the reusable, view-agnostic pieces
(shared by the timeline and the list) are split out and re-exported from
`@iptvnator/ui/epg`:

- `epg-timeline.utils.ts` (axis/blocks/date helpers) + `epg-timeline-render.util.ts`
  (short-programme tiers, grouping, zoom bounds) — the ribbon geometry.
- `epg-archive.util.ts` — catch-up gating (`isWithinArchiveWindow`,
  `canCatchUpProgramme`, `epgDialogActionFor`) off `when`/`startMs` primitives.
- `epg-summary.util.ts` — `EpgTimelineSummary` + collapsed-summary progress maths
  (`summaryProgress` / `summaryMinutesLeft` / …).
- `epg-programme-dialog.service.ts` — `EpgProgrammeDialogService`, opens the
  shared details dialog and returns the chosen `live` / `timeshift` action.
- `epg-timeline-scroll.controller.ts` — `TimelineScrollController` (ribbon
  scrolling + channel-select auto-focus); timeline-specific, kept out of the
  component so it stays under the line ceiling.

The **list view** (`epg-list-view/`) composes those same shared modules — it does
**not** duplicate classification or gating logic. It reuses `classifyTimelineWhen`
/ `hasProgramsForDateKey` / `nearestDateKeyWithPrograms`, `epg-archive.util`,
`epg-summary.util`, the `epg-date` helpers, `EpgProgrammeDialogService`, and the
shared `app-epg-timeline-empty-state` — and drops all ribbon geometry, zoom, and
horizontal scroll. It filters the loaded window to the selected day (overlap-based,
matching `hasProgramsForDateKey`), sorts, and deduplicates via a pure
`buildEpgListRows` (`epg-list-view.utils.ts`); renders each row through the dumb
`app-epg-list-view-row`; and delegates its own vertical auto-focus + sticky
"now" strip to `EpgListScrollController` (`epg-list-scroll.controller.ts`). Render
states, the collapsed inline summary, the date stepper, catch-up/timeshift
activation, and the details dialog behave identically to the timeline. Both
views also carry the optional `guideAvailable` input and `openGuide` output:
the M3U host binds them in both branches, so the programme guide's Guide
action is reachable whichever view the setting selects.

- **One channel, preloaded window.** The panel always shows a single channel.
  Each provider returns a multi-day window in roughly one call (M3U
  `GET_CHANNEL_PROGRAMS`; Stalker `get_epg_info`; Xtream `get_simple_data_table`),
  so the whole ribbon is rendered up front and day navigation is **scroll within
  the loaded window** — no per-day lazy fetch. The date stepper / "Now" jump
  scroll the ribbon; the day label follows the scroll position.
- **Auto-focus on channel select.** When a channel's EPG (re)loads or the ribbon
  (re)mounts, the timeline centres the **currently airing programme** in the
  viewport **instantly** (`behavior: 'auto'`, no scroll animation) — selecting a
  channel lands on "now" without the user pressing the Now button. The jump is
  deduped by programme-set identity (`programsFocusKey`), so the 30s now-tick,
  zoom changes, or a host re-emitting the same data never re-jump the viewport;
  switching channels (or returning after viewing an empty-day channel) re-centres.
  The explicit "Now" button still animates (`behavior: 'smooth'`) since it is a
  deliberate user action. See `TimelineScrollController.maybeAutoFocus` /
  `focusCurrentProgram` in `epg-timeline-scroll.controller.ts`.
- **Controlled component.** `app-epg-timeline` is presentation-only: it takes
  `programs`, `archivePlaybackAvailable`, `archiveDays`, `activeProgram`,
  `isLivePlayback`, `loading`, `emptyReason`, `selectedDate`, `collapsed`,
  `summary` and emits `programActivated`, `returnToLive`, `selectedDateChange`,
  `openEpgSettings`, `retry`, `collapsedChange`. The host layout owns playback,
  persists the collapse state (`live-epg-panel-state` in localStorage), and (for
  the M3U player) the `EpgActions.setCurrentEpgProgram` / `setEpgAvailableFlag`
  / `setActiveEpgProgram` dispatches. The timeline owns the **single** panel
  bar — collapse chevron + channel name on the left, return-to-live / jump /
  date stepper on the right — and the collapsed inline summary; the former
  `app-live-epg-panel` wrapper has been removed from the live layouts.
- **Dynamic bar subtitle.** Under the channel name the bar shows the
  **now-playing programme title** when expanded and a `summary` exists
  (`.epg-timeline__subtitle`) — readable title style, not the uppercase mono
  label. During timeshift it switches to the archive programme with a `history`
  icon and cyan accent (`.is-arch`). It falls back to the static `sourceLabel`
  (`Timeline` / `Xtream` / `Stalker Portal`) only when collapsed or when the
  channel has no programme.
- **State-aware toolbar controls.** The right-side controls are **hidden** (not
  disabled) when they cannot act, so a channel with no EPG shows a clean bar
  instead of dead controls: `showRibbonControls()` gates "Now" + zoom to the
  `ribbon` state only (nothing to jump to or zoom otherwise), and
  `showDateStepper()` keeps the date stepper for `ribbon` **and** `empty-day`
  (the only states where the channel has EPG on some day), hiding it for the
  no-EPG-anywhere states and while loading. Return-to-live is a playback control
  (`!isLivePlayback()`) and is independent of EPG state.
- **State-driven affordances.** Blocks are coloured past / now / future, with a
  red "now" playhead. Catch-up "Watch" appears on past blocks — and as a
  start-over replay button on the currently-airing block — only when
  `archivePlaybackAvailable` (Xtream `tv_archive`, M3U `catchup-*`); Stalker is
  schedule-only (dimmed past + a notice, no false buttons). The "i" button opens
  the shared `app-epg-item-description` dialog with a state-aware action.
- **Empty / error states.** `emptyReason` selects one of six states
  (`loading` skeleton, `empty-day`, `channel-unmapped`, `provider-no-epg`,
  `m3u-needs-setup`, `error`) via `app-epg-timeline-empty-state`. Icon tone is
  neutral for info, blue for actionable, red for errors; an action button is
  shown only when one really exists. The empty-state host `flex: 1`-fills the
  area below the toolbar and centres within **that** (compact icon/title/sub),
  rather than a fixed `min-height` that used to overflow the compact inline panel
  and push the icon/text — and the `empty-day` action buttons — below the visible
  edge. `empty-day` itself is decided by `hasProgramsForDateKey`, which is
  **overlap-based** (a programme counts for a day when `[start, stop)` intersects
  it, end-exclusive) — so a film that starts the previous evening and runs past
  midnight still keeps the ribbon on "today" while it airs, matching the sidebar
  (which matches by "airing now"); a start-date-only check used to drop to
  `empty-day` after midnight even though the programme was on air.
- **Short-programme strategy.** In a proportional ribbon a 5-minute programme
  would be an unreadable sliver, so `buildTimelineRenderItems`
  (`epg-timeline.utils.ts`) applies a layered fix: (A) a **minimum block width**
  (`TIMELINE_MIN_BLOCK_WIDTH_PX`); (B) width-adaptive **content tiers** —
  `wide` (title + time, 3-line clamp) → `med` (one-line ellipsis) → `narrow`
  (**vertical title**, no time) → `micro` (just a marker); (C) a **hover/focus
  popover** revealing the full title + time + description for any non-`wide`
  block (it flips above the block when the panel is near the screen bottom);
  (D) a px-per-minute **zoom** (tick density adapts via
  `timelineTickStepForScale`): the toolbar's icon-only zoom button cycles
  three presets — day overview (`1`) → by hour (`1.75`, the default) →
  detailed (`3.4`, the scale a group chip expands to) — snapping a
  wheel-tuned scale to its band's successor (`TIMELINE_ZOOM_LEVELS`,
  `nextTimelineZoomScale`), while Ctrl/⌘ + wheel (and trackpad pinch) over
  the ribbon zooms continuously around the cursor within
  `TIMELINE_ZOOM_MIN..MAX` and `preventDefault`s so Chromium never page-zooms
  the same gesture; the current level lives in the tooltip/`aria-label` and
  a `data-zoom-level` attribute; and (E) **grouping** of ≥4 consecutive short
  (<10 min) programmes into one dashed "N short" chip when zoomed out
  (`scale < TIMELINE_GROUP_ZOOM_MAX`), expanded by clicking it. The ribbon
  canvas lives in the child `app-epg-timeline-track`; the parent owns the
  scroller, toolbar (icon-only "Now" + zoom buttons, both labelled through
  tooltip + `aria-label`, so the channel/programme heading takes every pixel
  the fixed-width controls leave) and state.
- **Panel height & titles.** Block titles wrap onto as many lines as the card
  height allows and are clipped (not single-line ellipsis); the foot ("ON NOW"
  tag / "Watch") stays pinned at the bottom. With an inline player the guide is
  a compact panel (`.epg.epg--inline` → `flex: 0 0 clamp(180px, 36vh, 264px)`
  in `_portal-layout.scss`) so the player stays dominant; with an external
  player the guide keeps `flex: 1` and fills the whole content area. In **list
  mode** the hosts also set `.epg--list`, which raises only the inline clamp
  (`--epg-inline-height: clamp(280px, 46vh, 430px)`) — vertical rows need more
  height than the ribbon; the timeline height is unchanged, and the collapsed
  56px clamp still wins because the modifier sets just the CSS variable.
- **Wide-tier description preview.** When a block is the `wide` tier (rendered
  width ≥ `132px`, i.e. long programmes and/or zoomed in) **and** the programme
  has a `desc`, a dimmed (`--text-secondary`) preview of the description renders
  under the title (`.epg-timeline__block-desc`). Gated to `wide` only, so
  narrower cards and the moderate default zoom stay clean; the full description
  still lives in the hover popover for every tier. To avoid ugly mid-line cuts,
  wide-tier `time`/`title`/`desc` use `flex-shrink: 0` so flexbox can never
  shrink them to a fractional height: each self-clips on **whole lines** with an
  ellipsis via `-webkit-line-clamp` (title ≤ 2 lines, description ≤ 3) instead of
  being cut mid-line by the parent's `overflow: hidden`. At the usual inline
  panel height the title + 3-line preview fit without the parent clipping at all.

### Playlist-Declared EPG Sources

Some M3U providers declare XMLTV sources in the playlist header instead of
requiring the user to add them in Settings. The importer extracts EPG URLs from
`#EXTM3U` header attributes `x-tvg-url`, `url-tvg`, and `tvg-url` in
`@iptvnator/shared/m3u-utils`, then stores the normalized, deduplicated
candidates on `Playlist.detectedEpgUrls`.

`Playlist.epgUrls` is the enabled playlist-scoped subset used for automatic
import and lookup. Two additional lists preserve user edits:

- `Playlist.manualEpgUrls` stores URLs the user explicitly added for this
  playlist, including detected catalog URLs the user manually enabled.
- `Playlist.disabledEpgUrls` stores detected URLs the user removed from this
  playlist so playlist refreshes do not silently re-enable them.

- Up to five detected URLs are enabled automatically.
- Larger header lists are treated as provider catalogs. The importer keeps all
  candidates in `detectedEpgUrls`, but auto-enables only recommended URLs whose
  `guides/<country>` path matches playlist hints such as `tvg-country` or the
  country suffix in `tvg-id` (`channel.ua`). Language hints are used only when no
  country hints are present. If no recommendation can be made, the importer
  falls back to the first five detected URLs so generic provider catalogs still
  produce usable local EPG sources instead of silently enabling none.
- Recommendations are capped so a malformed or global provider list cannot
  start dozens of XMLTV downloads during playlist import.

These URLs are playlist-scoped by default:

- `libs/m3u-state` auto-fetches enabled `epgUrls` when M3U playlists are
  loaded, added, or refreshed, using the same EPG progress/import pipeline as
  Settings-managed XMLTV URLs. Before fetching, playlist URLs already present in
  global Settings are filtered out so the same XMLTV URL is not downloaded
  twice. Within a running session, the effect remembers the last fetchable URL
  set per playlist and only re-fetches when that URL set changes; metadata-only
  edits such as renaming a playlist or hiding groups do not re-download local
  EPG sources. When the local URL set expands, only newly added fetchable URLs
  are downloaded; disabling or removing one source does not re-download the
  remaining sources. Explicit playlist refreshes bypass that session fetch key
  and re-download the current fetchable local EPG URLs. Partial metadata updates
  that omit `epgUrls` preserve the previous fetch key, while an explicit empty
  `epgUrls` list clears it. Add/update metadata effects trigger playlist-local
  EPG fetches only after the playlist persistence call succeeds, and metadata
  updates that do not include any EPG source fields do not evaluate the fetch
  plan.
- The Electron EPG database stores `source_url` on imported programs so current
  program lookups can ask for the active playlist's EPG sources first. Existing
  databases backfill this column from `epg_channels.source_url` once, in bounded
  batches, after the scoped indexes are created. When multiple EPG files reuse
  the same XMLTV channel id, the channel row keeps its original `source_url`
  attribution instead of being overwritten by the last imported source; program
  scoping remains source-specific through `epg_programs.source_url`.
- `ChannelListContainerComponent` enables EPG rows when either global settings
  URLs or the active M3U playlist has `epgUrls`. EPG availability refreshes are
  debounced so several playlist-local XMLTV imports completing close together
  coalesce into one visible-channel EPG refresh. The visible channel list also
  refreshes when the effective EPG source context changes, so a playlist whose
  `epgUrls` arrive after the channels are rendered does not wait for the next
  periodic refresh before showing current programs. A successful EPG import
  clears current-program lookup caches before publishing availability, so an
  early "no current program" lookup cannot mask freshly imported rows until the
  TTL expires.
- Scoped lookups fall back only to Settings-managed EPG URLs for channels
  missing from the playlist-declared source. Playlist-local sources from other
  playlists are not treated as global fallback sources. Single-channel current
  program lookups include the source URL set in their cache and in-flight keys,
  so playlist-local and global lookups deduplicate without reusing the wrong
  source scope. Batch current-program lookups use the same source-scoped
  per-channel TTL cache and order-insensitive in-flight batch deduplication
  before reaching IPC; missing exact channel-id matches are resolved with batched
  id/display-name candidate queries rather than a per-channel fallback loop.
  Those candidate queries match the **raw key case-sensitively** as well as via
  `LOWER()`: SQLite's `LOWER()`/`COLLATE NOCASE` only fold ASCII, so for non-ASCII
  names (Cyrillic, Greek, …) a `LOWER()`-only match would miss channels whose
  M3U name and EPG `display_name` share the same casing — the raw exact match
  keeps parity with the timeline's single-channel exact-display-name lookup, and
  the JS `resolveChannelMetadataCandidate` then folds with full-Unicode
  `toLowerCase()`. The "airing now" window is compared with timezone-aware SQLite
  `datetime()` on both sides (`EpgQueryService.isAiringAt`), not raw string
  comparison: stored EPG timestamps often carry an offset (e.g. `+03:00`) while
  `now` is built as UTC (`…Z`), so a lexical compare would be wrong by the offset
  and surface a stale (or no) current programme. After the scoped + legacy
  candidate queries, any candidate that resolved by id/display-name but still has
  no in-scope current programme is retried once **unscoped** (all sources),
  mirroring the timeline's own unscoped `getChannelPrograms` lookup. This keeps
  the channel-list "now" line consistent with the timeline when a channel's row
  and its programmes carry different `source_url` values (shared XMLTV ids across
  multiple imports), where the channel resolves in scope but its programmes are
  tagged with a source that is not currently enabled.
  When upgrading an existing database whose historical programs have no
  `source_url`, scoped program and metadata queries try those legacy unscoped
  rows only after the requested source scope returns no result, so old EPG data
  remains visible without taking precedence over freshly imported scoped data.
  Channel metadata lookups use the same playlist-first, Settings-managed
  fallback strategy so icons and display names can still come from global EPG
  sources when the playlist-local guide only supplies programs. If multiple EPG
  sources reuse the same XMLTV channel id, channel metadata and display-name
  fallback lookups treat a channel as source-scoped when either the channel row
  itself or matching programs are tagged with the requested `source_url`.
- The playlist details dialog shows enabled EPG URLs with explicit actions to
  refresh, remove, or add a source to global Settings. It also allows adding one
  or more manual playlist-local sources and indicates when additional detected
  candidates were not auto-enabled. Removing a playlist-local source also
  clears programs tagged with that `source_url` and prunes only orphaned channel
  rows for that same source before saving the playlist metadata change, so a
  failed cleanup keeps the source enabled and visible. Shared XMLTV channel ids
  from other sources are preserved. Detected playlist sources are not silently
  promoted to global settings.

### Performance Optimizations

| Optimization                  | Implementation                                            |
| ----------------------------- | --------------------------------------------------------- |
| **Virtual Scroll**            | CDK virtual scroll for 90,000+ channels                   |
| **Computed Signals**          | `enrichedChannels` computed signal replaces template pipe |
| **Debounced Search**          | 300ms debounce on search input                            |
| **Global Progress Tick**      | Single 30s interval instead of per-item intervals         |
| **OnPush Change Detection**   | All components use OnPush                                 |
| **Infinite Scroll in Groups** | IntersectionObserver loads 50 channels at a time          |
| **Memoized Group Enrichment** | `enrichedGroupChannelsMap` computed signal                |

### Tab Components

#### AllChannelsViewComponent

- **Inputs**: `channels`, `channelEpgMap`, `channelIconMap`, `progressTick`, `shouldShowEpg`, `itemSize`, `activeChannelUrl`, `favoriteIds`
- **Outputs**: `channelSelected`, `channelPlaybackRequested`, `favoriteToggled`, `sidebarToggleRequested`
- **Features**: Workspace search, persisted channel sorting, virtual scrolling, no-results placeholder

#### GroupsViewComponent

- **Inputs**: Same as AllChannelsViewComponent + `groupedChannels`
- **Outputs**: `channelSelected`, `channelPlaybackRequested`, `favoriteToggled`, `hiddenGroupTitlesChanged`, sidebar sizing outputs
- **Features**: Resizable groups rail, local group search, group visibility management, persisted selected-group channel sorting

#### FavoritesViewComponent

- **Inputs**: `favorites`, `channelEpgMap`, `channelIconMap`, `progressTick`, `shouldShowEpg`, `activeChannelUrl`
- **Outputs**: `channelSelected`, `channelPlaybackRequested`, `favoriteToggled`, `favoritesReordered`
- **Features**: Drag-and-drop reordering with CDK DragDrop, read-only channel details context menu

#### RecentViewComponent

- **Inputs**: recent channels, `channelEpgMap`, `channelIconMap`, `progressTick`, `shouldShowEpg`, `activeChannelUrl`
- **Outputs**: `channelSelected`, `channelPlaybackRequested`, `removeRecent`
- **Features**: Read-only channel details context menu, row-level and context-menu removal

## EPG Integration

### EpgService (`@iptvnator/epg/data-access`)

```typescript
class EpgService {
    // Fetch EPG for multiple URLs
    fetchEpg(urls: string[]): void;

    // Get programs for a channel
    getChannelPrograms(channelId: string): void;

    // Batch fetch current programs
    getCurrentProgramsForChannels(
        channelIds: string[],
        options?: { sourceUrls?: string[] }
    ): Observable<Map<string, EpgProgram>>;

    // Batch fetch XMLTV channel metadata for logo fallback
    getChannelMetadataForChannels(
        channelIds: string[],
        options?: { sourceUrls?: string[] }
    ): Observable<Map<string, EpgChannelMetadata | null>>;

    // Observables
    epgAvailable$: Observable<boolean>;
    currentEpgPrograms$: Observable<EpgProgram[]>;
}
```

### EPG Components

| Component                     | Purpose                                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EpgTimelineComponent`        | Horizontal timeline for one channel                                                                                                                                           |
| `EpgListViewComponent`        | Vertical single-day list alternative                                                                                                                                          |
| `EpgItemDescriptionComponent` | Program details dialog                                                                                                                                                        |
| `EpgGuideComponent`           | Multi-channel programme guide grid fed by `EPG_GUIDE_SOURCE` (rows: `EpgGuideRowComponent`, toolbar: `EpgGuideToolbarComponent`, docked strip: `EpgGuideNowPlayingComponent`) |

## Video Player

**Location**: `libs/playlist/m3u/feature-player/src/lib/video-player/`

### Supported Players

- **ArtPlayer** (default) - Modern player with plugins
- **Video.js** - Fallback with HLS support
- **HTML5** - Basic video element
- **Audio** - For radio streams

### Player Features

- Channel navigation (prev/next)
- Favorites toggle
- EPG sidebar
- Collapsible inline EPG panel for internal players, persisted through the
  shared `live-epg-panel-state` preference
- Programme guide (multi-channel grid) in guide mode — see "Programme guide" below
- Channel info overlay
- External player support (MPV, VLC) in Electron
- M3U archive/catch-up playback for supported replay schemes

### Archive / Catch-Up Playback

- The shared EPG UI only shows the archive replay badge when the host confirms
  that the selected M3U channel has a playable replay scheme. Archive days
  alone are not enough.
- M3U catch-up support is resolved in `@iptvnator/shared/m3u-utils` from channel metadata and
  the archived program start time.
- Supported replay precedence:
    1. `catchup.source` if it is an HTTP(S) URL. IPTVNator rewrites or appends
       standard `utc` and `lutc` query params on that URL.
    2. Legacy same-stream shift playback when `catchup.type === 'shift'`. In
       that case IPTVNator rewrites or appends `utc` and `lutc` on `channel.url`.
    3. Legacy same-stream shift fallback when no explicit catch-up mode is
       declared, archive-day metadata exists (`tvg.rec`, `timeshift`, or
       `catchup.days`), and `channel.url` itself is an HTTP(S) stream URL. This
       covers providers that only advertise archive retention such as
       `tvg-rec="7"` but still expect standard `utc` and `lutc` query params on
       the live URL.
- `tvg.rec`, `timeshift`, and `catchup.days` still define the archive window
  shown in the EPG, but replay remains unavailable when the provider declares a
  different explicit catch-up scheme that IPTVNator does not understand or when
  the stream URL itself is not an HTTP(S) replay target.
- Active replay is stored separately from the selected channel in
  `playlistState.activePlaybackUrl`. Inline and external players use
  `activePlaybackUrl ?? activeChannel.url`, and returning to live playback
  clears the override.
- The unified favorites/recent live tab
  (`libs/portal/shared/ui/.../unified-collection/unified-live-tab.component.ts`)
  hosts the same timeline but does not use the NgRx playlist state; it keeps
  its own `activeTimeshift` signal, resolves the replay URL with
  `resolveM3uCatchupUrl`, and swaps the inline player's playback target (or
  hands the URL to the configured external player). Selecting another channel,
  closing the player, or "Return to live" clears the override.
- Catch-up activation is never silent: if the replay URL cannot be resolved
  for a programme the user clicked, both hosts surface a
  `EPG.TIMELINE.CATCHUP_FAILED` snackbar instead of doing nothing.

### Programme guide

`app-epg-guide` (`libs/ui/epg/src/lib/epg-guide/`) is a host-agnostic
multi-channel grid. It reads everything through the `EPG_GUIDE_SOURCE`
injection token (`epg-guide-source.ts`): the scope-resolved channel list
(`EpgGuideChannel { id, number, name, logoUrl, epgKey }`), the available scopes
(all / group / favorites), `loadPrograms(window)` and `loadCoverage(window)`
for a provider-clock time window, the active channel and `activate(id)`. An
optional `searchPrograms(query)` returns `EpgGuideSearchHit { channelId,
program }`, where `channelId` is `null` when the host cannot say which row a
hit belongs to. The M3U adapter is `M3uEpgGuideSourceService`
(`libs/playlist/m3u/feature-player/src/lib/epg-guide/`): channels come from
NgRx, `epgKey` uses the `tvg.id → tvg.name → name` chain, and the two bridge
reads `EPG_GET_PROGRAMS_FOR_CHANNELS` / `EPG_GET_PROGRAM_COVERAGE` resolve keys
in the main process (manual mappings first, then the metadata lookup shared
with the sidebar) and return programmes keyed by the requested key. Queries
are unscoped, like the timeline.

Row ids are not channel ids: `createChannel` falls back to the stream URL for
an entry without an explicit id, so one stream listed in two groups yields two
channels sharing an id. The adapter therefore builds SCOPE-LOCAL row ids by
prefixing every row with its position in the scope (`<index>:<channel id>`) —
the guide keys its programme, coverage and selection maps by row id, so
without that both copies lit up as playing and activating either one played
the first, and suffixing only the repeats was not enough because a real
channel id can itself look like a generated suffix (ids `x`, `x`, `x#1`
produced `x#1` twice). Ids move with the scope and the channel list, so only
ids the guide was just handed may be passed back. The active channel is
resolved to a row in three steps, because the store spreads the selected
channel (identity is gone) and copies can share an id: the row whose channel
matches the playing one field for field (every field except the
reducer-rewritten `epgParams`, key order ignored — `isSameChannelEntry`),
else the first same-id row with the same stream url, else the first same-id
row; `null` when the channel is outside the scope. `activate(rowId)`
resolves the row back to its own channel object. Opening the
guide mirrors the sidebar view (`applyInitialScope`): favorites stays
favorites, and the groups view opens on the group the sidebar's rail is
SHOWING — forwarded from `GroupsViewComponent.selectedGroupChange` through the
channel list container and `app-sidebar` into
`VideoPlayerComponent.selectedSidebarGroup` — because the user may have
browsed away from the playing channel's group before opening the guide. The
playing channel's group is the fallback, then `all`.

Guide mode is host layout, not an overlay: `VideoPlayerComponent.guideOpen`
hides the sidebar and the timeline, renders the guide, and CSS reflows the
untouched `app-web-player-view` into a 128 px docked strip
(`.content-container.is-guide`) beside `app-epg-guide-now-playing`; the strip
collapses to one 48 px line (`epg-guide:dock-collapsed`), which is also the
fixed height of the strip shown for an external MPV/VLC session — that one has
no video to reveal, so it hides the Collapse toggle (`collapsible=false`) and
writes no preference. Nothing remounts, so playback and native-view Embedded
MPV bounds survive. While the guide is open the docked `.video-player` carries
`data-player-shortcuts-suspended`, which makes `ControlsShortcuts` (shared and
legacy player shortcuts alike) yield ↑/↓, Space, F and M to the guide's own
keyboard controller. Entry points: the workspace header action
(`m3u-epg-guide`), the command palette, the Guide button in the EPG panel's
toolbar (`openGuide` on both `EpgTimelineComponent` and `EpgListViewComponent`,
so the action survives the list-view setting) and the `G` key on the player
page.
The header action reports `disabled` whenever the guide cannot open, which
greys out the header button and disables its palette command instead of
offering a no-op. Player fullscreen, radio, recognised movies, switching to
another playlist and the PWA close or withhold it. `openGuide()` itself also
refuses while ANY element is fullscreen or a CDK dialog is open — the guide
mounts in the page flow, so it would be painted over and still swallow the
keyboard — and the `G` key additionally ignores a press raised inside a
`.cdk-overlay-pane`, `[role="menu"]` or `[role="dialog"]`, the same surfaces
the PageUp/PageDown zapping yields to. Inside the guide: single click on a row or an
"on now" card switches the channel and keeps the guide open, double-click or
Enter switches and closes, other cards open the programme dialog; ↑/↓ ←/→
navigate, I details, N now, PgUp/PgDn day, Esc close — the keyboard controller
ignores keys on any element matching its interactive-target selector
(inputs, buttons, menu/option items, links, editable content) unless that
element carries `data-epg-guide-grid`, which the guide's own channel cells and
programme cards set so their `role="button"` does not shadow the grid's own
keys; a real control nested inside one (the catch-up button) still wins.
Density (`epg-guide:density`, comfortable 60 px / compact 44 px), zoom
(`epg-guide:zoom`, 120–480 px per hour, default 240) and the "Only with EPG"
toggle (`epg-guide:only-with-epg`) persist in localStorage; coverage is loaded
for the whole scope so the toggle never hides rows as they scroll in. The
guide reads the EPG display offset itself: the day axis is display time, the
request window is converted with `epgProviderClockMs`.

**Backend contract**: `EpgGuideQueryService`
(`apps/electron-backend/src/app/events/epg-guide-query.service.ts`) answers
both IPCs from one `guideWindowCondition()` predicate — when the request
carries `sourceUrls` (portal hosts only; the M3U host never does), a row
qualifies if it belongs to one of those sources OR carries no source at all
(legacy pre-per-source-tracking data), never if it belongs to a _different_
source. Both reads cap the requested channel-key batch
(`EPG_GUIDE_MAX_CHANNELS_PER_REQUEST` = 100 for programmes,
`EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST` = 2000 for the cheaper coverage
probe) and respond with exactly the trimmed, de-duplicated, cap-respecting
requested keys: a key cut by the cap is absent from the answer, never present
with an empty list, so a caller can tell "queried, nothing found" apart from
"not queried at all". An invalid window (bad instants, `fromMs >= toMs`, no
usable keys) returns `{}`/`[]` rather than throwing.

### External Player Request Headers

The built-in web players inherit the playlist-level custom
User-Agent/Referer through the Electron `webRequest` header override
(`set-user-agent` IPC: the playlist values form the session-wide override, the
active channel's `#EXTVLCOPT` values a stream-scoped one on top). External
MPV/VLC and the embedded MPV player make their own HTTP requests, so those
launches carry the headers in the payload instead:
`resolveExternalPlayerHttpHeaders()` in
`libs/m3u-state/src/lib/external-player-payload.util.ts` resolves each of
User-Agent/Referer/Origin independently — the channel's `#EXTVLCOPT` value
wins, the playlist-level value (import dialog / playlist settings) is the
fallback, and blank values count as absent. Every M3U external launch path
goes through it: the auto-launch and catch-up effects in `m3u-state`, the
manual MPV/VLC fallback in `VideoPlayerComponent`, and the embedded MPV
payload (`embeddedPlayback`). In the main process both players emit the same
header field list (`buildHttpHeaderFields`): a real `Origin: ...` header
(deduplicated against the custom headers map) plus every non-empty custom
header — MPV via `--http-header-fields`, VLC via per-input `:http-header=`
options in both the fresh-spawn and RC-enqueue paths. VLC additionally keeps
its legacy origin-as-Referer fallback when no Referer is set.

### DASH + ClearKey Playback

MPEG-DASH (`.mpd`) channels play through a Shaka Player _source engine_ inside
the existing built-in players — exactly like hls.js/mpegts.js. There is no new
player in settings.

**DRM data flow** (M3U module only; Xtream/Stalker have no DRM concept):

1. The playlist parser fork does not interpret `#KODIPROP:` lines, but
   preserves them in `item.raw` for **both** layouts: unknown lines between
   `#EXTINF` and the stream URL are kept as before, and since parser pin
   `v0.15.2-iptvnator.2` `#KODIPROP` lines placed _before_ the `#EXTINF` are
   buffered and attached to the **next** entry's `raw` in file order (Kodi
   semantics, case-insensitive prefix). Other stray `#` lines outside an open
   item are still dropped, matching upstream.
2. `extractDrmFromRaw()` (`libs/shared/m3u-utils/src/lib/kodiprop.utils.ts`)
   post-processes `raw` inside `createPlaylistObject()` — the single funnel
   for all four import paths (Electron URL/file import, refresh worker,
   web-backend `/parse`, client-side upload). It reads
   `inputstream.adaptive.license_type`, `license_key`, and the combined
   `drm_legacy` property. ClearKey key formats: `kid:key` hex (single or
   comma-separated), the W3C ClearKey license JSON, and a plain `{kid: key}`
   JSON map. Unsupported license types (Widevine, PlayReady, license-server
   URLs, malformed values) are preserved as `supported: false` — never a
   throw.
3. The typed result lands on `Channel.drm` (`ChannelDrm` in
   `@iptvnator/shared/interfaces`), travels through
   `ResolvedPortalPlayback.drm` into `WebPlayerViewComponent`'s synthetic
   channel, and reaches the engine. Persistence is free for newly imported or
   refreshed playlists (playlist JSON blob / IndexedDB object). Playlists
   imported **before** the DRM feature carry no `drm` field yet, but the raw
   `#KODIPROP` block survived in the stored items — the M3U player page falls
   back to `extractDrmFromRaw(channel.raw)` at playback time, so encrypted
   channels of pre-upgrade playlists work without a re-import.

**Engine selection and routing:**

- `ShakaVideoSession` (`libs/ui/playback/src/lib/shaka-engine/`) owns the
  engine: lazy `import('shaka-player')` on first use (the module is a separate
  lazy chunk, ~217 KB transfer), `drm.clearKeys` configuration, an operation
  queue + generation guard against channel-switch races. The DOM-free Shaka
  `5.2.4` public-error boundary lives in `libs/playback/util`; it version-locks
  its allowlisted
  severity/category/code values, emits only structured sanitized
  `PlaybackDiagnosticSource.Shaka` evidence, ignores recoverable error events,
  and treats a rejected load as terminal even if its final retry error retains
  recoverable severity. Raw messages and `error.data` never cross the boundary;
  only the documented direct/nested `BAD_HTTP_STATUS` slot may contribute a
  validated HTTP status. Exact category/code pairs classify failures, while an
  ambiguous Manifest category or unknown pair remains an unknown diagnostic.
  The public streaming-startup code `5006` is retained exactly but keeps
  unknown stage/failure. Public DASH text-parser codes likewise retain their
  exact `TEXT` category/code but keep stage/failure unknown. A failed
  `Player.isBrowserSupported()` preflight also stays unknown rather than
  claiming container incompatibility. It carries only the enumerated,
  app-owned `PlaybackRuntimeSupport.ShakaBrowserUnsupported` marker — never a
  producer recommendation hint or engine payload. Clear DASH still offers
  configured external-player actions, while KODIPROP DRM keeps them disabled
  because those players never receive its keys.
  Channels with `drm.supported === false` emit a `DrmOrEncryption` diagnostic
  with a fixed safe detail string and without starting an engine.
- HTML5 player: the `dash` branch of `playChannel()` (source kind from the
  shared `resolvePlaybackUrlSourceKind()`). ArtPlayer: `customType.mpd` in
  `ArtPlayerSourceSession`. Shared-controls bridge:
  `WebVideoControlsSource` kind `'shaka'` + `WebVideoShakaControls`
  (audio/text tracks via the Shaka 5 API — selecting a text track shows it,
  `selectTextTrack(null)` hides).
- DASH channels always play inline (radio precedent): `isDashChannel()` gates
  `shouldShowInlinePlayer()`, the MPV/VLC auto-launch in `m3u-state` effects
  (`shouldAutoLaunchExternalPlayer()`), and the `playerOverride` passed to
  `app-web-player-view` — ArtPlayer stays ArtPlayer, every other configured
  player (Video.js without a DASH bridge, embedded/external MPV, VLC) falls
  back to the HTML5 player. External players cannot receive KODIPROP ClearKey
  configuration (VLC upstream feature request #29465).
- ClearKey EME works in stock Electron (`org.w3.clearkey`; no Widevine CDM
  required) — EME needs a secure context, which `file://` (packaged) and
  `http://localhost` (dev/PWA) both satisfy. Widevine/FairPlay are out of
  scope (castLabs fork + VMP signing).

**Testing:** offline VP9+Opus CENC fixtures in
`apps/web-e2e/src/fixtures/dash/` (generated with ffmpeg + Shaka Packager —
see the README there for why), e2e suites `web-e2e:src/dash-clearkey.e2e.ts`
(Chromium; the Angular service worker is blocked because SW-routed requests
bypass Playwright interception) and
`electron-backend-e2e:src/dash-clearkey.e2e.ts` (real ClearKey EME in
Electron).

## Movie Recognition (VOD Detail View)

M3U playlists routinely mix live channels with movie FILES ("Movies"/"VOD"
groups, Xtream-derived exports). A recognized movie swaps the player + EPG
zone for the same two-state VOD detail shell the portals use, fed by TMDB
metadata. Works in both Electron and the PWA.

**Gate** (`VideoPlayerComponent.showMovieDetail`): the branch activates only
when ALL hold — the URL-shape heuristic recognizes the channel, TMDB
enrichment is enabled (`TmdbEnrichmentService.isEnabled()`), and
`Settings.m3uVodDetails` is not `false` (default on; the checkbox lives in
Settings → Metadata (TMDB) under the master toggle). The decision is
**synchronous** — layout is chosen at activation; the async TMDB lookup only
patches metadata into an already-mounted view, so a missed match never causes
a layout jump.

**Detection** (`isLikelyM3uMovie` in
`libs/shared/m3u-utils/src/lib/m3u-vod-detection.util.ts`): a movie-file
container extension (`mkv`, `mp4`, `avi`, … — deliberately NOT `ts`/`m3u8`/
`m4s` which deliver live streams, and not `mpd` which has its own DASH path)
OR an Xtream-style `/movie/`, `/movies/`, `/vod/` path segment. Exclusions
fail toward today's live layout: `radio="true"`, DASH URLs, `/series/` paths,
and names carrying an episode marker (`S01E02`, `1x02`, "2 серия",
"Season 3" — the season word list is shared with the title normalizer).
Known accepted cost: "Star Wars: Episode 1" is skipped.

**Flow** (`m3u-vod-detail/` in `libs/playlist/m3u/feature-player`):

- `M3uVodDetailComponent` hosts `PortalDetailShellComponent` +
  `PortalInlinePlayerComponent`. **Watch-first**: clicking a channel keeps
  M3U zapping semantics — playback starts immediately, the About block
  renders below where the EPG zone would be; Escape/close reveals the Browse
  hero, Play re-enters watch. The hero back arrow is hidden (the channel
  sidebar next to the detail IS the navigation).
- The parent passes its already-built `embeddedPlayback()`
  (`ResolvedPortalPlayback` with headers/EXTVLCOPT resolved) plus its shared
  persisted `volume()`; the host only overrides `isLive: false` (seek
  bar/VOD semantics). The payload's OBJECT IDENTITY is the player's
  source-application key (`createWebPlayerApplicationState` mints a new
  source revision for any new payload), so it must never depend on TMDB
  signals — folding the resolved title/poster in there restarted the movie
  the moment enrichment landed. Metadata lives in the hero/About
  presentation only.
- `PortalInlinePlayerComponent` gained an optional `volume` input
  (default `1`) for this host: the M3U player owns a persisted volume shared
  across its channels, while the portals keep the engines' own default. The
  parent re-reads that bus per channel AND on the host's `playbackStarted`
  output, because Browse → Play remounts the engine without a channel change
  and the engines only ever write to the bus.

**Coverage:** `apps/web-e2e/src/m3u-movie-details.e2e.ts` drives the workflow
against the real composition with a routed TMDB mock — recognition, async
metadata, the live-channel fallback, and the volume the remount must keep.

- `M3uVodMetadataService` (component-provided) calls
  `TmdbEnrichmentService.enrichMovie({ title: channel.name, year:
releaseTagYear(channel.name) })` — the resolver already normalizes titles
  and caches verdicts; the service only adds the release-year hint and a
  staleness guard keyed on `channel.id` so zapping mid-request drops the
  stale resolution.
- No TMDB match keeps the thin provider presentation (entry name + logo) in
  the detail layout rather than jumping back to the EPG view.
- External MPV/VLC users keep Browse: the m3u-state effects launch the
  external player on activation exactly as before, and
  `inlinePlayerAvailable=false` means the host never mounts an inline player.

**Out of scope (v1)**: series episodes (detection skips them), playback
position persistence for M3U movies, clickable cast chips (no
`actor/:personId` route in the M3U tree), and downloads.

## Interfaces

### Channel Interface

```typescript
interface Channel {
    id: string;
    url: string;
    name: string;
    group: { title: string };
    tvg: {
        id: string; // For EPG matching
        name: string;
        url: string;
        logo: string;
        rec: string;
    };
    epgParams?: string;
    timeshift?: string;
    catchup?: { type?: string; source?: string; days?: string };
    radio: string;
    http: {
        referrer: string;
        'user-agent': string;
        origin: string;
    };
    /** ClearKey DRM extracted from #KODIPROP lines (DASH channels). */
    drm?: ChannelDrm;
}
```

### Playlist State Additions

```typescript
interface PlaylistState {
    active: Channel | undefined;
    activePlaybackUrl: string | null;
    currentEpgProgram: EpgProgram | undefined;
    epgAvailable: boolean;
    channels: Channel[];
}
```

### EpgProgram Interface

```typescript
interface EpgProgram {
    start: string; // ISO string
    stop: string; // ISO string
    channel: string; // TVG ID
    title: string;
    desc: string | null;
    category: string | null;
    episodeNum?: string | null;
    iconUrl?: string | null;
    rating?: string | null;
}
```

## Routes

Routes live in `libs/playlist/m3u/feature-player/src/lib/m3u-workspace.routes.ts`
(`createM3uWorkspaceRoutes()`), nested under the workspace shell:

```
/workspace/playlists/:id            # M3U player (redirects to .../all)
/workspace/playlists/:id/favorites  # Favorites collection view
/workspace/playlists/:id/recent     # Recently viewed collection view
/workspace/playlists/:id/:view      # Video player with channel list view
```

## Adding New Features

### To add a new view to channel list:

1. Create component in `channel-list-container/new-view/`
2. Accept inputs: `channels`, `channelEpgMap`, `progressTick`, `shouldShowEpg`, `activeChannelUrl`
3. Emit `channelSelected` output
4. Add to parent template and imports

### To add EPG-related features:

1. Use `EpgService` for data fetching
2. Subscribe to `channelEpgMap` signal for current programs
3. Dispatch `EpgActions` for state updates

### To modify favorites behavior:

1. Dispatch `FavoritesActions.updateFavorites` for toggle
2. Dispatch `FavoritesActions.setFavorites` for reordering
3. Dispatch `FavoritesActions.hydrateFavorites` only when copying values that
   were already read from persistence into NgRx
4. Effects persist the two user-mutation actions; hydration is reducer-only

### XMLTV source lifecycle

Electron treats `Settings.epgUrl` as the committed global source list. Removing
an input is a draft edit; only a successful IndexedDB write authorizes source
reconciliation. A storage write failure restores the previous in-memory EPG
URLs. If subsequent cache cleanup fails, the saved URLs remain authoritative,
the settings form remains retryable and shows the existing EPG cleanup failure
message rather than claiming settings storage failed. Electron settings and
external-player paths still mirror the committed values after a cleanup failure;
a failed storage write never mirrors them. Ordinary settings saves
compare normalized source sets and skip reconciliation when they are unchanged,
so unrelated preferences do not depend on cache cleanup. An explicitly edited
EPG array requests reconciliation even when the committed URLs already match
(for example retrying a failed cleanup); removing a row marks that array dirty,
and only successful saving clears it. Startup reconciliation always runs.

`EpgSourceSettingsService` waits for `PlaylistsService.getAllPlaylists()` (which
performs the legacy playlist migration) before invoking `EPG_RECONCILE_SOURCES`.
Startup includes an empty global list and does not prune after a failed settings
read. Main verifies the completed migration flag, reads every enabled M3U
`epg_urls` list and unions them with the saved globals. Invalid ownership metadata
aborts pruning. Detected-but-disabled sources and Xtream/Stalker provider EPG are
not global XMLTV owners. No source-discovery or provider matching policy changes.

Reconciliation finds old sources in XMLTV channel, programme and per-source
metadata tables, plus queued imports. It
retires their generations before waiting for workers to exit, then uses the
`EpgWorkerRuntime` source-clear protocol. The runtime owns worker bootstrap and
shutdown; `EpgWorkerService` owns source generations and serialization, while
`runEpgFetch` owns each import’s message/timeout/exit lifecycle. Successfully cleared request candidates are forgotten
without resetting their generation fences; failed cleanups remain retryable.
Main-process and parser-worker diagnostics use `epgLogger`, applying shared
secret redaction and omitting complete URLs from error messages, nested request
data and redirect details. Error logs allowlist name/message/code/status/cause
and discard transport objects (which can contain relative request paths and raw
HTTP headers). XMLTV providers can put credentials in arbitrary path
segments or query keys; progress IPC and caller errors retain their original
values, while logs keep operation labels, counts and error codes.
Same-URL clears are serialized and replacement imports await the outstanding
clear, so an older cleanup cannot erase a newly re-added source. Source cleanup
also awaits the in-flight fetch promise when an error/timeout has already removed
the worker from the lookup but its termination is still pending.
Every removed source emits generation-scoped cancellation before cleanup starts,
including retained actionable errors whose workers have already finished. Retired
queued/running imports also cancel their own generation. Retry waits for source
reconciliation and rechecks the same error row; trust-setting continuations and
old dismissal timers cannot affect a removed or replacement row. Progress rows disappear without reporting routine worker termination as an import failure. Programmes are deleted by source; a globally keyed
channel is retained while another source still has programmes or channel metadata.
The additive `epg_channel_sources` table is created during database initialization
and records each imported source's name, logo, URL and timestamp. A per-channel
`write_order` advances inside the import transaction (including upserts and
refreshes), so restoration picks the latest surviving writer even when timestamps
collide or the clock moves backwards. Freshness still uses wall-clock timestamps.
Existing ledgers gain the column with zero for unknowable historical order. Before removing
source provenance, cleanup restores affected global channels from a surviving
snapshot, including when the legacy channel owner differs from the removed
metadata writer. Metadata-only owners survive another source's refresh or removal.
Refresh restores affected metadata before discarding that source's old snapshots;
clear-all deletes the snapshots too. Freshness reads source-specific snapshot
timestamps, so legacy sources without snapshots are refreshed on their next import
check. No legacy snapshot is guessed from global
channel metadata: its last writer may differ from its recorded owner. Affected
legacy channels without a surviving snapshot retain programmes with a neutral
XMLTV ID label, no logo/URL and no freshness timestamp until reimport. Historical
metadata with no remaining source provenance cannot be selectively reconstructed. Manual mappings are preserved and can
resolve another retained source sharing that channel ID. Legacy programmes with
unknown (`NULL`) ownership are conservatively left alone; the existing database
initialization backfill handles rows whose channel still identifies their owner.

Renderer reconciliation fences lookups before its first asynchronous step.
Imports wait for serialized reconciliation (including playlist migration), then
filter against its committed owner set. Completion increments the data revision again
and cancels earlier lookup
subscriptions, clears program caches and the selected M3U guide, and refreshes
Xtream selection and visible channel previews, plus Stalker manual mapping
overrides and bulk guides. A delayed startup import is
started only if its source still belongs to the reconciled configuration; its
completion observer is installed after settings initialization. Provider EPG
continues through its existing APIs. Playlist refresh is not EPG cache cleanup.
