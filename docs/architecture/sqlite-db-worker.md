# SQLite DB Worker

This document records the current non-EPG SQLite worker implementation in the
Electron app.

Related:

- [Category Management](./category-management.md)
- [Workspace Shell](./workspace-shell.md)

## Summary

- Heavy non-EPG SQLite work no longer runs on Electron's main thread. The
  explicitly lightweight download and EPG-specific SQLite handlers remain in
  main.
- A dedicated long-lived database worker now handles the slow Xtream and
  playlist database operations that were freezing the UI.
- Renderer APIs stay stable. The main change is that progress and long-running
  state now flow through a request-scoped `DB_OPERATION_EVENT` contract instead
  of a single global progress event.

## Goals

The worker cutover addresses three concrete problems:

1. Main-process UI stalls during large SQLite operations.
2. Xtream import progress events were global and unsafe for concurrent jobs.
3. EPG and non-EPG writers needed shared SQLite concurrency settings so they
   can coexist without `SQLITE_BUSY` regressions.

## Current Ownership

### Renderer and preload boundary

These files own the renderer-facing database service and stable Electron
bridge:

1. `libs/services/src/lib/database-electron.service.ts`
2. `apps/electron-backend/src/app/api/main.preload.ts`

### Main-process runtime wiring

These files own worker lifecycle and IPC bridging:

1. `apps/electron-backend/src/app/services/database-worker-client.ts`
2. `apps/electron-backend/src/app/events/database/category.events.ts`
3. `apps/electron-backend/src/app/events/database/content.events.ts`
4. `apps/electron-backend/src/app/events/database/playlist.events.ts`
5. `apps/electron-backend/src/app/events/database/xtream.events.ts`
6. `apps/electron-backend/src/main.ts`

### Worker runtime

These files own the worker protocol and the SQLite work itself:

1. `apps/electron-backend/src/app/workers/database-worker.types.ts`
2. `apps/electron-backend/src/app/workers/database.worker.ts`
3. `apps/electron-backend/src/app/workers/database.worker-connection.ts`
4. `apps/electron-backend/src/app/workers/worker-runtime-paths.ts`

### Database operation and support modules

Keep SQL-heavy logic here so the worker entry remains a thin dispatcher:

1. `apps/electron-backend/src/app/database/operations/category.operations.ts`
2. `apps/electron-backend/src/app/database/operations/content.operations.ts`
3. `apps/electron-backend/src/app/database/operations/playlist.operations.ts`
4. `apps/electron-backend/src/app/database/operations/xtream.operations.ts`
5. `apps/electron-backend/src/app/database/operations/favorites.operations.ts`
6. `apps/electron-backend/src/app/database/operations/recently-viewed.operations.ts`
7. `apps/electron-backend/src/app/database/operations/playback-position.operations.ts`
8. `apps/electron-backend/src/app/database/operations/content-backdrop.operations.ts`
9. `apps/electron-backend/src/app/database/operations/title-match.operations.ts`
10. `apps/electron-backend/src/app/database/operations/tmdb.operations.ts`
11. `apps/electron-backend/src/app/database/operations/epg-mapping.operations.ts`
12. `apps/electron-backend/src/app/database/operations/title-sources.operations.ts`
13. `apps/electron-backend/src/app/database/operations/vod-source-pin.operations.ts`

Focused helpers in the same directory keep the operation modules and dispatcher
small:

1. `content-search.util.ts`
2. `title-token-glob.ts`
3. `operation-control.ts`
4. `performance-phase-capture.ts`
5. `xtream-content-operation-steps.ts`

Worker operations use the shared table contract in
`libs/shared/database/src/lib/schema.ts`, imported by worker code through
`@iptvnator/shared/database/schema`.

## Worker Architecture

### Request flow

1. Renderer `DatabaseService` calls the stable preload API, such as
   `window.electron.dbSaveContent`.
2. The preload invokes an IPC channel owned by the focused event modules under
   `apps/electron-backend/src/app/events/database/`.
3. `ipcMain.handle(...)` builds a payload and delegates to
   `DatabaseWorkerClient`.
4. `DatabaseWorkerClient` lazily starts one long-lived `worker_threads` worker
   and correlates requests with a generated `requestId`.
5. The protocol reaches the worker dispatcher, which obtains the worker
   connection and delegates SQL work to an operation module using the shared
   schema.
6. The worker sends back either:
    1. `ready`
    2. `event`
    3. `response`
7. The main process resolves the IPC request and forwards worker events back to
   the originating renderer process.

`requestId` and `operationId` have different scopes:

1. `DatabaseWorkerClient` generates a fresh `requestId` for every request. It
   correlates worker `event` and `response` messages with the pending main-side
   transport request and is not renderer-visible operation state.
2. A renderer supplies an `operationId` for tracked long-running work. Progress
   events and cooperative cancellation use that stable identity across the
   renderer, preload, main process, and worker.

### Why one long-lived worker

- It avoids worker startup cost on every search/delete/import.
- It centralizes failure handling and restart behavior.
- It mirrors the existing EPG worker approach without multiplying writable
  SQLite owners.

### Packaged worker bootstrap

Packaged Electron builds do not load worker scripts and native modules from the
same place:

1. worker scripts live under `Resources/dist/apps/electron-backend/workers`
2. unpacked native modules live under one of the approved
   `app.asar.unpacked/.../node_modules` locations

Both the EPG worker and the DB worker now share the same runtime helper:

1. `resolveWorkerRuntimeBootstrap(...)` for main-process worker launch
2. `loadNativeModuleFromSearchPaths(...)` for worker-side native module loading

