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
  The transfer streams the response through the backend's validated Axios redirect helper instead of `electron-dl`. Headers (user agent, referer, origin) are persisted in `request_headers` and re-applied through the same allowlist when read back on retry/resume. Xtream VOD downloads use the playlist's configured User-Agent when present and otherwise share the provider-compatible `XTREAM_CLIENT_USER_AGENT` used by Xtream API requests and stream probes. Retry, resume, and missing-file recovery resolve the owning playlist type and add that fallback to legacy Xtream rows without a stored User-Agent; Stalker rows are left unchanged. Active pause/cancel operations abort the current request with `AbortController`; pause keeps the partial file and cancel removes it. Resume checks the existing `.part` size (rejecting anything that is not a regular file, so a symlink planted while paused is never followed) and sends `Range: bytes=<offset>-` plus `If-Range` with the stored entity validator. The first response's strong `ETag` (or `Last-Modified`) is persisted in `resume_validator` for exactly this purpose. A `206 Partial Content` answer must start at the requested offset (`Content-Range` is verified) before bytes are appended; any other 2xx answer — the server ignoring `Range`, or `If-Range` detecting that the remote file changed — restarts the transfer from byte zero over the same `.part` instead of failing the download.
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
  and allowlisted network interruptions after bytes reached disk deliberately
  retain it (the row keeps `filePath` so a later retry can finish without
  re-downloading); pause and restart recovery keep it for a later resume.
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
  replace or narrow that signal. Overlapping loads are request-ordered so a
  late response cannot replace a newer snapshot. Before each fresh download or
  resume the service asks the main process for an authorized folder and calls
  the corresponding IPC command. The `onDownloadsUpdate` broadcast triggers a
  new global load.
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
  queue uses compact progress rows with status text and icons; completed movies
  and grouped series reuse the portal's canonical content grid. Both completed
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
  titles on completed movie and grouped-series cards open the focused offline
  detail for that download; the explicit card Play action still starts the
  local file. A legacy standalone episode without a usable series id stays
  directly playable because there is no reliable series detail to build.
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

Keeping the backend queue, IPC handlers, shared schema, and renderer signals
synchronized minimizes drift between platform rules and the UI. Future work
might cover recordings, queue reordering, bulk pause/cancel actions, disk-free
space telemetry, or playback analytics.
