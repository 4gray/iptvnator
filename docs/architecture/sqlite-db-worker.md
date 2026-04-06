# SQLite DB Worker

This document records the current non-EPG SQLite worker implementation in the
Electron app.

Related:

- [Category Management](./category-management.md)
- [Workspace Shell](./workspace-shell.md)

## Summary

- Heavy non-EPG SQLite work no longer runs on Electron's main thread.
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

### Pure database operation modules

Keep SQL-heavy logic here so the worker entry remains a thin dispatcher:

1. `apps/electron-backend/src/app/database/operations/category.operations.ts`
2. `apps/electron-backend/src/app/database/operations/content.operations.ts`
3. `apps/electron-backend/src/app/database/operations/playlist.operations.ts`
4. `apps/electron-backend/src/app/database/operations/xtream.operations.ts`

## Worker Architecture

### Request flow

1. Renderer calls the existing preload API such as `window.electron.dbSaveContent`.
2. `ipcMain.handle(...)` in the Electron backend builds a payload and delegates
   to `DatabaseWorkerClient`.
3. `DatabaseWorkerClient` lazily starts one long-lived `worker_threads` worker
   and correlates requests with a generated `requestId`.
4. The worker executes SQLite work and sends back either:
   1. `ready`
   2. `event`
   3. `response`
5. The main process resolves the IPC request and forwards worker events back to
   the originating renderer process.

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

The event is forwarded to the renderer as `DB_OPERATION_EVENT`.

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

Cancellation is cooperative and chunk-based. Already committed SQLite batches
stay committed.

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
3. legacy compatibility:
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

The worker now owns all heavy non-EPG SQLite paths plus the remaining portal
state handlers that still used direct main-thread SQLite access.

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

### Playlist metadata

1. `DB_CREATE_PLAYLIST`
2. `DB_UPSERT_APP_PLAYLIST`
3. `DB_UPSERT_APP_PLAYLISTS`
4. `DB_GET_APP_PLAYLISTS`
5. `DB_GET_APP_PLAYLIST`
6. `DB_GET_PLAYLIST`
7. `DB_UPDATE_PLAYLIST`
8. `DB_DELETE_PLAYLIST`
9. `DB_DELETE_ALL_PLAYLISTS`
10. `DB_GET_APP_STATE`
11. `DB_SET_APP_STATE`

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

## UI Behavior Changes

### Search

Xtream search now guards against stale async responses:

1. local playlist search uses a monotonically increasing request version
2. global search uses a separate request version in the dialog component
3. clearing search invalidates older pending results

This prevents an older worker response from repainting over a newer query or a
cleared search state.

### Busy states

The UI now has explicit long-running state for destructive operations:

1. recent playlist rows show row-level refresh/delete spinners
2. Xtream import overlay shows phase text and a cancel action
3. Xtream playlist rows show request-scoped progress and cancel actions
4. busy rows block repeat clicks while an operation is in flight
5. settings "remove all playlists" owns its own spinner/disabled state

These changes matter because once SQLite work leaves the main thread, the
renderer can actually paint the loading state instead of freezing.

## Build And Packaging Notes

### Worker bundling

`apps/electron-backend/build-worker.js` now bundles both:

1. `epg-parser.worker.ts`
2. `database.worker.ts`

The worker build also aliases:

1. `database-schema`
2. `database-path-utils`

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

The script checks:

1. `epg-parser.worker.js`
2. `database.worker.js`
3. `better-sqlite3` in one approved unpacked node_modules location

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

This delay is test-only and disabled by default.

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
   Logs `DatabaseWorkerClient` request dispatch, completion timing, and emitted
   `DB_OPERATION_EVENT` payloads.
4. `IPTVNATOR_TRACE_SQL=1`
   Logs SQLite statements for the shared main-process connection and the DB
   worker connection using `better-sqlite3` verbose hooks.
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

These are intentionally still out of scope for this first cut:

1. request cancellation
2. moving network-heavy Xtream fetches off the current path
3. migrating every remaining small SQLite IPC handler to the worker
4. richer delete progress reporting for bulk destructive operations
5. repo-wide Angular/Jest cleanup for the currently failing web test baseline

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