The helper uses `process.resourcesPath` as the primary packaged base and keeps
`path.dirname(app.getAppPath())` only as a fallback.

## Worker Message Contract

The worker contract lives in
`apps/electron-backend/src/app/workers/database-worker.types.ts`.

### Core message types

1. `DbWorkerRequestMessage`
2. `DbWorkerResponseMessage`
3. `DbWorkerEventMessage`
4. `DbOperationEvent`

### Opt-in request performance capture

`IPTVNATOR_PERF_WORKER_PROFILING=1` adds development/test-only performance
metadata to each database-worker response. It is disabled by default and must
stay disabled for production launches.

Each enabled request gets a fresh event-loop-delay histogram and records:

- `requestReceivedEpochMs`, `workStartedEpochMs`, `workEndedEpochMs`, and
  `histogramFlushedEpochMs`
- `responsePostedEpochMs`, sampled after profiling finalization and immediately
  before the worker posts the response to main
- worker-thread CPU user/system microseconds from `process.threadCpuUsage()`
- event-loop utilization across the exact work interval
- event-loop-delay max/p95/p99 from the request's own histogram
- fixed invalid or unavailable reasons whenever a metric cannot be attributed

Histogram arming waits until the histogram has a sample; flushing waits for its
sample count to advance after work ends. Both waits use condition-based timer
polling. Arming permits the two poll turns that `monitorEventLoopDelay()` needs
before its first sample, then applies the 50 ms elapsed deadline; it always
stops by the 50-poll ceiling. Flushing has no poll floor and stops after 50 ms
or 50 polls. The waits have separate caps, and timer scheduling may overshoot
wall-clock time. A timeout or profiling API failure never replaces the business
response: timestamps and any independently available CPU/ELU metrics remain
valid, while event-loop delay is `null` with a fixed reason.

The long-lived database worker still executes concurrent requests without a
profiling queue. If captures overlap, every overlapping response carries
`invalidReason: "overlapping-database-worker-requests"` and all attributable
CPU, ELU, and event-loop-delay values are `null`. This avoids assigning shared
worker activity to one request while preserving normal worker concurrency.
`responsePostedEpochMs` remains a separate response boundary: the initial M3U
benchmark subtracts it from main's response receipt to attribute the
database-worker-to-main structured-clone proxy without folding that interval
into worker execution.

Initial M3U import profiling requires exact operation-specific phase pairs:

- `DB_UPSERT_APP_PLAYLIST`: `serialize.playlist`, then `sqlite.write`. The
  first covers playlist JSON serialization; the second covers the SQLite
  upsert and its autocommit.
- `DB_GET_APP_PLAYLIST`: `sqlite.read`, then `deserialize.playlist`. The first
  covers the awaited single-row SQLite select; the second covers
  `parseAppPlaylist`, including JSON parsing and persisted-field hydration.

