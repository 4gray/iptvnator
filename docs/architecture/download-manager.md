# Download Manager Architecture

The download manager is a desktop-only feature that layers a curated queue,
progress tracking, storage configuration, and playback controls on top of the
existing Xtream (`libs/portal/xtream`) + Stalker (`libs/portal/stalker`) portal
views. Backend work is handled in the Electron process while the Angular
renderer exposes the global `/workspace/downloads` page, source-scoped route
variants, contextual buttons, and theme-aware styling.

## Backend responsibilities

- **Queue control (`apps/electron-backend/src/app/events/database/download-runtime.ts`)**
  `DownloadTask` mirrors a row of the shared `downloads` table (type `Download` in `libs/shared/database/src/lib/schema.ts`) plus transient cancel/pause/progress helpers (shared task types live in `download-task.ts`). Request validation and row creation live in `download-requests.ts`, while `downloads.events.ts` stays focused on IPC registration. `enqueueDownload()` pushes the task onto `downloadQueue` and triggers `processQueue()`. `processQueue()` keeps one active download, updates the row to `downloading`, and calls `startDownload()`. The byte transfer itself lives in `download-transfer.ts`, finalization and retained-partial persistence in `download-finalize.ts`, and the renderer update broadcast in `download-broadcast.ts`.
- **Range-aware transfer (`download-transfer.ts`)**
  The transfer streams the response through the backend's validated Axios redirect helper instead of `electron-dl`. Headers (user agent, referer, origin) are persisted in `request_headers` and re-applied through the same allowlist when read back on retry/resume. Fresh Xtream movie and series-episode downloads propagate the playlist's configured headers, using its User-Agent when present and otherwise sharing the provider-compatible `XTREAM_CLIENT_USER_AGENT` used by Xtream API requests and stream probes. Retry, resume, and missing-file recovery resolve the owning playlist type and add that fallback to legacy Xtream rows without a stored User-Agent; known Stalker rows are left unchanged. Download rows deliberately outlive individually deleted playlists, so a headerless legacy row whose source no longer exists receives the same IPTV-player fallback because its original provider type cannot be recovered. Active pause/cancel operations abort the current request with `AbortController`; pause keeps the partial file and cancel removes it. Resume checks the existing `.part` size (rejecting anything that is not a regular file, so a symlink planted while paused is never followed). The first response's strong `ETag` (or `Last-Modified`) is persisted in `resume_validator`; only a partial carrying that validator may send `Range: bytes=<offset>-` plus `If-Range` and append bytes. A retained partial without a validator restarts from byte zero and overwrites its `.part`, so a changed remote representation can never be joined to an unverified prefix. A `206 Partial Content` answer must start at the requested offset (`Content-Range` is verified) before bytes are appended; any other 2xx answer — the server ignoring `Range`, or `If-Range` detecting that the remote file changed — restarts the transfer from byte zero over the same `.part` instead of failing the download.
- **Destination collision policy**
  Existing destination files are never overwritten, inspected, or deleted.
  Before starting a new transfer, the backend atomically reserves a free
  numbered `.part` path while leaving the final destination path absent. The
  selected final `filePath` and `fileName` are persisted before transfer
  begins. When a retained download's recorded destination got occupied while
  it was paused or failed (for example by a file the user created), the
  retained `.part` is renamed aside and finalized to the next free numbered
  destination (`Movie (1).mp4`) instead of resolving the collision by size or
  `unlink()`. Completion creates the final `filePath` from the `.part` without
  overwriting an existing file; cancel and non-recoverable transfer failures
  remove the `.part`, while finalization failures, completed-partial failures,
  and allowlisted network interruptions after bytes reached disk with a stored
  representation validator deliberately retain it (the row keeps `filePath`
  so a later retry can finish without re-downloading); pause and restart
  recovery keep partials, but a later retry starts over when no validator was
  available.
  Re-downloading such a failed row from a detail page
  (`DOWNLOADS_START`) deletes the retained `.part` before the row is reset.
