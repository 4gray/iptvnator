# Download Manager Architecture

The download manager is a desktop-only feature that layers a curated queue, progress tracking, storage configuration, and playback controls on top of the existing Xtream (`libs/portal/xtream`) + Stalker (`libs/portal/stalker`) portal views. Backend work is handled in the Electron process while the Angular renderer surface exposes a dedicated `/downloads` route, contextual buttons, and theme-aware styling.

## Backend responsibilities

- **Queue control (`apps/electron-backend/src/app/events/database/download-runtime.ts`)**
  `DownloadTask` mirrors a row of the shared `downloads` table (type `Download` in `libs/shared/database/src/lib/schema.ts`) plus transient cancel/pause/progress helpers. Request validation and row creation live in `download-requests.ts`, while `downloads.events.ts` stays focused on IPC registration. `enqueueDownload()` pushes the task onto `downloadQueue` and triggers `processQueue()`. `processQueue()` keeps one active download, updates the row to `downloading`, and calls `startDownload()`.
- **Range-aware transfer**
  `startDownload()` streams the response through the backend's validated Axios redirect helper instead of `electron-dl`. Headers (user agent, referer, origin) are persisted in `request_headers` and reattached on retry/resume. Active pause/cancel operations abort the current request with `AbortController`; pause keeps the partial file and cancel removes it. Resume checks the existing `.part` size and sends `Range: bytes=<offset>-`; the server must return `206 Partial Content` before bytes are appended.
- **Destination collision policy**
  Existing destination files are never overwritten. Before starting a new
  transfer, the backend atomically reserves a free numbered `.part` path while
  leaving the final destination path absent. The selected final `filePath` and
  `fileName` are persisted before transfer begins. Completion creates the final
  `filePath` from `<filePath>.part` without overwriting an existing file;
  cancel/failure remove the `.part`; pause and restart recovery keep it for a
  later resume.
- **IPC surface**  
  The backend exposes `DOWNLOADS_*` handlers for list retrieval, start/pause/resume/cancel/retry/remove operations, folder selection/reveal, and the `DOWNLOADS_UPDATE_EVENT` emitter that the renderer listens to in order to refresh its signal store.

## Renderer architecture

- **Downloads service** (`libs/services/src/lib/downloads.service.ts`)
  Signals back the current download list while `hasDownloads` and `isAvailable` gates UI rendering. Before each download/resume the service asks the main process for the authorized folder and calls the download IPC command. The backend extracts the file extension from the URL or falls back to `mp4`. `onDownloadsUpdate` updates the signal, while helper methods `pauseDownload`, `resumeDownload`, `retryDownload`, `removeDownload`, `cancelDownload`, and `playDownload` talk to the corresponding IPC commands so retries reuse existing rows and completed items can open the recorded path.
- **Downloads view** (`libs/portal/downloads/feature`)  
  A standalone page exposes the queue, desktop-only messaging, folder picker, and action buttons. `downloads.component.html` wraps the list inside a scrollable panel (`downloads__list-wrapper`) so long queues stay reachable, and `downloads.component.scss` drives gradient cards with theme-aware styling through Angular Material system CSS variables (`var(--mat-sys-*)`, `var(--app-*)`, `color-mix`) — theming tracks the active Material theme rather than a `body.dark-theme` hook.
  Failed/canceled cards show retry/delete controls, queued/downloading cards show pause/cancel controls, paused cards show resume/cancel/delete controls, and completed cards render inline play/open buttons with `mat-icon` cues. The header also shows the resolved download folder and a `CHANGE FOLDER` action.

## Global API surface

- **Preload + types**  
  `apps/electron-backend/src/app/api/main.preload.ts` wires every download IPC command plus the `onDownloadsUpdate` listener to `window.electron`. The shared `ElectronBridgeApi` contract in `libs/shared/interfaces/src/lib/electron-api.interface.ts` owns the download and playback-position method types; `global.d.ts` and `apps/web/src/typings.d.ts` reference that contract instead of redeclaring the bridge.

## Routing and navigation

- `/downloads` is available under both portal flavors: the Xtream routes already load `DownloadsComponent`, and the Stalker routes now import the same component so the sidebar link can target `/stalker/:id/downloads` without returning to the startup screen.
- Downloads navigation is data-driven: `libs/portal/shared/util/src/lib/navigation/portal-rail-links.ts` emits a `downloads` section link (`path: [...root, 'downloads']`) for both portals, so they reuse the same download page.

## Queuing, persistence, and UX notes

- Every download row writes to the shared `downloads` table with statuses (`queued`, `downloading`, `paused`, `completed`, `failed`, `canceled`) plus metadata such as `bytesDownloaded`, `totalBytes`, `errorMessage`, `requestHeaders`, and Xtream identifiers. Existing SQLite tables are rebuilt on startup when their status CHECK still lacks `paused`.
- On startup, `download-recovery.ts` converts stale `downloading` rows with a non-empty `.part` file to `paused`, and marks stale queued/downloading rows without recoverable partial bytes as `failed`.
- Queue cancellation removes a queued task or records an active cancellation request and aborts the request when available. Pausing follows the same abort path but persists `paused` and keeps the `.part`; retries reuse the same database entry and start from zero, while resume appends to the existing `.part` through HTTP Range.
- The OS downloads path is always authorized. A custom folder becomes
  authorized only after native folder selection, and the main process persists
  that selection under Electron `userData`. Renderer settings may display the
  path, but they are not trusted as authorization.
- The new UI leverages CSS variables for theme-specific backgrounds/borders, ensures `.downloads__list` can scroll inside its panel, and brings consistent badge/typography treatments to each card.

Keeping the backend queue, IPC handlers, shared schema, and renderer signals synchronized minimizes drift between platform rules and the UI. Future work might cover download list filters, cancel-all actions, or integration with upcoming playback analytics.