Missing, partial, reordered, or cross-operation phase sequences fail closed.
Markers carry item counts only and do not scan or copy the payload to compute
profiling metadata. The import creates no indexes, so there is no separate
index/transaction-commit phase. Across the upsert and GET requests, the formal
benchmark reports renderer-to-main, main-to-database-worker,
database-worker-to-main, and main-to-renderer structured-clone proxies; their
explicit sum is `ipcStructuredCloneProxyMs`. See
[M3U Playlist Module Architecture](./m3u-playlist-module.md#initial-url-import-performance-benchmark-electron)
for the complete cross-process attribution.

The same request envelope exposes count-only Xtream database phases for these
operations:

- `DB_GET_CATEGORIES`: `sqlite.categories.read`
- `DB_SAVE_CATEGORIES`: `normalize.categories`, then
  `sqlite.categories.write-transactions`
- `DB_GET_CONTENT`: `sqlite.content.read`
- `DB_SAVE_CONTENT`: `sqlite.content.category-map-read`, then
  `normalize.content`, then `sqlite.content.write-transactions`
- `DB_CLEAR_XTREAM_IMPORT_CACHE`:
  `sqlite.xtream-cache-clear.write-transactions`
- `DB_SEARCH_CONTENT`: `sqlite.search.query`, then `normalize.search-rank`
- `DB_DELETE_XTREAM_CONTENT`:
  `sqlite.xtream-delete.collect-user-data`, then
  `sqlite.xtream-delete.write-transactions`
- `DB_DELETE_PLAYLIST`: `sqlite.playlist-delete.collect-ids`, then
  `sqlite.playlist-delete.write-transactions`

Read and query phases cover the exact awaited Drizzle query. Normalization
phases cover the existing synchronous transforms. The content-write phase is
one aggregate pair around every row-budgeted transaction, cancellation
checkpoint, and progress callback; it is not an exact measurement of SQLite
commit time. Cache clear similarly uses one aggregate pair around the content
group transactions and the single category statement, including their
JavaScript overhead. A zero-category cache clear still emits one pair with
`itemCount: 0` and performs no extra SQL.

The Xtream-delete collection span includes its ordered category, favorite,
recently-viewed, and per-category content-count work. Its `itemCount`
deliberately counts only content and category deletion candidates (the summed
per-category counts plus the category rows); favorite, recently-viewed, and
hidden-category user data is timed but is not added to that count. The
matching write count uses the same deletion-candidate definition.
Playlist-delete collection counts the favorite, recently-viewed, and
playback-position rows, the summed content counts, and the category rows.
Download rows are intentionally excluded: they own local offline files
independently of the source playlist and survive source deletion, with
provider handoff disabled while that source is absent. The write count adds
the final playlist row. Both write spans include every cooperative checkpoint,
committed transaction, progress callback, and, for playlist deletion, the
final playlist-row autocommit; they are not exact SQLite commit-time
measurements.

Successful end markers carry only row/item counts. Error or cancellation still
closes the active phase without metadata and preserves the original error.
Disabled profiling passes no adapter into the operations, so it performs no
phase-event or metadata-callback allocation. Worker concurrency, SQL,
transaction boundaries, progress ordering, and cancellation checkpoints are the
same with and without profiling. `DB_GLOBAL_SEARCH` is deliberately not
instrumented: it interleaves queries and ranking across sources, so these
single-query phases would be misleading.

### Catalog write batching

Catalog deletes and inserts commit in row-budgeted transactions rather than
per 100 rows (#1292, `catalog-deletion.ts`). Every commit flushes the FTS5
trigram pending buffer into a new segment, re-appends the dirty pages of each
`content` index to the WAL, and about every 4 MB of WAL runs an fsync-ing
auto-checkpoint, so a 300k-row playlist committed in 100-row batches cost
3,000 commits and roughly 2 GB of WAL traffic where one transaction writes
140 MB. One giant transaction is not the alternative: the worker serves other
requests only between awaits, cancellation is cooperative between commits, and
the main-process and EPG-worker connections give up after their 5 s
`busy_timeout` while a write transaction holds the lock.

- `CONTENT_ROWS_PER_TRANSACTION` (5,000) is the budget for both directions.
- Deletes never materialize row ids in JavaScript. The worker reads content
  row counts per category from the two covering indexes
  (`countContentRowsByCategory`), packs consecutive categories into groups
  within the budget (`groupCategoriesByRowBudget`; a category larger than the
  budget forms its own group and is deleted whole — the largest real ones,
  around 45k rows, still commit in well under a second), and issues one
  `DELETE FROM content WHERE category_id IN (...)` per group. Categories are
  then removed with a single playlist- or type-scoped statement, and playlist
  removal drops favorites, recently-viewed and playback-position rows with one
  playlist-scoped statement each. `requireScopedFilter` refuses the
  `undefined` an empty `and()` yields, since `.where(undefined)` would be a
  full-table delete.
- Inserts keep 100-row `INSERT` statements (Drizzle binds the eleven columns
  an `XtreamContentValue` supplies, 1,100 parameters per statement; a whole
  5,000-row commit in one statement would pass SQLite's 32,766 limit) and
  wrap fifty of them in one transaction.
- For deletes, progress `current` is the sum of the `changes` SQLite reports
  and `total` is the summed pre-count. For inserts, `current` counts the rows
  handed to `INSERT ... ON CONFLICT DO NOTHING` and `total` is the number of
  normalized values, so a conflict-skipped duplicate still counts as
  progress — it is a progress figure, not a row count. Either way a
  checkpoint runs before every commit, so a cancel lands between commits
  exactly as before.

Formal initial-import comparison also requires both request-scoped captures in
every measured run to have coherent event-loop delay, event-loop utilization,
and worker-thread CPU values with no unavailable or invalid reason. Summary
validity records the exact expected and valid request counts; nullable metrics
remain in raw results but cannot be silently omitted from comparison
distributions.

The formal Xtream benchmark launches every iteration with a fresh temporary
profile. On that cold profile, the renderer can request the persistent database
worker while the main process is still initializing the shared SQLite schema.
The harness treats only `database is locked` and `no such table` during its
pre-measurement readiness checks as this startup race. It closes the failed app,
confirms that its Electron process exited, removes that profile, and permits one
relaunch with another fresh profile. Unrelated failures are never retried,
unconfirmed teardown or profile cleanup is fatal, a second readiness failure is
fatal, and the measured import, refresh, delete, cancel, or background-UI
operation still has exactly one attempt. Each successful iteration persists
`startup-evidence.json` for immediate diagnostics and also binds the attempt
count and fixed retry reason into the receipted `result.json` process identity.
The validated identity is copied into `summary.json`, so comparison output
cannot hide startup instability.

The main-process benchmark samples the database worker's V8
`used_heap_size` and `external_memory` independently. Raw output includes a
valid-sample count for each metric. A peak is numeric only after at least one
finite, non-negative isolate sample; otherwise it is `null` with a fixed
unavailability reason. An initialized zero is never used as evidence of a
successful sample. Formal initial-import comparisons require valid peak
samples from exactly one database worker in every measured run. Worker RSS is
not available per thread and remains part of the separately reported Electron
main-process RSS together with native and SQLite memory.

### Opt-in post-GC heap capture

The same `IPTVNATOR_PERF_WORKER_PROFILING=1` opt-in enables a development/test
one-shot `performance:collect-post-gc-heap` request. The benchmark transfers a
dedicated `MessagePort`; the database worker accepts the request only while no
request performance capture is active, calls exposed `globalThis.gc()`, reads
its own V8 isolate through `v8.getHeapStatistics()`, posts one result, and
closes the port. Production launches do not expose GC or send this request.

The response is a strict XOR: either a non-negative
`postGcHeapUsedBytes` with a `null` reason, or a `null` heap with a fixed
unavailability reason. Disabled profiling, a busy worker, unavailable GC, and
capture failure all fail closed without changing the database operation or
terminating the worker. The performance launcher supplies
`--js-flags=--expose-gc` to Electron itself; worker `execArgv` remains
untouched.

The main-process benchmark selects exactly one current-generation database
worker, waits for its final sampling call, stops its CPU profile, performs the
explicit-GC probe, and only then takes an optional diagnostic heap snapshot.
Profile or snapshot failure cannot overwrite an already captured post-GC
value. Capture stop closes a synchronous cutoff before awaiting profile or
snapshot work. A database request after that cutoff cannot restart sampling;
it records `database-worker-activity-after-cutoff` and invalidates the result.
Missing, multiple, busy, timed-out, or malformed worker captures remain raw
nullable outcomes and make a database-applicable measured run invalid for
comparison. A scenario cancelled before its database phase reports the worker
metric as not applicable rather than manufacturing an idle database request.
Before a measured generation, the M3U benchmark persists and validates its seed
capture, then atomically rolls a clean stopping cutoff into the next active
generation. This closes the otherwise unobservable gap between separate
stop/start calls: pre-rollover requests remain late and fatal, while
post-rollover requests are attributed to the new generation.

### Progress event contract

The worker now emits request-scoped events with:

- `operationId`
- `operation`
- `playlistId`
- `status`
- optional `phase`
- optional `current`
- optional `total`
- optional `increment`

Current shipped operation names:

1. `save-content`
2. `delete-xtream-content`
3. `restore-xtream-user-data`
4. `delete-playlist`
5. `delete-all-playlists`

All five are tracked. Save content, delete Xtream content, restore Xtream user
data, and delete playlist are cancellable. Delete all playlists deliberately
uses `cancellable: false`: its renderer-visible progress is tracked, but a
cancel request does not interrupt it.

The event is forwarded to the renderer as `DB_OPERATION_EVENT`.

Progress events are throttled in the worker
(`operation-progress-throttle.ts`): at most one `progress` event per
operation every 100 ms, with the rest coalesced into the next emitted one —
latest `phase`/`current`/`total`, summed `increment`, so a consumer adding
increments still reaches the same count. The first report of a phase, a
report that reaches its `total`, and the pending report of a phase that is
being left are never held back, and a pending report is flushed before the
terminal `completed`, `cancelled`, or `error` event. Consumers must therefore
not assume one event per committed transaction.

### Cancellation contract

Long-running Xtream and playlist operations now support best-effort
cancellation.

Renderer requests cancellation via:

1. `DB_CANCEL_OPERATION`
2. `window.electron.dbCancelOperation(operationId)`
3. `DatabaseService.cancelOperation(operationId)`

If a worker operation is canceled:

1. the worker emits a final `cancelled` event
2. the request rejects with an `AbortError`
3. the UI clears its busy state without treating the operation as success

Cancellation is cooperative and lands between commits: a checkpoint runs
before every row-budgeted transaction (see "Catalog write batching"), and
already committed SQLite batches stay committed. For an operation's busy
lifecycle, only the terminal
`completed`, `error`, or `cancelled` event settles UI state. The UI may set a
separate cancel-requested flag immediately so the cancel action cannot be
clicked twice while it waits for the authoritative terminal event.

With the exact `IPTVNATOR_PERF_WORKER_PROFILING=1` opt-in, receipt of a cancel
for a correlated active request also emits a
`performance-cancel-received` worker diagnostic containing only safe
operation/request IDs and its epoch. The functional cancellation flag is set
first, this receipt remains distinct from the later authoritative
`cancelled` event, and `DatabaseWorkerClient` ignores it without settling or
exposing the pending request. Disabled profiling performs no receipt clock or
transport work, and `DatabaseWorkerClient.cancel()` remains fire-and-return.

## Renderer Contract

The preload bridge keeps the existing database methods but adds scoped worker
events.

### Important preload APIs

1. `onDbOperationEvent(callback)`
2. `dbSaveContent(playlistId, streams, type, operationId?)`
3. `dbDeleteXtreamContent(playlistId, operationId?)`
4. `dbRestoreXtreamUserData(..., operationId?)`
5. `dbDeletePlaylist(playlistId, operationId?)`
6. `dbDeleteAllPlaylists(operationId?)`
7. `dbCancelOperation(operationId)`
8. legacy compatibility:
    1. `onDbSaveContentProgress(callback)`
    2. `removeDbSaveContentProgress()`

`DatabaseService.saveXtreamContent(...)` now generates an `operationId`,
subscribes to `onDbOperationEvent`, filters by that `operationId`, and only
falls back to the legacy progress API if the newer event channel is missing.

`DatabaseService` also owns:

1. `createOperationId(...)`
2. `cancelOperation(operationId)`
3. `isDbAbortError(error)`

## Migrated Operations

The worker owns heavy non-EPG SQLite paths and portal state operations that
would otherwise block Electron main.

### Deliberate direct-main exceptions

Lightweight work that coordinates main-process runtime or remains
EPG-specific is not migrated incidentally:

1. `apps/electron-backend/src/app/events/database/downloads.events.ts` keeps
   small download-row reads/writes beside native dialogs, filesystem cleanup,
   and the main-process download runtime.
2. `apps/electron-backend/src/app/events/database/epg-db.events.ts` keeps the
   EPG programme-search IPC handler.
3. `apps/electron-backend/src/app/events/epg-fetch.service.ts`,
   `apps/electron-backend/src/app/events/epg-mapping.service.ts`, and
   `apps/electron-backend/src/app/events/epg-query.service.ts` keep EPG
   freshness, mapping, and lookup behavior in their focused main-process
   owners, while EPG parsing/import remains in its dedicated worker.

Do not move these paths as part of unrelated database work. Reassess the
boundary if a handler becomes heavy enough to block the main process.

### Categories

1. `DB_HAS_CATEGORIES`
2. `DB_GET_CATEGORIES`
3. `DB_SAVE_CATEGORIES`
4. `DB_GET_ALL_CATEGORIES`
5. `DB_UPDATE_CATEGORY_VISIBILITY`

### Content

1. `DB_HAS_CONTENT`
2. `DB_GET_CONTENT`
3. `DB_SAVE_CONTENT`
4. `DB_GET_CONTENT_BY_XTREAM_ID`
5. `DB_SEARCH_CONTENT`
6. `DB_GLOBAL_SEARCH`
7. `DB_GET_GLOBAL_RECENTLY_ADDED`

`DB_GLOBAL_SEARCH` returns a shared global-search result union rather than an
Xtream-only row shape:

1. `source_type = "xtream"` rows come from the normalized `content` and
   `categories` tables joined with `playlists`. Xtream title matching uses
   `content_title_fts`, an FTS5 trigram index over `content.title`, for search
   terms with at least one 3+ character token. Tokens are quoted before being
   passed to `MATCH`, so FTS reserved words such as `and` are treated as search
   text instead of degrading to the slow fallback path. SQL prefilters keep both
   raw lower-case tokens and accent-normalized tokens, so an accented query such
   as `Café` can still reach rows stored as either `Café` or `Cafe` before the
   worker's accent-insensitive ranking step. Existing databases rebuild this
   index once through the `migration:content-title-fts-trigram:v1` app-state
   marker before legacy content cleanup/normalization migrations run; fresh
   inserts, deletes, and title updates stay synchronized through SQLite triggers.
2. `source_type = "m3u"` rows come from M3U playlist payloads stored in
   `playlists.payload`. The worker uses SQL `payload LIKE` against channel
   `name`/`title` JSON fields only as a coarse candidate prefilter, then parses
   candidate JSON payloads and matches channel name, TVG name, and group title
   case-insensitively in the worker. M3U payload prefilters also preserve raw
   accented token variants next to normalized variants. The SQL candidate query
   is capped by the same stable 5000-row candidate limit used for Xtream search,
   so large
   matching M3U payloads are not loaded without an upper bound.
3. The optional `sources` argument can restrict search to `xtream` or `m3u`,
   but omitted callers keep the backward-compatible behavior of searching all
   supported global-search sources.
4. The optional pagination argument accepts `{ limit, offset }`. The worker
   keeps the legacy default of 50 results when the argument is omitted, but the
   routed global-search view requests one extra row per page to implement
   lazy loading without requiring a separate count query. Candidate selection
   uses a stable max-size pool for every page so score-based in-memory ranking
   cannot shift already-rendered items into later pages.
5. Candidate rows are ranked in the worker after the coarse SQL prefilter.
   Exact and prefix matches sort ahead of word-prefix and substring matches;
   short first tokens such as `tv` stay anchored to the start of the title, so
   `TV Sport` matches but `Test TV` does not. These short first-token queries
   bypass trigram FTS and use the `idx_content_title` prefix index path because
   trigram tokenization cannot match 1-2 character terms. Punctuation-joined
   words such as `A&E` or `X-Men` are an exception: tokenization splits them
   into short fragments, so the intact word is preserved as a "compound word"
   (`content-search.util.ts`) that additionally matches as an exact substring —
   a supplemental trigram FTS `MATCH '"a&e"'` query for the Xtream arm (merged
   and deduped with the prefix-index candidates), intact-word `LIKE` contains
   patterns for the per-playlist and M3U payload prefilters, and a
   space-bounded whole-phrase check in the ranking step. All compound arms
   keep the remaining words of the query as SQL constraints — the FTS
   supplement AND-s the non-compound tokens as `LIKE` conditions and the
   `LIKE` prefilters compose per word — so `A&E HD` cannot fill the bounded
   candidate window with titles that only contain `A&E`. This lets `A&E`
   find `US: A&E` anywhere in the title while single short tokens stay
   prefix-anchored (issue #1161).
6. `excludeHidden` still filters hidden Xtream categories and also filters M3U
   channels whose `group.title` is listed in the playlist payload's
   `hiddenGroupTitles`.
7. M3U radio entries are returned as live results with `radio = "true"` and the
   serialized `Channel` attached for renderer playback routing. M3U global
   search rows are not Xtream content rows: they use `xtream_id = -1`, and
   Xtream-only metadata such as `rating`, `added`, and a missing `poster_url`
   is represented as `null`.
8. EPG-program text is not part of this contract; EPG search remains a separate
   feature because it uses different persistence and freshness rules.

### Playlist metadata

1. `DB_CREATE_PLAYLIST`
2. `DB_UPSERT_APP_PLAYLIST`
3. `DB_UPSERT_APP_PLAYLISTS`
4. `DB_GET_APP_PLAYLISTS`
5. `DB_GET_APP_PLAYLIST_METAS`
6. `DB_GET_APP_PLAYLIST`
7. `DB_GET_APP_PLAYLIST_FAVORITE_CHANNELS`
8. `DB_GET_PLAYLIST`
9. `DB_UPDATE_PLAYLIST`
10. `DB_DELETE_PLAYLIST`
11. `DB_DELETE_ALL_PLAYLISTS`
12. `DB_GET_APP_STATE`
13. `DB_SET_APP_STATE`

`DB_GET_APP_PLAYLIST_METAS` is the preferred path for summary surfaces such as
the workspace sidebar and dashboard source rail. It selects playlist metadata
columns only and deliberately skips the large `payload` column, which can
contain full parsed M3U channel lists. Full playlist reads must continue using
`DB_GET_APP_PLAYLIST` for one playlist or `DB_GET_APP_PLAYLISTS` for legacy
full-data workflows.

`DB_GET_APP_PLAYLIST_FAVORITE_CHANNELS` is a dashboard-oriented M3U fast path.
It resolves a playlist's favorite IDs to matching channel payloads inside the
DB worker and returns only the matched channels plus favorite order metadata.
Renderer code must still fall back to `DB_GET_APP_PLAYLIST` when the fast path
is unavailable or the SQLite playlist migration has not completed.

### Xtream refresh helpers

1. `DB_DELETE_XTREAM_CONTENT`
2. `DB_RESTORE_XTREAM_USER_DATA`

### Favorites

1. `DB_ADD_FAVORITE`
2. `DB_REMOVE_FAVORITE`
3. `DB_IS_FAVORITE`
4. `DB_GET_FAVORITES`
5. `DB_GET_GLOBAL_FAVORITES`
6. `DB_GET_ALL_GLOBAL_FAVORITES`
7. `DB_REORDER_GLOBAL_FAVORITES`

### Recently viewed

1. `DB_GET_RECENTLY_VIEWED`
2. `DB_CLEAR_RECENTLY_VIEWED`
3. `DB_GET_RECENT_ITEMS`
4. `DB_ADD_RECENT_ITEM`
5. `DB_CLEAR_PLAYLIST_RECENT_ITEMS`
6. `DB_REMOVE_RECENT_ITEM`

### Playback positions

1. `DB_SAVE_PLAYBACK_POSITION`
2. `DB_GET_PLAYBACK_POSITION`
3. `DB_GET_SERIES_PLAYBACK_POSITIONS`
4. `DB_GET_RECENT_PLAYBACK_POSITIONS`
5. `DB_GET_ALL_PLAYBACK_POSITIONS`
6. `DB_CLEAR_PLAYBACK_POSITION`

## SQLite Concurrency Rules

EPG remains on its own worker, so both workers must use compatible SQLite
pragmas.

Applied now in both the shared connection path and worker-owned connections:

1. `foreign_keys = ON`
2. `journal_mode = WAL`
3. `busy_timeout = 5000`

Current sources:

1. `libs/shared/database/src/lib/connection.ts`
2. `apps/electron-backend/src/app/workers/database.worker-connection.ts`
3. `apps/electron-backend/src/app/workers/epg-parser.worker.ts`

Main-process EPG ownership is split across focused event modules:

1. `apps/electron-backend/src/app/events/epg.events.ts` registers EPG IPC
   handlers and delegates to the modules below.
2. `apps/electron-backend/src/app/events/epg-fetch.service.ts` owns EPG
   freshness checks and multi-URL fetch orchestration.
3. `apps/electron-backend/src/app/events/epg-mapping.service.ts` owns manual
   EPG channel-mapping resolution and CRUD at the IPC boundary.
4. `apps/electron-backend/src/app/events/epg-worker.service.ts` owns EPG
   worker creation, renderer progress updates, fetch worker lifecycle, and
   clear-worker lifecycle.
5. `apps/electron-backend/src/app/events/epg-query.service.ts` owns EPG
   channel/program database lookups, metadata resolution, and DB row mapping.

Keep worker lifecycle state out of the IPC registration layer. Add new EPG DB
lookup behavior to `epg-query.service.ts`; add new EPG worker/progress behavior
to `epg-worker.service.ts`.

EPG fetch workers use an inactivity watchdog, not a fixed maximum import
duration. `EpgWorkerService` starts the watchdog when the worker is created,
refreshes it when the worker becomes ready, and refreshes it again whenever an
`EPG_PROGRESS` event increases the channel or program counters. This lets very
large XMLTV imports continue for longer than the nominal timeout as long as the
parser/database pipeline is still making progress, while still terminating a
worker that stops emitting progress.

## UI Behavior Changes

### Search

Xtream search now guards against stale async responses:

1. local playlist search uses a monotonically increasing request version
2. global search uses a separate request version in the routed workspace search
   component
3. clearing search invalidates older pending results

This prevents an older worker response from repainting over a newer query or a
cleared search state.

### Xtream type-aware content lookup

Xtream UI flows must treat `xtream_id` as only partially unique.

Current contract:

1. `xtream_id` can collide across `live`, `movie`, and `series` within the same
   playlist.
2. Any DB-backed lookup that starts from an Xtream result card, favorite button,
   recent-item update, continue-watching flow, or detail route must resolve
   content by:
    - `playlist_id`
    - `xtream_id`
    - `content.type`
3. Mixed Xtream collection identity must key entries by `type + xtream_id`,
   not `xtream_id` alone. This includes favorites maps, recent-item lists,
   dashboard collection payloads, and other UI state keyed off persisted
   Xtream content.

Why this matters:

- Search results are already type-filtered, so resolving favorites by only
  `playlist_id + xtream_id` can favorite the wrong persisted row when IDs
  collide.
- Continue-watching / recently-viewed flows that resolve by only
  `playlist_id + xtream_id` can store the wrong persisted row when a series or
  movie ID collides with a live entry.
- Mixed favorites maps keyed only by `xtream_id` can mark an unrelated live row
  as favorited when the actual favorite is a movie or series with the same
  numeric ID.
- Mixed recent/favorites collection items keyed only by `xtream_id` can cause
  local UI state to remove, reorder, or reactivate the wrong Xtream entry when
  different content types collide.

Current implementation paths:

1. `apps/electron-backend/src/app/database/operations/content.operations.ts`
2. `libs/portal/xtream/data-access/src/lib/with-favorites.feature.ts`
3. `libs/portal/xtream/data-access/src/lib/with-recent-items.ts`
4. `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts`
5. `libs/portal/shared/data-access/src/lib/collection/unified-recent-data.service.ts`
6. `libs/portal/shared/data-access/src/lib/collection/unified-favorites-data.service.ts`

### Busy states

The UI now has explicit long-running state for destructive operations:

1. recent playlist rows show row-level refresh/delete spinners
2. Xtream import overlay shows phase text and a cancel action
3. Xtream playlist rows show request-scoped progress and cancel actions
4. busy rows block repeat clicks while an operation is in flight
5. settings "remove all playlists" owns its own spinner/disabled state and
   consumes request-scoped DB operation events for progress text while the
   worker deletes playlist data

These changes matter because once SQLite work leaves the main thread, the
renderer can actually paint the loading state instead of freezing.

## Build And Packaging Notes

### Worker bundling

`apps/electron-backend/build-worker.js` produces three bundles:

1. `apps/electron-backend/src/app/workers/epg-parser.worker.ts` →
   `dist/apps/electron-backend/workers/epg-parser.worker.js`
2. `apps/electron-backend/src/app/workers/database.worker.ts` →
   `dist/apps/electron-backend/workers/database.worker.js`
3. `apps/electron-backend/src/app/workers/playlist-refresh.worker.ts` →
   `dist/apps/electron-backend/workers/playlist-refresh.worker.js`

The worker build also aliases:

1. `@iptvnator/shared/database/schema`
2. `@iptvnator/shared/database/path-utils`

These aliases avoid importing the shared database barrel from inside the worker,
which would otherwise pull in runtime code that assumes the main Electron
process environment.

### Worker path resolution

`DatabaseWorkerClient` resolves:

1. development path from `__dirname`
2. packaged path from `process.resourcesPath/dist/apps/electron-backend/workers/...`
3. fallback packaged path from `path.dirname(app.getAppPath())`

### Packaged artifact verification

`tools/packaging/verify-electron-package-layout.mjs` verifies packaged worker
artifacts for:

1. Linux unpacked resources
2. macOS app bundles
3. Windows unpacked app resources

The verifier's `workerFiles` list currently checks:

1. `epg-parser.worker.js`
2. `database.worker.js`

The playlist refresh bundle is produced by the worker build, but is not yet a
third explicit `workerFiles` check. The verifier also checks:

1. `better-sqlite3` in one approved unpacked node_modules location
2. Snap packaging compatibility settings for `better-sqlite3`:
    - `snap.base = core22`
    - Snap launch args keep the X11 fallback
    - Snap and the other non-Flatpak Linux artifacts build on Ubuntu 22.04, while Flatpak builds on a separate Ubuntu 24.04 CI runner

### Development rebuild rule

Worker-backed database logic is executed from the compiled bundle at:

1. `dist/apps/electron-backend/workers/database.worker.js`

Do not assume a source edit is active in the live app. If a fix touches:

1. `apps/electron-backend/src/app/database/operations/`
2. `apps/electron-backend/src/app/workers/`
3. `apps/electron-backend/src/app/events/database/`
4. preload-backed DB methods consumed by the renderer

then the safe workflow is:

1. rebuild the worker bundle, or the full `electron-backend` target if preload,
   main-process, or web output also changed
2. confirm the new `dist/` artifact exists or has a fresh timestamp
3. restart the Electron process
4. only then rerun CDP/manual checks or Electron E2E

A running Electron app keeps using the worker bundle it already loaded at
startup. This is a common reason a worker fix appears "not working" in manual
verification even when the source patch is correct.

## Gotchas

### Prepared-statement writes inside a transaction must use `.run()`, not `.execute()`

Drizzle's `PreparedQuery.execute()` on the `better-sqlite3` driver returns a
**promise** and defers the actual SQL to a microtask. Our bulk writers run their
statements inside a **synchronous** `db.transaction(() => { ... })` callback,
which cannot `await`. If the statement is dispatched with `.execute()`, the
transaction commits before the deferred promise settles, so the write is a
**silent no-op** — no error, no rows changed.

Always call the synchronous `.run(placeholderValues)` on prepared statements
executed inside a synchronous transaction callback:

```ts
// favorites is playlist-scoped: filter by (contentId, playlistId), otherwise
// a same-contentId favorite in another playlist gets rewritten too.
const stmt = db
    .update(schema.favorites)
    .set({ position: sql<number>`${sql.placeholder('position')}` })
    .where(
        and(
            eq(schema.favorites.contentId, sql.placeholder('contentId')),
            eq(schema.favorites.playlistId, sql.placeholder('playlistId'))
        )
    )
    .prepare();

db.transaction(() => {
    for (const { content_id, playlist_id, position } of chunk) {
        // NOT .execute()
        stmt.run({ position, contentId: content_id, playlistId: playlist_id });
    }
});
```

This bit `reorderGlobalFavorites` and `removeRecentItemsBatch` (issue #1137):
custom favorites drag-and-drop order silently never persisted for the
per-playlist ("this playlist") view. Global ("all playlists") favorites masked
it because that path also persists an order to the `appState`
`global-favorites-channel-order-v1` key and re-applies it on read, independent
of the DB `position` column. The mocked operations specs did not catch it —
a jest mock records an `.execute()` call the same as a `.run()` call, so the
regression tests explicitly assert `.run()` is used and `.execute()` is not.

## Testing

### Unit coverage added

`apps/electron-backend/src/app/services/database-worker-client.spec.ts`
covers:

1. worker ready -> request -> response flow
2. event forwarding to a pending request
3. serialized worker error propagation
4. `AbortError` propagation for cancelled work
5. cancel message routing to the live worker
6. worker exit recovery and fresh worker startup

`apps/electron-backend/src/app/events/epg.events.spec.ts` covers:

1. shared worker bootstrap usage for the EPG worker
2. `nativeModuleSearchPaths` forwarding into workerData
3. actionable worker-path resolution failures
4. EPG clear worker rejection on unexpected exit or timeout
5. case-insensitive EPG program lookup fallbacks
6. metadata lookup precedence for exact/case-insensitive id and display name
7. malformed EPG row filtering
8. active EPG fetches keep running when worker progress keeps moving

`apps/electron-backend/src/app/workers/worker-runtime-paths.spec.ts` covers:

1. packaged and development worker path resolution
2. packaged native-module search path ordering
3. aggregated native module resolution errors

### Electron responsiveness coverage

`apps/electron-backend-e2e/src/xtream-responsiveness.e2e.ts` covers:

1. large Xtream import shows the overlay promptly
2. DB worker progress events advance during import
3. renderer animation frames continue while import/delete are in progress
4. large Xtream playlist delete shows row-level busy UI and completes cleanly

`apps/electron-backend-e2e/src/electron-test-fixtures.ts` now also captures:

1. `DB_OPERATION_EVENT` history in the renderer
2. a requestAnimationFrame counter for repaint assertions

For deterministic E2E timing, tests may set:

```bash
IPTVNATOR_DB_WORKER_BATCH_DELAY_MS=20
```

This artificial delay is test-only and disabled by default. At the default
value of `0`, every cancellable batch checkpoint still yields one event-loop
turn without adding a timer delay. That yield lets the worker receive a queued
cancel message before starting the next batch.

### Useful verification commands

```bash
pnpm exec jest --config apps/electron-backend/jest.config.ts --runInBand apps/electron-backend/src/app/services/database-worker-client.spec.ts apps/electron-backend/src/app/events/epg.events.spec.ts apps/electron-backend/src/app/workers/worker-runtime-paths.spec.ts
pnpm nx run electron-backend:build-worker
pnpm exec tsc -p apps/electron-backend/tsconfig.app.json --noEmit
pnpm exec tsc -p apps/web/tsconfig.app.json --noEmit
pnpm nx run electron-backend-e2e:e2e -- --project=electron --grep "Electron Xtream Responsiveness"
pnpm run verify:package-layout -- macos arm64
pnpm run verify:package-layout -- linux
pnpm run verify:package-layout -- windows
```

### Electron runtime validation

```bash
pnpm nx serve electron-backend
agent-browser --cdp 9222 tab list
agent-browser --cdp 9222 tab 1
agent-browser --cdp 9222 snapshot -i -c -d 3
pnpm run smoke:packaged -- macos arm64
```

When worker-backed behavior changed, rebuild and restart before reconnecting:

```bash
pnpm nx run electron-backend:build-worker
CI=1 NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false pnpm nx run electron-backend:build --skip-nx-cache
stat -f "%Sm %N" dist/apps/electron-backend/workers/database.worker.js
```

Then restart the Electron process and reconnect to `127.0.0.1:9222`.

### Electron freeze tracing

When a renderer route freezes before DevTools become usable, start Electron with
one of these opt-in trace flags and inspect the terminal output:

```bash
IPTVNATOR_TRACE_STARTUP=1 pnpm run serve:backend
```

Available trace flags:

1. `IPTVNATOR_TRACE_STARTUP=1`
   Enables the broad startup trace set: BrowserWindow lifecycle, renderer
   bridge calls, DB worker requests/events, and SQL tracing.
2. `IPTVNATOR_TRACE_IPC=1`
   Logs `window.electron.*` method calls crossing the preload bridge so you can
   see whether the renderer is still reaching Electron main.
3. `IPTVNATOR_TRACE_DB=1`
   Logs redacted `DatabaseWorkerClient` request dispatch, completion timing,
   and emitted `DB_OPERATION_EVENT` summaries. It also enables the safe SQL
   statement-type summaries described below.
4. `IPTVNATOR_TRACE_SQL=1`
   Logs only a fixed allowlisted statement type such as `SELECT`, `INSERT`, or
   `UPDATE` for the shared main-process and worker connections. The verbose
   hook output passes through
   `libs/shared/logging/src/lib/sql-trace-summary.ts`; expanded SQL text and
   bound values are never emitted.
5. `IPTVNATOR_TRACE_WINDOW=1`
   Logs BrowserWindow loading, navigation, `unresponsive`, and
   `render-process-gone` transitions.
6. `IPTVNATOR_TRACE_RENDERER_CONSOLE=1`
   Mirrors renderer console messages into the Electron terminal output when the
   renderer itself is the thing getting wedged.

### Electron E2E troubleshooting

If a production-mode Electron or Electron E2E launch shows `ERR_FILE_NOT_FOUND`
for hashed `chunk-*.js`, `main-*.js`, or `styles-*.css` assets:

1. treat `dist/apps/web` as stale first
2. rerun a deterministic production build, for example:

```bash
CI=1 NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false pnpm nx run electron-backend:build --skip-nx-cache
```

3. verify `dist/apps/web/index.html` uses `<base href="./">` before relaunching
   Electron in file-backed mode

## Current Limitations

These remain intentionally out of scope:

1. moving network-heavy Xtream fetches off the current path
2. migrating explicitly lightweight download and EPG-specific main-process
   handlers without evidence that they block Electron main
3. richer delete progress reporting for bulk destructive operations
4. repo-wide Angular/Jest cleanup for the currently failing web test baseline

## Extending The Worker

When adding another heavy SQLite operation:

1. Put SQL-heavy logic in `apps/electron-backend/src/app/database/operations/`.
2. Add the channel name to `database-worker.types.ts`.
3. Handle it in `database.worker.ts`.
4. Proxy the IPC handler through `DatabaseWorkerClient`.
5. If the renderer needs progress, emit a request-scoped `DbOperationEvent`.
6. Reuse existing preload/service APIs where possible instead of creating a new
   renderer-facing contract.
7. Re-run the worker unit test and at least one Electron runtime smoke.