- **Derived file readiness and recovery**
  `DOWNLOADS_GET_LIST` and `DOWNLOADS_GET` inspect completed destinations on
  every read. Only regular, non-symbolic-link files are reported as available;
  missing paths, directories, symlinks, and inspection errors are reported as
  missing without changing the persisted `completed` transfer status.
  `DOWNLOADS_REDOWNLOAD_MISSING` accepts only the managed row id, rechecks the
  file, and returns a recovered result without network access when it has
  reappeared. Otherwise it conditionally claims the completed row, preserves
  its owned destination, re-applies the stored header allowlist and URL safety
  policy, and enqueues a fresh transfer without overwriting an existing file.
- **IPC surface**  
  The backend exposes `DOWNLOADS_*` handlers for list retrieval,
  start/pause/resume/cancel/retry/missing-file recovery/remove operations,
  folder selection/reveal, and the `DOWNLOADS_UPDATE_EVENT` emitter that the
  renderer listens to in order to refresh its signal store.

## Renderer architecture

- **Downloads service** (`libs/services/src/lib/downloads.service.ts`)
  `DownloadsService.downloads` is the renderer's authoritative **global** list.
  `loadDownloads()` therefore always invokes the Electron list IPC without its
  legacy optional playlist scope. Route scope, category, and search must never
  replace or narrow that signal. Loads are serialized: at most one list IPC is
  active, and callers arriving during it coalesce behind one trailing refresh.
  Each response therefore commits in request order. A caller assigned to the
  trailing refresh resolves after that refresh settles even when later
  broadcasts queue the following refresh, preventing both stale continuation
  and starvation during frequent progress updates.
  `hasLoadedDownloads` records that the latest attempt completed, including an
  error, while
  `hasAuthoritativeDownloadList` becomes true after a successful request,
  remains true while a later refresh is in flight, and clears only if the
  latest request fails. Series download actions require both loaded and
  authoritative state so a failed refresh cannot restart rows missing from a
  stale or empty renderer snapshot. Before each fresh download or resume the
  service asks the main process for an authorized folder and calls the
  corresponding IPC command. The `onDownloadsUpdate` broadcast triggers a new
  global load.
