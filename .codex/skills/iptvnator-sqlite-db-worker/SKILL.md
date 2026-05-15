---
name: iptvnator-sqlite-db-worker
description: Repository-specific guidance for Electron non-EPG SQLite worker boundaries, request-scoped DB progress events, and validation for slow DB operations.
---

# IPTVnator SQLite DB Worker

Use this skill when changing Electron SQLite operations, worker-backed database flows, DB progress events, or Xtream/playlist import/search/delete persistence.

## Ownership

- Runtime worker client: `apps/electron-backend/src/app/services/database-worker-client.ts`
- Worker protocol: `apps/electron-backend/src/app/workers/database-worker.types.ts`
- Worker dispatcher: `apps/electron-backend/src/app/workers/database.worker.ts`
- SQL operation modules: `apps/electron-backend/src/app/database/operations/`
- Shared schema/path helpers: `libs/shared/database/src/`
- Architecture doc: `docs/architecture/sqlite-db-worker.md`

## Rules

- Keep heavy non-EPG SQLite work off the Electron main thread.
- Keep SQL-heavy logic in operation modules; keep the worker entrypoint as dispatcher/orchestration.
- Emit request-scoped `DB_OPERATION_EVENT` progress for long-running operations.
- Preserve cancellation as cooperative and chunk-based.
- Do not break existing preload API method names without a coordinated renderer migration.

## Validation

- Run `pnpm nx test electron-backend` for worker/client/operation changes.
- Run targeted Electron E2E for import, search, delete, backup/restore, or downloads flows when touched.
- Use `IPTVNATOR_TRACE_DB=1` or `IPTVNATOR_TRACE_SQL=1` for manual debugging.
