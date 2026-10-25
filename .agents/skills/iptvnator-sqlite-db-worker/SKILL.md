---
name: iptvnator-sqlite-db-worker
description: Use when changing Electron SQLite IPC, database-worker operations, request-scoped progress or cancellation, worker packaging, or runtime verification of non-EPG database work.
---

# IPTVnator SQLite DB Worker

## Ownership and Flow

- Renderer service: `libs/services/src/lib/database-electron.service.ts`
- Preload API: `apps/electron-backend/src/app/api/main.preload.ts`
- IPC handlers: `apps/electron-backend/src/app/events/database/`
- Client: `apps/electron-backend/src/app/services/database-worker-client.ts`
- Protocol: `apps/electron-backend/src/app/workers/database-worker.types.ts`
- Thin dispatcher: `apps/electron-backend/src/app/workers/database.worker.ts`
- Connection: `apps/electron-backend/src/app/workers/database.worker-connection.ts`
- Runtime paths: `apps/electron-backend/src/app/workers/worker-runtime-paths.ts`
- SQL operations: `apps/electron-backend/src/app/database/operations/`
- Shared schema: `libs/shared/database/src/lib/schema.ts`
- Bundler: `apps/electron-backend/build-worker.js`
- Canonical guide: `docs/architecture/sqlite-db-worker.md`

The chain is renderer `DatabaseService` → preload IPC → main event handler →
`DatabaseWorkerClient` and its request protocol → worker dispatcher →
worker connection → operation module → shared
`@iptvnator/shared/database/schema`, then response or request-scoped event back
to the originating renderer. Keep SQL-heavy logic in operation modules and the
worker entrypoint focused on dispatch/orchestration.

The build script produces three bundles: EPG parser, database, and playlist
refresh. EPG parsing stays in its dedicated worker. Do not silently migrate
lightweight download handlers or EPG-specific main-process query/mapping/fetch
handlers as part of unrelated database work.

## Identity, Progress, and Cancellation

`requestId` is generated for every client request and correlates worker
event/response transport. `operationId` is the renderer-visible identity for
long-operation progress and cooperative cancellation.

Tracked operations are save content, delete Xtream content, restore Xtream user
data, delete playlist, and delete all playlists. The first four are
cancellable. Delete-all is deliberately tracked with `cancellable: false`.

Cancellation is cooperative at chunk checkpoints. Committed chunks remain
committed and the request finally rejects with `AbortError`. For the
operation/busy lifecycle, only a terminal completed/error/cancelled event
settles UI state; a cancel-requested flag may update immediately.

Inside synchronous `better-sqlite3` transactions, prepared writes must use
`.run()`. `.execute()` defers work and can commit a silent no-op.

## Rebuild and Verify

After worker source changes:

```bash
pnpm nx test electron-backend
pnpm nx run electron-backend:build-worker
stat dist/apps/electron-backend/workers/database.worker.js
```

Confirm the artifact timestamp, restart Electron, then run the closest
Electron E2E or CDP workflow.

For SQL output, `IPTVNATOR_TRACE_DB=1` and `IPTVNATOR_TRACE_SQL=1` emit only
fixed, allowlisted statement types through the shared redacting summary in
`libs/shared/logging/src/lib/sql-trace-summary.ts`; never log expanded SQL or
bound values. DB transport traces remain separately redacted.