- **Series season queueing**
  `SeasonDownloadCoordinator` owns synchronous, per-identity pending
  reservations and submits an individual episode or selected-season snapshot
  through `DownloadsService.startDownload()`. Season batches are sequential
  and best-effort: one candidate failing does not stop later candidates. After
  added or stable duplicate submissions, one authoritative list refresh closes
  the pending-to-queued/downloaded handoff, and the coordinator returns
  `added`, `skipped`, and `failed` counts. Xtream and Stalker adapters own
  provider URL, request header, and metadata preparation; the coordinator owns
  only provider-neutral orchestration. When a reserved candidate matches a
  completed-missing row, the coordinator performs one authoritative preflight
  refresh before any provider preparation. If another list request is active,
  the preflight joins the single trailing refresh; later download-update
  broadcasts cannot delay that assigned refresh. Restored files therefore
  become stable skips without requiring a Stalker URL/network request. Both
  providers use normalized `episode.id` as the canonical
  episode `xtreamId`; Stalker `originalCmd` and `originalId` participate only
  in URL resolution. Provider adapters preserve numeric season zero, including
  a fallback season key of `"0"`, so Specials keep distinct `S00` coordinates.
  The exact `(playlistId, contentType, xtreamId)` identity is authoritative.
  Complete `(playlistId, seriesXtreamId, seasonNumber, episodeNumber)`
  coordinates are a legacy episode-compatibility fallback. Stalker also stores
  an `episode_identity_scope` for regular `/series`, embedded VOD `series[]`,
  and lazy Ministra VOD `is_series` origins. A known different scope is a
  different episode owner; an older coordinate row without a provable scope
  fails closed instead of being migrated across modes. Exact canonical legacy
  rows remain authoritative. Other ambiguous or conflicting matches resolve to
  the same explicit renderer conflict state rather than masquerading as a
  missing row, so both the episode action and season count fail closed.
  SQLite `null` and optional `undefined` coordinates both mean that a canonical
  legacy row is incomplete, matching the backend resolver. Renderer-pending,
  queued, downloading, and paused episodes are skipped, as are completed rows
  whose file is available or whose availability is still unknown. Failed,
  canceled, completed-missing, and unambiguous row-less episodes are eligible;
  a completed-missing row is restarted as a fresh download. Before resetting
  such a completed row, `DOWNLOADS_START` asynchronously rechecks its retained
  path in the main process. A restored file returns stable
  `reason: 'already-downloaded'` without mutation; active matches return
  `reason: 'already-in-progress'`. The recheck has a one-second caller deadline
  that starts before shared-slot acquisition; timeout or probe failure leaves
  the row untouched and returns a failed submission, allowing the sequential
  season loop to continue. Completed-file list callers have the same deadline
  and report a timeout as missing for that snapshot. The underlying filesystem
  operation remains coalesced and charged against the four-probe cap until it
  actually settles, so later callers get independent bounded waits without
  duplicating stalled native work. Only `ENOENT` and `ENOTDIR` are authoritative
  absence; permission, I/O, and other probe errors remain unknown, so
  `DOWNLOADS_START` leaves the completed row and file path untouched. Before a
  completed-missing, failed, or canceled row clears its path, the same start IPC
  asynchronously removes any retained `.part`. Cleanup coalesces same-path work
  and allows at most four underlying unlinks. A one-second admission deadline
  rejects queued work before it can mutate the filesystem; once an unlink
  starts, the request awaits its authoritative result so no late side effect can
  race a retry. Permission and I/O failures keep the row's ownership intact,
  while `ENOENT` and `ENOTDIR` safely proceed. The coordinator counts both stable
  duplicate reasons as skipped. There is no batch IPC,
  parallel transfer, or queue reordering: destination authorization, persisted
  header handling, and the backend's one-active-transfer FIFO semantics remain
  unchanged.
- **Pure manager model**
  (`download-manager.viewmodel.ts` and `download-library.viewmodel.ts`)
  derives the current route scope, search/category filtering, queue partitions,
  stable ordering, counts, and tracked byte total without mutating service
  state. `queued`, `downloading`, and `paused` rows form the active surface;
  `failed` and `canceled` rows form the attention surface. A `completed` row
  whose derived file availability is missing also enters attention with a
  dedicated recovery reason; only available completed rows enter the offline
  library. Completed episodes with a valid
  `seriesXtreamId` are grouped by `(playlistId, seriesXtreamId)`, ordered by
  season and episode, and represented by one poster card. Episodes without a
  usable series id remain standalone cards so they never disappear.
- **Downloads workspace** (`libs/portal/downloads/feature`)
  keeps orchestration in `DownloadsComponent`, async mutations in the
  component-scoped `DownloadManagerActionsService`, source-route resolution in
  `DownloadLibraryNavigationService`, and rendering in the presentational
  `DownloadQueueComponent`, `DownloadLibraryComponent`, and
  `DownloadedSeriesDialogComponent`. Presentational children emit typed
  `DownloadItemAction` values and do not inject the download service, router,
  dialogs, or snackbars.
  The fixed header and filter row sit above one vertical scroll owner. The
  queue and library sections share one heading treatment (the dashboard-rail
  title style with an `.app-count-badge` item count) so same-level sections
  read alike; the queue's bordered panel wraps only the row list. Queue rows
  expose exactly one visible primary action — pause, resume, or retry — while
  cancel, copy-URL, and remove live in the row's overflow menu, so two
  adjacent destructive icons never compete. Completed movies
  and grouped series reuse the portal's canonical content grid as compact
  poster cards borrowed from the dashboard-rail card language: a type badge
  and an always-visible ⋮ trigger sit on the artwork, the title and series
  facts sit below it, and Play / Show in folder / Copy URL / Remove live in
  that overflow menu. File size is not repeated on the card; it belongs to the
  focused offline detail. Both completed
  cards and their loading skeleton consume the global
  `--cover-grid-min-width` / `--cover-gap` tokens, so the Small, Medium, and
  Large cover preference behaves like it does elsewhere in the app. All
  surfaces use the existing `--app-*` and Material system tokens. Ready cards
  do not repeat an Offline badge; source provenance is available at the top of
  their overflow menus. The global
  workspace download shortcut displays the service's active count, while the
  page badge and filter counts reflect the current route scope.
