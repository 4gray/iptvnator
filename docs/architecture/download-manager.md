# Download Manager Architecture

The download manager is a desktop-only feature that layers a curated queue, progress tracking, storage configuration, and playback controls on top of the existing Xtream (xtream-tauri folder) + Stalker viewers. Backend work is handled in the Electron process while the Angular renderer surface exposes a dedicated `/downloads` route, contextual buttons, and theme-aware styling.

## Backend responsibilities

- **Queue control (apps/electron-backend/src/app/events/downloads.events.ts)**  
  `DownloadTask` mirrors the shared `DownloadItem` table plus transient cancel/progress helpers. `enqueueDownload()` resolves a unique file path, persists a `queued` row in `downloads`, pushes the task onto `downloadQueue`, and triggers `processQueue()`. `processQueue()` keeps one active download, updates the row to `downloading`, and calls `startDownload()`.
- **electron-dl integration**  
  `startDownload()` now calls `electron-dl`’s `download()` helper. Headers (user agent, referer, origin) are attached, and the `onStarted`, `onProgress`, `onCompleted`, and `onCancel` callbacks translate the helper’s payload into Drizzle updates. The handler throttles progress broadcast, saves `filePath`/`fileName` from `electron-dl`, and marks failures/cancellations cleanly. Errors and cancellations delete partial files.
- **IPC surface**  
  The backend exposes `DOWNLOADS_*` handlers for list retrieval, start/cancel/retry/remove operations, folder selection/reveal, and the `DOWNLOADS_UPDATE_EVENT` emitter that the renderer listens to in order to refresh its signal store.

## Renderer architecture

- **Downloads service** (`apps/web/src/app/services/downloads.service.ts`)
  Signals back the current download list while `hasDownloads` and `isAvailable` gates UI rendering. Before each download the service resolves a download folder (stored in `SettingsStore` or fetched via `downloadsGetDefaultFolder`) and calls `downloadsStart`. The backend extracts the file extension from the URL or falls back to `mp4`. `onDownloadsUpdate` updates the signal, while helper methods `retryDownload`, `removeDownload`, `cancelDownload`, and `playDownload` talk to the corresponding IPC commands so retries reuse existing rows and completed items can open the recorded path.
- **Downloads view** (`apps/web/src/app/xtream-tauri/downloads`)  
  A standalone page exposes the queue, desktop-only messaging, folder picker, and action buttons. `downloads.component.html` now wraps the list inside a scrollable panel (`downloads__list-wrapper`) so long queues stay reachable, and `downloads.component.scss` drives a bold two-tone aesthetic inspired by the frontend-design mandate—gradient cards, floating avatars, and theme-aware variables triggered via `body.dark-theme`.
  Failed/canceled cards now show retry/delete controls, queued/downloading cards show a cancel icon, and completed cards render inline play/open buttons with `mat-icon` cues. The header also shows the resolved download folder and a `CHANGE FOLDER` action.
- **Theme fixes**  
  To keep typography legible in both modes, `app-search-result-item` now inherits color from `:host-context(body.dark-theme)` and `:host-context(body:not(.dark-theme))`, ensuring dense light-theme grids no longer show white text on white backgrounds.

## Global API surface

- **Preload + types**  
  `apps/electron-backend/src/app/api/main.preload.ts` wires every download IPC command plus the `onDownloadsUpdate` listener to `window.electron`. `global.d.ts` now mirrors those methods, adds playback-position helpers, and exposes `onPlaybackPositionUpdate` / `removePlaybackPositionListener` so Angular can type-check the new APIs. This keeps the renderer typing in sync with the backend implementation.

## Routing and navigation

- `/downloads` is available under both portal flavors: the Xtream routes already load `DownloadsComponent`, and the Stalker routes now import the same component so the sidebar link can target `/stalker/:id/downloads` without returning to the startup screen.
- The navigation component already points `routerLink="./downloads"` inside the shared nav pane, so both portals reuse the same download page.

## Queuing, persistence, and UX notes

- Every download row writes to the shared `downloads` table with statuses (`queued`, `downloading`, `completed`, `failed`, `canceled`) plus metadata such as `bytesDownloaded`, `totalBytes`, `errorMessage`, and Xtream identifiers. Stale downloads reset to `failed` on startup.
- Queue cancellation removes the task or calls `downloadItem.cancel()` if the item is active; retries reuse the same database entry, preventing duplicate rows.
- Folder selection first checks stored preferences, falls back to the OS default downloads path, and finally prompts the user to pick a folder. The downloads service persists the chosen path via `SettingsStore`.
- The new UI leverages CSS variables for theme-specific backgrounds/borders, ensures `.downloads__list` can scroll inside its panel, and brings consistent badge/typography treatments to each card.

Keeping the backend queue, IPC handlers, shared schema, and renderer signals synchronized minimizes drift between platform rules and the UI. Future work might cover download list filters, cancel-all actions, or integration with upcoming playback analytics.
