# Download Manager Architecture

The download manager is a desktop-only feature that layers a curated queue, progress tracking, storage configuration, and playback controls on top of the existing Xtream (xtream-electron folder) + Stalker viewers. Backend work is handled in the Electron process while the Angular renderer surface exposes a dedicated `/downloads` route, contextual buttons, and theme-aware styling.

## Backend responsibilities

- **Queue control (`apps/electron-backend/src/app/events/database/download-runtime.ts`)**
  `DownloadTask` mirrors the shared `DownloadItem` table plus transient cancel/progress helpers. Request validation and row creation live in `download-requests.ts`, while `downloads.events.ts` stays focused on IPC registration. `enqueueDownload()` pushes the task onto `downloadQueue` and triggers `processQueue()`. `processQueue()` keeps one active download, updates the row to `downloading`, and calls `startDownload()`.
- **electron-dl integration**
  `startDownload()` calls `electron-dl`'s `download()` helper. Headers (user agent, referer, origin) are attached, and the `onStarted`, `onProgress`, `onCompleted`, and `onCancel` callbacks translate the helper's payload into Drizzle updates. A cancellation requested before `onStarted` is remembered and applied as soon as Electron supplies the `DownloadItem`, so the request cannot be lost in the startup race.
- **Destination collision policy**
  Existing destination files are never overwritten. Before starting Electron's
  download, the backend atomically reserves a free numbered filename with an
  exclusive filesystem create. Electron may overwrite that empty reservation,
  but cannot overwrite a file that existed before the reservation. The selected
  `filePath` and `fileName` are persisted before transfer begins. Errors,
  cancellations, and startup recovery remove that exact partial path and clear
  it from the row; completed downloads replace it with Electron's final values.
- **IPC surface**  
  The backend exposes `DOWNLOADS_*` handlers for list retrieval, start/cancel/retry/remove operations, folder selection/reveal, and the `DOWNLOADS_UPDATE_EVENT` emitter that the renderer listens to in order to refresh its signal store.

## Renderer architecture

- **Downloads service** (`libs/services/src/lib/downloads.service.ts`)
  Signals back the current download list while `hasDownloads` and `isAvailable` gates UI rendering. Before each download the service asks the main process for the authorized folder and calls `downloadsStart`. The backend extracts the file extension from the URL or falls back to `mp4`. `onDownloadsUpdate` updates the signal, while helper methods `retryDownload`, `removeDownload`, `cancelDownload`, and `playDownload` talk to the corresponding IPC commands so retries reuse existing rows and completed items can open the recorded path.
- **Downloads view** (`libs/portal/downloads/feature`)  
  A standalone page exposes the queue, desktop-only messaging, folder picker, and action buttons. `downloads.component.html` now wraps the list inside a scrollable panel (`downloads__list-wrapper`) so long queues stay reachable, and `downloads.component.scss` drives a bold two-tone aesthetic inspired by the frontend-design mandate—gradient cards, floating avatars, and theme-aware variables triggered via `body.dark-theme`.
  Failed/canceled cards now show retry/delete controls, queued/downloading cards show a cancel icon, and completed cards render inline play/open buttons with `mat-icon` cues. The header also shows the resolved download folder and a `CHANGE FOLDER` action.
- **Theme fixes**  
  To keep typography legible in both modes, `app-search-result-item` now inherits color from `:host-context(body.dark-theme)` and `:host-context(body:not(.dark-theme))`, ensuring dense light-theme grids no longer show white text on white backgrounds.

## Global API surface

- **Preload + types**  
  `apps/electron-backend/src/app/api/main.preload.ts` wires every download IPC command plus the `onDownloadsUpdate` listener to `window.electron`. The shared `ElectronBridgeApi` contract in `libs/shared/interfaces/src/lib/electron-api.interface.ts` owns the download and playback-position method types; `global.d.ts` and `apps/web/src/typings.d.ts` reference that contract instead of redeclaring the bridge.

## Routing and navigation

- `/downloads` is available under both portal flavors: the Xtream routes already load `DownloadsComponent`, and the Stalker routes now import the same component so the sidebar link can target `/stalker/:id/downloads` without returning to the startup screen.
- The navigation component already points `routerLink="./downloads"` inside the shared nav pane, so both portals reuse the same download page.

## Queuing, persistence, and UX notes

- Every download row writes to the shared `downloads` table with statuses (`queued`, `downloading`, `completed`, `failed`, `canceled`) plus metadata such as `bytesDownloaded`, `totalBytes`, `errorMessage`, and Xtream identifiers. On startup, `download-recovery.ts` deletes persisted partial reservations before stale queued/downloading rows become `failed`.
- Queue cancellation removes a queued task or records an active cancellation request and calls `downloadItem.cancel()` when the item is available; retries reuse the same database entry, preventing duplicate rows.
- The OS downloads path is always authorized. A custom folder becomes
  authorized only after native folder selection, and the main process persists
  that selection under Electron `userData`. Renderer settings may display the
  path, but they are not trusted as authorization.
- The new UI leverages CSS variables for theme-specific backgrounds/borders, ensures `.downloads__list` can scroll inside its panel, and brings consistent badge/typography treatments to each card.

Keeping the backend queue, IPC handlers, shared schema, and renderer signals synchronized minimizes drift between platform rules and the UI. Future work might cover download list filters, cancel-all actions, or integration with upcoming playback analytics.