- **Honest interactions**
  Every asynchronous item command owns a pending id until the IPC result
  settles, preventing duplicate dispatch without optimistically changing a
  status. Service failures surface through the established snackbar path.
  Removing a completed entry explicitly says the finalized media file remains
  on disk. Removing a paused, failed, or canceled entry says retained partial
  data is deleted. “Clear finished” communicates both outcomes and preserves
  playlist scope when the page is opened under a source route. VOD and episode
  detail views continue to render a paused download as an active Resume button
  (`DownloadsService.isPaused()` / `resumeDownloadByContent()`). Artwork and
  titles on every completed card — movie, grouped series, and standalone
  episode alike — open the focused offline detail for that download; the
  explicit Play command in the poster's overflow menu still starts the local
  file directly. A legacy standalone episode without a usable series id
  resolves to a single-episode offline detail built from its own row.
  Missing completed rows show `File missing` under Needs attention with
  `Download again`; Play and Show in folder are withheld. A file-action race
  that returns `File not found` refreshes the authoritative list and returns
  the user from focused details to the manager.

## Focused offline details

- Ready movies and grouped series open a local-focused detail view rather than
  a provider catalog page. A movie exposes local Play and Show in folder. A
  series projects only completed episode rows whose finalized files are still
  available, grouped into seasons; every episode Play and Show in folder action
  targets that row's local file. The provider's other seasons and episodes are
  deliberately absent from this view.
- `View in portal` resolves an exact category/item route for Xtream. For
  Stalker it accepts a matching recently-viewed snapshot only when its raw
  movie/regular-series/VOD-series markers agree with the download type, so
  overlapping movie and series ids cannot select the wrong item. An exact
  numeric category stored in the download snapshot wins over the recent
  collection's virtual `vod`/`series` category. Without a matching recent
  shape, only a movie with that exact numeric category can form a
  metadata-only target; episodes and legacy movies without one leave the
  handoff unavailable. The normal provider detail opens in one-shot
  `provider-only` presentation: provider content and playback remain available
  when that host resolves them, while local, Offline, and download actions are
  hidden.
- A completed row that is no longer locally available is never rendered as a
  ready offline detail. Direct or stale detail URLs return to the manager; if
  navigation fails, the detail shell shows the missing-file error with Back and
  Retry. Invalid or removed download ids render a focused not-found state.
- Movie and episode downloads capture a versioned, display-only metadata
  snapshot at start time from the already-rendered Xtream or Stalker detail,
  including any TMDB fields already present. The snapshot keeps provider
  identity/category separately from presentation metadata and lets the offline
  view render even when the source portal is unavailable.
- A grouped series selects its newest valid parent snapshot, then fills only
  missing parent metadata from older valid member snapshots. Newer values,
  per-episode metadata, language, and freshness identity remain authoritative.
  Each episode row still uses its own stored episode metadata.
- Legacy rows and sparse, stale, or wrong-language snapshots are backfilled
  when focused details open: row metadata supplies a safe local fallback,
  provider data is merged when it can be resolved, and opt-in TMDB enrichment
  uses the same app language and merge rules as provider details. Successful
  refreshes persist to the representative row; transient failures keep safe
  improvements without falsely marking the snapshot fresh, and concurrent
  refreshes are request-ordered so only the latest generation may write.
- Snapshot artwork accepts only safe HTTP(S) image URLs. Renderer normalization
  and main-process persistence independently reject credential-shaped path and
  query keys, including `username`, so provider credentials cannot be cached in
  offline metadata.

## Global API surface

