# Download Manager Architecture

The download manager is a desktop-only feature that layers a curated queue, progress tracking, storage configuration, and playback controls on top of the existing Xtream (`libs/portal/xtream`) + Stalker (`libs/portal/stalker`) portal views. Backend work is handled in the Electron process while the Angular renderer surface exposes a dedicated `/downloads` route, contextual buttons, and theme-aware styling.

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
  Signals back the current download list while `hasDownloads` and `isAvailable` gates UI rendering. Before each download/resume the service asks the main process for the authorized folder and calls the download IPC command. The backend extracts the file extension from the URL or falls back to `mp4`. `onDownloadsUpdate` updates the signal, while helper methods `pauseDownload`, `resumeDownload`, `retryDownload`, `removeDownload`, `cancelDownload`, and `playDownload` talk to the corresponding IPC commands so retries reuse existing rows and completed items can open the recorded path.
- **Downloads view** (`libs/portal/downloads/feature`)  
  A standalone page exposes the queue, desktop-only messaging, folder picker, and action buttons. `downloads.component.html` wraps the list inside a scrollable panel (`downloads__list-wrapper`) so long queues stay reachable, and `downloads.component.scss` drives gradient cards with theme-aware styling through Angular Material system CSS variables (`var(--mat-sys-*)`, `var(--app-*)`, `color-mix`) — theming tracks the active Material theme rather than a `body.dark-theme` hook.
  Failed/canceled cards show retry/delete controls, queued/downloading cards show pause/cancel controls, paused cards show resume/cancel/delete controls, and completed cards render inline play/open buttons with `mat-icon` cues. Pause/resume/cancel/retry surface backend `success: false` results in a snackbar instead of failing silently. The header also shows the resolved download folder and a `CHANGE FOLDER` action. VOD and episode detail views render a paused download as an active "Resume" button (`DownloadsService.isPaused()` / `resumeDownloadByContent()`) rather than a disabled "Downloading" state.

## Global API surface

- **Preload + types**  
  `apps/electron-backend/src/app/api/main.preload.ts` wires every download IPC command plus the `onDownloadsUpdate` listener to `window.electron`. The shared `ElectronBridgeApi` contract in `libs/shared/interfaces/src/lib/electron-api.interface.ts` owns the download and playback-position method types; `global.d.ts` and `apps/web/src/typings.d.ts` reference that contract instead of redeclaring the bridge.

## Routing and navigation

- `/downloads` is available under both portal flavors: the Xtream routes already load `DownloadsComponent`, and the Stalker routes now import the same component so the sidebar link can target `/stalker/:id/downloads` without returning to the startup screen.
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
- The new UI leverages CSS variables for theme-specific backgrounds/borders, ensures `.downloads__list` can scroll inside its panel, and brings consistent badge/typography treatments to each card.

Keeping the backend queue, IPC handlers, shared schema, and renderer signals synchronized minimizes drift between platform rules and the UI. Future work might cover download list filters, cancel-all actions, or integration with upcoming playback analytics.
