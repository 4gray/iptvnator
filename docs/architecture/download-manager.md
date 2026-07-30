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
  The transfer streams the response through the backend's validated Axios redirect helper instead of `electron-dl`. Headers (user agent, referer, origin) are persisted in `request_headers` and re-applied through the same allowlist when read back on retry/resume. Active pause/cancel operations abort the current request with `AbortController`; pause keeps the partial file and cancel removes it. Resume checks the existing `.part` size (rejecting anything that is not a regular file, so a symlink planted while paused is never followed) and sends `Range: bytes=<offset>-` plus `If-Range` with the stored entity validator. The first response's strong `ETag` (or `Last-Modified`) is persisted in `resume_validator` for exactly this purpose. A `206 Partial Content` answer must start at the requested offset (`Content-Range` is verified) before bytes are appended; any other 2xx answer — the server ignoring `Range`, or `If-Range` detecting that the remote file changed — restarts the transfer from byte zero over the same `.part` instead of failing the download.
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
  overwriting an existing file; cancel and ordinary transfer failures remove
  the `.part`, while finalization failures and completed-partial failures
  deliberately retain it (the row keeps `filePath` so a later retry can finish
  without re-downloading); pause and restart recovery keep it for a later
  resume. Re-downloading such a failed row from a detail page
  (`DOWNLOADS_START`) deletes the retained `.part` before the row is reset.
- **IPC surface**  
  The backend exposes `DOWNLOADS_*` handlers for list retrieval, start/pause/resume/cancel/retry/remove operations, folder selection/reveal, and the `DOWNLOADS_UPDATE_EVENT` emitter that the renderer listens to in order to refresh its signal store.

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
  `failed` and `canceled` rows form the attention surface; only `completed`
  rows enter the offline library. Completed episodes with a valid
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
  surfaces use the existing `--app-*` and Material system tokens. The global
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
  titles on completed movie and grouped-series cards open the provider detail
  page; the explicit Play action starts the local file. A legacy standalone
  episode without a usable series id stays directly playable because there is
  no reliable detail route to open.

## Offline detail playback

- A completed VOD renders an Offline tag on both rich and fallback detail
  shells. Its primary action plays the downloaded file, while a neutral
  “Play from this source” action preserves the existing provider, pinned-source,
  resume, and restart path.
- Managed MPV/VLC state remains authoritative: Opening disables conflicting
  playback actions, and Stop closes the matched external session before any
  local or provider choice can run.
- Detail metadata still comes from the owning Xtream or Stalker provider.
  Download rows do not cache a standalone offline detail payload in this MVP,
  so a provider that is unavailable may prevent the detail shell from loading;
  the explicit Play action on the download card remains available for the
  local file.

## Global API surface

- **Preload + types**  
  `apps/electron-backend/src/app/api/main.preload.ts` wires every download IPC command plus the `onDownloadsUpdate` listener to `window.electron`. The shared `ElectronBridgeApi` contract in `libs/shared/interfaces/src/lib/electron-api.interface.ts` owns the download and playback-position method types; `global.d.ts` and `apps/web/src/typings.d.ts` reference that contract instead of redeclaring the bridge.

## Routing and navigation

- The global workspace is `/workspace/downloads`. Source-scoped variants are
  available under both portal flavors:
  `/workspace/xtreams/:id/downloads` and
  `/workspace/stalker/:id/downloads`. All three routes render the same global
  store; the `:id` routes derive a view-only playlist scope.
- Downloads navigation is data-driven: `libs/portal/shared/util/src/lib/navigation/portal-rail-links.ts` emits a `downloads` section link (`path: [...root, 'downloads']`) for both portals, so they reuse the same download page.

## Queuing, persistence, and UX notes

- Every download row writes to the shared `downloads` table with statuses (`queued`, `downloading`, `paused`, `completed`, `failed`, `canceled`) plus metadata such as `bytesDownloaded`, `totalBytes`, `errorMessage`, `requestHeaders`, `resumeValidator`, and Xtream identifiers. Existing SQLite tables are rebuilt on startup when their status CHECK still lacks `paused`; the `resume_validator` column is added through the idempotent column migrations.
- On startup, `download-recovery.ts` converts stale `downloading` rows with a non-empty `.part` file to `paused`, converts stale `queued` rows to `paused` while keeping any retained `.part` (a resumed download waiting behind an active one persists as `queued` with its partial), and marks stale `downloading` rows without recoverable partial bytes as `failed`.
- Queue cancellation removes a queued task or records an active cancellation request and aborts the request when available. Pausing follows the same abort path but persists `paused` and keeps the `.part`. Retries reuse the same database entry: a failed row with a retained `filePath` resumes its `.part` through HTTP Range, otherwise the retry starts from zero. Resume appends to the existing `.part` through HTTP Range with `If-Range` validation.
- A `.part` that cannot be deleted (locked, permission denied) never loses its database path: cancel persists `canceled` while retaining `filePath` for later cleanup, and `DOWNLOADS_REMOVE` keeps the row and answers `success: false` (surfaced as a snackbar) so retrying the remove re-attempts the deletion once the lock is released.
- Resume claims the row atomically (`paused` → `queued` as a conditional update) and the runtime queue rejects duplicate ids, so two rapid Resume clicks racing the status refresh can never produce two transfers for the same download.
- A response that ends cleanly before the advertised representation size (for example a proxy that caps each response) is never committed as completed: the transfer fails with `Transfer ended before the advertised size` while retaining the `.part` and `filePath`, so a retry continues via Range from where it stopped.
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
might cover an offline metadata snapshot for provider-independent details,
recordings, queue reordering, bulk pause/cancel actions, disk-free space
telemetry, or playback analytics.