- **Preload + types**  
  `apps/electron-backend/src/app/api/main.preload.ts` wires every download IPC command plus the `onDownloadsUpdate` listener to `window.electron`. The shared `ElectronBridgeApi` contract in `libs/shared/interfaces/src/lib/electron-api.interface.ts` owns the download and playback-position method types; `global.d.ts` and `apps/web/src/typings.d.ts` reference that contract instead of redeclaring the bridge.

## Routing and navigation

- The global workspace is `/workspace/downloads`. Source-scoped variants are
  available under both portal flavors:
  `/workspace/xtreams/:id/downloads` and
  `/workspace/stalker/:id/downloads`. All three routes render the same global
  store; the `:id` routes derive a view-only playlist scope.
- Each scope exposes the same focused child route:
  `/workspace/downloads/:downloadId`,
  `/workspace/xtreams/:id/downloads/:downloadId`, and
  `/workspace/stalker/:id/downloads/:downloadId`. The workspace shell treats
  all three as focused content: route search is disabled and the context panel
  is `none`, so provider categories are not shown beside a local-only item.
- The manager persists its selected All/Movies/Series/In progress filter in
  the current route query with `replaceUrl`. Opening a focused item then keeps
  that exact scoped URL as its validated return target, so Back restores the
  manager's scope, search query, filter, and browser-history position.
- Downloads navigation is data-driven: `libs/portal/shared/util/src/lib/navigation/portal-rail-links.ts` emits a `downloads` section link (`path: [...root, 'downloads']`) for both portals, so they reuse the same download page.

## Queuing, persistence, and UX notes

- Every download row writes to the shared `downloads` table with statuses (`queued`, `downloading`, `paused`, `completed`, `failed`, `canceled`) plus metadata such as `bytesDownloaded`, `totalBytes`, `errorMessage`, `requestHeaders`, `resumeValidator`, the offline-detail metadata snapshot, and Xtream identifiers. Downloads are locally owned records rather than playlist children: deleting a source retains its rows and local files, keeps them visible in the global library, and disables provider handoff until that source exists again. Startup rebuilds older tables that still carry the playlist foreign key, while additive columns use the idempotent column migrations.
- Download-list and focused-detail reads verify completed files with asynchronous `lstat` probes in the main process. One shared probe queue permits at most four filesystem calls at once and coalesces only in-flight checks for the same path; it does not cache completed results, so external file deletion is visible on the next refresh without letting frequent progress broadcasts block Electron's main thread.
- On startup, `download-recovery.ts` converts stale `downloading` rows with a non-empty `.part` file to `paused`, converts stale `queued` rows to `paused` while keeping any retained `.part` (a resumed download waiting behind an active one persists as `queued` with its partial), and marks stale `downloading` rows without recoverable partial bytes as `failed`.
- Queue cancellation removes a queued task or records an active cancellation request and aborts the request when available. Pausing follows the same abort path but persists `paused` and keeps the `.part`. Retries reuse the same database entry: a failed row with a retained `filePath` resumes its `.part` through HTTP Range, otherwise the retry starts from zero. Resume appends to the existing `.part` through HTTP Range with `If-Range` validation.
- A `.part` that cannot be deleted (locked, permission denied) never loses its database path: cancel persists `canceled` while retaining `filePath` for later cleanup, and `DOWNLOADS_REMOVE` keeps the row and answers `success: false` (surfaced as a snackbar) so retrying the remove re-attempts the deletion once the lock is released.
- Resume claims the row atomically (`paused` → `queued` as a conditional update) and the runtime queue rejects duplicate ids, so two rapid Resume clicks racing the status refresh can never produce two transfers for the same download.
- A response that ends cleanly before the advertised representation size (for example a proxy that caps each response) is never committed as completed: the transfer fails with `Transfer ended before the advertised size` while retaining the `.part` and `filePath`, so a retry continues via Range from where it stopped.
- An allowlisted mid-response network failure such as `ECONNRESET` is recoverable only when the response advertised a larger total and the `.part` contains valid incomplete bytes. This includes a validated `206` resume that drops before adding another byte. The failed row retains that partial and exposes a stable `DOWNLOAD_NETWORK_INTERRUPTED (<code>)` message without a URL; Retry continues through the same Range/If-Range validation. Pre-response failures, unknown stream errors, filesystem errors, empty fresh failures, and responses without a trustworthy total keep the generic failure path.
- Retained `filePath`s recorded in the database stay usable after the user switches download folders — resume/retry of a retained row does not re-require the folder to be the current selection. Fresh downloads still authorize against the currently selected folder.
- Startup recovery recognizes a finalization that crashed between creating the final file and committing the row (`downloading` row, no partial, final file present with the recorded size) and marks it `completed` instead of failing it and orphaning the file.
- Pause/resume is covered end to end by `apps/electron-backend-e2e/src/downloads.e2e.ts`: a throttled Range-capable mock server verifies the paused `.part` on disk, the `Range`/`If-Range` resume request, and byte-exact assembly of the final file.
- The OS downloads path is always authorized. A custom folder becomes
  authorized only after native folder selection, and the main process persists
  that selection under Electron `userData`. Renderer settings may display the
  path, but they are not trusted as authorization.
- The manager's search and All/Movies/Series/In progress filters affect visible
  queue and library entities only. The tracked-byte summary deliberately
  ignores search/category filtering while honoring route scope, so hiding a
  card never makes its disk footprint appear to vanish.

## Live-TV recordings

Recordings made with the embedded MPV player live beside downloads, not inside
them: a recording has no source URL to re-fetch, no byte totals, and no
retry/resume semantics, so it gets its own `recordings` SQLite table (no
unique index — re-recording a channel is normal; `playlist_id` carries no FK
so recordings survive source deletion, with `playlist_name` stored as a
display snapshot via `playlistDisplayLabel`).

- **Lifecycle tracking** is owned by `EmbeddedMpvRecordingTracker`
  (`apps/electron-backend/src/app/services/embedded-mpv-recording-tracker.ts`):
  explicit start/stop hooks in `EmbeddedMpvNativeService` plus a
  session-snapshot observer. The stop hook is a *request*, not an outcome —
  `addon.stopRecording()` only dispatches (async mpv property set, or a
  command written to the frame-copy helper), so finalization always waits for
  the snapshot reporting the recording inactive; statting or unlinking
  earlier would report a short recording as failed and could delete bytes mpv
  is still flushing. macOS native-view clears `recordingActive` *before*
  dispatching the async property set and restores it if that request is
  rejected, so an inactive snapshot must additionally survive a 1.5 s settle
  window (three poll cycles) before it counts as an acknowledgement; a revived
  recording cancels the pending finalization. A 10 s bound finalizes anyway if
  the acknowledgement never arrives. The same observer covers the stop paths that never call
  `stopRecording()` at all (stream-replacement auto-stop, frame-copy helper
  crash, session error/close). Statuses: `recording` → `completed` (acknowledged
  stop, `fs.stat` size) / `interrupted` (implicit stop with a playable partial
  — MPEG-TS is streamable) / `failed` (start error or absent/empty file). Only
  a recording that never went active has its empty pre-reserved file unlinked;
  once mpv owned the file, the bytes are left alone. Rows carry `owner_pid`,
  so startup repair (`recording-recovery.ts`, `reconcileStaleRecordings`)
  resolves what a hard kill left in `recording` while skipping rows another
  live instance still owns (`IPTVNATOR_ALLOW_MULTIPLE_INSTANCES`).
- **Metadata is captured at recording start** (EPG is time-sensitive and
  Xtream/Stalker EPG never reaches SQLite): each live host — M3U player,
  Xtream live layout, Stalker ITV layout, unified live tab — assembles a
  `RecordingStartMetadata` (channel name/logo, playlist id + display-label
  snapshot, source type, EPG key, current program) that flows
  `WebPlayerViewComponent → EmbeddedMpvPlayerComponent →
  EmbeddedMpvControlsAdapter → EmbeddedMpvRecordingStartOptions.metadata`.
  `EmbeddedMpvPlayerComponent` watches the session snapshot for the
  active→inactive recording edge and emits `recordingStopped` — one owner for
  every trigger, including a Stop clicked in the download manager, which
  talks to the main process directly and never reaches the player's own
  toggle. The event carries the EPG key captured while the recording was
  active, because a channel switch auto-stops the recording and the host's own
  state already describes the new channel by the time the stop is handled;
  each host enriches only when that key still matches its current channel. The host answers with **stop enrichment**: it filters its in-memory
  program list to the programs overlapping `[startedAt, endedAt]`
  (`filterRecordingProgramsOverlap` in `@iptvnator/shared/interfaces`) and
  sends them through `RECORDINGS_UPDATE_PROGRAMS`, keyed by the unique
  target path — that is how a recording spanning a program boundary lists
  every covered show. The handler awaits `whenFinalized(targetPath)` before its
  terminal-row lookup, since the stop IPC returns before mpv acknowledges.
  That deadline bounds only the wait for mpv (fallback + 1 s); once
  finalization has started the wait follows the terminal write itself, so a
  slow database can never make the one-shot enrichment miss its row. A recording stopped while no player is mounted on that
  channel keeps its start snapshot.
- **IPC surface** (`recordings.events.ts`): `RECORDINGS_GET_LIST/GET/STOP/
  REMOVE/UPDATE_PROGRAMS/REVEAL_FILE/PLAY_FILE` plus the dedicated
  `RECORDINGS_UPDATE_EVENT` bare ping (not shared with downloads, so
  recording transitions do not force availability-probed download refetches).
  Active rows are decorated with a live `fs.stat` size — `file_size_bytes` is
  only persisted at finalization, so the manager's growing size comes from
  there. Recording totals also feed the manager-wide All chip and the header's
  active badge, so a page listing only recordings never reads "All 0".
  Reveal/play are gated by `isManagedRecordingFile` — the path must exist in
  the recordings table, mirroring `isManagedDownloadFile`, so the
  renderer-supplied recording directory stays a write-location preference
  rather than a shell-access grant. `RECORDINGS_STOP` resolves the row's
  `session_id` and stops through `EmbeddedMpvNativeService`, so the manager
  can stop a recording without knowing about MPV sessions — but only for rows
  this process owns: session ids restart per process, so dispatching a
  foreign row's id would stop an unrelated local recording. Remove keeps
  finished files on disk (same contract as downloads) and cleans up a failed
  row's leftover reservation only while no other row claims that path — a
  retry within the same timestamp second reuses the freed name. Renderer gate: a separate
  `supportsRecordings` capability allowlist — deliberately NOT folded into
  `supportsDownloads`, which would strip older builds of the whole manager.
- **UI**: `RecordingsService` mirrors `DownloadsService` (one global list,
  coalesced refreshes via `DownloadListLoadState`, refetch on ping). The
  manager adds a `recording` filter chip; `recording-manager.viewmodel.ts`
  partitions rows into a "Recording now" queue section (pulsing REC chip with
  elapsed time and live file size — never a percentage, the length is
  unknown), a recordings-only Needs attention list (Remove only: a broadcast
  cannot be re-recorded), and a "Recordings" library section of 16:9
  channel-logo cards (`recording-queue.component.*`,
  `recording-library.component.*`). Card titles use the captured program
  title, falling back to channel + start time. The focused detail
  (`recording-detail/`, route `/workspace/downloads/recording/:recordingId`,
  context panel and route search hidden via `workspace-shell-route.utils.ts`)
  shows the recorded time range, covered programs when a recording spans ≥2
  shows, file path, and Play/Reveal/Stop/Remove; a missing file degrades to
  Back + Remove.

Keeping the backend queue, IPC handlers, shared schema, and renderer signals
synchronized minimizes drift between platform rules and the UI. Future work
might cover queue reordering, bulk pause/cancel actions, disk-free space
telemetry, playback analytics, or frame-copy screenshot posters for
recordings.
