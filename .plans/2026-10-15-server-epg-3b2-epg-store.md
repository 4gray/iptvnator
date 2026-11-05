# Server EPG 3b-2: @iptvnator/shared/epg-store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the XMLTV import pipeline and the EPG queries out of `apps/electron-backend` into a Node-only library `@iptvnator/shared/epg-store`, give `ValidatedHttpClient` a capped streaming mode, and keep Electron's behavior unchanged.

**Architecture:** The library takes everything it needs as parameters: a better-sqlite3 connection for the import and maintenance functions, an `EpgSourceOpener` for the source bytes, and a drizzle handle plus an optional mapping resolver for the queries. The epg_* DDL stays owned by `libs/shared/database` (which `initDatabase()` needs) and moves into its own module there; the library depends on it through the `schema` and `epg-schema-sql` sub-entries, never the reverse. Electron keeps the worker entry, its opener (validated axios, trust options, local-file authorization), error classification, fetch orchestration, generation fences and IPC, and calls the library.

**Tech Stack:** Node 22/24, TypeScript 6, better-sqlite3 13 (Node-API), Drizzle ORM 0.45, saxes 6, Jest 30 via `@nx/jest`, Nx 23, esbuild (worker bundles), axios (web-backend transport).

Spec: `docs/superpowers/specs/2026-10-15-server-epg-design.md` (sections 4, 6.1, 11, 12 "3b", 13, 15). Overview and shared contract B: `.plans/2026-10-15-server-epg.md`.

---

## Contract deviations

Shared contract B in the overview is implemented with these names and shapes. Everything below is additive or a precision of an open point; PR 3c's plan should take it into account.

1. **`EpgSourceResponse.kind?: 'http' | 'file'` (additive, optional).** Electron's local XMLTV files have no HTTP headers and must be gunzipped by signature only (a `.xml.gz` holding plain XML and an extension-less gzip file both work today). With `kind: 'file'` `runEpgImport` skips `Content-Encoding` and URL/MIME hints and runs only the optional gunzip stage. Omitted or `'http'` is the contract behavior; the server never sets it.
2. **`EpgDrizzle` is structural:** `Pick<BaseSQLiteDatabase<'sync', BetterSqlite3.RunResult>, 'select' | 'selectDistinct' | 'all'>`. Any `drizzle(better-sqlite3)` instance satisfies it whatever schema it was created with, so Electron passes its main-database `getDatabase`. `createEpgDrizzle(db)` returns it and loads `drizzle-orm/better-sqlite3` lazily (that driver requires the native binding at module load, which the Electron worker must not do before registering its native search paths). 3c: `const epgDrizzle = createEpgDrizzle(epgDb); createEpgQueries({ getDb: () => epgDrizzle })`.
3. **`resolveMappings` may reject.** The library wraps it: every read falls back to unmapped ids on failure except `getProgramCoverage`, which rejects (coverage must stay "unknown", as on the desktop). 3c passes none until 3e.
4. **Additional exports:** `isEpgSourceFresh(db, sourceUrl, cutoffIso)` and `EPG_FRESHNESS_MAX_AGE_HOURS` (Electron's freshness check keeps its per-URL generation fences around the shared query), `epgLogger` (the URL-omitting EPG logger, moved from Electron; 3c should log through it), and the sub-entry `@iptvnator/shared/epg-store/testing` with `seedEpgSource()` for tests.
5. **`runEpgImport` error mapping (precision):** SAX/XML errors → `EpgImportError('epg_parse_failed')`; more than `maxDecompressedBytes` decoded bytes → `epg_too_large`; `signal` aborted after the opener returned → `epg_aborted`; zero channels → `epg_empty`. Opener errors, transport errors while reading, zlib errors (invalid or truncated gzip, `code` `Z_*`) and SQLite errors propagate unchanged. 3c maps `Z_*` to `epg_parse_failed` and transport errors to `epg_network`/`epg_timeout`. `runEpgImport` never sets pragmas on, or closes, the connection it is given.
6. **Nx project name:** `shared-epg-store` (`pnpm nx test shared-epg-store`).
7. **Streaming HTTP (spec section 13):** `ValidatedHttpClient.stream(url, { maxBytes, timeout?, signal?, headers?, params?, onConnect? })` resolves at the final 2xx headers with `WebBackendHttpStream { stream, requestUrl, finalUrl, headers, status }`. Failures before headers are `ProviderRequestError` exactly as `get()`; the returned stream fails with `ProviderBodyTooLargeError` past `maxBytes` wire bytes and with `code: 'ECONNABORTED'` after `timeout` of socket inactivity. The body is not decompressed (`decompress: false`); `runEpgImport` decodes it.
8. **`PROVIDER_BODY_TOO_LARGE_CODE = 'ERR_PROVIDER_BODY_TOO_LARGE'`** is exported from `apps/web-backend/src/app/provider-response.ts`, and `ProviderBodyTooLargeError.code` is that constant. 3c imports it from `../provider-response` to classify the error as `epg_too_large`.
9. **`RunEpgImportOptions.onPublishStart?: () => void` (additive, optional).** Called once, after the whole document parsed and passed the empty check, right before the synchronous publish transaction. Callers that watch for stalls (the server's import queue) suspend their stall timer then: the publish sends no progress and can take minutes on slow disks. Not called when the import fails before publishing (empty feed, parse error, abort, size cap, source error).

Not a contract change, but visible in Electron: `events/epg-queries.ts` creates two `createEpgQueries` instances, because the single-channel timeline (`GET_CHANNEL_PROGRAMS`) has always also resolved a mapping saved under an Xtream stream that shares the requested provider `epg_channel_id`, and the batch reads never did. Note for PR 3e: unifying them into one resolver would change which mapping the batch reads find; decide it there.

## Design decisions

- **Dependency direction `shared-epg-store` → `database`.** The DDL must run inside `initDatabase()` (the desktop database holds EPG tables next to user data), so `libs/shared/database` owns it. It moves out of `connection.ts` into `libs/shared/database/src/lib/epg-schema-sql.ts`, spliced back at the same positions; `ensureEpgSchema()` applies the same lists to a standalone database. The library imports only `@iptvnator/shared/database/schema` and `@iptvnator/shared/database/epg-schema-sql`, never the database barrel (which loads `better-sqlite3` and the connection singleton). Nothing in `libs/shared/database` imports the library, and the lint rule below forbids it.
- **Renderer projects cannot import the library.** Nx tags cannot express it: `services` (renderer) and `database` (Node) carry the same three tags, and `web` and `web-backend` do too. `eslint.config.mjs` therefore bans `@iptvnator/shared/epg-store` and its sub-paths with `no-restricted-imports` for `apps/web/src/**`, `apps/remote-control-web/src/**` and every `libs/**` file outside the library (that includes `libs/shared/database`, which also guards the dependency direction). Task 5 proves the rule with a probe file.
- **Strict TypeScript.** The library compiles with `strict: true` because PR 3c imports it into `web-backend`, which is strict. The moved code needed one change for that: `toAiringInstantIso` narrows `nowMs` with a type guard instead of a boolean.
- **No behavior change for Electron.** Same SQL, same query order (the moved specs mock `select()` call sequences and still pass), same worker messages, same error messages and codes, same connections and pragmas. `epg_*` library error codes are stripped in the worker before posting, so the renderer sees `errorCode: undefined` exactly as before.
- **Commits inside the move.** `git mv` keeps file history, and it means `electron-backend` does not compile between Task 7 (first pipeline file moved) and Task 11 (worker rewired), and between Task 12 (query files moved) and Task 14 (main process rewired). That is acceptable: pull requests in this repository are squash-merged, so only the final head has to build. Those tasks run only the library checks. Do not push before Task 18.
- **Electron does not use `onPublishStart`.** Its import watchdog (`EpgWorkerService.fetchTimeoutMs`, 5 minutes, `apps/electron-backend/src/app/events/epg-fetch-operation.ts`) restarts only when an `EPG_PROGRESS` message raises the channel or programme counters. Since #1941 the last such message comes from the parser's final flush, and the publish transaction that follows sends none, so a publish that takes longer than 5 minutes would be terminated and rolled back, and the import reported as timed out. So yes, it could hit the publish today, but only for an unusually large feed on a very slow disk: on desktop disks the publish of a typical feed should take seconds to a minute (#1941's regression test parses and publishes 137,000 programmes within its 120-second test budget; nobody has timed the publish alone). It is today's behavior and this PR leaves it unchanged.

## Decisions taken with the maintainer (2026-10-15)

- Electron keeps two `createEpgQueries` instances (no behavior change); PR 3e revisits them.
- Intermediate commits that do not compile are fine (squash merge).
- `pruneEpgPrograms` deletes programmes only; channels and source snapshots stay.
- `ensureEpgSchema` throws on any migration error other than an already-applied column.
- Coverage: if the merged ratchet drops, add tests; never lower a ratchet.
- Moved specs now type-checked under `strict` may get type-only annotations; assertions do not change.

## Dependencies on open pull requests

Write the move against `master` plus these pull requests (diffs read on 2026-10-15; `master` was `002faebb0`):

| PR | State on 2026-10-15 | What it changes that this plan moves |
| --- | --- | --- |
| #1946 UTF-8 across chunks | merged (`34470ea27`) | `epg-parser.worker.ts` reads with `setEncoding('utf8')`; new `workers/epg-parser.worker.spec.ts` (UTF-8 cases) |
| #1941 staged atomic import | open | new `workers/epg-import-staging.ts` (`EpgImportStaging`), `EpgDatabase.createImport(sourceUrl)`, `insertPrograms(…, strict)`, worker body (open → stage → parse → empty check → commit → `finally` destroy/close), new `workers/epg-import-atomicity.spec.ts` and `workers/testing/epg-import-scenario.ts` |
| #1947 clear/refresh fences | open | `events/epg-source-generation.ts`, new `events/epg-fetch-queue.ts`, `epg-worker-runtime.ts`, `epg-worker.service.ts`, `handleFetchEpg` in `epg-fetch.service.ts`: all stay in Electron; nothing here moves |
| #1800 forced refresh | open (overlaps #1947) | `handleFetchEpg` and `EpgWorkerService`: stay in Electron |

Code from #1941 is moved as it lands; this plan names its classes and functions and the import rewrites, and adds only `EpgImportStaging.dispose()`.

## File map

Moves (`git mv`, history kept):

| Source (`apps/electron-backend/src/app/…`) | Destination (`libs/shared/epg-store/src/lib/…` unless noted) | Change |
| --- | --- | --- |
| `util/epg-logger.ts` | `epg-logger.ts` | unchanged; Electron keeps a one-line re-export at the old path |
| `util/epg-logger.spec.ts` | `epg-logger.spec.ts` | unchanged |
| `workers/epg-optional-gunzip.ts` | `import/epg-optional-gunzip.ts` | unchanged |
| `workers/epg-response-utils.ts` (+ `.spec.ts`) | `import/epg-response-utils.ts` (+ spec) | unchanged |
| `workers/epg-stream-decoder.ts` (+ `.spec.ts`) | `import/epg-stream-decoder.ts` (+ spec) | unchanged |
| `workers/epg-streaming-parser.ts` (+ `.spec.ts`) | `import/epg-streaming-parser.ts` (+ spec) | unchanged |
| `workers/epg-source-metadata.ts` | `epg-source-metadata.ts` | unchanged |
| `workers/epg-source-metadata.spec.ts` | `epg-source-metadata.spec.ts` | harness preamble rewritten (Node instead of Electron, new module paths) |
| `workers/epg-database.ts` | `import/epg-import-writer.ts` | `EpgDatabase` → `EpgImportWriter(db)`; clear classes → `maintenance/epg-clear.ts`; dedup index → `schema/epg-program-dedup-index.ts` |
| `workers/epg-database.spec.ts` | `import/epg-import-writer.spec.ts` | constructor rewrite; clear cases → `maintenance/epg-clear.spec.ts` |
| `workers/epg-import-staging.ts` (#1941) | `import/epg-import-staging.ts` | `dispose()` added |
| `workers/epg-source-stream.ts` | `apps/electron-backend/src/app/workers/epg-source-opener.ts` | stays in Electron; returns `EpgSourceResponse` instead of a decoded stream |
| `workers/epg-source-stream.spec.ts` | `apps/electron-backend/src/app/workers/epg-source-opener.spec.ts` | rewritten for the raw response |
| `events/epg-query.service.ts` | `queries/epg-query.service.ts` | split: `epg-query-scope.ts`, `epg-channel-lookup.ts`, `epg-program-rows.ts`, `epg-current-programs.ts`; mapping lookup → Electron `events/epg-channel-program-mapping.ts`; `getAllChannels` → Electron `events/epg-queries.ts` |
| `events/epg-query.service.spec.ts` | `queries/epg-query.service.spec.ts` | constructor rewrite; mapping case → Electron |
| `events/epg-guide-query.service.ts` (+ `.spec.ts`) | `queries/epg-guide-query.service.ts` (+ spec) | `getDb` injected |
| `events/epg-guide-window.util.ts` | `queries/epg-guide-window.util.ts` | unchanged |
| `events/epg-program-row.util.ts` | `queries/epg-program-row.util.ts` | unchanged |

Created:

| File | Responsibility |
| --- | --- |
| `libs/shared/database/src/lib/epg-schema-sql.ts` (+ `.spec.ts`) | epg_* DDL lists, single source of truth |
| `libs/shared/epg-store/{project.json,jest.config.ts,tsconfig.json,tsconfig.lib.json,tsconfig.spec.json,README.md}` | the Nx project |
| `libs/shared/epg-store/src/index.ts` (+ `index.spec.ts`) | public API; the spec proves importing it loads no native module |
| `libs/shared/epg-store/src/testing/{index.ts,seed-epg-source.ts}` | `@iptvnator/shared/epg-store/testing` |
| `src/lib/epg-import-error.ts` | `EPG_IMPORT_ERROR_CODES`, `EpgImportError` |
| `src/lib/schema/ensure-epg-schema.ts` (+ spec), `schema/epg-program-dedup-index.ts` | `ensureEpgSchema`, lazy dedup index |
| `src/lib/import/epg-source-response.ts` (+ spec) | `EpgSourceResponse`, `EpgSourceOpener`, decoding and the decompressed-byte cap |
| `src/lib/import/run-epg-import.ts` (+ spec) | `runEpgImport` |
| `src/lib/maintenance/epg-clear.ts` (+ spec), `maintenance/prune-epg-programs.ts` (+ spec) | `clearAllEpgData`, `clearEpgSource`, `pruneEpgPrograms` |
| `src/lib/queries/epg-drizzle.ts` | `EpgDrizzle`, `createEpgDrizzle` |
| `src/lib/queries/epg-query-scope.ts`, `epg-channel-lookup.ts`, `epg-program-rows.ts`, `epg-current-programs.ts` | the split query service |
| `src/lib/queries/epg-mapping-resolution.ts` (+ spec), `epg-guide-mapping.ts` (+ spec) | mapping fallback and remap, moved from Electron's IPC layer |
| `src/lib/queries/epg-search.query.ts`, `epg-freshness.query.ts` | search (from `epg-db.events.ts`) and freshness (from `epg-fetch.service.ts`) |
| `src/lib/queries/create-epg-queries.ts` (+ spec on real SQLite) | `EpgQueries`, `createEpgQueries` |
| `apps/electron-backend/src/app/events/epg-queries.ts` | Electron wiring of `createEpgQueries`, `getAllEpgChannels` |
| `apps/electron-backend/src/app/events/epg-channel-program-mapping.ts` (+ spec) | the timeline's mapping lookup with the Xtream fallback |

Modified:

| File | Change |
| --- | --- |
| `libs/shared/database/src/lib/connection.ts` | EPG statements replaced by spreads of the new lists |
| `tsconfig.base.json` | aliases `@iptvnator/shared/epg-store`, `@iptvnator/shared/epg-store/testing`, `@iptvnator/shared/database/epg-schema-sql` |
| `eslint.config.mjs` | renderer ban of the library |
| `tools/coverage/coverage-policy.json` | `shared-epg-store` in Tier A |
| `tools/eslint/max-lines-baseline.mjs` | regenerated: `epg-query.service.ts` entry removed |
| `apps/electron-backend/build-worker.js` | aliases for the library and `epg-schema-sql` |
| `apps/electron-backend/src/app/util/epg-logger.ts` | re-export |
| `apps/electron-backend/src/app/workers/epg-parser.worker.ts` (+ `.spec.ts`) | thin entry around `runEpgImport` |
| `apps/electron-backend/src/app/workers/testing/epg-import-scenario.ts` (#1941) | seeds through `seedEpgSource` |
| `apps/electron-backend/src/app/events/epg.events.ts` | handlers call `epgQueries` |
| `apps/electron-backend/src/app/events/database/epg-db.events.ts` (+ comment in `.spec.ts`) | search through `epgQueries.searchPrograms` |
| `apps/electron-backend/src/app/events/epg-fetch.service.ts` | freshness through `isEpgSourceFresh` |
| `apps/electron-backend/src/app/events/epg-mapping.service.ts` (+ `.spec.ts`) | `resolveChannelIds`/`queryByResolvedChannelIds` removed (now in the library) |
| `apps/electron-backend/src/app/events/epg-guide.events.spec.ts` | rewritten: delegation to `epgQueries` |
| `apps/electron-backend-e2e/src/performance/charset-parse-workloads.ts` | parser path |
| `apps/web-backend/src/app/validated-http-client.ts`, `provider-response.ts`, `provider-axios-transport.ts` | streaming mode |
| `apps/web-backend/src/app/web-backend-app.spec-helpers.ts`, `validated-http-client.spec.ts`, `validated-http-client.integration.spec.ts` | streaming tests |
| `docs/architecture/m3u-playlist-module.md`, `nx-workspace-boundaries.md`, `sqlite-db-worker.md`, `pwa-self-hosted.md`, `validation-map.md`, `docs/maintenance/agent-context-map.md`, `libs/shared/database/README.md` | docs |

Spec files and their destinations:

| Spec | Destination |
| --- | --- |
| `workers/epg-stream-decoder.spec.ts`, `epg-response-utils.spec.ts`, `epg-streaming-parser.spec.ts` | `libs/shared/epg-store/src/lib/import/` (unchanged) |
| `workers/epg-source-metadata.spec.ts` | `libs/shared/epg-store/src/lib/` (harness rewritten) |
| `workers/epg-database.spec.ts` | `lib/import/epg-import-writer.spec.ts` + `lib/maintenance/epg-clear.spec.ts` |
| `util/epg-logger.spec.ts` | `lib/epg-logger.spec.ts` |
| `events/epg-query.service.spec.ts` | `lib/queries/epg-query.service.spec.ts`; the Xtream mapping case → `apps/electron-backend/src/app/events/epg-channel-program-mapping.spec.ts` |
| `events/epg-guide-query.service.spec.ts` | `lib/queries/epg-guide-query.service.spec.ts` |
| `events/epg-guide.events.spec.ts` | stays (rewritten); its remap cases → `lib/queries/epg-guide-mapping.spec.ts` |
| `events/epg-mapping.service.spec.ts` | stays; `queryByResolvedChannelIds` cases → `lib/queries/epg-mapping-resolution.spec.ts` |
| `workers/epg-parser.worker.spec.ts` (#1946) | stays (rewritten for the thin worker); UTF-8 cases → `lib/import/run-epg-import.spec.ts` |
| `workers/epg-source-stream.spec.ts` | `workers/epg-source-opener.spec.ts` (rewritten); local decoding cases → `lib/import/epg-source-response.spec.ts` |
| `workers/epg-import-atomicity.spec.ts` (#1941) | stays, unchanged (runs the real bundled worker) |
| `events/epg.events.spec.ts`, `epg-mapping.events.spec.ts`, `database/epg-db.events.spec.ts`, `epg-worker.service*.spec.ts` | stay, unchanged |

Paths in this plan are relative to the worktree root. Line numbers cite `origin/master` at `002faebb0`; Task 1 re-checks them.

---

### Task 1: Refresh against master

**Files:** none changed; the move map above is corrected in place if `master` differs.

- [ ] **Step 1: Check that the pipeline pull requests are merged**

Run from the main checkout:

```bash
for pr in 1941 1946 1947 1800; do
  gh pr view "$pr" -R 4gray/iptvnator \
    --json number,state,mergedAt,mergeCommit \
    --jq '"#\(.number) \(.state) \(.mergedAt // "-") \(.mergeCommit.oid // "-")"'
done
```

Expected: `#1941`, `#1946`, `#1947` print `MERGED`; `#1800` prints `MERGED` or `CLOSED` (it overlaps #1947). If any of #1941, #1946, #1947 is `OPEN`, stop and report: the overview starts 3b-2 only after they merge.

- [ ] **Step 2: Create the worktree**

```bash
git fetch origin
git worktree add .claude/worktrees/server-epg-store -b claude/server-epg-store origin/master
cd .claude/worktrees/server-epg-store
git log --oneline -1
```

Expected: a new branch at the current `origin/master` head. All later commands run in this worktree.

- [ ] **Step 3: Confirm the merged code has the shapes this plan moves**

```bash
git grep -n -E "export class EpgImportStaging|^    commit\(\): void|insertChannels\(rows|insertPrograms\(rows" -- apps/electron-backend/src/app/workers/epg-import-staging.ts
git grep -n -E "createImport\(sourceUrl|strict = false|export class EpgDatabase \{|export class EpgDatabaseClearOperation|export class EpgDatabaseSourceClearOperation|private ensureProgramDedupIndex" -- apps/electron-backend/src/app/workers/epg-database.ts
git grep -n -E "setEncoding\('utf8'\)|epgDb\.createImport\(url\)|staged\.commit\(\)|function toEpgFetchError" -- apps/electron-backend/src/app/workers/epg-parser.worker.ts
git grep -n -E "new EpgDatabase\(SharedDatabase|seed\.insertChannels|seed\.insertPrograms" -- apps/electron-backend/src/app/workers/testing/epg-import-scenario.ts
git grep -n -E "eq\(schema\.epgChannelSources\.sourceUrl, url\)|export const EPG_FRESHNESS_MAX_AGE_HOURS" -- apps/electron-backend/src/app/events/epg-fetch.service.ts
git grep -n -E "export function retireAllEpgSources|export class EpgFetchQueue" -- apps/electron-backend/src/app/events
```

Expected: every pattern matches at least once. `EpgImportStaging` has a constructor `(db, applyChannels, applyProgrammes)`, `insertChannels`, `insertPrograms`, `commit`, and no `dispose`.

- [ ] **Step 4: List every commit since the plan was written that touches a moved file**

```bash
git log --oneline 002faebb0..HEAD -- \
  apps/electron-backend/src/app/workers/epg-*.ts \
  apps/electron-backend/src/app/workers/testing \
  apps/electron-backend/src/app/util/epg-logger*.ts \
  apps/electron-backend/src/app/events/epg-query.service*.ts \
  apps/electron-backend/src/app/events/epg-guide-*.ts \
  apps/electron-backend/src/app/events/epg-program-row.util.ts \
  apps/electron-backend/src/app/events/epg-mapping.service*.ts \
  apps/electron-backend/src/app/events/epg-fetch.service.ts \
  apps/electron-backend/src/app/events/epg.events.ts \
  apps/electron-backend/src/app/events/database/epg-db.events*.ts \
  libs/shared/database/src/lib/connection.ts \
  apps/web-backend/src/app/validated-http-client.ts apps/web-backend/src/app/provider-response.ts
```

Expected: the merge commits of #1941, #1947 (and #1800 if merged), and any other EPG fix. For each listed commit run `git show --stat <sha>`. A new file next to a moved one (for example a new `workers/epg-*.ts`) is moved by the same rule as its neighbours; a new spec moves with its code. Record every such addition in a "Move map changes" list for the PR body. If #1941 merged with a staging API other than `createImport(url)` → `insertChannels` / `insertPrograms` / `commit()`, adapt the three calls in Task 9's `runEpgImport` to the merged names and note it in the same list.

- [ ] **Step 5: Re-check the cited line ranges**

```bash
grep -n -E "// EPG tables|// EPG channel mappings|ADD COLUMN source_url|ADD COLUMN write_order|idx_epg_programs_source_time_range" libs/shared/database/src/lib/connection.ts
wc -l apps/electron-backend/src/app/events/epg-query.service.ts apps/electron-backend/src/app/events/epg.events.ts
```

Expected (at `002faebb0`): `// EPG tables` at 237, `// EPG channel mappings` at 302, the two `ALTER` lines at 392 and 394, the source-time-range index at 414; `epg-query.service.ts` 976 lines. Different numbers are fine; use the current ones wherever this plan cites a range.

---

### Task 2: Install, discovery and baseline

**Files:** none.

- [ ] **Step 1: Install and verify discovery**

```bash
pnpm install --frozen-lockfile
pnpm nx show projects | grep -E '^(database|electron-backend|electron-backend-e2e|web-backend|shared-logging|shared-interfaces)$'
node tools/testing/ensure-electron-binary.mjs
```

Expected: install exits 0, the grep prints the six names, the Electron check prints the pinned version.

- [ ] **Step 2: Record the baseline**

```bash
pnpm nx test electron-backend 2>&1 | tee /tmp/3b2-electron-backend-baseline.txt | tail -5
pnpm nx test database
pnpm nx test web-backend
```

Expected: `database` and `web-backend` pass. For `electron-backend` note the summary line; failures that exist before any change (sandboxes without network have failed a few Xtream connectivity and stream-probe specs) are the baseline. Later tasks must not add failures; do not fix unrelated ones here.

---

### Task 3: One source of truth for the EPG DDL

**Files:**
- Create: `libs/shared/database/src/lib/epg-schema-sql.ts`
- Create: `libs/shared/database/src/lib/epg-schema-sql.spec.ts`
- Modify: `libs/shared/database/src/lib/connection.ts:1-15` (import), `:237-301` (tables), `:391-394` (column migrations), `:412-414` (index migrations)
- Modify: `tsconfig.base.json` (paths, after `@iptvnator/shared/database/connection-observer`)
- Modify: `apps/electron-backend/build-worker.js:85-110` (alias table)

- [ ] **Step 1: Write the failing spec**

Create `libs/shared/database/src/lib/epg-schema-sql.spec.ts`:

```ts
import { __databaseConnectionTestHooks } from './connection';
import {
    EPG_COLUMN_MIGRATION_STATEMENTS,
    EPG_INDEX_MIGRATION_STATEMENTS,
    EPG_PROGRAMS_FTS_STATEMENTS,
    EPG_TABLE_STATEMENTS,
} from './epg-schema-sql';

function containsInOrder(
    list: readonly string[],
    part: readonly string[]
): boolean {
    const start = list.indexOf(part[0]);
    return (
        start >= 0 &&
        part.every((statement, offset) => list[start + offset] === statement)
    );
}

describe('EPG schema statements', () => {
    const {
        createTableStatements,
        columnMigrationStatements,
        indexMigrationStatements,
    } = __databaseConnectionTestHooks;

    it('run inside the main database initialization, in their original order', () => {
        expect(
            containsInOrder(createTableStatements, [
                ...EPG_TABLE_STATEMENTS,
                ...EPG_PROGRAMS_FTS_STATEMENTS,
            ])
        ).toBe(true);
        expect(
            containsInOrder(
                columnMigrationStatements,
                EPG_COLUMN_MIGRATION_STATEMENTS
            )
        ).toBe(true);
        expect(
            containsInOrder(
                indexMigrationStatements,
                EPG_INDEX_MIGRATION_STATEMENTS
            )
        ).toBe(true);
    });

    it('cover every imported-EPG table, index and trigger the main database creates', () => {
        // Manual mappings are user data and stay in connection.ts.
        const importedEpg =
            /(?:TABLE|INDEX|TRIGGER) IF NOT EXISTS (?:idx_)?epg_(?!channel_mappings)/;
        const shared = new Set([
            ...EPG_TABLE_STATEMENTS,
            ...EPG_PROGRAMS_FTS_STATEMENTS,
            ...EPG_INDEX_MIGRATION_STATEMENTS,
        ]);
        const strays = [
            ...createTableStatements,
            ...indexMigrationStatements,
        ].filter((sql) => importedEpg.test(sql) && !shared.has(sql));

        expect(strays).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test database --testPathPatterns=epg-schema-sql`
Expected: FAIL, `Cannot find module './epg-schema-sql'`.

- [ ] **Step 3: Create the statement module**

Create `libs/shared/database/src/lib/epg-schema-sql.ts`. Cut the statements from `connection.ts` (lines 238–301, 392, 394, 413–414) and paste them here byte for byte; the text inside the template literals, including its indentation, must not change because SQLite stores it in `sqlite_master`. The result is:

```ts
/**
 * The epg_* DDL in one place. `connection.ts` splices these lists into the
 * main database's initialization at the positions they always had;
 * `ensureEpgSchema()` in `@iptvnator/shared/epg-store` applies the same
 * lists to a standalone EPG database (the self-hosted server's `epg.db`).
 * Change EPG tables, indexes or their migrations only here.
 *
 * Manual channel mappings (`epg_channel_mappings`) are user data, not
 * imported EPG data, and stay in `connection.ts`.
 */

/** Tables plus the indexes on columns every historical schema had. */
export const EPG_TABLE_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS epg_channels (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      icon_url TEXT,
      url TEXT,
      source_url TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
  )`,
    `CREATE TABLE IF NOT EXISTS epg_channel_sources (
      channel_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      display_name TEXT NOT NULL,
      icon_url TEXT,
      url TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      write_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel_id, source_url),
      FOREIGN KEY (channel_id) REFERENCES epg_channels(id) ON DELETE CASCADE
  )`,
    `CREATE INDEX IF NOT EXISTS idx_epg_channel_sources_source ON epg_channel_sources(source_url)`,
    `CREATE TABLE IF NOT EXISTS epg_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      start TEXT NOT NULL,
      stop TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      icon_url TEXT,
      rating TEXT,
      episode_num TEXT,
      source_url TEXT,
      FOREIGN KEY (channel_id) REFERENCES epg_channels(id) ON DELETE CASCADE
  )`,
    // EPG indexes
    `CREATE INDEX IF NOT EXISTS idx_epg_channels_source ON epg_channels(source_url)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_channels_name ON epg_channels(display_name)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_channel ON epg_programs(channel_id)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_start ON epg_programs(start)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_stop ON epg_programs(stop)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_time_range ON epg_programs(channel_id, start, stop)`,
];

/** FTS5 table for full-text search on EPG programs and the triggers that keep it in sync. */
export const EPG_PROGRAMS_FTS_STATEMENTS: readonly string[] = [
    `CREATE VIRTUAL TABLE IF NOT EXISTS epg_programs_fts USING fts5(
      title,
      description,
      category,
      content='epg_programs',
      content_rowid='id'
  )`,
    `CREATE TRIGGER IF NOT EXISTS epg_programs_ai AFTER INSERT ON epg_programs BEGIN
      INSERT INTO epg_programs_fts(rowid, title, description, category)
      VALUES (new.id, new.title, new.description, new.category);
  END`,
    `CREATE TRIGGER IF NOT EXISTS epg_programs_ad AFTER DELETE ON epg_programs BEGIN
      INSERT INTO epg_programs_fts(epg_programs_fts, rowid, title, description, category)
      VALUES ('delete', old.id, old.title, old.description, old.category);
  END`,
    `CREATE TRIGGER IF NOT EXISTS epg_programs_au AFTER UPDATE ON epg_programs BEGIN
      INSERT INTO epg_programs_fts(epg_programs_fts, rowid, title, description, category)
      VALUES ('delete', old.id, old.title, old.description, old.category);
      INSERT INTO epg_programs_fts(rowid, title, description, category)
      VALUES (new.id, new.title, new.description, new.category);
  END`,
];

/** Columns added after the tables first shipped; a duplicate-column error means already applied. */
export const EPG_COLUMN_MIGRATION_STATEMENTS: readonly string[] = [
    // v1.7.1: Scope XMLTV programs to their source URL for playlist-local EPG lookup
    `ALTER TABLE epg_programs ADD COLUMN source_url TEXT`,
    // Preserve writer order independently of wall-clock precision or changes.
    `ALTER TABLE epg_channel_sources ADD COLUMN write_order INTEGER NOT NULL DEFAULT 0`,
];

/** Indexes on migrated columns; they run after the column migrations. */
export const EPG_INDEX_MIGRATION_STATEMENTS: readonly string[] = [
    // v1.7.1 -> v1.7.2: Query playlist-scoped EPG by source URL and channel/time
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_source ON epg_programs(source_url)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_source_time_range ON epg_programs(source_url, channel_id, start, stop)`,
];
```

- [ ] **Step 4: Splice the lists back into `connection.ts`**

Add after the `xtreamCacheUniqueIndexesExist` import (line 15):

```ts
import {
    EPG_COLUMN_MIGRATION_STATEMENTS,
    EPG_INDEX_MIGRATION_STATEMENTS,
    EPG_PROGRAMS_FTS_STATEMENTS,
    EPG_TABLE_STATEMENTS,
} from './epg-schema-sql';
```

In `CREATE_TABLE_STATEMENTS`, replace everything from `    // EPG tables` (line 237) through the closing `  END\`,` of the `epg_programs_au` trigger (line 301) with:

```ts
    // EPG tables, indexes and full-text search (epg-schema-sql.ts, shared
    // with @iptvnator/shared/epg-store's ensureEpgSchema)
    ...EPG_TABLE_STATEMENTS,
    ...EPG_PROGRAMS_FTS_STATEMENTS,
```

The `// EPG channel mappings (manual user overrides)` block that follows stays.

In `COLUMN_MIGRATION_STATEMENTS`, replace lines 391–394:

```ts
    // v1.7.1: Scope XMLTV programs to their source URL for playlist-local EPG lookup
    `ALTER TABLE epg_programs ADD COLUMN source_url TEXT`,
    // Preserve writer order independently of wall-clock precision or changes.
    `ALTER TABLE epg_channel_sources ADD COLUMN write_order INTEGER NOT NULL DEFAULT 0`,
```

with:

```ts
    ...EPG_COLUMN_MIGRATION_STATEMENTS,
```

In `INDEX_MIGRATION_STATEMENTS`, replace lines 412–414:

```ts
    // v1.7.1 -> v1.7.2: Query playlist-scoped EPG by source URL and channel/time
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_source ON epg_programs(source_url)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_source_time_range ON epg_programs(source_url, channel_id, start, stop)`,
```

with:

```ts
    ...EPG_INDEX_MIGRATION_STATEMENTS,
```

- [ ] **Step 5: Add the sub-entry alias**

In `tsconfig.base.json`, directly after the `"@iptvnator/shared/database/connection-observer"` entry:

```json
            "@iptvnator/shared/database/epg-schema-sql": [
                "libs/shared/database/src/lib/epg-schema-sql.ts"
            ],
```

In `apps/electron-backend/build-worker.js`, inside `alias: { … }` after the `'@iptvnator/shared/database/app-playlist'` entry (esbuild would otherwise rewrite the sub-path through the `@iptvnator/shared/database` barrel alias):

```js
                    '@iptvnator/shared/database/epg-schema-sql': path.join(
                        __dirname,
                        '../../libs/shared/database/src/lib/epg-schema-sql.ts'
                    ),
```

- [ ] **Step 6: Run the database suite**

```bash
pnpm nx test database --runInBand
pnpm nx lint database
```

Expected: PASS, including `epg-schema-sql.spec.ts`, `connection-upgrades.spec.ts` and `connection-migrations.spec.ts` (the statements and their order are unchanged).

- [ ] **Step 7: Commit**

```bash
git add libs/shared/database/src/lib/epg-schema-sql.ts libs/shared/database/src/lib/epg-schema-sql.spec.ts libs/shared/database/src/lib/connection.ts tsconfig.base.json apps/electron-backend/build-worker.js
git commit -m "refactor(database): keep the EPG DDL in one module

The epg_* tables, FTS triggers and their migrations move out of
connection.ts into epg-schema-sql.ts and are spliced back at the same
positions, so a standalone EPG database can use the same statements.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scaffold `shared-epg-store`, move the EPG logger, add the import error

**Files:**
- Create: `libs/shared/epg-store/project.json`, `jest.config.ts`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`
- Create: `libs/shared/epg-store/src/index.ts`, `src/index.spec.ts`, `src/lib/epg-import-error.ts`, `src/lib/epg-import-error.spec.ts`
- Move: `apps/electron-backend/src/app/util/epg-logger.ts` → `libs/shared/epg-store/src/lib/epg-logger.ts`; `util/epg-logger.spec.ts` → `src/lib/epg-logger.spec.ts`
- Create: `apps/electron-backend/src/app/util/epg-logger.ts` (re-export)
- Modify: `tsconfig.base.json`, `apps/electron-backend/build-worker.js`, `tools/coverage/coverage-policy.json`

- [ ] **Step 1: Create the project files**

`libs/shared/epg-store/project.json`:

```json
{
    "name": "shared-epg-store",
    "$schema": "../../../node_modules/nx/schemas/project-schema.json",
    "sourceRoot": "libs/shared/epg-store/src",
    "projectType": "library",
    "tags": ["scope:shared", "domain:shared-runtime", "type:data-access"],
    "targets": {
        "test": {
            "executor": "@nx/jest:jest",
            "outputs": ["{workspaceRoot}/coverage/{projectRoot}"],
            "options": {
                "jestConfig": "libs/shared/epg-store/jest.config.ts",
                "tsConfig": "libs/shared/epg-store/tsconfig.spec.json"
            }
        },
        "lint": {
            "command": "eslint \"libs/shared/epg-store/**/*.ts\""
        }
    }
}
```

No `build` target: the consumers (Electron webpack and esbuild, the web-backend esbuild bundle) compile the library from source, like `libs/shared/logging`.

`libs/shared/epg-store/jest.config.ts`:

```ts
export default {
    displayName: 'shared-epg-store',
    preset: '../../../jest.preset.js',
    testEnvironment: 'node',
    transform: {
        '^.+\\.[tj]s$': [
            'ts-jest',
            { tsconfig: '<rootDir>/tsconfig.spec.json' },
        ],
    },
    moduleFileExtensions: ['ts', 'js'],
    coverageDirectory: '../../../coverage/libs/shared/epg-store',
};
```

`libs/shared/epg-store/tsconfig.json` (strict: PR 3c compiles this code inside the strict `web-backend` program):

```json
{
    "extends": "../../../tsconfig.base.json",
    "compilerOptions": {
        "module": "commonjs",
        "forceConsistentCasingInFileNames": true,
        "strict": true,
        "importHelpers": true,
        "noImplicitOverride": true,
        "noFallthroughCasesInSwitch": true,
        "esModuleInterop": true,
        "ignoreDeprecations": "6.0"
    },
    "files": [],
    "include": [],
    "references": [
        { "path": "./tsconfig.lib.json" },
        { "path": "./tsconfig.spec.json" }
    ]
}
```

`libs/shared/epg-store/tsconfig.lib.json`:

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "outDir": "../../../dist/out-tsc",
        "declaration": true,
        "types": ["node"]
    },
    "include": ["src/**/*.ts"],
    "exclude": ["jest.config.ts", "src/**/*.spec.ts", "src/**/*.test.ts"]
}
```

`libs/shared/epg-store/tsconfig.spec.json`:

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "emitDecoratorMetadata": false,
        "outDir": "../../../dist/out-tsc",
        "module": "commonjs",
        "moduleResolution": "node10",
        "types": ["jest", "node"]
    },
    "include": [
        "jest.config.ts",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/*.d.ts"
    ]
}
```

- [ ] **Step 2: Add the aliases**

In `tsconfig.base.json`, directly after the `"@iptvnator/shared/host-health"` entry:

```json
            "@iptvnator/shared/epg-store": [
                "libs/shared/epg-store/src/index.ts"
            ],
            "@iptvnator/shared/epg-store/testing": [
                "libs/shared/epg-store/src/testing/index.ts"
            ],
```

In `apps/electron-backend/build-worker.js`, inside `alias: { … }` after the entry added in Task 3:

```js
                    '@iptvnator/shared/epg-store': path.join(
                        __dirname,
                        '../../libs/shared/epg-store/src/index.ts'
                    ),
```

- [ ] **Step 3: Register the project for coverage**

In `tools/coverage/coverage-policy.json`, in `unitCoverage.tierA`, directly after the `"shared-host-health"` object:

```json
            {
                "name": "shared-epg-store",
                "root": "libs/shared/epg-store",
                "sourceRoot": "libs/shared/epg-store/src",
                "validationCommand": "pnpm nx test shared-epg-store",
                "e2eTags": ["@epg", "@electron"]
            },
```

- [ ] **Step 4: Write the failing tests for the import error and the entry point**

`libs/shared/epg-store/src/lib/epg-import-error.spec.ts`:

```ts
import { EPG_IMPORT_ERROR_CODES, EpgImportError } from './epg-import-error';

describe('EpgImportError', () => {
    it('carries a code and keeps the message', () => {
        const error = new EpgImportError(
            EPG_IMPORT_ERROR_CODES.Empty,
            'nothing to import'
        );

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(EpgImportError);
        expect(error.name).toBe('EpgImportError');
        expect(error.code).toBe('epg_empty');
        expect(error.message).toBe('nothing to import');
    });

    it('uses the code as the message when none is given', () => {
        expect(
            new EpgImportError(EPG_IMPORT_ERROR_CODES.Aborted).message
        ).toBe('epg_aborted');
    });

    it('exposes the four contract codes', () => {
        expect(EPG_IMPORT_ERROR_CODES).toEqual({
            Empty: 'epg_empty',
            ParseFailed: 'epg_parse_failed',
            TooLarge: 'epg_too_large',
            Aborted: 'epg_aborted',
        });
    });
});
```

`libs/shared/epg-store/src/index.spec.ts`:

```ts
describe('@iptvnator/shared/epg-store entry point', () => {
    it('loads no native SQLite binding on import', async () => {
        // The Electron EPG worker imports this barrel before it registers
        // the packaged native-module search paths; better-sqlite3 (and
        // drizzle's better-sqlite3 driver, which requires it) may only load
        // when a function that needs it is called.
        await jest.isolateModulesAsync(async () => {
            jest.doMock('better-sqlite3', () => {
                throw new Error('better-sqlite3 was loaded at import time');
            });

            await expect(import('./index')).resolves.toBeDefined();
        });
    });
});
```

Run: `pnpm nx test shared-epg-store`
Expected: FAIL, `Cannot find module './epg-import-error'` and `Cannot find module './index'`.

- [ ] **Step 5: Create the import error**

`libs/shared/epg-store/src/lib/epg-import-error.ts`:

```ts
/** Failures `runEpgImport` itself recognizes; everything else propagates unchanged. */
export const EPG_IMPORT_ERROR_CODES = {
    Empty: 'epg_empty',
    ParseFailed: 'epg_parse_failed',
    TooLarge: 'epg_too_large',
    Aborted: 'epg_aborted',
} as const;

export type EpgImportErrorCode =
    (typeof EPG_IMPORT_ERROR_CODES)[keyof typeof EPG_IMPORT_ERROR_CODES];

export class EpgImportError extends Error {
    constructor(
        readonly code: EpgImportErrorCode,
        message?: string
    ) {
        super(message ?? code);
        this.name = 'EpgImportError';
    }
}
```

- [ ] **Step 6: Move the logger and leave a re-export behind**

```bash
mkdir -p libs/shared/epg-store/src/lib
git mv apps/electron-backend/src/app/util/epg-logger.ts libs/shared/epg-store/src/lib/epg-logger.ts
git mv apps/electron-backend/src/app/util/epg-logger.spec.ts libs/shared/epg-store/src/lib/epg-logger.spec.ts
```

Both files keep their content; their only imports are `@iptvnator/shared/logging` and `./epg-logger`.

Create `apps/electron-backend/src/app/util/epg-logger.ts`:

```ts
/** The EPG logger lives in `@iptvnator/shared/epg-store`; Electron modules keep this path. */
export { epgLogger } from '@iptvnator/shared/epg-store';
```

- [ ] **Step 7: Create the entry point**

`libs/shared/epg-store/src/index.ts` (later tasks append to it):

```ts
/**
 * @iptvnator/shared/epg-store: XMLTV import, maintenance and EPG queries
 * for Node (the Electron EPG worker and main process, the self-hosted web
 * backend). Renderer code must not import it (eslint.config.mjs).
 */
export { EPG_IMPORT_ERROR_CODES, EpgImportError } from './lib/epg-import-error';
export type { EpgImportErrorCode } from './lib/epg-import-error';
export { epgLogger } from './lib/epg-logger';
```

- [ ] **Step 8: Run the checks**

```bash
pnpm nx show projects | grep -x shared-epg-store
pnpm nx test shared-epg-store
pnpm nx lint shared-epg-store
pnpm nx test electron-backend --testPathPatterns="epg|util"
pnpm run coverage:policy:check
```

Expected: the project is listed; all pass (`electron-backend` modules that import `../util/epg-logger` now get the re-export).

- [ ] **Step 9: Commit**

```bash
git add libs/shared/epg-store tsconfig.base.json apps/electron-backend/build-worker.js tools/coverage/coverage-policy.json apps/electron-backend/src/app/util/epg-logger.ts
git commit -m "refactor(epg): add the shared-epg-store library with the EPG logger

Node-only library for the XMLTV pipeline and EPG queries. It starts with
EpgImportError and the URL-omitting EPG logger, which Electron re-exports
from its old path.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Keep the library out of renderer code

**Files:**
- Modify: `eslint.config.mjs:10-23` (helper), `:222-236` (existing rule), after `:238` (new block)

- [ ] **Step 1: Prove the gap with a probe**

```bash
cat > libs/services/src/lib/epg-store-import-probe.ts <<'EOF'
import { epgLogger } from '@iptvnator/shared/epg-store';

export const epgStoreImportProbe = epgLogger;
EOF
pnpm nx lint services --skip-nx-cache 2>&1 | grep -n "epg-store-import-probe" || echo "probe not flagged"
```

Expected: `probe not flagged` (type and domain tags allow it today).

- [ ] **Step 2: Build the restricted-import options in one place**

In `eslint.config.mjs`, after the `legacyBareAliases` array (line 23), add:

```js
const legacyAliasMessage =
    'Use the scoped @iptvnator/* path alias instead of the legacy bare alias.';

const nodeOnlyLibraryMessage =
    '@iptvnator/shared/epg-store is Node-only (SQLite, zlib, streams). Renderer code reaches EPG through the EPG runtime backend.';

/** `no-restricted-imports` options: the legacy alias ban plus `extra`. */
function restrictedImports(extra = { paths: [], patterns: [] }) {
    return {
        paths: [
            ...legacyBareAliases.map((name) => ({
                name,
                message: legacyAliasMessage,
            })),
            ...extra.paths,
        ],
        patterns: [
            ...legacyBareAliases.map((name) => ({
                group: [`${name}/*`],
                message: legacyAliasMessage,
            })),
            ...extra.patterns,
        ],
    };
}
```

Replace the existing rule body (lines 222–236):

```js
            'no-restricted-imports': [
                'error',
                {
                    paths: legacyBareAliases.map((name) => ({
                        name,
                        message:
                            'Use the scoped @iptvnator/* path alias instead of the legacy bare alias.',
                    })),
                    patterns: legacyBareAliases.map((name) => ({
                        group: [`${name}/*`],
                        message:
                            'Use the scoped @iptvnator/* path alias instead of the legacy bare alias.',
                    })),
                },
            ],
```

with:

```js
            'no-restricted-imports': ['error', restrictedImports()],
```

- [ ] **Step 3: Add the renderer block**

Directly after the closing `},` of that first rules block (the object that holds `@nx/enforce-module-boundaries`, line 238), insert:

```js
    {
        // Node-only libraries stay out of renderer bundles. Tags cannot say
        // this: `services` (renderer) and `database` (Node) share all three
        // tags, as do `web` and `web-backend`, so renderer sources are listed
        // by path. A later block replaces the whole rule, so the legacy alias
        // ban is repeated through restrictedImports().
        files: [
            'apps/web/src/**/*.ts',
            'apps/remote-control-web/src/**/*.ts',
            'libs/**/*.ts',
        ],
        ignores: ['libs/shared/epg-store/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                restrictedImports({
                    paths: [
                        {
                            name: '@iptvnator/shared/epg-store',
                            message: nodeOnlyLibraryMessage,
                        },
                    ],
                    patterns: [
                        {
                            group: ['@iptvnator/shared/epg-store/*'],
                            message: nodeOnlyLibraryMessage,
                        },
                    ],
                }),
            ],
        },
    },
```

`libs/**` includes `libs/shared/database`, so the rule also keeps the dependency direction `shared-epg-store` → `database`.

- [ ] **Step 4: Verify the probe is now rejected, then remove it**

```bash
pnpm nx lint services --skip-nx-cache 2>&1 | grep -n "Node-only" 
rm libs/services/src/lib/epg-store-import-probe.ts
cat > libs/services/src/lib/epg-store-import-probe.ts <<'EOF'
import { services } from 'services';

export const legacyAliasProbe = services;
EOF
pnpm nx lint services --skip-nx-cache 2>&1 | grep -n "legacy bare alias"
rm libs/services/src/lib/epg-store-import-probe.ts
```

Expected: the first grep prints the `no-restricted-imports` error with the Node-only message; the second prints the legacy-alias error (the merged rule still bans bare aliases). Both probe files are deleted.

- [ ] **Step 5: Run the lint targets that read the root config**

```bash
pnpm nx run-many -t lint -p services database shared-epg-store electron-backend web-backend web
git status --short
```

Expected: no new errors (existing warnings unchanged); `git status` shows only `eslint.config.mjs`.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs
git commit -m "build(lint): keep @iptvnator/shared/epg-store out of renderer code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `ensureEpgSchema` and the dedup index

**Files:**
- Create: `libs/shared/epg-store/src/lib/schema/epg-program-dedup-index.ts`
- Create: `libs/shared/epg-store/src/lib/schema/ensure-epg-schema.ts`
- Create: `libs/shared/epg-store/src/lib/schema/ensure-epg-schema.spec.ts`
- Modify: `libs/shared/epg-store/src/index.ts`

- [ ] **Step 1: Write the failing spec**

`libs/shared/epg-store/src/lib/schema/ensure-epg-schema.spec.ts`:

```ts
import Database from 'better-sqlite3';
import { ensureEpgSchema } from './ensure-epg-schema';

type SchemaObject = { type: string; name: string; sql: string | null };

function schemaObjects(db: Database.Database): SchemaObject[] {
    return db
        .prepare(
            "SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%epg%' ORDER BY type, name"
        )
        .all() as SchemaObject[];
}

function names(db: Database.Database): string[] {
    return schemaObjects(db).map((object) => object.name);
}

function columns(db: Database.Database, table: string): string[] {
    return (
        db
            .prepare(`SELECT name FROM pragma_table_info('${table}')`)
            .all() as Array<{ name: string }>
    ).map((column) => column.name);
}

describe('ensureEpgSchema', () => {
    let db: Database.Database;

    beforeEach(() => {
        db = new Database(':memory:');
    });

    afterEach(() => db.close());

    it('creates the EPG tables and indexes, without full-text search when not asked', () => {
        ensureEpgSchema(db, { fts: false });

        expect(names(db)).toEqual(
            expect.arrayContaining([
                'epg_channels',
                'epg_channel_sources',
                'epg_programs',
                'idx_epg_channel_sources_source',
                'idx_epg_channels_source',
                'idx_epg_channels_name',
                'idx_epg_programs_channel',
                'idx_epg_programs_start',
                'idx_epg_programs_stop',
                'idx_epg_programs_time_range',
                'idx_epg_programs_source',
                'idx_epg_programs_source_time_range',
                'idx_epg_programs_dedup_v2',
            ])
        );
        expect(names(db).filter((name) => name.startsWith('epg_programs_'))).toEqual([]);
        expect(names(db)).not.toContain('epg_channel_mappings');
    });

    it('adds the FTS table and its triggers when asked', () => {
        ensureEpgSchema(db, { fts: true });

        expect(names(db)).toEqual(
            expect.arrayContaining([
                'epg_programs_fts',
                'epg_programs_ai',
                'epg_programs_ad',
                'epg_programs_au',
            ])
        );
    });

    it.each([false, true])('is safe to run again (fts: %s)', (fts) => {
        ensureEpgSchema(db, { fts });
        const first = schemaObjects(db);

        ensureEpgSchema(db, { fts });

        expect(schemaObjects(db)).toEqual(first);
    });

    it('upgrades tables from before per-source programmes and writer order, keeping their rows', () => {
        db.exec(`
            CREATE TABLE epg_channels (id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
                icon_url TEXT, url TEXT, source_url TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')));
            CREATE TABLE epg_channel_sources (channel_id TEXT NOT NULL, source_url TEXT NOT NULL,
                display_name TEXT NOT NULL, icon_url TEXT, url TEXT,
                updated_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (channel_id, source_url));
            CREATE TABLE epg_programs (id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL, start TEXT NOT NULL, stop TEXT NOT NULL,
                title TEXT NOT NULL, description TEXT, category TEXT, icon_url TEXT,
                rating TEXT, episode_num TEXT);
            INSERT INTO epg_channels (id, display_name, source_url)
                VALUES ('a', 'A', 'https://a.test/guide.xml');
            INSERT INTO epg_channel_sources (channel_id, source_url, display_name)
                VALUES ('a', 'https://a.test/guide.xml', 'A');
            INSERT INTO epg_programs (channel_id, start, stop, title) VALUES
                ('a', '2026-10-15T08:00:00Z', '2026-10-15T09:00:00Z', 'News'),
                ('a', '2026-10-15T08:00:00Z', '2026-10-15T09:00:00Z', 'News');
        `);

        ensureEpgSchema(db, { fts: false });

        expect(columns(db, 'epg_programs')).toContain('source_url');
        expect(columns(db, 'epg_channel_sources')).toContain('write_order');
        expect(names(db)).toEqual(
            expect.arrayContaining([
                'idx_epg_programs_source_time_range',
                'idx_epg_programs_dedup_v2',
            ])
        );
        // The dedup index removes the duplicate slot before it is created.
        expect(
            db.prepare('SELECT COUNT(*) AS count FROM epg_programs').get()
        ).toEqual({ count: 1 });
        expect(
            db.prepare('SELECT write_order FROM epg_channel_sources').get()
        ).toEqual({ write_order: 0 });
    });
});
```

Run: `pnpm nx test shared-epg-store --testPathPatterns=ensure-epg-schema`
Expected: FAIL, `Cannot find module './ensure-epg-schema'`.

- [ ] **Step 2: Create the dedup index helper**

`libs/shared/epg-store/src/lib/schema/epg-program-dedup-index.ts`. The body is `EpgDatabase.ensureProgramDedupIndex` from `apps/electron-backend/src/app/workers/epg-database.ts:197-246` with `this.db` → `db`; Task 8 deletes the original.

```ts
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Create the unique (channel_id, start, title, source_url) dedup index.
 *
 * Databases that predate the index may already contain duplicate rows —
 * exactly the situation the index is meant to prevent — so those are
 * removed first; a plain `CREATE UNIQUE INDEX` would otherwise throw and
 * permanently break EPG imports for upgrading users.
 *
 * The `_v2` name migrates users off the earlier source-blind index
 * (`idx_epg_programs_dedup` on `channel_id, start, title`), which
 * collapsed programmes imported from different EPG sources that shared
 * those three columns. The old index is dropped so it can no longer
 * enforce the source-blind uniqueness.
 *
 * Returns false when the index could not be created, in which case the
 * import writer falls back to plain inserts.
 */
export function ensureProgramDedupIndex(db: BetterSqlite3.Database): boolean {
    try {
        const exists = db
            .prepare(
                `SELECT 1 FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_epg_programs_dedup_v2'`
            )
            .get();
        if (!exists) {
            db.prepare(`DROP INDEX IF EXISTS idx_epg_programs_dedup`).run();
            db.prepare(
                `DELETE FROM epg_programs
                 WHERE id NOT IN (
                     SELECT MIN(id) FROM epg_programs
                     GROUP BY channel_id, start, title, source_url
                 )`
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX idx_epg_programs_dedup_v2
                 ON epg_programs(channel_id, start, title, source_url)`
            ).run();
        }
        return true;
    } catch {
        return false;
    }
}
```

- [ ] **Step 3: Create `ensureEpgSchema`**

`libs/shared/epg-store/src/lib/schema/ensure-epg-schema.ts`:

```ts
import type BetterSqlite3 from 'better-sqlite3';
import {
    EPG_COLUMN_MIGRATION_STATEMENTS,
    EPG_INDEX_MIGRATION_STATEMENTS,
    EPG_PROGRAMS_FTS_STATEMENTS,
    EPG_TABLE_STATEMENTS,
} from '@iptvnator/shared/database/epg-schema-sql';
import { ensureProgramDedupIndex } from './epg-program-dedup-index';

/**
 * Creates or upgrades the epg_* tables on `db` with the statements the
 * desktop database runs in `initDatabase()`, so the two schemas cannot fork,
 * plus the programme dedup index the import writer otherwise creates on
 * first use. Safe on every start.
 *
 * `fts: true` adds `epg_programs_fts` and its triggers, as on the desktop.
 * A standalone EPG database passes `false`: programme search uses `LIKE`
 * and the triggers would slow every import. An existing FTS table is left
 * alone either way. Manual channel mappings are user data and are not part
 * of this schema.
 *
 * Unlike `initDatabase()`, which logs a failed migration and continues,
 * this throws on anything but an already-applied column, so a caller can
 * discard a database it cannot upgrade (it holds no user data).
 */
export function ensureEpgSchema(
    db: BetterSqlite3.Database,
    options: { fts: boolean }
): void {
    for (const statement of EPG_TABLE_STATEMENTS) {
        db.exec(statement);
    }
    if (options.fts) {
        for (const statement of EPG_PROGRAMS_FTS_STATEMENTS) {
            db.exec(statement);
        }
    }
    for (const statement of EPG_COLUMN_MIGRATION_STATEMENTS) {
        try {
            db.exec(statement);
        } catch (error) {
            if (!isDuplicateColumnError(error)) {
                throw error;
            }
        }
    }
    for (const statement of EPG_INDEX_MIGRATION_STATEMENTS) {
        db.exec(statement);
    }
    ensureProgramDedupIndex(db);
}

function isDuplicateColumnError(error: unknown): boolean {
    return (
        error instanceof Error &&
        error.message.toLowerCase().includes('duplicate column name')
    );
}
```

- [ ] **Step 4: Export it**

Append to `libs/shared/epg-store/src/index.ts`:

```ts
export { ensureEpgSchema } from './lib/schema/ensure-epg-schema';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm nx test shared-epg-store`
Expected: PASS, including the four `ensureEpgSchema` cases and `index.spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add libs/shared/epg-store/src
git commit -m "feat(epg): ensureEpgSchema for a standalone EPG database

Applies the shared epg_* DDL with optional FTS and creates the programme
dedup index; idempotent and upgrade-safe.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Move the stream decoding stages and add the source response

From this task until Task 11, `electron-backend` does not compile (its worker still imports the moved files). Run only the library checks.

**Files:**
- Move: `apps/electron-backend/src/app/workers/epg-optional-gunzip.ts`, `epg-response-utils.ts` (+ spec), `epg-stream-decoder.ts` (+ spec), `epg-streaming-parser.ts` (+ spec) → `libs/shared/epg-store/src/lib/import/`
- Create: `libs/shared/epg-store/src/lib/import/epg-source-response.ts`, `epg-source-response.spec.ts`
- Modify: `apps/electron-backend-e2e/src/performance/charset-parse-workloads.ts:47-52`

- [ ] **Step 1: Move the files**

```bash
mkdir -p libs/shared/epg-store/src/lib/import
for file in epg-optional-gunzip.ts epg-response-utils.ts epg-response-utils.spec.ts \
    epg-stream-decoder.ts epg-stream-decoder.spec.ts \
    epg-streaming-parser.ts epg-streaming-parser.spec.ts; do
  git mv "apps/electron-backend/src/app/workers/$file" "libs/shared/epg-store/src/lib/import/$file"
done
grep -n "from '" libs/shared/epg-store/src/lib/import/*.ts
```

Expected: every import is a Node built-in, `saxes`, or a sibling (`./epg-optional-gunzip`, `./epg-response-utils`, `./epg-stream-decoder`, `./epg-streaming-parser`). No rewrite is needed.

- [ ] **Step 2: Point the charset benchmark at the new parser path**

In `apps/electron-backend-e2e/src/performance/charset-parse-workloads.ts`, replace:

```ts
            '../../../electron-backend/src/app/workers/epg-streaming-parser.ts'
```

with:

```ts
            '../../../../libs/shared/epg-store/src/lib/import/epg-streaming-parser.ts'
```

and in the comment above `XMLTV_CHUNK_CHARS` replace `The EPG worker writes 64 KiB decoded chunks.` with `The EPG import writes 64 KiB decoded chunks.` Verify the path:

```bash
node -e "require('node:fs').accessSync(require('node:path').resolve('apps/electron-backend-e2e/src/performance', '../../../../libs/shared/epg-store/src/lib/import/epg-streaming-parser.ts'))" && echo ok
```

Expected: `ok`.

- [ ] **Step 3: Write the failing decoding spec**

`libs/shared/epg-store/src/lib/import/epg-source-response.spec.ts` (the local-file cases come from `epg-source-stream.spec.ts`, whose decoding now happens here):

```ts
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { EPG_IMPORT_ERROR_CODES } from '../epg-import-error';
import {
    decodeEpgSourceResponse,
    type EpgSourceResponse,
} from './epg-source-response';

const xml =
    '<?xml version="1.0" encoding="utf-8"?><tv><channel id="c1">' +
    '<display-name>One</display-name></channel></tv>';

async function readText(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
}

function response(
    body: Buffer | string,
    overrides: Partial<EpgSourceResponse> = {}
): EpgSourceResponse {
    return {
        stream: Readable.from([Buffer.from(body)]),
        requestUrl: 'https://epg.test/guide.xml',
        finalUrl: 'https://epg.test/guide.xml',
        headers: {},
        ...overrides,
    };
}

describe('decodeEpgSourceResponse', () => {
    describe('local files', () => {
        it.each<[string, Buffer, string]>([
            ['plain XML named .xml.gz', Buffer.from(xml), '/epg/guide.xml.gz'],
            ['gzip without an extension', gzipSync(xml), '/epg/guide'],
            ['gzip named .xml', gzipSync(xml), '/epg/guide.xml'],
        ])('decodes %s by its signature only', async (_name, body, path) => {
            const decoded = decodeEpgSourceResponse(
                response(body, { requestUrl: path, finalUrl: path, kind: 'file' })
            );

            await expect(readText(decoded)).resolves.toBe(xml);
        });

        it('fails a truncated gzip file instead of parsing it as XML', async () => {
            const decoded = decodeEpgSourceResponse(
                response(gzipSync(xml).subarray(0, 20), { kind: 'file' })
            );

            await expect(readText(decoded)).rejects.toThrow();
        });
    });

    describe('HTTP bodies', () => {
        it('passes plain XML through', async () => {
            await expect(
                readText(decodeEpgSourceResponse(response(xml)))
            ).resolves.toBe(xml);
        });

        it('gunzips a body whose redirect target names a .gz file', async () => {
            const decoded = decodeEpgSourceResponse(
                response(gzipSync(xml), {
                    finalUrl: 'https://cdn.epg.test/guide.xml.gz',
                })
            );

            await expect(readText(decoded)).resolves.toBe(xml);
        });

        it('decodes one gzip layer described by both Content-Encoding and a .gz name', async () => {
            const decoded = decodeEpgSourceResponse(
                response(gzipSync(xml), {
                    requestUrl: 'https://epg.test/guide.xml.gz',
                    finalUrl: 'https://epg.test/guide.xml.gz',
                    headers: { 'content-encoding': 'gzip' },
                })
            );

            await expect(readText(decoded)).resolves.toBe(xml);
        });

        it('decodes a gzip file inside HTTP gzip', async () => {
            const decoded = decodeEpgSourceResponse(
                response(gzipSync(gzipSync(xml)), {
                    requestUrl: 'https://epg.test/guide.xml.gz',
                    finalUrl: 'https://epg.test/guide.xml.gz',
                    headers: { 'Content-Encoding': 'gzip' },
                })
            );

            await expect(readText(decoded)).resolves.toBe(xml);
        });
    });

    describe('maxDecompressedBytes', () => {
        it('fails with epg_too_large once the decoded body passes the cap', async () => {
            const decoded = decodeEpgSourceResponse(
                response(gzipSync('x'.repeat(4096)), {
                    finalUrl: 'https://epg.test/guide.xml.gz',
                }),
                1024
            );

            await expect(readText(decoded)).rejects.toMatchObject({
                code: EPG_IMPORT_ERROR_CODES.TooLarge,
            });
        });

        it('accepts a body of exactly the cap', async () => {
            const decoded = decodeEpgSourceResponse(
                response('x'.repeat(1024)),
                1024
            );

            await expect(readText(decoded)).resolves.toHaveLength(1024);
        });
    });
});
```

Run: `pnpm nx test shared-epg-store --testPathPatterns=epg-source-response`
Expected: FAIL, `Cannot find module './epg-source-response'`.

- [ ] **Step 4: Create the source response module**

`libs/shared/epg-store/src/lib/import/epg-source-response.ts`. The HTTP branch is the decoding half of `openRemoteEpgSource` (`apps/electron-backend/src/app/workers/epg-source-stream.ts:110-138`) and the file branch the pipeline of `openLocalEpgSource` (`:75-84`):

```ts
import { PassThrough, pipeline, Transform, type Readable } from 'node:stream';
import { EPG_IMPORT_ERROR_CODES, EpgImportError } from '../epg-import-error';
import { epgLogger } from '../epg-logger';
import { createOptionalEpgGunzip } from './epg-optional-gunzip';
import {
    getEpgResponseContentEncoding,
    shouldGunzipEpgResponse,
} from './epg-response-utils';
import { createDecodedEpgStream } from './epg-stream-decoder';

const loggerLabel = '[EPG Worker]';

/** An opened XMLTV source, before any decoding. */
export interface EpgSourceResponse {
    /** Raw body, before Content-Encoding. */
    readonly stream: Readable;
    readonly requestUrl: string;
    /** After redirects. */
    readonly finalUrl: string;
    readonly headers: Readonly<Record<string, string | string[] | undefined>>;
    /**
     * `'file'`: a local file. No HTTP headers apply and gzip is detected from
     * the first two bytes only, so `guide.xml`, `guide.xml.gz` and a gzip file
     * without an extension all parse. Default `'http'`.
     */
    readonly kind?: 'http' | 'file';
}

/** Opens a source; its errors reach the `runEpgImport` caller unchanged. */
export type EpgSourceOpener = (
    url: string,
    signal: AbortSignal
) => Promise<EpgSourceResponse>;

/**
 * The XMLTV bytes of an opened source: Content-Encoding layers in reverse
 * order, then one gzip file layer when the URL, redirect target, MIME type
 * or filename says so (optional when HTTP gzip was also present). With
 * `maxDecompressedBytes` the stream fails with `epg_too_large` past that
 * many decoded bytes.
 */
export function decodeEpgSourceResponse(
    response: EpgSourceResponse,
    maxDecompressedBytes?: number
): Readable {
    const decoded =
        response.kind === 'file'
            ? decodeFileBody(response.stream)
            : decodeHttpBody(response);
    return maxDecompressedBytes === undefined
        ? decoded
        : limitDecodedBytes(decoded, maxDecompressedBytes);
}

function decodeFileBody(stream: Readable): Readable {
    const output = new PassThrough();
    pipeline(stream, createOptionalEpgGunzip(), output, (error) => {
        if (error) output.destroy(error);
    });
    return output;
}

function decodeHttpBody(response: EpgSourceResponse): Readable {
    const isGzipped = shouldGunzipEpgResponse(response.requestUrl, {
        headers: response.headers,
        url: response.finalUrl,
    });
    const contentEncoding = getEpgResponseContentEncoding(response.headers);

    if (response.finalUrl !== response.requestUrl) {
        epgLogger.log(loggerLabel, 'Resolved EPG redirect');
    }
    epgLogger.log(loggerLabel, `EPG response detected as gzipped: ${isGzipped}`);
    if (contentEncoding) {
        epgLogger.log(
            loggerLabel,
            `EPG response content-encoding: ${contentEncoding}`
        );
    }

    return createDecodedEpgStream(response.stream, response.headers, isGzipped);
}

function limitDecodedBytes(decoded: Readable, maxBytes: number): Readable {
    let total = 0;
    const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            total += chunk.length;
            if (total > maxBytes) {
                callback(
                    new EpgImportError(
                        EPG_IMPORT_ERROR_CODES.TooLarge,
                        `EPG source exceeds ${maxBytes} bytes after decompression`
                    )
                );
                return;
            }
            callback(null, chunk);
        },
    });
    // pipeline destroys `decoded` (and its source) when the limit fails or
    // the consumer destroys `limit`; decoding errors surface on `limit`.
    pipeline(decoded, limit, (error) => {
        if (error) limit.destroy(error);
    });
    return limit;
}
```

- [ ] **Step 5: Run the library tests**

```bash
pnpm nx test shared-epg-store
pnpm nx lint shared-epg-store
```

Expected: PASS, including the moved `epg-stream-decoder.spec.ts`, `epg-response-utils.spec.ts`, `epg-streaming-parser.spec.ts` and the new decoding spec.

- [ ] **Step 6: Commit**

```bash
git add libs/shared/epg-store/src/lib/import apps/electron-backend/src/app/workers apps/electron-backend-e2e/src/performance/charset-parse-workloads.ts
git commit -m "refactor(epg): move XMLTV decoding and parsing into shared-epg-store

The gzip and Content-Encoding stages and the SAX parser move unchanged;
decodeEpgSourceResponse decodes an opener's raw response and can cap the
decompressed size. The Electron worker is rewired in a later commit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Move the import writer, staging and maintenance; add prune and the test seed

**Files:**
- Move: `apps/electron-backend/src/app/workers/epg-database.ts` → `libs/shared/epg-store/src/lib/import/epg-import-writer.ts`
- Move: `apps/electron-backend/src/app/workers/epg-database.spec.ts` → `libs/shared/epg-store/src/lib/import/epg-import-writer.spec.ts`
- Move: `apps/electron-backend/src/app/workers/epg-import-staging.ts` → `libs/shared/epg-store/src/lib/import/epg-import-staging.ts`
- Move: `apps/electron-backend/src/app/workers/epg-source-metadata.ts` (+ `.spec.ts`) → `libs/shared/epg-store/src/lib/`
- Create: `libs/shared/epg-store/src/lib/maintenance/epg-clear.ts`, `epg-clear.spec.ts`, `prune-epg-programs.ts`, `prune-epg-programs.spec.ts`
- Create: `libs/shared/epg-store/src/testing/seed-epg-source.ts`, `src/testing/index.ts`
- Modify: `libs/shared/epg-store/src/index.ts`

- [ ] **Step 1: Move the files**

```bash
mkdir -p libs/shared/epg-store/src/lib/maintenance libs/shared/epg-store/src/testing
git mv apps/electron-backend/src/app/workers/epg-database.ts libs/shared/epg-store/src/lib/import/epg-import-writer.ts
git mv apps/electron-backend/src/app/workers/epg-database.spec.ts libs/shared/epg-store/src/lib/import/epg-import-writer.spec.ts
git mv apps/electron-backend/src/app/workers/epg-import-staging.ts libs/shared/epg-store/src/lib/import/epg-import-staging.ts
git mv apps/electron-backend/src/app/workers/epg-source-metadata.ts libs/shared/epg-store/src/lib/epg-source-metadata.ts
git mv apps/electron-backend/src/app/workers/epg-source-metadata.spec.ts libs/shared/epg-store/src/lib/epg-source-metadata.spec.ts
```

- [ ] **Step 2: Turn `EpgDatabase` into `EpgImportWriter`**

In `libs/shared/epg-store/src/lib/import/epg-import-writer.ts`:

1. Imports. Before:

```ts
import type BetterSqlite3 from 'better-sqlite3';
import { getIptvnatorDatabasePath } from '@iptvnator/shared/database/path-utils';
import type { ParsedChannel, ParsedProgram } from './epg-streaming-parser';
import { restoreSurvivingChannelMetadata } from './epg-source-metadata';
import { EpgImportStaging } from './epg-import-staging';
```

After:

```ts
import type BetterSqlite3 from 'better-sqlite3';
import { restoreSurvivingChannelMetadata } from '../epg-source-metadata';
import { ensureProgramDedupIndex } from '../schema/epg-program-dedup-index';
import { EpgImportStaging } from './epg-import-staging';
import type { ParsedChannel, ParsedProgram } from './epg-streaming-parser';
```

2. Class header and constructor. Before:

```ts
/**
 * Database helper for worker-owned EPG operations.
 * Creates its own connection to avoid blocking the main thread.
 */
export class EpgDatabase {
    private readonly db: BetterSqlite3.Database;
    private readonly knownChannelIds = new Set<string>();
```

and

```ts
    constructor(Database: typeof BetterSqlite3) {
        this.db = new Database(getIptvnatorDatabasePath());
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');

```

After:

```ts
/**
 * Writes parsed XMLTV channels and programmes for one import. The caller
 * owns `db`: it opens it, sets its pragmas (foreign keys, WAL,
 * busy_timeout) and closes it.
 */
export class EpgImportWriter {
    private readonly knownChannelIds = new Set<string>();
```

and

```ts
    constructor(private readonly db: BetterSqlite3.Database) {
```

3. In the constructor replace `const dedupIndexReady = this.ensureProgramDedupIndex();` with `const dedupIndexReady = ensureProgramDedupIndex(this.db);`.
4. Delete the `close()` method, the private `ensureProgramDedupIndex()` method with its doc comment (now in `schema/epg-program-dedup-index.ts`), and the classes `EpgDatabaseClearOperation` and `EpgDatabaseSourceClearOperation` (Step 4 recreates them as functions).
5. Keep `insertChannels(channels, sourceUrl, clearTodayAndFuture)`, `insertPrograms(programs, sourceUrl, strict)` and `createImport(sourceUrl)` exactly as #1941 merged them.

Check: `grep -c "" libs/shared/epg-store/src/lib/import/epg-import-writer.ts` prints fewer than 300.

- [ ] **Step 3: Let the staging tables be dropped on a connection the caller keeps**

In `libs/shared/epg-store/src/lib/import/epg-import-staging.ts` (#1941), the import of the parser types stays `./epg-streaming-parser`. Add this method after `commit()`:

```ts
    /**
     * Drops the staging tables. #1941 relied on closing the worker's own
     * connection; `runEpgImport` runs on a connection its caller keeps, so
     * it disposes after committing or failing.
     */
    dispose(): void {
        this.db.exec(`
            DROP TABLE IF EXISTS temp.epg_import_channels;
            DROP TABLE IF EXISTS temp.epg_import_programmes;
        `);
    }
```

Replace the comment at the end of `commit()`:

```ts
        // Closing the owning connection discards all temporary rows, including
        // after a parse error, failed commit or worker termination.
```

with:

```ts
        // dispose() drops the temporary rows; closing the connection (worker
        // termination) discards them too.
```

- [ ] **Step 4: Create the maintenance functions**

`libs/shared/epg-store/src/lib/maintenance/epg-clear.ts` (bodies from the two deleted classes):

```ts
import type BetterSqlite3 from 'better-sqlite3';
import { restoreSurvivingChannelMetadata } from '../epg-source-metadata';

const DELETE_ORPHAN_CHANNELS_FOR_SOURCE = `
            DELETE FROM epg_channels
            WHERE source_url = ?
              AND NOT EXISTS (
                  SELECT 1
                  FROM epg_programs
                  WHERE epg_programs.channel_id = epg_channels.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM epg_channel_sources
                  WHERE epg_channel_sources.channel_id = epg_channels.id
              )
        `;

/** Deletes every programme, channel snapshot and channel in one transaction. */
export function clearAllEpgData(db: BetterSqlite3.Database): void {
    db.exec('BEGIN');
    try {
        db.exec('DELETE FROM epg_programs');
        db.exec('DELETE FROM epg_channel_sources');
        db.exec('DELETE FROM epg_channels');
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

/**
 * Removes one source's programmes and channel snapshots. Channels another
 * source still describes get that source's metadata back
 * (`restoreSurvivingChannelMetadata`); channels nobody owns any more are
 * deleted. A blank URL does nothing.
 */
export function clearEpgSource(
    db: BetterSqlite3.Database,
    sourceUrl: string
): void {
    const normalizedSourceUrl = sourceUrl.trim();
    if (!normalizedSourceUrl) {
        return;
    }

    const deleteProgramsForSource = db.prepare(`
            DELETE FROM epg_programs WHERE source_url = ?
        `);
    const deleteOrphanChannelsForSource = db.prepare(
        DELETE_ORPHAN_CHANNELS_FOR_SOURCE
    );
    const clearSource = db.transaction((url: string) => {
        // Capture affected IDs while removed-source provenance still exists.
        restoreSurvivingChannelMetadata(db, url);
        deleteProgramsForSource.run(url);
        db.prepare('DELETE FROM epg_channel_sources WHERE source_url = ?').run(
            url
        );
        deleteOrphanChannelsForSource.run(url);
    });

    clearSource(normalizedSourceUrl);
}
```

`libs/shared/epg-store/src/lib/maintenance/prune-epg-programs.ts` (new):

```ts
import type BetterSqlite3 from 'better-sqlite3';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Index-usable slack for the plain-string prefilter. Stored stop times are
 * ISO strings whose wall-clock prefix can run up to 14 h ahead of the
 * instant (provider offsets) or differ by format within a day, so 48 h keeps
 * the prefilter a superset of the exact `datetime()` test (the guide window
 * uses the same bound, `GUIDE_WINDOW_SLACK_MS`).
 */
const PREFILTER_SLACK_MS = 48 * 60 * 60 * 1000;

/**
 * Deletes programmes that stopped before `now − olderThanDays` and returns
 * how many. Channels and their source snapshots stay.
 */
export function pruneEpgPrograms(
    db: BetterSqlite3.Database,
    options: { olderThanDays: number; now?: Date }
): number {
    if (!Number.isFinite(options.olderThanDays) || options.olderThanDays < 0) {
        throw new RangeError('olderThanDays must be a non-negative number');
    }
    const cutoffMs =
        (options.now ?? new Date()).getTime() - options.olderThanDays * DAY_MS;
    const result = db
        .prepare(
            `DELETE FROM epg_programs
             WHERE stop < @prefilter
               AND datetime(stop) < datetime(@cutoff)`
        )
        .run({
            cutoff: new Date(cutoffMs).toISOString(),
            prefilter: new Date(cutoffMs + PREFILTER_SLACK_MS).toISOString(),
        });
    return result.changes;
}
```

- [ ] **Step 5: Create the test seed sub-entry**

`libs/shared/epg-store/src/testing/seed-epg-source.ts`:

```ts
import type BetterSqlite3 from 'better-sqlite3';
import { EpgImportWriter } from '../lib/import/epg-import-writer';
import type {
    ParsedChannel,
    ParsedProgram,
} from '../lib/import/epg-streaming-parser';

/**
 * Test fixture: writes one source's channels and programmes directly, with
 * no staging and no replacement of earlier rows. Programmes of channels not
 * in `channels` are skipped, as in an import.
 */
export function seedEpgSource(
    db: BetterSqlite3.Database,
    sourceUrl: string,
    channels: ParsedChannel[],
    programmes: ParsedProgram[] = []
): void {
    const writer = new EpgImportWriter(db);
    writer.insertChannels(channels, sourceUrl);
    writer.insertPrograms(programmes, sourceUrl);
}
```

`libs/shared/epg-store/src/testing/index.ts`:

```ts
/** Test fixtures for code that uses @iptvnator/shared/epg-store. */
export { seedEpgSource } from './seed-epg-source';
export type {
    ParsedChannel,
    ParsedProgram,
} from '../lib/import/epg-streaming-parser';
```

- [ ] **Step 6: Export the maintenance functions**

Append to `libs/shared/epg-store/src/index.ts`:

```ts
export { clearAllEpgData, clearEpgSource } from './lib/maintenance/epg-clear';
export { pruneEpgPrograms } from './lib/maintenance/prune-epg-programs';
```

- [ ] **Step 7: Adapt the moved writer spec**

In `libs/shared/epg-store/src/lib/import/epg-import-writer.spec.ts`:

1. Replace the imports

```ts
import {
    EpgDatabase,
    EpgDatabaseClearOperation,
    EpgDatabaseSourceClearOperation,
} from './epg-database';
```

with

```ts
import { EpgImportWriter } from './epg-import-writer';
```

(`import type BetterSqlite3 from 'better-sqlite3';` and the `ParsedChannel` import stay.)

2. Delete the function `createDatabaseMock` (the `exec`-based mock; only the clear cases used it).
3. In `createEpgDatabaseMock`, replace

```ts
    const Database = jest.fn(() => database) as unknown as typeof BetterSqlite3;

    return { Database, database, statements };
```

with

```ts
    return {
        db: database as unknown as BetterSqlite3.Database,
        database,
        statements,
    };
```

4. Rewrite the constructions and the suite name:

```bash
perl -pi -e 's/const \{ Database, /const { db, /; s/new EpgDatabase\(Database\)/new EpgImportWriter(db)/g; s/describe\(.EpgDatabase.,/describe(\x27EpgImportWriter\x27,/' libs/shared/epg-store/src/lib/import/epg-import-writer.spec.ts
```

5. Delete the `describe('EpgDatabaseClearOperation', …)` and `describe('EpgDatabaseSourceClearOperation', …)` blocks (Step 8 moves them).

Check: `grep -n "EpgDatabase" libs/shared/epg-store/src/lib/import/epg-import-writer.spec.ts` prints nothing, and `grep -c "new EpgImportWriter(db)" libs/shared/epg-store/src/lib/import/epg-import-writer.spec.ts` prints 5.

- [ ] **Step 8: Create the clear spec from the moved cases**

`libs/shared/epg-store/src/lib/maintenance/epg-clear.spec.ts`:

```ts
import type BetterSqlite3 from 'better-sqlite3';
import { clearAllEpgData, clearEpgSource } from './epg-clear';

function normalizeSql(sql: unknown): string {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function asDatabase(database: object): BetterSqlite3.Database {
    return database as unknown as BetterSqlite3.Database;
}

function createStatementMock() {
    const statements = new Map<string, jest.Mock>();
    const prepare = jest.fn((statement: string) => {
        const run = jest.fn();
        statements.set(normalizeSql(statement), run);
        return { run, get: jest.fn() };
    });
    const transaction = jest.fn(
        (callback: (url: string) => void) => (url: string) => callback(url)
    );
    return { database: { prepare, transaction }, prepare, statements };
}

describe('clearAllEpgData', () => {
    it('clears programs and channels in one transaction', () => {
        const exec = jest.fn();

        clearAllEpgData(asDatabase({ exec }));

        expect(exec.mock.calls.map(([statement]) => statement)).toEqual([
            'BEGIN',
            'DELETE FROM epg_programs',
            'DELETE FROM epg_channel_sources',
            'DELETE FROM epg_channels',
            'COMMIT',
        ]);
    });

    it('rolls back when either delete fails', () => {
        const failure = new Error('database is busy');
        const exec = jest.fn((statement: string) => {
            if (statement === 'DELETE FROM epg_channels') {
                throw failure;
            }
        });

        expect(() => clearAllEpgData(asDatabase({ exec }))).toThrow(failure);
        expect(exec.mock.calls.map(([statement]) => statement)).toEqual([
            'BEGIN',
            'DELETE FROM epg_programs',
            'DELETE FROM epg_channel_sources',
            'DELETE FROM epg_channels',
            'ROLLBACK',
        ]);
    });
});

describe('clearEpgSource', () => {
    it('clears programs for one source and prunes only orphan channels from that source', () => {
        const sourceUrl = 'https://playlist.example.com/guide.xml';
        const { database, prepare, statements } = createStatementMock();

        clearEpgSource(asDatabase(database), `  ${sourceUrl}  `);

        const preparedSql = prepare.mock.calls.map(([sql]) => normalizeSql(sql));
        const deleteProgramsSql = 'DELETE FROM epg_programs WHERE source_url = ?';
        const deleteOrphanChannelsSql = normalizeSql(`
            DELETE FROM epg_channels
            WHERE source_url = ?
              AND NOT EXISTS (
                  SELECT 1
                  FROM epg_programs
                  WHERE epg_programs.channel_id = epg_channels.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM epg_channel_sources
                  WHERE epg_channel_sources.channel_id = epg_channels.id
              )
        `);

        expect(preparedSql).toContain(deleteProgramsSql);
        expect(preparedSql).toContain(deleteOrphanChannelsSql);
        expect(preparedSql).not.toContain(
            'DELETE FROM epg_channels WHERE source_url = ?'
        );
        expect(statements.get(deleteProgramsSql)).toHaveBeenCalledWith(sourceUrl);
        expect(statements.get(deleteOrphanChannelsSql)).toHaveBeenCalledWith(
            sourceUrl
        );
    });

    it('does nothing for a blank source URL', () => {
        const { database, prepare } = createStatementMock();

        clearEpgSource(asDatabase(database), '   ');

        expect(prepare).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 9: Rewrite the source-metadata harness**

The scenarios now run in Node (better-sqlite3 13 is Node-API; the library has no Electron dependency). In `libs/shared/epg-store/src/lib/epg-source-metadata.spec.ts`:

1. Replace the imports and the whole `runDatabaseScenario` function (lines 1–56) with:

```ts
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Exercise the import writer and source clears on real SQLite, including upgrades. */
function runDatabaseScenario(scenario: string): unknown {
    const writerUrl = pathToFileURL(
        resolve(__dirname, 'import/epg-import-writer.ts')
    ).href;
    const clearUrl = pathToFileURL(
        resolve(__dirname, 'maintenance/epg-clear.ts')
    ).href;
    const connectionUrl = pathToFileURL(
        resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { EpgImportWriter } = await import(${JSON.stringify(writerUrl)});
        const { clearAllEpgData, clearEpgSource } = await import(${JSON.stringify(clearUrl)});
        const { __databaseConnectionTestHooks } = await import(${JSON.stringify(connectionUrl)});
        const sqlite = new Database(':memory:');
        const statements = __databaseConnectionTestHooks.createTableStatements
            .filter(sql => /(?:TABLE|INDEX|TRIGGER) IF NOT EXISTS (?:idx_)?epg_/.test(sql));
        for (const sql of statements) sqlite.exec(sql);
        const worker = new EpgImportWriter(sqlite);
        const clear = { run: (url) => clearEpgSource(sqlite, url) };
        const clearAll = () => clearAllEpgData(sqlite);
        const importSource = (source, programs = true, clearFirst = false) => {
            worker.insertChannels([{
                id: 'shared', displayName: [{ value: source + ' News' }],
                icon: [{ src: source + '.png' }], url: [source + '.website']
            }], source, clearFirst);
            if (programs) worker.insertPrograms([{
                channel: 'shared', start: '2099-01-01T00:00:00Z',
                stop: '2099-01-01T01:00:00Z', title: [{value: source}]
            }], source);
        };
        const channel = () => sqlite.prepare('SELECT * FROM epg_channels WHERE id = ?').get('shared');
        ${scenario}
        sqlite.close();
    `;
    return JSON.parse(
        execFileSync(process.execPath, ['--import', 'tsx', '--eval', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: {
                ...process.env,
                TSX_TSCONFIG_PATH: resolve(process.cwd(), 'tsconfig.base.json'),
            },
        })
    );
}
```

2. In the case `clears all metadata and permits a clean reimport`, replace `new EpgDatabaseClearOperation(SharedDatabase).run();` with `clearAll();`.

- [ ] **Step 10: Write the prune spec**

`libs/shared/epg-store/src/lib/maintenance/prune-epg-programs.spec.ts`:

```ts
import Database from 'better-sqlite3';
import { seedEpgSource } from '../../testing';
import type { ParsedProgram } from '../import/epg-streaming-parser';
import { ensureEpgSchema } from '../schema/ensure-epg-schema';
import { pruneEpgPrograms } from './prune-epg-programs';

const now = new Date('2026-10-15T12:00:00.000Z');
const sourceUrl = 'https://a.test/guide.xml';

function programme(title: string, start: string, stop: string): ParsedProgram {
    return {
        channel: 'news.test',
        start,
        stop,
        title: [{ lang: '', value: title }],
        desc: [],
        category: [],
        date: '',
        episodeNum: [],
        icon: [],
        rating: [],
    };
}

describe('pruneEpgPrograms', () => {
    let db: Database.Database;

    const titles = () =>
        (
            db.prepare('SELECT title FROM epg_programs ORDER BY id').all() as Array<{
                title: string;
            }>
        ).map((row) => row.title);

    beforeEach(() => {
        db = new Database(':memory:');
        ensureEpgSchema(db, { fts: true });
        seedEpgSource(
            db,
            sourceUrl,
            [
                {
                    id: 'news.test',
                    displayName: [{ lang: '', value: 'News' }],
                    icon: [],
                    url: [],
                },
            ],
            [
                programme('Ten days ago', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z'),
                programme('Eight days ago', '2026-10-07T13:00:00+03:00', '2026-10-07T14:00:00+03:00'),
                programme('Six days ago', '2026-10-09T10:00:00Z', '2026-10-09T11:00:00Z'),
                programme('Tonight', '2026-10-15T20:00:00Z', '2026-10-15T21:00:00Z'),
            ]
        );
    });

    afterEach(() => db.close());

    it('deletes programmes that stopped before the cutoff, offsets included, and returns the count', () => {
        expect(pruneEpgPrograms(db, { olderThanDays: 7, now })).toBe(2);
        expect(titles()).toEqual(['Six days ago', 'Tonight']);
        // The FTS delete trigger keeps the search index in step.
        expect(
            db
                .prepare(
                    "SELECT COUNT(*) AS count FROM epg_programs_fts WHERE epg_programs_fts MATCH 'days'"
                )
                .get()
        ).toEqual({ count: 1 });
    });

    it('keeps channels and their source snapshots', () => {
        pruneEpgPrograms(db, { olderThanDays: 0, now });

        expect(db.prepare('SELECT id FROM epg_channels').all()).toEqual([
            { id: 'news.test' },
        ]);
        expect(
            db.prepare('SELECT source_url FROM epg_channel_sources').all()
        ).toEqual([{ source_url: sourceUrl }]);
    });

    it('deletes nothing when no programme is old enough', () => {
        expect(pruneEpgPrograms(db, { olderThanDays: 30, now })).toBe(0);
        expect(titles()).toHaveLength(4);
    });

    it('rejects a negative age', () => {
        expect(() => pruneEpgPrograms(db, { olderThanDays: -1, now })).toThrow(
            RangeError
        );
    });
});
```

- [ ] **Step 11: Run the library suite**

```bash
pnpm nx test shared-epg-store
pnpm nx lint shared-epg-store
```

Expected: PASS: writer cases, clear cases, the nine source-metadata scenarios (now in Node), prune, schema, decoding.

- [ ] **Step 12: Commit**

```bash
git add libs/shared/epg-store apps/electron-backend/src/app/workers
git commit -m "refactor(epg): move the import writer and EPG maintenance into shared-epg-store

EpgDatabase becomes EpgImportWriter on a caller-owned connection; the
clear operations become clearAllEpgData and clearEpgSource; staging gains
dispose(). New: pruneEpgPrograms and the seedEpgSource test fixture.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `runEpgImport`

**Files:**
- Create: `libs/shared/epg-store/src/lib/import/run-epg-import.ts`
- Create: `libs/shared/epg-store/src/lib/import/run-epg-import.spec.ts`
- Modify: `libs/shared/epg-store/src/index.ts`

The body is the import half of `apps/electron-backend/src/app/workers/epg-parser.worker.ts` after #1941 and #1946 (`fetchAndParseEpgStreaming`): open, stage, parse with one UTF-8 decoder, refuse an empty feed, publish in one transaction, release everything in `finally`. What stays in the worker is the connection, the opener, error classification and `postMessage`.

- [ ] **Step 1: Write the failing spec**

`libs/shared/epg-store/src/lib/import/run-epg-import.spec.ts`:

```ts
import Database from 'better-sqlite3';
import {
    createServer,
    get,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { EPG_IMPORT_ERROR_CODES, EpgImportError } from '../epg-import-error';
import { ensureEpgSchema } from '../schema/ensure-epg-schema';
import type { EpgSourceOpener } from './epg-source-response';
import { runEpgImport, type RunEpgImportOptions } from './run-epg-import';

const HOUR = 60 * 60 * 1000;

function xmltvDate(ms: number): string {
    const date = new Date(ms);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
        date.getUTCDate()
    )}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
        date.getUTCSeconds()
    )} +0000`;
}

/** One channel with consecutive upcoming programmes, like epg.e2e.ts's fixtures. */
function guide(channelName: string, titles: string[], channelId = 'news.test'): string {
    const start = Date.now() + HOUR;
    const programmes = titles
        .map(
            (title, index) =>
                `<programme start="${xmltvDate(start + index * HOUR)}" stop="${xmltvDate(
                    start + (index + 1) * HOUR
                )}" channel="${channelId}"><title>${title}</title></programme>`
        )
        .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><tv><channel id="${channelId}"><display-name>${channelName}</display-name></channel>${programmes}</tv>`;
}

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function withHttpServer<T>(
    handler: Handler,
    run: (baseUrl: string) => Promise<T>
): Promise<T> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const { port } = server.address() as AddressInfo;
        return await run(`http://127.0.0.1:${port}`);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

/**
 * Node's HTTP client without decompression, as the real openers deliver
 * bodies. It leaves the signal to runEpgImport, which destroys the body on
 * abort (an aborted request would also error the response stream).
 */
const httpOpener: EpgSourceOpener = (url) =>
    new Promise((resolve, reject) => {
        get(url, (response) =>
            resolve({
                stream: response,
                requestUrl: url,
                finalUrl: url,
                headers: response.headers,
            })
        ).once('error', reject);
    });

function memoryOpener(chunks: Buffer[]): EpgSourceOpener {
    return async (url) => ({
        stream: Readable.from(chunks),
        requestUrl: url,
        finalUrl: url,
        headers: {},
    });
}

describe('runEpgImport', () => {
    let db: Database.Database;

    const titles = () =>
        (
            db.prepare('SELECT title FROM epg_programs ORDER BY start').all() as Array<{
                title: string;
            }>
        ).map((row) => row.title);
    const channelName = () =>
        (
            db
                .prepare('SELECT display_name FROM epg_channels WHERE id = ?')
                .get('news.test') as { display_name: string } | undefined
        )?.display_name;

    function importFrom(
        url: string,
        overrides: Partial<RunEpgImportOptions> = {}
    ) {
        return runEpgImport({
            url,
            db,
            openSource: httpOpener,
            signal: new AbortController().signal,
            ...overrides,
        });
    }

    beforeEach(() => {
        db = new Database(':memory:');
        ensureEpgSchema(db, { fts: true });
    });

    afterEach(() => db.close());

    it.each([
        ['single', false],
        ['double', true],
    ] as const)(
        'imports a %s gzip feed served with a .gz URL and HTTP gzip',
        async (_name, doubleGzip) => {
            const file = gzipSync(guide('Gzip News', ['Bulletin', 'Weather']));
            const body = doubleGzip ? gzipSync(file) : file;
            const onProgress = jest.fn();
            let titlesAtPublishStart: string[] | undefined;
            const onPublishStart = jest.fn(() => {
                titlesAtPublishStart = titles();
            });

            await withHttpServer(
                (_request, response) => {
                    response.writeHead(200, {
                        'Content-Type': 'application/gzip',
                        'Content-Encoding': 'gzip',
                    });
                    response.end(body);
                },
                async (baseUrl) => {
                    await expect(
                        importFrom(`${baseUrl}/guide.xml.gz`, {
                            onProgress,
                            onPublishStart,
                        })
                    ).resolves.toEqual({ totalChannels: 1, totalPrograms: 2 });
                }
            );

            expect(channelName()).toBe('Gzip News');
            expect(titles()).toEqual(['Bulletin', 'Weather']);
            expect(onProgress).toHaveBeenCalledWith({
                totalChannels: 1,
                totalPrograms: 0,
            });
            // Once, after the last progress report, before the publish.
            expect(onPublishStart).toHaveBeenCalledTimes(1);
            expect(onPublishStart.mock.invocationCallOrder[0]).toBeGreaterThan(
                Math.max(...onProgress.mock.invocationCallOrder)
            );
            expect(titlesAtPublishStart).toEqual([]);
        }
    );

    it('keeps a multibyte character that gunzip splits across 16 KiB chunks', async () => {
        const title = 'Été 日本 🎬 Новости';
        const xml = guide('Gzip Новости 東京 📺', [title]);
        // Put the first byte of É at the end of gunzip's first 16 KiB chunk.
        const titleOffset = Buffer.byteLength(xml.slice(0, xml.indexOf(title)));
        const padding = ' '.repeat(16 * 1024 - 1 - titleOffset - 7);
        const paddedXml = xml.replace('<tv>', `<tv><!--${padding}-->`);
        expect(Buffer.from(paddedXml)[16 * 1024 - 1]).toBe(0xc3);
        expect(Buffer.from(paddedXml)[16 * 1024]).toBe(0x89);

        await withHttpServer(
            (_request, response) => {
                response.writeHead(200, { 'Content-Encoding': 'gzip' });
                response.end(gzipSync(paddedXml));
            },
            (baseUrl) => importFrom(`${baseUrl}/guide.xml`)
        );

        expect(channelName()).toBe('Gzip Новости 東京 📺');
        expect(titles()).toEqual([title]);
    });

    it.each([1, 2, 3, 7])(
        'keeps identifiers and text intact with %i-byte chunks',
        async (chunkSize) => {
            const xml = guide('Новости café 東京 📺', ['Été 日本 🎬'], 'café-東京-📺');
            const bytes = Buffer.from(xml);
            const chunks: Buffer[] = [];
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                chunks.push(bytes.subarray(offset, offset + chunkSize));
            }

            await importFrom('https://epg.test/guide.xml', {
                openSource: memoryOpener(chunks),
            });

            expect(
                db.prepare('SELECT id, display_name FROM epg_channels').all()
            ).toEqual([{ id: 'café-東京-📺', display_name: 'Новости café 東京 📺' }]);
            expect(titles()).toEqual(['Été 日本 🎬']);
        }
    );

    it.each([
        ['malformed XML', (xml: string) => xml.replace('</tv>', '<broken></tv>'), EPG_IMPORT_ERROR_CODES.ParseFailed],
        ['truncated XML', (xml: string) => xml.replace('</tv>', ''), EPG_IMPORT_ERROR_CODES.ParseFailed],
    ] as const)(
        'keeps the previous guide after %s',
        async (_name, damage, code) => {
            const url = 'https://epg.test/guide.xml';
            await importFrom(url, {
                openSource: memoryOpener([Buffer.from(guide('News', ['Old']))]),
            });

            await expect(
                importFrom(url, {
                    openSource: memoryOpener([
                        Buffer.from(damage(guide('Renamed', ['New']))),
                    ]),
                })
            ).rejects.toMatchObject({ code });

            expect(channelName()).toBe('News');
            expect(titles()).toEqual(['Old']);
        }
    );

    it('keeps the previous guide when a gzip body is truncated, and reports the zlib error unchanged', async () => {
        const url = 'https://epg.test/guide.xml.gz';
        await importFrom(url, {
            openSource: memoryOpener([gzipSync(guide('News', ['Old']))]),
        });
        const truncated = gzipSync(guide('News', ['New'])).subarray(0, 40);

        const error = await importFrom(url, {
            openSource: memoryOpener([truncated]),
        }).catch((failure: unknown) => failure);

        expect(error).not.toBeInstanceOf(EpgImportError);
        expect(error).toMatchObject({ code: expect.stringMatching(/^Z_/) });
        expect(titles()).toEqual(['Old']);
    });

    it('refuses an empty feed with epg_empty and the desktop message', async () => {
        await expect(
            importFrom('https://epg.test/guide.xml', {
                openSource: memoryOpener([Buffer.from('<tv></tv>')]),
            })
        ).rejects.toEqual(
            new EpgImportError(
                EPG_IMPORT_ERROR_CODES.Empty,
                'EPG parse produced 0 channels — feed may be unreachable or unsupported'
            )
        );
        expect(titles()).toEqual([]);
    });

    it('does not announce a publish for an empty feed', async () => {
        const onPublishStart = jest.fn();

        await expect(
            importFrom('https://epg.test/guide.xml', {
                openSource: memoryOpener([Buffer.from('<tv></tv>')]),
                onPublishStart,
            })
        ).rejects.toMatchObject({ code: EPG_IMPORT_ERROR_CODES.Empty });
        expect(onPublishStart).not.toHaveBeenCalled();
    });

    it('fails with epg_too_large past maxDecompressedBytes and publishes nothing', async () => {
        const xml = guide('News', Array.from({ length: 400 }, (_, index) => `Show ${index}`));

        await withHttpServer(
            (_request, response) => {
                response.writeHead(200, { 'Content-Encoding': 'gzip' });
                response.end(gzipSync(xml));
            },
            async (baseUrl) => {
                await expect(
                    importFrom(`${baseUrl}/guide.xml`, {
                        maxDecompressedBytes: 4 * 1024,
                    })
                ).rejects.toMatchObject({ code: EPG_IMPORT_ERROR_CODES.TooLarge });
            }
        );

        expect(titles()).toEqual([]);
    });

    it('stops with epg_aborted when the signal aborts while the body is streaming', async () => {
        const controller = new AbortController();
        let opened!: () => void;
        const sourceOpened = new Promise<void>((resolve) => (opened = resolve));

        await withHttpServer(
            (_request, response) => {
                response.writeHead(200, { 'Content-Type': 'application/xml' });
                // Keep the body open: the import is still reading when aborted.
                response.write('<tv><channel id="news.test"><display-name>News</display-name></channel>');
            },
            async (baseUrl) => {
                const pending = importFrom(`${baseUrl}/guide.xml`, {
                    signal: controller.signal,
                    openSource: async (url, signal) => {
                        const response = await httpOpener(url, signal);
                        opened();
                        return response;
                    },
                });
                await sourceOpened;
                controller.abort();

                await expect(pending).rejects.toMatchObject({
                    code: EPG_IMPORT_ERROR_CODES.Aborted,
                });
            }
        );

        expect(channelName()).toBeUndefined();
    });

    it('passes opener errors through unchanged', async () => {
        const failure = Object.assign(new Error('HTTP error! status: 404'), {
            status: 404,
        });

        await expect(
            importFrom('https://epg.test/guide.xml', {
                openSource: () => Promise.reject(failure),
            })
        ).rejects.toBe(failure);
    });

    it('reads a local gzip file by its signature when the opener marks it as a file', async () => {
        await importFrom('/home/user/epg/guide', {
            openSource: async (url) => ({
                stream: Readable.from([gzipSync(guide('Local News', ['From disk']))]),
                requestUrl: url,
                finalUrl: url,
                headers: {},
                kind: 'file',
            }),
        });

        expect(channelName()).toBe('Local News');
        expect(titles()).toEqual(['From disk']);
    });

    it('can import twice on the same connection', async () => {
        const url = 'https://epg.test/guide.xml';
        await importFrom(url, {
            openSource: memoryOpener([Buffer.from(guide('News', ['First']))]),
        });
        await importFrom(url, {
            openSource: memoryOpener([Buffer.from(guide('News', ['Second']))]),
        });

        expect(titles()).toEqual(['Second']);
    });
});
```

Run: `pnpm nx test shared-epg-store --testPathPatterns=run-epg-import`
Expected: FAIL, `Cannot find module './run-epg-import'`.

- [ ] **Step 2: Write `runEpgImport`**

`libs/shared/epg-store/src/lib/import/run-epg-import.ts`:

```ts
import type BetterSqlite3 from 'better-sqlite3';
import type { Readable } from 'node:stream';
import { EPG_IMPORT_ERROR_CODES, EpgImportError } from '../epg-import-error';
import { epgLogger } from '../epg-logger';
import type { EpgImportStaging } from './epg-import-staging';
import { EpgImportWriter } from './epg-import-writer';
import {
    decodeEpgSourceResponse,
    type EpgSourceOpener,
} from './epg-source-response';
import { StreamingEpgParser } from './epg-streaming-parser';

const loggerLabel = '[EPG Worker]';
const CHANNEL_BATCH_SIZE = 100;
const PROGRAM_BATCH_SIZE = 1000;
const EMPTY_FEED_MESSAGE =
    'EPG parse produced 0 channels — feed may be unreachable or unsupported';

export interface EpgImportStats {
    readonly totalChannels: number;
    readonly totalPrograms: number;
}

export interface RunEpgImportOptions {
    readonly url: string;
    readonly db: BetterSqlite3.Database;
    /** Its errors propagate unchanged. */
    readonly openSource: EpgSourceOpener;
    readonly signal: AbortSignal;
    readonly onProgress?: (stats: EpgImportStats) => void;
    /**
     * Called once, after the whole document parsed and passed the empty
     * check, right before the synchronous publish transaction. Callers that
     * watch for stalls (the server's import queue) suspend their stall timer
     * then: the publish sends no progress and can take minutes on slow disks.
     */
    readonly onPublishStart?: () => void;
    readonly maxDecompressedBytes?: number;
}

/**
 * Imports one XMLTV source into the epg_* tables of `db`. Batches are
 * staged in connection-private temporary tables while the source streams;
 * after the whole document parsed with at least one channel, the source's
 * replacement (today and future programmes, programmes older than seven
 * days, channel snapshots and freshness) is published in one transaction.
 * Nothing is published when this throws, so the previous guide stays.
 *
 * `db` is the caller's: it sets the pragmas and closes it. The schema must
 * exist (`ensureEpgSchema`, or the desktop's `initDatabase()`).
 */
export async function runEpgImport(
    options: RunEpgImportOptions
): Promise<EpgImportStats> {
    const { url, db, openSource, signal } = options;
    epgLogger.log(loggerLabel, 'Fetching EPG source');
    throwIfAborted(signal);

    const writer = new EpgImportWriter(db);
    let source: Readable | undefined;
    let decoded: Readable | undefined;
    let staged: EpgImportStaging | undefined;
    try {
        const response = await openSource(url, signal);
        source = response.stream;
        throwIfAborted(signal);
        decoded = decodeEpgSourceResponse(
            response,
            options.maxDecompressedBytes
        );
        staged = writer.createImport(url);

        const stats = await parseIntoStaging(
            decoded,
            staged,
            signal,
            options.onProgress
        );
        if (stats.totalChannels === 0) {
            throw new EpgImportError(
                EPG_IMPORT_ERROR_CODES.Empty,
                EMPTY_FEED_MESSAGE
            );
        }
        throwIfAborted(signal);
        options.onPublishStart?.();
        // Publish all batches, source metadata and freshness together. A SQL
        // failure rolls back the replacement; parsing never changes live rows.
        staged.commit();
        epgLogger.log(
            loggerLabel,
            `Parsing complete: ${stats.totalChannels} channels, ${stats.totalPrograms} programs`
        );
        return { totalChannels: stats.totalChannels, totalPrograms: stats.totalPrograms };
    } finally {
        decoded?.destroy();
        source?.destroy();
        staged?.dispose();
    }
}

/** Marks a staging (SQLite) failure so it is not reported as an XML error. */
class StagingFailure {
    constructor(readonly error: unknown) {}
}

function stage(write: () => void): void {
    try {
        write();
    } catch (error) {
        throw new StagingFailure(error);
    }
}

function parseIntoStaging(
    stream: Readable,
    staged: EpgImportStaging,
    signal: AbortSignal,
    onProgress: RunEpgImportOptions['onProgress']
): Promise<EpgImportStats> {
    const parser = new StreamingEpgParser(
        (channels) => stage(() => staged.insertChannels(channels)),
        (programs) => stage(() => staged.insertPrograms(programs)),
        (totalChannels, totalPrograms) =>
            onProgress?.({ totalChannels, totalPrograms }),
        CHANNEL_BATCH_SIZE,
        PROGRAM_BATCH_SIZE
    );
    // Decode after decompression, retaining partial UTF-8 sequences between
    // chunks and flushing the decoder before the end event.
    stream.setEncoding('utf8');

    return new Promise((resolve, reject) => {
        const onAbort = () => fail(abortedError());
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        const fail = (error: unknown) => {
            cleanup();
            reject(error);
            stream.destroy();
        };
        signal.addEventListener('abort', onAbort, { once: true });

        stream.on('data', (chunk: string) => {
            try {
                parser.write(chunk);
            } catch (error) {
                epgLogger.error(loggerLabel, 'Parse error:', error);
                fail(toImportFailure(error));
            }
        });
        stream.once('end', () => {
            cleanup();
            try {
                resolve(parser.finish());
            } catch (error) {
                reject(toImportFailure(error));
            }
        });
        stream.once('error', (error) => {
            epgLogger.error(loggerLabel, 'Stream error:', error);
            cleanup();
            reject(error);
        });
    });
}

/** SAX errors become `epg_parse_failed` with their message; staging errors pass unchanged. */
function toImportFailure(error: unknown): unknown {
    if (error instanceof StagingFailure) {
        return error.error;
    }
    return new EpgImportError(
        EPG_IMPORT_ERROR_CODES.ParseFailed,
        error instanceof Error ? error.message : String(error)
    );
}

function abortedError(): EpgImportError {
    return new EpgImportError(
        EPG_IMPORT_ERROR_CODES.Aborted,
        'EPG import was aborted'
    );
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw abortedError();
    }
}
```

- [ ] **Step 3: Export it**

Append to `libs/shared/epg-store/src/index.ts`:

```ts
export { runEpgImport } from './lib/import/run-epg-import';
export type {
    EpgImportStats,
    RunEpgImportOptions,
} from './lib/import/run-epg-import';
export type {
    EpgSourceOpener,
    EpgSourceResponse,
} from './lib/import/epg-source-response';
```

- [ ] **Step 4: Run the library suite**

```bash
pnpm nx test shared-epg-store
pnpm exec tsc -p libs/shared/epg-store/tsconfig.lib.json --noEmit
```

Expected: PASS; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/epg-store/src
git commit -m "feat(epg): runEpgImport, the XMLTV import without worker wiring

Opens a source through a caller-supplied opener, decodes, parses, stages
and publishes in one transaction; epg_empty, epg_parse_failed,
epg_too_large and epg_aborted mark its own failures.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Electron's source opener

**Files:**
- Move: `apps/electron-backend/src/app/workers/epg-source-stream.ts` → `apps/electron-backend/src/app/workers/epg-source-opener.ts`
- Move: `apps/electron-backend/src/app/workers/epg-source-stream.spec.ts` → `apps/electron-backend/src/app/workers/epg-source-opener.spec.ts`

- [ ] **Step 1: Move the files**

```bash
git mv apps/electron-backend/src/app/workers/epg-source-stream.ts apps/electron-backend/src/app/workers/epg-source-opener.ts
git mv apps/electron-backend/src/app/workers/epg-source-stream.spec.ts apps/electron-backend/src/app/workers/epg-source-opener.spec.ts
```

- [ ] **Step 2: Replace the spec with the opener's contract**

Overwrite `apps/electron-backend/src/app/workers/epg-source-opener.spec.ts` (decoding of local files is now covered by `libs/shared/epg-store/src/lib/import/epg-source-response.spec.ts`):

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pathToFileURL } from 'url';
import { gzipSync } from 'zlib';

const requestWithValidatedRedirects = jest.fn();

jest.mock('../util/validated-axios', () => ({
    requestWithValidatedRedirects: (...args: unknown[]) =>
        requestWithValidatedRedirects(...args),
}));
jest.mock('../util/secure-https', () => ({
    createPlaylistAgentFactory: () => ({}),
}));
jest.mock('../events/url-safety', () => ({
    isPrivateNetworkUrlAccessAllowed: () => false,
}));
jest.mock('../util/epg-logger', () => ({
    epgLogger: { log: jest.fn(), error: jest.fn() },
}));

import {
    createElectronEpgSourceOpener,
    type EpgWorkerFetchOptions,
} from './epg-source-opener';

const LOCAL = { allowLocalFile: true };
const signal = new AbortController().signal;
const xmltv =
    '<?xml version="1.0" encoding="utf-8"?><tv><channel id="c1">' +
    '<display-name>One</display-name></channel></tv>';

async function readAll(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function open(url: string, options: EpgWorkerFetchOptions = {}) {
    return createElectronEpgSourceOpener(options)(url, signal);
}

describe('createElectronEpgSourceOpener', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'iptvnator-epg-source-'));
        requestWithValidatedRedirects.mockReset();
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('opens a local XML file as an undecoded file body', async () => {
        const file = join(dir, 'guide.xml');
        writeFileSync(file, xmltv);

        const response = await open(file, LOCAL);

        expect(response).toMatchObject({
            requestUrl: file,
            finalUrl: file,
            headers: {},
            kind: 'file',
        });
        expect((await readAll(response.stream)).toString('utf-8')).toBe(xmltv);
        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
    });

    it('hands a gzip file over undecoded; the import detects it by signature', async () => {
        const file = join(dir, 'guide');
        const body = gzipSync(xmltv);
        writeFileSync(file, body);

        const response = await open(file, LOCAL);

        expect(response.kind).toBe('file');
        expect(await readAll(response.stream)).toEqual(body);
    });

    it('accepts a file: URL with percent-encoded characters', async () => {
        const file = join(dir, 'guide v2.xml');
        writeFileSync(file, xmltv);

        const response = await open(pathToFileURL(file).href, LOCAL);

        expect((await readAll(response.stream)).toString('utf-8')).toBe(xmltv);
    });

    it('tolerates surrounding whitespace in the stored value', async () => {
        const file = join(dir, 'guide.xml');
        writeFileSync(file, xmltv);

        const response = await open(`  ${file}  `, LOCAL);

        expect((await readAll(response.stream)).toString('utf-8')).toBe(xmltv);
    });

    it('reports a missing file with its path instead of an ENOENT code', async () => {
        const file = join(dir, 'missing.xml');

        await expect(open(file, LOCAL)).rejects.toThrow(
            `EPG file not found: ${file}`
        );
    });

    it('refuses a directory', async () => {
        const folder = join(dir, 'epg');
        mkdirSync(folder);

        await expect(open(folder, LOCAL)).rejects.toThrow(
            `EPG source is not a file: ${folder}`
        );
    });

    it('routes remote links through the validated HTTP client and returns the raw body', async () => {
        const body = Readable.from([gzipSync(xmltv)]);
        requestWithValidatedRedirects.mockResolvedValue({
            config: { url: 'https://cdn.example.org/guide.xml.gz' },
            data: body,
            headers: {
                'content-encoding': 'gzip',
                'content-type': 'application/gzip',
            },
            status: 200,
        });

        const response = await open('https://epg.example.org/guide.xml', {
            trustedPrivateNetworkEpgUrls: [],
        });

        expect(response).toEqual({
            stream: body,
            requestUrl: 'https://epg.example.org/guide.xml',
            finalUrl: 'https://cdn.example.org/guide.xml.gz',
            headers: {
                'content-encoding': 'gzip',
                'content-type': 'application/gzip',
            },
        });
        expect(requestWithValidatedRedirects).toHaveBeenCalledWith(
            'https://epg.example.org/guide.xml',
            expect.objectContaining({
                decompress: false,
                method: 'GET',
                responseType: 'stream',
            }),
            { allowPrivateNetworks: false }
        );
    });

    it('copies axios header objects into a plain record', async () => {
        requestWithValidatedRedirects.mockResolvedValue({
            config: {},
            data: Readable.from([Buffer.from(xmltv)]),
            headers: {
                toJSON: () => ({ 'Content-Type': 'application/xml' }),
            },
            status: 200,
        });

        const response = await open('https://epg.example.org/guide.xml');

        expect(response.headers).toEqual({ 'content-type': 'application/xml' });
        expect(response.finalUrl).toBe('https://epg.example.org/guide.xml');
    });

    it('trusts a private-network source only when the user trusted that URL', async () => {
        requestWithValidatedRedirects.mockResolvedValue({
            config: {},
            data: Readable.from([Buffer.from(xmltv)]),
            headers: {},
            status: 200,
        });

        await open('http://192.168.1.10/guide.xml', {
            trustedPrivateNetworkEpgUrls: [' http://192.168.1.10/guide.xml '],
        });

        expect(requestWithValidatedRedirects).toHaveBeenCalledWith(
            'http://192.168.1.10/guide.xml',
            expect.anything(),
            { allowPrivateNetworks: true }
        );
    });

    it('fails a non-2xx response', async () => {
        requestWithValidatedRedirects.mockResolvedValue({
            config: {},
            data: Readable.from([]),
            headers: {},
            status: 404,
        });

        await expect(open('https://epg.example.org/guide.xml')).rejects.toThrow(
            'HTTP error! status: 404'
        );
    });

    it('refuses a local file the main process did not authorize', async () => {
        const file = join(dir, 'guide.xml');
        writeFileSync(file, xmltv);

        await expect(open(file)).rejects.toThrow(
            'Local EPG file was not authorized'
        );
        await expect(
            open(file, { allowLocalFile: 'yes' as unknown as boolean })
        ).rejects.toThrow('Local EPG file was not authorized');
        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
    });

    it('never reads a relative path from disk', async () => {
        requestWithValidatedRedirects.mockRejectedValue(new Error('Invalid URL'));

        await expect(open('guide.xml')).rejects.toThrow();
        expect(requestWithValidatedRedirects).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 3: Rewrite the opener**

Overwrite `apps/electron-backend/src/app/workers/epg-source-opener.ts`. The local checks and the remote request are unchanged; decoding moved to `decodeEpgSourceResponse`.

```ts
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { Readable } from 'stream';
import type {
    EpgSourceOpener,
    EpgSourceResponse,
} from '@iptvnator/shared/epg-store';
import type { ElectronBridgeTrustOptions } from '@iptvnator/shared/interfaces';
import { isPrivateNetworkUrlAccessAllowed } from '../events/url-safety';
import { epgLogger } from '../util/epg-logger';
import { resolveLocalEpgSourcePath } from '../util/epg-local-source-path';
import { createPlaylistAgentFactory } from '../util/secure-https';
import { requestWithValidatedRedirects } from '../util/validated-axios';

const loggerLabel = '[EPG Worker]';

/** Trust options plus the main-process verdict on a local file. */
export type EpgWorkerFetchOptions = ElectronBridgeTrustOptions & {
    /**
     * Set by `EpgWorkerService.startFetch` only after the main-process
     * authorizer allowed the path (native picker or native confirmation).
     * Never taken from the renderer.
     */
    allowLocalFile?: boolean;
};

/**
 * The Electron opener for `runEpgImport`.
 *
 * Remote sources go through the validated-redirect HTTP client with the
 * private-network and TLS trust policy and return the raw body (axios does
 * not decompress; `runEpgImport` decodes). Local sources — a `file:` URL or
 * an absolute path — are read from disk and marked `kind: 'file'`, so gzip
 * is detected from the file's own signature.
 *
 * The local branch bypasses `validateRemoteUrl`, which only knows http(s).
 * Two things make that safe: header-declared M3U sources are filtered to
 * remote links before they are stored (`extractM3uEpgUrls`), and the main
 * process opens the branch only for a path its authorizer allowed
 * (`allowLocalFile`), so neither a downloaded playlist nor a compromised
 * renderer can name an arbitrary file.
 */
export function createElectronEpgSourceOpener(
    options: EpgWorkerFetchOptions = {}
): EpgSourceOpener {
    return async (url) => {
        const localPath = resolveLocalEpgSourcePath(url);
        if (localPath) {
            if (options.allowLocalFile !== true) {
                throw new Error('Local EPG file was not authorized');
            }
            return openLocalEpgSource(url, localPath);
        }
        return openRemoteEpgSource(url, options);
    };
}

async function openLocalEpgSource(
    url: string,
    filePath: string
): Promise<EpgSourceResponse> {
    let info: Awaited<ReturnType<typeof stat>>;
    try {
        info = await stat(filePath);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            throw new Error(`EPG file not found: ${filePath}`);
        }
        throw error;
    }
    if (!info.isFile()) {
        throw new Error(`EPG source is not a file: ${filePath}`);
    }

    epgLogger.log(loggerLabel, 'Reading local EPG file');
    return {
        stream: createReadStream(filePath),
        requestUrl: url,
        finalUrl: url,
        headers: {},
        kind: 'file',
    };
}

async function openRemoteEpgSource(
    url: string,
    options: ElectronBridgeTrustOptions
): Promise<EpgSourceResponse> {
    // EPG URLs can originate from an untrusted M3U `url-tvg` attribute.
    // Validate every redirect and require an explicit operator opt-in for
    // private/LAN sources.
    const response = await requestWithValidatedRedirects<Readable>(
        url.trim(),
        {
            agentFactory: createPlaylistAgentFactory({
                trustedInsecureTlsHosts: options.trustedInsecureTlsHosts,
            }),
            decompress: false,
            method: 'GET',
            responseType: 'stream',
        },
        {
            allowPrivateNetworks:
                isPrivateNetworkUrlAccessAllowed() ||
                isTrustedPrivateNetworkEpgSource(url, options),
        }
    );

    if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    if (!response.data) {
        throw new Error('Response body is null');
    }

    return {
        stream: response.data,
        requestUrl: url,
        finalUrl: response.config.url ?? url,
        headers: toPlainHeaders(response.headers),
    };
}

/** Axios `AxiosHeaders` carry methods; the import wants a plain lower-case record. */
function toPlainHeaders(
    headers: unknown
): Record<string, string | string[] | undefined> {
    const source =
        typeof (headers as { toJSON?: unknown } | undefined)?.toJSON ===
        'function'
            ? (headers as { toJSON(): Record<string, unknown> }).toJSON()
            : ((headers ?? {}) as Record<string, unknown>);
    return Object.fromEntries(
        Object.entries(source).map(([name, value]) => [
            name.toLowerCase(),
            Array.isArray(value)
                ? value.map(String)
                : value === undefined || value === null
                  ? undefined
                  : String(value),
        ])
    );
}

function isTrustedPrivateNetworkEpgSource(
    url: string,
    options: ElectronBridgeTrustOptions
): boolean {
    const normalizedUrl = url.trim();
    return (
        options.trustedPrivateNetworkEpgUrls?.some(
            (trustedUrl) => trustedUrl.trim() === normalizedUrl
        ) ?? false
    );
}
```

- [ ] **Step 4: Run the opener spec**

Run: `pnpm exec jest --config apps/electron-backend/jest.config.ts apps/electron-backend/src/app/workers/epg-source-opener.spec.ts`
Expected: PASS, 12 tests. (The whole `electron-backend` project still does not compile until Task 11.)

- [ ] **Step 5: Commit**

```bash
git add apps/electron-backend/src/app/workers/epg-source-opener.ts apps/electron-backend/src/app/workers/epg-source-opener.spec.ts
git commit -m "refactor(epg): Electron opens XMLTV sources for runEpgImport

epg-source-stream becomes epg-source-opener: the same validated axios
request, trust options and local-file authorization, returning the raw
body and headers instead of decoding them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The thin EPG worker

**Files:**
- Modify: `apps/electron-backend/src/app/workers/epg-parser.worker.ts` (rewritten)
- Modify: `apps/electron-backend/src/app/workers/epg-parser.worker.spec.ts` (rewritten; its UTF-8 cases now live in `run-epg-import.spec.ts`)
- Modify: `apps/electron-backend/src/app/workers/testing/epg-import-scenario.ts` (#1941)

The worker keeps its file name (`tools/packaging/verify-electron-package-layout.mjs` expects `workers/epg-parser.worker.js`), its message protocol, its connections and their pragmas, and its error classification. It passes no `onPublishStart`: Electron's 5-minute watchdog restarts on progress only and stays as it is (see "Electron does not use `onPublishStart`" under Design decisions).

- [ ] **Step 1: Write the failing worker spec**

Overwrite `apps/electron-backend/src/app/workers/epg-parser.worker.spec.ts`:

```ts
import {
    EPG_IMPORT_ERROR_CODES,
    EpgImportError,
} from '@iptvnator/shared/epg-store';
import { UnsafeUrlError } from '../events/url-safety';

const postMessage = jest.fn();
const runEpgImport = jest.fn();
const clearAllEpgData = jest.fn();
const clearEpgSource = jest.fn();
const mockOpener = jest.fn();
const createElectronEpgSourceOpener = jest.fn(
    (..._args: unknown[]) => mockOpener
);
const mockPragmas: string[] = [];
const mockClose = jest.fn();
let handleMessage: (message: Record<string, unknown>) => Promise<void>;

class MockDatabase {
    constructor(readonly path: string) {}

    pragma(statement: string): void {
        mockPragmas.push(statement);
    }

    close(): void {
        mockClose();
    }
}

jest.mock('worker_threads', () => ({
    workerData: {},
    parentPort: {
        on: (_event: string, listener: typeof handleMessage) => {
            handleMessage = listener;
        },
        postMessage: (...args: unknown[]) => postMessage(...args),
    },
}));
jest.mock('./worker-runtime-paths', () => ({
    getWorkerDataNativeModuleSearchPaths: () => [],
    getNativeModuleSearchPaths: () => [],
    registerNativeModuleSearchPaths: jest.fn(),
    loadNativeModuleFromSearchPaths: () => MockDatabase,
}));
jest.mock('@iptvnator/shared/database/path-utils', () => ({
    getIptvnatorDatabasePath: () => '/tmp/iptvnator-test/iptvnator.db',
}));
jest.mock('@iptvnator/shared/epg-store', () => ({
    ...jest.requireActual('@iptvnator/shared/epg-store'),
    runEpgImport: (...args: unknown[]) => runEpgImport(...args),
    clearAllEpgData: (...args: unknown[]) => clearAllEpgData(...args),
    clearEpgSource: (...args: unknown[]) => clearEpgSource(...args),
}));
jest.mock('./epg-source-opener', () => ({
    createElectronEpgSourceOpener: (...args: unknown[]) =>
        createElectronEpgSourceOpener(...args),
}));
jest.mock('../util/network-defaults', () => ({
    applyElectronNetworkDefaults: jest.fn(),
}));
jest.mock('../util/epg-logger', () => ({
    epgLogger: { log: jest.fn(), error: jest.fn() },
}));

import './epg-parser.worker';

const messagesAtLoad = [...postMessage.mock.calls];
const sourceUrl = 'https://example.com/guide.xml';

describe('EPG parser worker', () => {
    beforeEach(() => {
        postMessage.mockReset();
        runEpgImport.mockReset();
        clearAllEpgData.mockReset();
        clearEpgSource.mockReset();
        createElectronEpgSourceOpener.mockClear();
        mockClose.mockReset();
        mockPragmas.length = 0;
    });

    it('announces READY once loaded', () => {
        expect(messagesAtLoad).toEqual([[{ type: 'READY' }]]);
    });

    it('imports on its own WAL connection and reports progress and completion', async () => {
        runEpgImport.mockImplementation(
            async (options: {
                onProgress: (stats: object) => void;
            }) => {
                options.onProgress({ totalChannels: 1, totalPrograms: 0 });
                return { totalChannels: 1, totalPrograms: 2 };
            }
        );

        await handleMessage({
            type: 'FETCH_EPG',
            url: sourceUrl,
            options: { allowLocalFile: true },
        });

        expect(mockPragmas).toEqual([
            'foreign_keys = ON',
            'journal_mode = WAL',
            'busy_timeout = 5000',
        ]);
        expect(createElectronEpgSourceOpener).toHaveBeenCalledWith({
            allowLocalFile: true,
        });
        expect(runEpgImport).toHaveBeenCalledWith(
            expect.objectContaining({
                url: sourceUrl,
                db: expect.any(MockDatabase),
                openSource: mockOpener,
                signal: expect.any(AbortSignal),
            })
        );
        expect(postMessage.mock.calls).toEqual([
            [
                {
                    type: 'EPG_PROGRESS',
                    stats: { totalChannels: 1, totalPrograms: 0 },
                },
            ],
            [
                {
                    type: 'EPG_COMPLETE',
                    url: sourceUrl,
                    stats: { totalChannels: 1, totalPrograms: 2 },
                },
            ],
        ]);
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('treats FORCE_FETCH like FETCH_EPG', async () => {
        runEpgImport.mockResolvedValue({ totalChannels: 3, totalPrograms: 9 });

        await handleMessage({ type: 'FORCE_FETCH', url: sourceUrl });

        expect(createElectronEpgSourceOpener).toHaveBeenCalledWith({});
        expect(postMessage).toHaveBeenCalledWith({
            type: 'EPG_COMPLETE',
            url: sourceUrl,
            stats: { totalChannels: 3, totalPrograms: 9 },
        });
    });

    it('posts library failures as plain errors without a bridge error code', async () => {
        const message =
            'EPG parse produced 0 channels — feed may be unreachable or unsupported';
        runEpgImport.mockRejectedValue(
            new EpgImportError(EPG_IMPORT_ERROR_CODES.Empty, message)
        );

        await handleMessage({ type: 'FETCH_EPG', url: sourceUrl });

        expect(postMessage).toHaveBeenCalledTimes(1);
        const [response] = postMessage.mock.calls[0];
        expect(response).toEqual({
            type: 'EPG_ERROR',
            error: message,
            errorCode: undefined,
            errorHost: undefined,
            url: sourceUrl,
        });
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('classifies a blocked private-network source for the trust prompt', async () => {
        const url = 'http://192.168.1.10/guide.xml';
        runEpgImport.mockRejectedValue(
            new UnsafeUrlError('URL resolves to a private network address')
        );

        await handleMessage({ type: 'FETCH_EPG', url });

        expect(postMessage).toHaveBeenCalledWith({
            type: 'EPG_ERROR',
            error: 'EPG source points to private network and was blocked.',
            errorCode: 'epg-private-network-blocked',
            errorHost: '192.168.1.10',
            url,
        });
    });

    it('clears all EPG data on a busy-timeout connection', async () => {
        await handleMessage({ type: 'CLEAR_EPG' });

        expect(mockPragmas).toEqual(['busy_timeout = 5000']);
        expect(clearAllEpgData).toHaveBeenCalledWith(expect.any(MockDatabase));
        expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_COMPLETE' });
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('clears one source', async () => {
        await handleMessage({ type: 'CLEAR_EPG_SOURCE', sourceUrl });

        expect(clearEpgSource).toHaveBeenCalledWith(
            expect.any(MockDatabase),
            sourceUrl
        );
        expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_COMPLETE' });
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('reports a failed clear and still closes the connection', async () => {
        clearAllEpgData.mockImplementation(() => {
            throw new Error('database is locked');
        });

        await handleMessage({ type: 'CLEAR_EPG' });

        expect(postMessage).toHaveBeenCalledWith({
            type: 'EPG_ERROR',
            error: 'database is locked',
        });
        expect(mockClose).toHaveBeenCalledTimes(1);
    });
});
```

Run: `pnpm exec jest --config apps/electron-backend/jest.config.ts apps/electron-backend/src/app/workers/epg-parser.worker.spec.ts`
Expected: FAIL: the worker still imports `./epg-database` and `./epg-source-stream`.

- [ ] **Step 2: Rewrite the worker**

Overwrite `apps/electron-backend/src/app/workers/epg-parser.worker.ts`:

```ts
import type BetterSqlite3 from 'better-sqlite3';
import { parentPort, workerData } from 'worker_threads';
import { getIptvnatorDatabasePath } from '@iptvnator/shared/database/path-utils';
import {
    clearAllEpgData,
    clearEpgSource,
    EpgImportError,
    runEpgImport,
    type EpgImportStats,
} from '@iptvnator/shared/epg-store';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    ElectronBridgeSecurityErrorCode,
} from '@iptvnator/shared/interfaces';
import { UnsafeUrlError } from '../events/url-safety';
import { epgLogger } from '../util/epg-logger';
import { applyElectronNetworkDefaults } from '../util/network-defaults';
import {
    getHostnameFromErrorUrl,
    getHostnameFromUrl,
    isInvalidTlsCertificateError,
} from '../util/security-errors';
import {
    createElectronEpgSourceOpener,
    type EpgWorkerFetchOptions,
} from './epg-source-opener';
import {
    getNativeModuleSearchPaths,
    getWorkerDataNativeModuleSearchPaths,
    loadNativeModuleFromSearchPaths,
    registerNativeModuleSearchPaths,
} from './worker-runtime-paths';

const nativeModuleSearchPaths = [
    ...getWorkerDataNativeModuleSearchPaths(workerData),
    ...getNativeModuleSearchPaths({
        resourcesPath: (process as NodeJS.Process & { resourcesPath?: string })
            .resourcesPath,
    }),
];

registerNativeModuleSearchPaths(nativeModuleSearchPaths);

function loadBetterSqlite3(): typeof BetterSqlite3 {
    return loadNativeModuleFromSearchPaths({
        moduleName: 'better-sqlite3',
        loggerLabel: '[EPG Worker]',
        searchPaths: nativeModuleSearchPaths,
        fallbackRequire: () =>
            require('better-sqlite3') as typeof BetterSqlite3,
    });
}

const Database = loadBetterSqlite3();

/**
 * EPG worker: runs `runEpgImport` and the EPG clears from
 * `@iptvnator/shared/epg-store` off the main thread, on its own connections
 * to the main database. The main process stops an import by terminating
 * the worker.
 */

interface WorkerMessage {
    type: 'FETCH_EPG' | 'FORCE_FETCH' | 'CLEAR_EPG' | 'CLEAR_EPG_SOURCE';
    url?: string;
    sourceUrl?: string;
    options?: EpgWorkerFetchOptions;
}

interface WorkerResponse {
    type:
        | 'EPG_COMPLETE'
        | 'EPG_ERROR'
        | 'EPG_PROGRESS'
        | 'CLEAR_COMPLETE'
        | 'READY';
    error?: string;
    errorCode?: ElectronBridgeSecurityErrorCode;
    errorHost?: string;
    url?: string;
    stats?: {
        totalChannels: number;
        totalPrograms: number;
    };
}

// Worker threads keep their own Node networking defaults; see the helper.
applyElectronNetworkDefaults();

const loggerLabel = '[EPG Worker]';

/** Import connection: the same pragmas as every other writer (sqlite-db-worker.md). */
function openImportConnection(): BetterSqlite3.Database {
    const db = new Database(getIptvnatorDatabasePath());
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    return db;
}

/** Clear connections only wait for locks, as before the move. */
function openClearConnection(): BetterSqlite3.Database {
    const db = new Database(getIptvnatorDatabasePath());
    db.pragma('busy_timeout = 5000');
    return db;
}

async function fetchAndParseEpgStreaming(
    url: string,
    options: EpgWorkerFetchOptions = {}
): Promise<void> {
    const db = openImportConnection();
    let stats: EpgImportStats;
    try {
        stats = await runEpgImport({
            url,
            db,
            openSource: createElectronEpgSourceOpener(options),
            // Never aborted: the main process terminates the worker instead.
            signal: new AbortController().signal,
            onProgress: ({ totalChannels, totalPrograms }) => {
                const response: WorkerResponse = {
                    type: 'EPG_PROGRESS',
                    stats: { totalChannels, totalPrograms },
                };
                parentPort?.postMessage(response);
            },
        });
    } catch (error) {
        throw toEpgFetchError(error, url);
    } finally {
        db.close();
    }
    const response: WorkerResponse = {
        type: 'EPG_COMPLETE',
        url,
        stats: {
            totalChannels: stats.totalChannels,
            totalPrograms: stats.totalPrograms,
        },
    };
    parentPort?.postMessage(response);
}

function toEpgFetchError(
    error: unknown,
    url: string
): Error & {
    code?: ElectronBridgeSecurityErrorCode;
    host?: string;
} {
    if (
        error instanceof UnsafeUrlError &&
        /private|local network/i.test(error.message)
    ) {
        return Object.assign(
            new Error('EPG source points to private network and was blocked.'),
            {
                code: ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked,
                host: getHostnameFromUrl(url),
            }
        );
    }

    if (isInvalidTlsCertificateError(error)) {
        return Object.assign(
            new Error('Certificate for this source host is invalid.'),
            {
                code: ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate,
                host: getHostnameFromErrorUrl(error, url),
            }
        );
    }

    // epg_* codes are not bridge security codes: the renderer receives the
    // message alone, as before the import moved into the library.
    if (error instanceof EpgImportError) {
        return new Error(error.message);
    }

    return error instanceof Error ? error : new Error(String(error));
}

function clearAllData(): void {
    const db = openClearConnection();

    try {
        epgLogger.log(loggerLabel, 'Clearing all EPG data...');
        clearAllEpgData(db);
        epgLogger.log(loggerLabel, 'All EPG data cleared');

        const response: WorkerResponse = { type: 'CLEAR_COMPLETE' };
        parentPort?.postMessage(response);
    } catch (error) {
        epgLogger.error(loggerLabel, 'Error clearing EPG data:', error);
        const errorResponse: WorkerResponse = {
            type: 'EPG_ERROR',
            error: error instanceof Error ? error.message : String(error),
        };
        parentPort?.postMessage(errorResponse);
    } finally {
        db.close();
    }
}

function clearDataForSource(sourceUrl: string): void {
    const db = openClearConnection();

    try {
        epgLogger.log(loggerLabel, 'Clearing EPG data for source...');
        clearEpgSource(db, sourceUrl);
        epgLogger.log(loggerLabel, 'EPG data cleared for source');

        const response: WorkerResponse = { type: 'CLEAR_COMPLETE' };
        parentPort?.postMessage(response);
    } catch (error) {
        epgLogger.error(loggerLabel, 'Error clearing EPG source data:', error);
        const errorResponse: WorkerResponse = {
            type: 'EPG_ERROR',
            error: error instanceof Error ? error.message : String(error),
        };
        parentPort?.postMessage(errorResponse);
    } finally {
        db.close();
    }
}

/**
 * Worker message handler
 */
if (parentPort) {
    parentPort.on('message', async (message: WorkerMessage) => {
        try {
            if (
                message.type === 'FETCH_EPG' ||
                message.type === 'FORCE_FETCH'
            ) {
                await fetchAndParseEpgStreaming(message.url!, message.options);
            } else if (message.type === 'CLEAR_EPG') {
                clearAllData();
            } else if (message.type === 'CLEAR_EPG_SOURCE') {
                clearDataForSource(message.sourceUrl ?? '');
            }
        } catch (error) {
            epgLogger.error(loggerLabel, 'Worker error:', error);
            const typedError = error as {
                code?: ElectronBridgeSecurityErrorCode;
                host?: string;
            };
            const errorResponse: WorkerResponse = {
                type: 'EPG_ERROR',
                error: error instanceof Error ? error.message : String(error),
                errorCode: typedError.code,
                errorHost: typedError.host,
                url: message.url,
            };
            parentPort?.postMessage(errorResponse);
        }
    });

    // Notify parent that worker is ready
    parentPort.postMessage({ type: 'READY' });
} else {
    epgLogger.error(loggerLabel, 'parentPort is not available!');
}
```

If the merged worker (Task 1, Step 3) differs from `master` + #1941 + #1946 in any part this file does not take from the library (message types, response fields, the handler's `catch`), carry that difference over.

- [ ] **Step 3: Seed the atomicity scenario through the library**

In `apps/electron-backend/src/app/workers/testing/epg-import-scenario.ts` (#1941):

1. Replace `import { EpgDatabase } from '../epg-database';` with `import { seedEpgSource } from '@iptvnator/shared/epg-store/testing';`.
2. Delete the `SharedDatabase` class and the line `const seed = new EpgDatabase(SharedDatabase as unknown as typeof Database);`.
3. Replace the four seed calls

```ts
    seed.insertChannels([channel('Previous source')], source);
    seed.insertPrograms(
        [
            programme('Previous programme'),
            programme('Previous archive', previousDay.toISOString()),
            programme('Expired archive', expiredDay.toISOString()),
        ],
        source
    );
    seed.insertChannels([channel('Other source')], 'other-source');
    seed.insertPrograms([programme('Other programme')], 'other-source');
```

with

```ts
    seedEpgSource(
        sqlite,
        source,
        [channel('Previous source')],
        [
            programme('Previous programme'),
            programme('Previous archive', previousDay.toISOString()),
            programme('Expired archive', expiredDay.toISOString()),
        ]
    );
    seedEpgSource(
        sqlite,
        'other-source',
        [channel('Other source')],
        [programme('Other programme')]
    );
```

The scenario still bundles the real `epg-parser.worker.ts` with esbuild (`tsconfig: tsconfig.base.json` resolves `@iptvnator/shared/epg-store`) and runs it in Electron with a 64 MiB heap.

- [ ] **Step 4: Run the worker spec and the real-worker scenarios**

```bash
pnpm exec jest --config apps/electron-backend/jest.config.ts apps/electron-backend/src/app/workers/epg-parser.worker.spec.ts apps/electron-backend/src/app/workers/epg-import-atomicity.spec.ts
```

Expected: PASS: 8 worker cases; the atomicity suite's malformed, truncated, gzip-error, write-error, empty, valid, cancelled and 137,000-programme cases.

- [ ] **Step 5: Build the worker bundles**

```bash
pnpm nx run electron-backend:build-worker
node -e "require('./dist/apps/electron-backend/workers/epg-parser.worker.js')" 2>&1 | tail -1
```

Expected: `✅ Workers built successfully!`; loading the bundle outside a worker prints `[EPG Worker] parentPort is not available!` and exits 0 (the bundle resolves `@iptvnator/shared/epg-store` and loads `better-sqlite3` only through the search paths).

- [ ] **Step 6: Run the whole backend suite**

```bash
pnpm nx test electron-backend 2>&1 | tail -5
pnpm run typecheck:backend
pnpm nx lint electron-backend
```

Expected: the same failures as the Task 2 baseline and no others; type check and lint clean (existing warnings only).

- [ ] **Step 7: Commit**

```bash
git add apps/electron-backend/src/app/workers
git commit -m "refactor(epg): the Electron EPG worker runs runEpgImport

The worker keeps its file, messages, connections, pragmas and error
classification; import, staging and clears come from shared-epg-store.
Library error codes are not forwarded as bridge security codes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Move and split the query services

From this task until Task 14, `electron-backend` does not compile (its IPC handlers still import the moved services). Run only the library checks.

**Files:**
- Move: `apps/electron-backend/src/app/events/epg-query.service.ts` (+ `.spec.ts`), `epg-guide-query.service.ts` (+ `.spec.ts`), `epg-guide-window.util.ts`, `epg-program-row.util.ts` → `libs/shared/epg-store/src/lib/queries/`
- Create: `libs/shared/epg-store/src/lib/queries/epg-drizzle.ts`, `epg-mapping-resolution.ts`, `epg-mapping-resolution.spec.ts`, `epg-query-scope.ts`, `epg-channel-lookup.ts`, `epg-program-rows.ts`, `epg-current-programs.ts`
- Modify (moved): `queries/epg-query.service.ts` (rewritten as the class only), `queries/epg-guide-query.service.ts`, both specs

The 976-line `EpgQueryService` becomes five files under 300 lines. Function bodies are the original private methods with `this.` removed and `db` passed in; the order of `db.select()` calls is unchanged, which the moved spec checks through its mocked call sequences. Two things move out of the library: the mapping lookup `getMapping` (joins Electron's `content` and `categories`; Task 14 puts it in `events/epg-channel-program-mapping.ts`) and `getAllChannels` (Task 14, `events/epg-queries.ts`).

- [ ] **Step 1: Move the files**

```bash
mkdir -p libs/shared/epg-store/src/lib/queries
for file in epg-query.service.ts epg-query.service.spec.ts \
    epg-guide-query.service.ts epg-guide-query.service.spec.ts \
    epg-guide-window.util.ts epg-program-row.util.ts; do
  git mv "apps/electron-backend/src/app/events/$file" "libs/shared/epg-store/src/lib/queries/$file"
done
```

`epg-guide-window.util.ts` and `epg-program-row.util.ts` need no change (their only import is a type from `@iptvnator/shared/interfaces`).

- [ ] **Step 2: Create the drizzle handle**

`libs/shared/epg-store/src/lib/queries/epg-drizzle.ts`:

```ts
import type BetterSqlite3 from 'better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
    epgChannelSources,
    epgChannels,
    epgPrograms,
} from '@iptvnator/shared/database/schema';

/**
 * The drizzle surface the EPG queries use: `select`, `selectDistinct` and
 * raw `all` on a synchronous better-sqlite3 connection. Any
 * `drizzle(better-sqlite3)` instance satisfies it whatever its schema, so
 * Electron passes its main-database instance and a standalone EPG
 * database passes `createEpgDrizzle(db)`.
 */
export type EpgDrizzle = Pick<
    BaseSQLiteDatabase<'sync', BetterSqlite3.RunResult>,
    'select' | 'selectDistinct' | 'all'
>;

const epgTables = { epgChannels, epgChannelSources, epgPrograms };

/** Drizzle over the epg_* tables of `db`. */
export function createEpgDrizzle(db: BetterSqlite3.Database): EpgDrizzle {
    // Loaded on first use: drizzle's better-sqlite3 driver requires the
    // native binding at module load, and the Electron EPG worker imports
    // this library before it registers its native search paths (see
    // database.worker-connection.ts).
    const { drizzle } = require('drizzle-orm/better-sqlite3') as typeof import(
        'drizzle-orm/better-sqlite3'
    );
    return drizzle(db, { schema: epgTables });
}
```

- [ ] **Step 3: Write the failing mapping-resolution spec**

The `queryByResolvedChannelIds` cases come from `apps/electron-backend/src/app/events/epg-mapping.service.spec.ts:121-160`, with the resolver injected. `libs/shared/epg-store/src/lib/queries/epg-mapping-resolution.spec.ts`:

```ts
import {
    queryByResolvedChannelIds,
    resolveMappingsSoft,
    resolveMappingsStrict,
} from './epg-mapping-resolution';

const lookupFailure = new Error('sqlite operation failed');

describe('resolveMappingsSoft', () => {
    it('returns the resolver answer', async () => {
        const mappings = new Map([['channel-a', 'epg-a']]);

        await expect(
            resolveMappingsSoft(async () => mappings, ['channel-a'])
        ).resolves.toBe(mappings);
    });

    it('answers "no mappings" without a resolver or when it fails', async () => {
        await expect(resolveMappingsSoft(undefined, ['a'])).resolves.toEqual(
            new Map()
        );
        await expect(
            resolveMappingsSoft(() => Promise.reject(lookupFailure), ['a'])
        ).resolves.toEqual(new Map());
    });
});

describe('resolveMappingsStrict', () => {
    it('lets a failing lookup reject', async () => {
        await expect(
            resolveMappingsStrict(() => Promise.reject(lookupFailure), ['a'])
        ).rejects.toBe(lookupFailure);
        await expect(resolveMappingsStrict(undefined, ['a'])).resolves.toEqual(
            new Map()
        );
    });
});

describe('queryByResolvedChannelIds', () => {
    it('queries mapped ids and remaps results onto the requested ids', async () => {
        const query = jest
            .fn()
            .mockResolvedValue({ 'epg-a': 'A', 'channel-b': 'B' });

        const result = await queryByResolvedChannelIds(
            ['channel-a', 'channel-b'],
            async () => new Map([['channel-a', 'epg-a']]),
            query
        );

        expect(query).toHaveBeenCalledWith(['epg-a', 'channel-b']);
        expect(result).toEqual({ 'channel-a': 'A', 'channel-b': 'B' });
    });

    it('fills missing query results with null', async () => {
        await expect(
            queryByResolvedChannelIds(
                ['channel-a'],
                async () => new Map(),
                jest.fn().mockResolvedValue({})
            )
        ).resolves.toEqual({ 'channel-a': null });
    });

    it('falls back to unmapped ids through the soft resolver', async () => {
        const query = jest.fn().mockResolvedValue({ 'channel-a': 'A' });

        const result = await queryByResolvedChannelIds(
            ['channel-a'],
            (keys) =>
                resolveMappingsSoft(() => Promise.reject(lookupFailure), keys),
            query
        );

        expect(query).toHaveBeenCalledWith(['channel-a']);
        expect(result).toEqual({ 'channel-a': 'A' });
    });
});
```

Run: `pnpm nx test shared-epg-store --testPathPatterns=epg-mapping-resolution`
Expected: FAIL, `Cannot find module './epg-mapping-resolution'`.

- [ ] **Step 4: Create the mapping resolution**

`libs/shared/epg-store/src/lib/queries/epg-mapping-resolution.ts`:

```ts
/** Channel key → EPG channel id; keys without a mapping are absent. May reject. */
export type EpgMappingResolver = (keys: string[]) => Promise<Map<string, string>>;

/** A mapping lookup must never take an EPG read down: on failure the keys stay unmapped. */
export async function resolveMappingsSoft(
    resolve: EpgMappingResolver | undefined,
    keys: string[]
): Promise<Map<string, string>> {
    if (!resolve) {
        return new Map();
    }
    try {
        return await resolve(keys);
    } catch {
        return new Map();
    }
}

/**
 * For guide coverage: answering "unmapped" for a mapped channel would let
 * the "Only with EPG" filter hide it, so a failed lookup rejects and
 * coverage stays unknown.
 */
export async function resolveMappingsStrict(
    resolve: EpgMappingResolver | undefined,
    keys: string[]
): Promise<Map<string, string>> {
    return resolve ? resolve(keys) : new Map();
}

/**
 * Runs a batch query against mapping-resolved channel ids and remaps the
 * results back onto the requested keys, which are used verbatim.
 */
export async function queryByResolvedChannelIds<T>(
    channelIds: string[],
    resolve: EpgMappingResolver,
    query: (resolvedIds: string[]) => Promise<Record<string, T | null>>
): Promise<Record<string, T | null>> {
    const resolvedMap = await resolve(channelIds);
    const resolvedIds = channelIds.map((id) => resolvedMap.get(id) ?? id);
    const results = await query(resolvedIds);

    const remapped: Record<string, T | null> = {};
    for (const originalId of channelIds) {
        const resolvedId = resolvedMap.get(originalId) ?? originalId;
        remapped[originalId] = results[resolvedId] ?? null;
    }
    return remapped;
}
```

- [ ] **Step 5: Create the query scope helpers**

`libs/shared/epg-store/src/lib/queries/epg-query-scope.ts` (from `EpgQueryService`: the row type, the chunk constant, `normalizeChannelLookupKeys`, `normalizeSourceUrls`, `toAiringInstantIso`, `isAiringAt` and the four source-scope helpers):

```ts
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';

/** An `epg_programs` row as `db.select().from(epgPrograms)` returns it. */
export interface EpgProgramSelectRow {
    id: number;
    channelId: string;
    start: string;
    stop: string;
    title: string;
    description: string | null;
    category: string | null;
    iconUrl: string | null;
    rating: string | null;
    episodeNum: string | null;
}

export type EpgChannelRow = typeof schema.epgChannels.$inferSelect;

/** `legacyOnly`: rows imported before per-source tracking (`source_url` null or ''). */
export interface SourceScopeOptions {
    legacyOnly?: boolean;
}

/**
 * Max channel keys per candidate-lookup query. The query binds each key up to
 * four times (raw id / raw displayName / LOWER(id) / LOWER(displayName)), so we
 * chunk to stay well under SQLite's `SQLITE_LIMIT_VARIABLE_NUMBER` (32766) even
 * for very large playlists — at 500 that's ~2k bound parameters per statement.
 */
export const CHANNEL_LOOKUP_CHUNK_SIZE = 500;

/** Largest |ms| `Date` can serialize. */
const MAX_SERIALIZABLE_MS = 8.64e15;

export function normalizeChannelLookupKeys(channelIds: string[]): string[] {
    return Array.from(
        new Set(
            channelIds
                .map((channelId) => channelId.trim())
                .filter((channelId) => channelId.length > 0)
        )
    );
}

export function normalizeSourceUrls(sourceUrls?: string[]): string[] {
    return Array.from(
        new Set(
            (sourceUrls ?? [])
                .map((sourceUrl) => sourceUrl.trim())
                .filter((sourceUrl) => sourceUrl.length > 0)
        )
    );
}

/**
 * The instant "currently airing" is evaluated at, as the UTC ISO string
 * `isAiringAt` expects. The renderer passes its wall clock shifted into
 * the provider's EPG clock (the display offset setting) so the row it
 * receives is the one it will also render as "now"; without a usable
 * value the process clock applies. Bounded to the range `Date` can
 * serialize so a corrupt payload cannot throw inside the query.
 */
export function toAiringInstantIso(nowMs?: number): string {
    return new Date(isUsableInstant(nowMs) ? nowMs : Date.now()).toISOString();
}

function isUsableInstant(value: number | undefined): value is number {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= MAX_SERIALIZABLE_MS
    );
}

/**
 * Timezone-aware "currently airing at `now`" predicate. EPG start/stop are
 * stored as ISO strings that often carry a UTC offset (e.g. `+03:00`) while
 * `now` is built as UTC (`new Date().toISOString()`, `…Z`). A raw string
 * comparison is lexical and therefore wrong by the offset, so we normalize
 * both sides with SQLite `datetime()` (which converts every form to UTC).
 */
export function isAiringAt(now: string): SQL {
    return and(
        sql`datetime(${schema.epgPrograms.start}) <= datetime(${now})`,
        sql`datetime(${schema.epgPrograms.stop}) >= datetime(${now})`
    ) as SQL;
}

export function withProgramSourceScope(
    condition: SQL,
    sourceUrls: string[],
    options: SourceScopeOptions = {}
): SQL {
    if (options.legacyOnly) {
        return and(condition, legacyProgramSourceCondition()) as SQL;
    }

    return sourceUrls.length > 0
        ? (and(
              condition,
              inArray(schema.epgPrograms.sourceUrl, sourceUrls)
          ) as SQL)
        : condition;
}

export function withChannelSourceScope(
    condition: SQL,
    sourceUrls: string[],
    options: SourceScopeOptions = {}
): SQL {
    if (options.legacyOnly) {
        return and(condition, legacyChannelSourceCondition()) as SQL;
    }

    return sourceUrls.length > 0
        ? (and(
              condition,
              or(
                  inArray(schema.epgChannels.sourceUrl, sourceUrls),
                  channelHasProgramsForSourceScope(sourceUrls)
              ) as SQL
          ) as SQL)
        : condition;
}

function legacyProgramSourceCondition(): SQL {
    return or(
        isNull(schema.epgPrograms.sourceUrl),
        eq(schema.epgPrograms.sourceUrl, '')
    ) as SQL;
}

function legacyChannelSourceCondition(): SQL {
    return or(
        isNull(schema.epgChannels.sourceUrl),
        eq(schema.epgChannels.sourceUrl, '')
    ) as SQL;
}

function channelHasProgramsForSourceScope(sourceUrls: string[]): SQL {
    const sourceUrlValues = sourceUrls.map((sourceUrl) => sql`${sourceUrl}`);

    return sql`EXISTS (
            SELECT 1
            FROM ${schema.epgPrograms}
            WHERE ${schema.epgPrograms.channelId} = ${schema.epgChannels.id}
              AND ${schema.epgPrograms.sourceUrl} IN (${sql.join(sourceUrlValues, sql`, `)})
        )`;
}
```

- [ ] **Step 6: Create the channel lookups**

`libs/shared/epg-store/src/lib/queries/epg-channel-lookup.ts` (from `selectChannelById`, `selectLegacyChannelById`, `selectChannelByDisplayName`, `selectLegacyChannelByDisplayName`, `selectChannelMetadataCandidates`, `selectChannelMetadataCandidatesChunk`, `resolveChannelMetadataCandidate`; `selectChannelLookupCandidates`, an alias of `selectChannelMetadataCandidates`, is dropped):

```ts
import { eq, sql, type SQL } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { EpgChannelMetadata } from '@iptvnator/shared/interfaces';
import type { EpgDrizzle } from './epg-drizzle';
import {
    CHANNEL_LOOKUP_CHUNK_SIZE,
    type EpgChannelRow,
    type SourceScopeOptions,
    withChannelSourceScope,
} from './epg-query-scope';

export async function selectChannelById(
    db: EpgDrizzle,
    channelId: string,
    sourceUrls: string[]
): Promise<EpgChannelRow[]> {
    return db
        .select()
        .from(schema.epgChannels)
        .where(
            withChannelSourceScope(
                sql`${schema.epgChannels.id} = ${channelId} COLLATE NOCASE`,
                sourceUrls
            )
        )
        .limit(1);
}

export async function selectLegacyChannelById(
    db: EpgDrizzle,
    channelId: string,
    sourceUrls: string[]
): Promise<EpgChannelRow[]> {
    if (sourceUrls.length === 0) {
        return [];
    }

    return db
        .select()
        .from(schema.epgChannels)
        .where(
            withChannelSourceScope(
                sql`${schema.epgChannels.id} = ${channelId} COLLATE NOCASE`,
                sourceUrls,
                { legacyOnly: true }
            )
        )
        .limit(1);
}

export async function selectChannelByDisplayName(
    db: EpgDrizzle,
    displayName: string,
    sourceUrls: string[],
    options: { caseInsensitive?: boolean } = {}
): Promise<EpgChannelRow[]> {
    return db
        .select()
        .from(schema.epgChannels)
        .where(
            withChannelSourceScope(
                displayNameCondition(displayName, options),
                sourceUrls
            )
        )
        .limit(1);
}

export async function selectLegacyChannelByDisplayName(
    db: EpgDrizzle,
    displayName: string,
    sourceUrls: string[],
    options: { caseInsensitive?: boolean } = {}
): Promise<EpgChannelRow[]> {
    if (sourceUrls.length === 0) {
        return [];
    }

    return db
        .select()
        .from(schema.epgChannels)
        .where(
            withChannelSourceScope(
                displayNameCondition(displayName, options),
                sourceUrls,
                { legacyOnly: true }
            )
        )
        .limit(1);
}

function displayNameCondition(
    displayName: string,
    options: { caseInsensitive?: boolean }
): SQL {
    return options.caseInsensitive
        ? (sql`${schema.epgChannels.displayName} = ${displayName} COLLATE NOCASE` as SQL)
        : eq(schema.epgChannels.displayName, displayName);
}

export async function selectChannelMetadataCandidates(
    db: EpgDrizzle,
    keys: string[],
    sourceUrls: string[],
    options: SourceScopeOptions = {}
): Promise<EpgChannelMetadata[]> {
    if (options.legacyOnly && sourceUrls.length === 0) {
        return [];
    }

    const uniqueKeys = Array.from(new Set(keys));
    if (uniqueKeys.length === 0) {
        return [];
    }

    // Chunk so the bound-parameter count stays well under SQLite's limit even
    // for large playlists (the per-chunk query binds each key up to 4×).
    const candidates: EpgChannelMetadata[] = [];
    for (let i = 0; i < uniqueKeys.length; i += CHANNEL_LOOKUP_CHUNK_SIZE) {
        candidates.push(
            ...(await selectChannelMetadataCandidatesChunk(
                db,
                uniqueKeys.slice(i, i + CHANNEL_LOOKUP_CHUNK_SIZE),
                sourceUrls,
                options
            ))
        );
    }
    return candidates;
}

async function selectChannelMetadataCandidatesChunk(
    db: EpgDrizzle,
    uniqueKeys: string[],
    sourceUrls: string[],
    options: SourceScopeOptions
): Promise<EpgChannelMetadata[]> {
    const rawValues = uniqueKeys.map((key) => sql`${key}`);
    const lowerValues = Array.from(
        new Set(uniqueKeys.map((key) => key.toLowerCase()))
    ).map((key) => sql`${key}`);

    // SQLite LOWER()/COLLATE NOCASE only fold ASCII, so for non-ASCII names
    // (Cyrillic, Greek, …) the lowercased key never matches the stored value.
    // Match the raw key case-sensitively too — parity with the timeline's
    // exact display-name lookup — so those channels resolve; the LOWER()
    // branch keeps ASCII case-insensitivity. The JS resolver
    // (`resolveChannelMetadataCandidate`) then folds with full-Unicode
    // toLowerCase().
    const lookupCondition = sql`
            (
                ${schema.epgChannels.id} IN (${sql.join(rawValues, sql`, `)})
                OR ${schema.epgChannels.displayName} IN (${sql.join(rawValues, sql`, `)})
                OR LOWER(${schema.epgChannels.id}) IN (${sql.join(lowerValues, sql`, `)})
                OR LOWER(${schema.epgChannels.displayName}) IN (${sql.join(lowerValues, sql`, `)})
            )
        `;

    return db
        .select({
            id: schema.epgChannels.id,
            displayName: schema.epgChannels.displayName,
            iconUrl: schema.epgChannels.iconUrl,
        })
        .from(schema.epgChannels)
        .where(
            withChannelSourceScope(lookupCondition as SQL, sourceUrls, options)
        );
}

/** Exact id, case-insensitive id, exact display name, case-insensitive display name. */
export function resolveChannelMetadataCandidate(
    channelId: string,
    candidates: EpgChannelMetadata[]
): EpgChannelMetadata | null {
    const lowerChannelId = channelId.toLowerCase();

    return (
        candidates.find((candidate) => candidate.id === channelId) ??
        candidates.find(
            (candidate) => candidate.id.toLowerCase() === lowerChannelId
        ) ??
        candidates.find((candidate) => candidate.displayName === channelId) ??
        candidates.find(
            (candidate) =>
                candidate.displayName.toLowerCase() === lowerChannelId
        ) ??
        null
    );
}
```

- [ ] **Step 7: Create the programme row helpers**

`libs/shared/epg-store/src/lib/queries/epg-program-rows.ts` (from `selectChannelPrograms`, `selectLegacyChannelPrograms`, `selectCurrentProgramsForChannelIds`, `toEpgPrograms`, `assignCurrentProgramRows`, `assignCandidateCurrentProgramRows`, `pendingCandidateIds`):

```ts
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import type { EpgDrizzle } from './epg-drizzle';
import { isValidEpgProgram, toEpgProgramFromRow } from './epg-program-row.util';
import {
    type EpgProgramSelectRow,
    isAiringAt,
    type SourceScopeOptions,
    withProgramSourceScope,
} from './epg-query-scope';

export async function selectChannelPrograms(
    db: EpgDrizzle,
    channelId: string,
    sourceUrls: string[]
): Promise<EpgProgramSelectRow[]> {
    return (
        db
            .select()
            .from(schema.epgPrograms)
            .where(
                withProgramSourceScope(
                    eq(schema.epgPrograms.channelId, channelId),
                    sourceUrls
                )
            )
            // Collapse identical slots from multiple sources in SQL so the
            // 500-row cap counts distinct programmes, not duplicate rows.
            .groupBy(
                schema.epgPrograms.channelId,
                schema.epgPrograms.start,
                schema.epgPrograms.title
            )
            .orderBy(schema.epgPrograms.start)
            .limit(500)
    );
}

export async function selectLegacyChannelPrograms(
    db: EpgDrizzle,
    channelId: string,
    sourceUrls: string[]
): Promise<EpgProgramSelectRow[]> {
    if (sourceUrls.length === 0) {
        return [];
    }

    return db
        .select()
        .from(schema.epgPrograms)
        .where(
            withProgramSourceScope(
                eq(schema.epgPrograms.channelId, channelId),
                sourceUrls,
                { legacyOnly: true }
            )
        )
        .groupBy(
            schema.epgPrograms.channelId,
            schema.epgPrograms.start,
            schema.epgPrograms.title
        )
        .orderBy(schema.epgPrograms.start)
        .limit(500);
}

export async function selectCurrentProgramsForChannelIds(
    db: EpgDrizzle,
    channelIds: string[],
    now: string,
    sourceUrls: string[],
    options: SourceScopeOptions = {}
): Promise<EpgProgramSelectRow[]> {
    if (channelIds.length === 0) {
        return [];
    }
    if (options.legacyOnly && sourceUrls.length === 0) {
        return [];
    }

    return (
        db
            .select()
            .from(schema.epgPrograms)
            .where(
                withProgramSourceScope(
                    and(
                        inArray(schema.epgPrograms.channelId, channelIds),
                        isAiringAt(now)
                    ) as SQL,
                    sourceUrls,
                    options
                )
            )
            // One current row per channel so duplicate cross-source slots
            // don't consume the per-channel cap and starve other channels.
            .groupBy(schema.epgPrograms.channelId)
            .limit(channelIds.length)
    );
}

/**
 * Map program rows to EpgProgram and drop invalid ones, then collapse
 * duplicate programme slots. The dedup index is source-aware, so an
 * unscoped lookup (e.g. the M3U timeline, which queries without
 * `sourceUrls`) can return the same channel/start/title from two EPG
 * sources; keep the first so a programme is never shown twice.
 */
export function toEpgPrograms(rows: EpgProgramSelectRow[]): EpgProgram[] {
    const seen = new Set<string>();
    const programs: EpgProgram[] = [];
    for (const row of rows) {
        const program = toEpgProgramFromRow(row);
        if (!isValidEpgProgram(program)) {
            continue;
        }
        const key = `${program.channel}|${program.start}|${program.title}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        programs.push(program);
    }
    return programs;
}

export function assignCurrentProgramRows(
    result: Record<string, EpgProgram | null>,
    rows: EpgProgramSelectRow[]
): Set<string> {
    const matchedChannelIds = new Set<string>();
    for (const row of rows) {
        if (result[row.channelId]) {
            continue;
        }

        const program = toEpgProgramFromRow(row);
        if (isValidEpgProgram(program)) {
            result[row.channelId] = program;
            matchedChannelIds.add(row.channelId);
        }
    }
    return matchedChannelIds;
}

export function assignCandidateCurrentProgramRows(
    result: Record<string, EpgProgram | null>,
    candidateIdsByRequestedId: Map<string, string>,
    rows: EpgProgramSelectRow[]
): Set<string> {
    const matchedCandidateIds = new Set<string>();
    for (const row of rows) {
        const program = toEpgProgramFromRow(row);
        if (!isValidEpgProgram(program)) {
            continue;
        }

        for (const [requestedId, candidateId] of candidateIdsByRequestedId) {
            if (candidateId !== row.channelId || result[requestedId]) {
                continue;
            }

            result[requestedId] = program;
            matchedCandidateIds.add(candidateId);
        }
    }
    return matchedCandidateIds;
}

/**
 * Resolved candidate ids whose requested channel still has no programme in
 * `result` — i.e. the channel was matched to an epg_channels row but no
 * in-scope current programme was found for it yet.
 */
export function pendingCandidateIds(
    candidateIdsByRequestedId: Map<string, string>,
    result: Record<string, EpgProgram | null>
): string[] {
    const pending = new Set<string>();
    for (const [requestedId, candidateId] of candidateIdsByRequestedId) {
        if (!result[requestedId]) {
            pending.add(candidateId);
        }
    }
    return Array.from(pending);
}
```

- [ ] **Step 8: Create the current-programme batch**

`libs/shared/epg-store/src/lib/queries/epg-current-programs.ts` (the body of `getCurrentProgramsBatch`'s `try` block):

```ts
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    resolveChannelMetadataCandidate,
    selectChannelMetadataCandidates,
} from './epg-channel-lookup';
import type { EpgDrizzle } from './epg-drizzle';
import {
    assignCandidateCurrentProgramRows,
    assignCurrentProgramRows,
    pendingCandidateIds,
    selectCurrentProgramsForChannelIds,
} from './epg-program-rows';

/**
 * Fills `result` with the programme airing at `now` for each of `validIds`
 * (trimmed, unique) and `null` where none is found. `result` is filled in
 * place so a caller that catches a failure keeps what was found.
 *
 * Order: programmes by channel id (scoped, then legacy rows); then channels
 * resolved by id or display name (scoped, then legacy) and their
 * programmes; then, with a source scope, those channels' programmes from
 * any source, as the timeline does.
 */
export async function fillCurrentPrograms(
    result: Record<string, EpgProgram | null>,
    db: EpgDrizzle,
    validIds: string[],
    now: string,
    sourceUrls: string[]
): Promise<void> {
    assignCurrentProgramRows(
        result,
        await selectCurrentProgramsForChannelIds(db, validIds, now, sourceUrls)
    );

    let unmatchedIds = validIds.filter((id) => !(id in result));
    if (unmatchedIds.length > 0) {
        assignCurrentProgramRows(
            result,
            await selectCurrentProgramsForChannelIds(
                db,
                unmatchedIds,
                now,
                sourceUrls,
                { legacyOnly: true }
            )
        );
    }

    unmatchedIds = validIds.filter((id) => !(id in result));
    if (unmatchedIds.length > 0) {
        await fillFromResolvedChannels(result, db, unmatchedIds, now, sourceUrls);
    }

    for (const channelId of validIds) {
        result[channelId] ??= null;
    }
}

async function fillFromResolvedChannels(
    result: Record<string, EpgProgram | null>,
    db: EpgDrizzle,
    unmatchedIds: string[],
    now: string,
    sourceUrls: string[]
): Promise<void> {
    const scopedCandidates = await selectChannelMetadataCandidates(
        db,
        unmatchedIds,
        sourceUrls
    );
    const unresolvedIds = unmatchedIds.filter(
        (channelId) =>
            !resolveChannelMetadataCandidate(channelId, scopedCandidates)
    );
    const candidates =
        unresolvedIds.length > 0
            ? [
                  ...scopedCandidates,
                  ...(await selectChannelMetadataCandidates(
                      db,
                      unresolvedIds,
                      sourceUrls,
                      { legacyOnly: true }
                  )),
              ]
            : scopedCandidates;
    const candidateIdsByRequestedId = new Map<string, string>();
    for (const channelId of unmatchedIds) {
        const candidate = resolveChannelMetadataCandidate(channelId, candidates);
        if (candidate) {
            candidateIdsByRequestedId.set(channelId, candidate.id);
        }
    }

    const candidateIds = Array.from(new Set(candidateIdsByRequestedId.values()));
    const matchedCandidateIds = assignCandidateCurrentProgramRows(
        result,
        candidateIdsByRequestedId,
        await selectCurrentProgramsForChannelIds(db, candidateIds, now, sourceUrls)
    );
    const unresolvedCandidateIds = candidateIds.filter(
        (candidateId) => !matchedCandidateIds.has(candidateId)
    );
    assignCandidateCurrentProgramRows(
        result,
        candidateIdsByRequestedId,
        await selectCurrentProgramsForChannelIds(
            db,
            unresolvedCandidateIds,
            now,
            sourceUrls,
            { legacyOnly: true }
        )
    );

    // Unscoped fallback (mirror the timeline): a candidate resolved by
    // id/display-name but whose programmes are tagged with a source_url
    // outside the active scope — e.g. multi-source EPG imports where
    // epg_channels.source_url and epg_programs.source_url disagree — would
    // otherwise stay empty in the list while the timeline (which never
    // scopes by source) shows it. Retry only the still-unresolved
    // resolved-candidate ids against all sources.
    if (sourceUrls.length > 0) {
        const pending = pendingCandidateIds(candidateIdsByRequestedId, result);
        if (pending.length > 0) {
            assignCandidateCurrentProgramRows(
                result,
                candidateIdsByRequestedId,
                await selectCurrentProgramsForChannelIds(db, pending, now, [])
            );
        }
    }
}
```

- [ ] **Step 9: Rewrite the service file as the class only**

Overwrite `libs/shared/epg-store/src/lib/queries/epg-query.service.ts`:

```ts
import type {
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import { epgLogger } from '../epg-logger';
import {
    resolveChannelMetadataCandidate,
    selectChannelByDisplayName,
    selectChannelById,
    selectChannelMetadataCandidates,
    selectLegacyChannelByDisplayName,
    selectLegacyChannelById,
} from './epg-channel-lookup';
import { fillCurrentPrograms } from './epg-current-programs';
import type { EpgDrizzle } from './epg-drizzle';
import type { EpgMappingResolver } from './epg-mapping-resolution';
import {
    selectChannelPrograms,
    selectLegacyChannelPrograms,
    toEpgPrograms,
} from './epg-program-rows';
import {
    type EpgProgramSelectRow,
    normalizeChannelLookupKeys,
    normalizeSourceUrls,
    toAiringInstantIso,
} from './epg-query-scope';

/**
 * Channel programmes, current programmes and channel metadata from the
 * epg_* tables. Keys resolve to XMLTV channels by programme channel id,
 * then channel id (case-insensitive), then display name; scoped lookups
 * fall back to legacy rows without a source.
 *
 * `resolveMapping` supplies the manual mapping for the single-channel
 * lookup; batch callers map their keys first (`createEpgQueries`).
 */
export class EpgQueryService {
    constructor(
        private readonly getDb: () => EpgDrizzle | Promise<EpgDrizzle>,
        private readonly resolveMapping: EpgMappingResolver,
        private readonly loggerLabel = '[EPG Events]'
    ) {}

    async getChannelPrograms(
        channelId: string,
        options: { sourceUrls?: string[] } = {}
    ): Promise<EpgProgram[]> {
        try {
            const db = await this.getDb();
            let trimmedChannelId = channelId.trim();
            const sourceUrls = normalizeSourceUrls(options.sourceUrls);

            if (!trimmedChannelId) {
                return [];
            }

            // A manual EPG mapping replaces the key for every lookup below.
            const mapped = (await this.resolveMapping([trimmedChannelId])).get(
                trimmedChannelId
            );
            if (mapped) {
                trimmedChannelId = mapped;
            }

            return await this.lookupChannelPrograms(
                db,
                trimmedChannelId,
                sourceUrls
            );
        } catch (error) {
            epgLogger.error(
                this.loggerLabel,
                'Error getting channel programs:',
                error
            );
            return [];
        }
    }

    async getCurrentProgramsBatch(
        channelIds: string[],
        options: { sourceUrls?: string[]; nowMs?: number } = {}
    ): Promise<Record<string, EpgProgram | null>> {
        const result: Record<string, EpgProgram | null> = {};
        if (!Array.isArray(channelIds) || channelIds.length === 0) {
            return result;
        }

        const validIds = Array.from(
            new Set(
                channelIds
                    .map((id) => id?.trim())
                    .filter((id): id is string => Boolean(id))
            )
        );
        if (validIds.length === 0) {
            return result;
        }

        try {
            const db = await this.getDb();
            await fillCurrentPrograms(
                result,
                db,
                validIds,
                toAiringInstantIso(options.nowMs),
                normalizeSourceUrls(options.sourceUrls)
            );
            return result;
        } catch (error) {
            epgLogger.error(
                this.loggerLabel,
                'Error getting batch current programs:',
                error
            );
            return result;
        }
    }

    /**
     * Resolve channel lookup keys to XMLTV channel metadata. Throws on a
     * database failure so callers that must tell "no match" apart from "could
     * not look up" (the guide's coverage read) can fail open.
     */
    async resolveChannelMetadata(
        channelIds: string[],
        options: { sourceUrls?: string[] } = {}
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        const normalizedChannelIds = normalizeChannelLookupKeys(channelIds);
        if (normalizedChannelIds.length === 0) {
            return {};
        }

        const db = await this.getDb();
        const sourceUrls = normalizeSourceUrls(options.sourceUrls);
        let candidates = await selectChannelMetadataCandidates(
            db,
            normalizedChannelIds,
            sourceUrls
        );
        if (sourceUrls.length > 0) {
            const missingChannelIds = normalizedChannelIds.filter(
                (channelId) =>
                    !resolveChannelMetadataCandidate(channelId, candidates)
            );
            if (missingChannelIds.length > 0) {
                candidates = [
                    ...candidates,
                    ...(await selectChannelMetadataCandidates(
                        db,
                        missingChannelIds,
                        sourceUrls,
                        { legacyOnly: true }
                    )),
                ];
            }
        }

        return Object.fromEntries(
            normalizedChannelIds.map((channelId) => [
                channelId,
                resolveChannelMetadataCandidate(channelId, candidates),
            ])
        );
    }

    /** Fail-soft variant of `resolveChannelMetadata`: a failure logs and answers `{}`. */
    async getChannelMetadata(
        channelIds: string[],
        options: { sourceUrls?: string[] } = {}
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        try {
            return await this.resolveChannelMetadata(channelIds, options);
        } catch (error) {
            epgLogger.error(
                this.loggerLabel,
                'Error getting channel metadata:',
                error
            );
            return {};
        }
    }

    /** Programme rows of the key itself, else of the channel it names by id, else by display name. */
    private async lookupChannelPrograms(
        db: EpgDrizzle,
        channelId: string,
        sourceUrls: string[]
    ): Promise<EpgProgram[]> {
        let results = await this.selectProgramsOf(db, channelId, sourceUrls);
        if (results.length > 0) {
            return toEpgPrograms(results);
        }

        let channel = await selectChannelById(db, channelId, sourceUrls);
        if (channel.length === 0) {
            channel = await selectLegacyChannelById(db, channelId, sourceUrls);
        }
        if (channel.length > 0) {
            results = await this.selectProgramsOf(db, channel[0].id, sourceUrls);
            if (results.length > 0) {
                return toEpgPrograms(results);
            }
        }

        channel = await selectChannelByDisplayName(db, channelId, sourceUrls);
        if (channel.length === 0) {
            channel = await selectChannelByDisplayName(db, channelId, sourceUrls, {
                caseInsensitive: true,
            });
        }
        if (channel.length === 0) {
            channel = await selectLegacyChannelByDisplayName(
                db,
                channelId,
                sourceUrls
            );
        }
        if (channel.length === 0) {
            channel = await selectLegacyChannelByDisplayName(
                db,
                channelId,
                sourceUrls,
                { caseInsensitive: true }
            );
        }
        if (channel.length > 0) {
            return toEpgPrograms(
                await this.selectProgramsOf(db, channel[0].id, sourceUrls)
            );
        }

        return [];
    }

    /** Scoped rows of one channel id, else its legacy rows without a source. */
    private async selectProgramsOf(
        db: EpgDrizzle,
        channelId: string,
        sourceUrls: string[]
    ): Promise<EpgProgramSelectRow[]> {
        const results = await selectChannelPrograms(db, channelId, sourceUrls);
        return results.length > 0
            ? results
            : selectLegacyChannelPrograms(db, channelId, sourceUrls);
    }
}
```

- [ ] **Step 10: Inject the database into the guide service**

In `libs/shared/epg-store/src/lib/queries/epg-guide-query.service.ts`:

1. Imports (lines 12–21). Before:

```ts
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';
import { epgLogger } from '../util/epg-logger';
import {
    EpgProgramRow,
    isValidEpgProgram,
    toEpgProgramFromRow,
} from './epg-program-row.util';
import { epgQueryService, EpgQueryService } from './epg-query.service';
```

After:

```ts
import * as schema from '@iptvnator/shared/database/schema';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { epgLogger } from '../epg-logger';
import type { EpgDrizzle } from './epg-drizzle';
import {
    EpgProgramRow,
    isValidEpgProgram,
    toEpgProgramFromRow,
} from './epg-program-row.util';
import type { EpgQueryService } from './epg-query.service';
```

2. Constructor (lines 106–109). Before:

```ts
    constructor(
        private readonly resolver: ChannelResolver = epgQueryService,
        private readonly loggerLabel = '[EPG Guide]'
    ) {}
```

After:

```ts
    constructor(
        private readonly resolver: ChannelResolver,
        private readonly getDb: () => EpgDrizzle | Promise<EpgDrizzle>,
        private readonly loggerLabel = '[EPG Guide]'
    ) {}
```

3. Replace both `const db = await getDatabase();` (lines 140 and 195) with `const db = await this.getDb();`.
4. In the class comment, replace `manual mappings are applied by the IPC layer before the keys reach this service.` with `manual mappings are applied before the keys reach this service (createEpgQueries).`
5. Delete the last line, `export const epgGuideQueryService = new EpgGuideQueryService();`.

- [ ] **Step 11: Adapt the two moved specs**

`libs/shared/epg-store/src/lib/queries/epg-query.service.spec.ts`:

1. Replace the header

```ts
import { EpgQueryService } from './epg-query.service';

const getDatabase = jest.fn();

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));
```

with

```ts
import { EpgQueryService } from './epg-query.service';

const getDatabase = jest.fn();
const resolveMapping = jest.fn();
```

2. Replace the `beforeEach` body

```ts
        getDatabase.mockReset();
        service = new EpgQueryService('[Test EPG]');
```

with

```ts
        getDatabase.mockReset();
        resolveMapping.mockReset();
        resolveMapping.mockResolvedValue(new Map());
        service = new EpgQueryService(
            () => getDatabase(),
            resolveMapping,
            '[Test EPG]'
        );
```

3. Replace the whole case `it('resolves a manual mapping saved under any stream sharing the epg_channel_id via a single join', …)` (the Xtream join now lives in Electron, Task 14) with:

```ts
    it('looks the channel up under its manual mapping', async () => {
        resolveMapping.mockResolvedValue(
            new Map([['provider.epg.id', 'BBC.MAPPED']])
        );
        const select = jest.fn().mockReturnValueOnce(
            createProgramChain([
                {
                    id: 1,
                    channelId: 'BBC.MAPPED',
                    start: '2026-06-21T17:00:00.000Z',
                    stop: '2026-06-21T18:00:00.000Z',
                    title: 'Mapped Programme',
                    description: null,
                    category: null,
                    iconUrl: null,
                    rating: null,
                    episodeNum: null,
                    sourceUrl: null,
                },
            ])
        );
        getDatabase.mockResolvedValue({ select });

        const result = await service.getChannelPrograms(' provider.epg.id ');

        expect(resolveMapping).toHaveBeenCalledWith(['provider.epg.id']);
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Mapped Programme');
    });
```

4. In the case `collapses duplicate programme slots from multiple sources in an unscoped lookup`, delete `const whereCalls: unknown[] = [];` and the two leading mocks of the mapping lookup:

```ts
            // getMapping direct + Xtream fallback — both miss.
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            .mockReturnValueOnce({
                from: jest.fn(() => ({
                    innerJoin: jest.fn(function inner() {
                        return this;
                    }),
                    where: jest.fn(() => ({
                        orderBy: jest.fn(() => ({
                            limit: jest.fn().mockResolvedValue([]),
                        })),
                    })),
                })),
            })
```

so that `select` starts with `.mockReturnValueOnce(createProgramChain([...]))`.

`libs/shared/epg-store/src/lib/queries/epg-guide-query.service.spec.ts`:

1. Replace

```ts
import { epgLogger } from '../util/epg-logger';

const getDatabase = jest.fn();

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

jest.mock('../util/epg-logger', () => ({
    epgLogger: { error: jest.fn(), log: jest.fn() },
}));
```

with

```ts
import { epgLogger } from '../epg-logger';

const getDatabase = jest.fn();

jest.mock('../epg-logger', () => ({
    epgLogger: { error: jest.fn(), log: jest.fn() },
}));
```

2. Replace

```ts
        service = new EpgGuideQueryService(
            { resolveChannelMetadata },
            '[Test]'
        );
```

with

```ts
        service = new EpgGuideQueryService(
            { resolveChannelMetadata },
            () => getDatabase(),
            '[Test]'
        );
```

- [ ] **Step 12: Run the library suite and the strict type check**

```bash
pnpm nx test shared-epg-store
pnpm exec tsc -p libs/shared/epg-store/tsconfig.lib.json --noEmit
pnpm run typecheck:spec libs/shared/epg-store
for file in libs/shared/epg-store/src/lib/queries/*.ts; do printf '%5d %s\n' "$(grep -c '' "$file")" "$file"; done
```

Expected: PASS (all moved `EpgQueryService` and `EpgGuideQueryService` cases plus mapping resolution); both type checks print no error; every non-spec file under 300 lines. The moved specs were type-checked without `strict` in `electron-backend`; if `typecheck:spec` reports an implicit `any` or an `unknown` catch variable in one, add the type annotation in that spec without changing an assertion.

- [ ] **Step 13: Commit**

```bash
git add libs/shared/epg-store/src/lib/queries apps/electron-backend/src/app/events
git commit -m "refactor(epg): move the EPG query services into shared-epg-store

EpgQueryService (976 lines, baselined) is split into scope helpers,
channel lookups, programme rows, the current-programme batch and the
service class; queries take an EpgDrizzle getter instead of
getDatabase(). The guide service gets the same injection.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: `createEpgQueries`

**Files:**
- Create: `libs/shared/epg-store/src/lib/queries/epg-guide-mapping.ts`, `epg-guide-mapping.spec.ts`
- Create: `libs/shared/epg-store/src/lib/queries/epg-search.query.ts`, `epg-freshness.query.ts`
- Create: `libs/shared/epg-store/src/lib/queries/create-epg-queries.ts`, `create-epg-queries.spec.ts`
- Modify: `libs/shared/epg-store/src/index.ts`

- [ ] **Step 1: Write the failing guide-remap spec**

The cases come from `apps/electron-backend/src/app/events/epg-guide.events.spec.ts`, which tested this logic through the IPC handlers. `libs/shared/epg-store/src/lib/queries/epg-guide-mapping.spec.ts`:

```ts
import {
    getGuideCoverageByRequestedKeys,
    getGuideProgramsByRequestedKeys,
} from './epg-guide-mapping';

const program = {
    start: '2026-01-01T00:00:00.000Z',
    stop: '2026-01-01T01:00:00.000Z',
    channel: 'xmltv.id',
    title: 'News',
    desc: null,
    category: null,
};
const noMappings = async () => new Map<string, string>();

describe('getGuideProgramsByRequestedKeys', () => {
    it('applies a manual mapping before querying and keys the answer back by the requested key', async () => {
        const query = jest.fn().mockResolvedValue({ 'xmltv.id': [program] });

        const result = await getGuideProgramsByRequestedKeys(
            { channelIds: ['m3u-key'], fromMs: 0, toMs: 1 },
            async () => new Map([['m3u-key', 'xmltv.id']]),
            query
        );

        expect(query).toHaveBeenCalledWith(
            expect.objectContaining({ channelIds: ['xmltv.id'] })
        );
        expect(result).toEqual({ 'm3u-key': [program] });
    });

    it('gives two requested keys resolving to one target their own array reference', async () => {
        const result = await getGuideProgramsByRequestedKeys(
            { channelIds: ['a', 'b'], fromMs: 0, toMs: 1 },
            async () =>
                new Map([
                    ['a', 'xmltv.id'],
                    ['b', 'xmltv.id'],
                ]),
            jest.fn().mockResolvedValue({ 'xmltv.id': [program] })
        );

        expect(result['a']).toEqual([program]);
        expect(result['b']).toEqual([program]);
        expect(result['a']).not.toBe(result['b']);
    });

    it('trims a padded requested id to find the service answer keyed by the trimmed form', async () => {
        const query = jest.fn().mockResolvedValue({ CNN: [program] });

        const result = await getGuideProgramsByRequestedKeys(
            { channelIds: [' CNN '], fromMs: 0, toMs: 1 },
            noMappings,
            query
        );

        expect(query).toHaveBeenCalledWith(
            expect.objectContaining({ channelIds: [' CNN '] })
        );
        expect(result).toEqual({ ' CNN ': [program] });
    });

    it('omits a key the service did not answer for instead of filling it with []', async () => {
        await expect(
            getGuideProgramsByRequestedKeys(
                { channelIds: ['dropped'], fromMs: 0, toMs: 1 },
                noMappings,
                jest.fn().mockResolvedValue({})
            )
        ).resolves.toEqual({});
    });
});

describe('getGuideCoverageByRequestedKeys', () => {
    it('de-duplicates requested keys and keeps only the covered ones', async () => {
        await expect(
            getGuideCoverageByRequestedKeys(
                { channelIds: ['a', 'a', 'b'], fromMs: 0, toMs: 1 },
                noMappings,
                jest.fn().mockResolvedValue(['a'])
            )
        ).resolves.toEqual(['a']);
    });

    it('rejects when the mapping lookup rejects', async () => {
        await expect(
            getGuideCoverageByRequestedKeys(
                { channelIds: ['a'], fromMs: 0, toMs: 1 },
                () => Promise.reject(new Error('mapping db down')),
                jest.fn()
            )
        ).rejects.toThrow('mapping db down');
    });
});
```

Run: `pnpm nx test shared-epg-store --testPathPatterns=epg-guide-mapping`
Expected: FAIL, `Cannot find module './epg-guide-mapping'`.

- [ ] **Step 2: Create the guide remap**

`libs/shared/epg-store/src/lib/queries/epg-guide-mapping.ts` (from `EpgEvents.handleGetGuidePrograms`, `handleGetGuideCoverage` and `resolvedGuideKey` in `apps/electron-backend/src/app/events/epg.events.ts:302-377`):

```ts
import type {
    ElectronBridgeEpgGuideWindow,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import type { EpgMappingResolver } from './epg-mapping-resolution';

/**
 * Guide reads take playlist channel keys. Manual mappings are applied before
 * the query and the answer is keyed back by the requested key, so callers
 * never see a mapped id. The guide service keys its answer by the TRIMMED,
 * de-duplicated, cap-respecting form of the ids it was given
 * (`normalizeGuideWindow`), so the remap trims too.
 */
function resolvedGuideKey(mapping: Map<string, string>, id: unknown): string {
    return typeof id === 'string' ? (mapping.get(id) ?? id).trim() : '';
}

/**
 * A key the service did not answer for (cut by its per-request cap) stays
 * absent rather than `[]`, so callers can tell "queried, nothing found"
 * from "not queried at all".
 */
export async function getGuideProgramsByRequestedKeys(
    guideWindow: ElectronBridgeEpgGuideWindow,
    resolve: EpgMappingResolver,
    query: (
        resolved: ElectronBridgeEpgGuideWindow
    ) => Promise<Record<string, EpgProgram[]>>
): Promise<Record<string, EpgProgram[]>> {
    const requested = Array.isArray(guideWindow?.channelIds)
        ? guideWindow.channelIds
        : [];
    const mapping = await resolve(requested);
    const resolvedIds = requested.map((id) => mapping.get(id) ?? id);
    const programs = await query({ ...guideWindow, channelIds: resolvedIds });
    const answer: Record<string, EpgProgram[]> = Object.create(null);
    for (const id of requested) {
        const key = resolvedGuideKey(mapping, id);
        if (Object.prototype.hasOwnProperty.call(programs, key)) {
            // Copy so two requested ids resolving to one target never
            // share an array reference.
            answer[String(id)] = [...programs[key]];
        }
    }
    return answer;
}

/** The requested keys (de-duplicated) whose resolved channel has a programme in the window. */
export async function getGuideCoverageByRequestedKeys(
    guideWindow: ElectronBridgeEpgGuideWindow,
    resolve: EpgMappingResolver,
    query: (resolved: ElectronBridgeEpgGuideWindow) => Promise<string[]>
): Promise<string[]> {
    const requested = Array.isArray(guideWindow?.channelIds)
        ? guideWindow.channelIds
        : [];
    const mapping = await resolve(requested);
    const resolvedIds = requested.map((id) => mapping.get(id) ?? id);
    const covered = new Set(
        await query({ ...guideWindow, channelIds: resolvedIds })
    );
    const seen = new Set<string>();
    const answer: string[] = [];
    for (const id of requested) {
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        if (covered.has(resolvedGuideKey(mapping, id))) {
            answer.push(id);
        }
    }
    return answer;
}
```

- [ ] **Step 3: Create the search and freshness queries**

`libs/shared/epg-store/src/lib/queries/epg-search.query.ts` (from `apps/electron-backend/src/app/events/database/epg-db.events.ts:15-95`):

```ts
import { sql } from 'drizzle-orm';
import type { ElectronBridgeEpgSearchProgram } from '@iptvnator/shared/interfaces';
import type { EpgDrizzle } from './epg-drizzle';

/** Raw `epg_programs` columns as `db.all` returns them, plus the joined channel name. */
interface EpgSearchRow {
    channel_id: string;
    start: string;
    stop: string;
    title: string;
    description: string | null;
    category: string | null;
    icon_url: string | null;
    rating: string | null;
    episode_num: string | null;
    channel_name: string | null;
}

/**
 * `db.all` hands back snake_case columns; the bridge promises the public
 * `EpgProgram` shape (`channel`, `desc`, `iconUrl`, …), so map here or every
 * consumer sees `program.channel === undefined`.
 */
function toSearchProgram(row: EpgSearchRow): ElectronBridgeEpgSearchProgram {
    return {
        start: row.start,
        stop: row.stop,
        channel: row.channel_id,
        title: row.title,
        desc: row.description,
        category: row.category,
        iconUrl: row.icon_url,
        rating: row.rating,
        episodeNum: row.episode_num,
        channelName: row.channel_name ?? null,
    };
}

/**
 * Programme search by substring in title, description or category, past
 * programmes included (catch-up), with the XMLTV channel name. `LIKE`
 * rather than FTS: it matches substrings in Cyrillic and other scripts the
 * way users expect. A database failure throws.
 */
export async function searchEpgPrograms(
    db: EpgDrizzle,
    searchTerm: string,
    limit = 50
): Promise<ElectronBridgeEpgSearchProgram[]> {
    const trimmedTerm = searchTerm.trim();
    if (!trimmedTerm) {
        return [];
    }

    const likePattern = `%${trimmedTerm}%`;
    const results = (await db.all(sql`
                SELECT
                    p.*,
                    c.display_name as channel_name
                FROM epg_programs p
                LEFT JOIN epg_channels c ON p.channel_id = c.id
                WHERE (
                    p.title LIKE ${likePattern}
                    OR p.description LIKE ${likePattern}
                    OR p.category LIKE ${likePattern}
                )
                ORDER BY p.start
                LIMIT ${limit}
            `)) as EpgSearchRow[];

    return results.map(toSearchProgram);
}
```

`libs/shared/epg-store/src/lib/queries/epg-freshness.query.ts` (the query from `apps/electron-backend/src/app/events/epg-fetch.service.ts:53-62`):

```ts
import { eq } from 'drizzle-orm';
import { epgChannelSources } from '@iptvnator/shared/database/schema';
import type { ElectronBridgeEpgFreshnessResult } from '@iptvnator/shared/interfaces';
import { epgLogger } from '../epg-logger';
import type { EpgDrizzle } from './epg-drizzle';

/** Age after which stored EPG data is refetched. */
export const EPG_FRESHNESS_MAX_AGE_HOURS = 12;

const loggerLabel = '[EPG Events]';

/**
 * Whether `sourceUrl` has a channel snapshot written at or after
 * `cutoffIso`: the source's own import time, not global channel metadata.
 */
export async function isEpgSourceFresh(
    db: EpgDrizzle,
    sourceUrl: string,
    cutoffIso: string
): Promise<boolean> {
    const result = await db
        .select({ updatedAt: epgChannelSources.updatedAt })
        .from(epgChannelSources)
        .where(eq(epgChannelSources.sourceUrl, sourceUrl))
        .limit(1);

    return Boolean(
        result.length > 0 &&
            result[0].updatedAt &&
            result[0].updatedAt >= cutoffIso
    );
}

/** Splits `urls` into fresh and stale; any database failure answers "all stale". */
export async function checkEpgSourcesFreshness(
    getDb: () => EpgDrizzle | Promise<EpgDrizzle>,
    urls: string[],
    maxAgeHours = EPG_FRESHNESS_MAX_AGE_HOURS
): Promise<ElectronBridgeEpgFreshnessResult> {
    const staleUrls: string[] = [];
    const freshUrls: string[] = [];
    const cutoffIso = new Date(
        Date.now() - maxAgeHours * 60 * 60 * 1000
    ).toISOString();

    try {
        const db = await getDb();
        for (const url of urls) {
            if (!url?.trim()) {
                continue;
            }
            if (await isEpgSourceFresh(db, url, cutoffIso)) {
                freshUrls.push(url);
            } else {
                staleUrls.push(url);
            }
        }
    } catch (error) {
        epgLogger.error(loggerLabel, 'Error checking EPG freshness:', error);
        return { staleUrls: urls, freshUrls: [] };
    }

    return { staleUrls, freshUrls };
}
```

- [ ] **Step 4: Write the failing `createEpgQueries` spec on real SQLite**

`libs/shared/epg-store/src/lib/queries/create-epg-queries.spec.ts`:

```ts
import Database from 'better-sqlite3';
import { seedEpgSource, type ParsedProgram } from '../../testing';
import { ensureEpgSchema } from '../schema/ensure-epg-schema';
import { createEpgQueries } from './create-epg-queries';
import { createEpgDrizzle } from './epg-drizzle';

const sourceUrl = 'https://a.test/guide.xml';
const fromMs = Date.parse('2026-10-15T07:00:00.000Z');
const toMs = Date.parse('2026-10-15T11:00:00.000Z');

function programme(
    channel: string,
    title: string,
    start: string,
    stop: string
): ParsedProgram {
    return {
        channel,
        start,
        stop,
        title: [{ lang: '', value: title }],
        desc: [{ lang: '', value: `${title} description` }],
        category: [],
        date: '',
        episodeNum: [],
        icon: [],
        rating: [],
    };
}

describe('createEpgQueries on an EPG database', () => {
    let db: Database.Database;

    beforeEach(() => {
        db = new Database(':memory:');
        ensureEpgSchema(db, { fts: false });
        seedEpgSource(
            db,
            sourceUrl,
            [
                {
                    id: 'news.test',
                    displayName: [{ lang: '', value: 'Новости 東京' }],
                    icon: [{ src: 'https://a.test/news.png' }],
                    url: [],
                },
                {
                    id: 'sport.test',
                    displayName: [{ lang: '', value: 'Sport HD' }],
                    icon: [],
                    url: [],
                },
            ],
            [
                programme('news.test', 'Morning News', '2026-10-15T08:00:00.000Z', '2026-10-15T09:00:00.000Z'),
                programme('news.test', 'Weather', '2026-10-15T09:00:00.000Z', '2026-10-15T10:00:00.000Z'),
                programme('sport.test', 'Match Day', '2026-10-15T08:00:00.000Z', '2026-10-15T10:00:00.000Z'),
            ]
        );
    });

    afterEach(() => db.close());

    function queries(
        resolveMappings?: (keys: string[]) => Promise<Map<string, string>>
    ) {
        const epgDrizzle = createEpgDrizzle(db);
        return createEpgQueries({ getDb: () => epgDrizzle, resolveMappings });
    }

    it('answers channel programmes by id, case-insensitive id and display name', async () => {
        const epg = queries();

        for (const key of ['news.test', 'NEWS.TEST', 'Новости 東京']) {
            expect(
                (await epg.getChannelPrograms(key)).map((p) => p.title)
            ).toEqual(['Morning News', 'Weather']);
        }
        await expect(epg.getChannelPrograms('missing')).resolves.toEqual([]);
    });

    it('answers the programme airing at the given instant', async () => {
        const current = await queries().getCurrentProgramsBatch(
            ['news.test', 'Sport HD', 'missing'],
            { nowMs: Date.parse('2026-10-15T09:30:00.000Z') }
        );

        expect(current['news.test']?.title).toBe('Weather');
        expect(current['Sport HD']?.title).toBe('Match Day');
        expect(current['missing']).toBeNull();
    });

    it('answers channel metadata', async () => {
        await expect(
            queries().getChannelMetadata(['news.test', 'Sport HD', 'missing'])
        ).resolves.toEqual({
            'news.test': {
                id: 'news.test',
                displayName: 'Новости 東京',
                iconUrl: 'https://a.test/news.png',
            },
            'Sport HD': {
                id: 'sport.test',
                displayName: 'Sport HD',
                iconUrl: null,
            },
            missing: null,
        });
    });

    it('answers the guide window and its coverage', async () => {
        const epg = queries();

        const programs = await epg.getProgramsForChannels({
            channelIds: ['news.test', ' sport.test '],
            fromMs,
            toMs,
        });
        expect(programs['news.test'].map((p) => p.title)).toEqual([
            'Morning News',
            'Weather',
        ]);
        expect(programs[' sport.test '].map((p) => p.title)).toEqual([
            'Match Day',
        ]);
        await expect(
            epg.getProgramCoverage({
                channelIds: ['news.test', 'missing'],
                fromMs,
                toMs,
            })
        ).resolves.toEqual(['news.test']);
    });

    it('searches programmes with their channel name', async () => {
        const epg = queries();

        await expect(epg.searchPrograms('news')).resolves.toEqual([
            expect.objectContaining({
                title: 'Morning News',
                channel: 'news.test',
                channelName: 'Новости 東京',
            }),
        ]);
        await expect(epg.searchPrograms('   ')).resolves.toEqual([]);
    });

    it('reports a just-imported source as fresh and an unknown one as stale', async () => {
        await expect(
            queries().checkFreshness([sourceUrl, 'https://unknown.test/guide.xml'])
        ).resolves.toEqual({
            freshUrls: [sourceUrl],
            staleUrls: ['https://unknown.test/guide.xml'],
        });
    });

    it('applies manual mappings and keys every answer by the requested key', async () => {
        const epg = queries(
            async (keys) =>
                new Map(
                    keys
                        .filter((key) => key === 'm3u-key')
                        .map((key): [string, string] => [key, 'news.test'])
                )
        );

        expect(
            (await epg.getChannelPrograms('m3u-key')).map((p) => p.title)
        ).toEqual(['Morning News', 'Weather']);
        expect(
            (
                await epg.getCurrentProgramsBatch(['m3u-key'], {
                    nowMs: Date.parse('2026-10-15T08:30:00.000Z'),
                })
            )['m3u-key']?.title
        ).toBe('Morning News');
        expect(
            Object.keys(
                await epg.getProgramsForChannels({
                    channelIds: ['m3u-key'],
                    fromMs,
                    toMs,
                })
            )
        ).toEqual(['m3u-key']);
    });

    it('keeps answering when the mapping lookup fails, except for coverage', async () => {
        const epg = queries(() => Promise.reject(new Error('mapping db down')));

        await expect(epg.getChannelPrograms('news.test')).resolves.toHaveLength(2);
        await expect(
            epg.getChannelMetadata(['news.test'])
        ).resolves.toMatchObject({ 'news.test': { id: 'news.test' } });
        await expect(
            epg.getProgramCoverage({ channelIds: ['news.test'], fromMs, toMs })
        ).rejects.toThrow('mapping db down');
    });
});
```

Run: `pnpm nx test shared-epg-store --testPathPatterns=create-epg-queries`
Expected: FAIL, `Cannot find module './create-epg-queries'`.

- [ ] **Step 5: Create `createEpgQueries`**

`libs/shared/epg-store/src/lib/queries/create-epg-queries.ts`:

```ts
import type {
    ElectronBridgeCurrentProgramsOptions,
    ElectronBridgeEpgFreshnessResult,
    ElectronBridgeEpgGuideWindow,
    ElectronBridgeEpgSearchProgram,
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import type { EpgDrizzle } from './epg-drizzle';
import { checkEpgSourcesFreshness } from './epg-freshness.query';
import {
    getGuideCoverageByRequestedKeys,
    getGuideProgramsByRequestedKeys,
} from './epg-guide-mapping';
import { EpgGuideQueryService } from './epg-guide-query.service';
import {
    queryByResolvedChannelIds,
    resolveMappingsSoft,
    resolveMappingsStrict,
    type EpgMappingResolver,
} from './epg-mapping-resolution';
import { EpgQueryService } from './epg-query.service';
import { searchEpgPrograms } from './epg-search.query';

/** EPG reads with the renderer bridge's semantics (`ElectronBridgeApi`). */
export interface EpgQueries {
    getChannelPrograms(
        channelId: string,
        options?: { sourceUrls?: string[] }
    ): Promise<EpgProgram[]>;
    getCurrentProgramsBatch(
        channelIds: string[],
        options?: ElectronBridgeCurrentProgramsOptions
    ): Promise<Record<string, EpgProgram | null>>;
    getChannelMetadata(
        channelIds: string[],
        options?: { sourceUrls?: string[] }
    ): Promise<Record<string, EpgChannelMetadata | null>>;
    getProgramsForChannels(
        window: ElectronBridgeEpgGuideWindow
    ): Promise<Record<string, EpgProgram[]>>;
    getProgramCoverage(window: ElectronBridgeEpgGuideWindow): Promise<string[]>;
    searchPrograms(
        term: string,
        limit?: number
    ): Promise<ElectronBridgeEpgSearchProgram[]>;
    checkFreshness(
        urls: string[],
        maxAgeHours?: number
    ): Promise<ElectronBridgeEpgFreshnessResult>;
}

/**
 * The EPG reads over `getDb()`. `resolveMappings` maps channel keys to EPG
 * channel ids (manual mappings); it may reject. Every read then falls back
 * to the unmapped keys except `getProgramCoverage`, which rejects so the
 * "Only with EPG" filter never hides a mapped channel.
 */
export function createEpgQueries(options: {
    readonly getDb: () => EpgDrizzle | Promise<EpgDrizzle>;
    /** Manual mappings (Electron; server from 3e): channel key → EPG channel id. */
    readonly resolveMappings?: (keys: string[]) => Promise<Map<string, string>>;
}): EpgQueries {
    const { getDb, resolveMappings } = options;
    const soft: EpgMappingResolver = (keys) =>
        resolveMappingsSoft(resolveMappings, keys);
    const strict: EpgMappingResolver = (keys) =>
        resolveMappingsStrict(resolveMappings, keys);
    const lookups = new EpgQueryService(getDb, soft);
    const guide = new EpgGuideQueryService(lookups, getDb);

    return {
        getChannelPrograms: (channelId, lookup) =>
            lookups.getChannelPrograms(channelId, lookup),
        getCurrentProgramsBatch: (channelIds, lookup) =>
            queryByResolvedChannelIds(channelIds, soft, (resolvedIds) =>
                lookups.getCurrentProgramsBatch(resolvedIds, lookup)
            ),
        getChannelMetadata: (channelIds, lookup) =>
            queryByResolvedChannelIds(channelIds, soft, (resolvedIds) =>
                lookups.getChannelMetadata(resolvedIds, lookup)
            ),
        getProgramsForChannels: (guideWindow) =>
            getGuideProgramsByRequestedKeys(guideWindow, soft, (resolved) =>
                guide.getProgramsForChannels(resolved)
            ),
        getProgramCoverage: (guideWindow) =>
            getGuideCoverageByRequestedKeys(guideWindow, strict, (resolved) =>
                guide.getProgramCoverage(resolved)
            ),
        searchPrograms: async (term, limit) =>
            searchEpgPrograms(await getDb(), term, limit),
        checkFreshness: (urls, maxAgeHours) =>
            checkEpgSourcesFreshness(getDb, urls, maxAgeHours),
    };
}
```

- [ ] **Step 6: Export the queries**

Append to `libs/shared/epg-store/src/index.ts`:

```ts
export { createEpgDrizzle } from './lib/queries/epg-drizzle';
export type { EpgDrizzle } from './lib/queries/epg-drizzle';
export { createEpgQueries } from './lib/queries/create-epg-queries';
export type { EpgQueries } from './lib/queries/create-epg-queries';
export {
    EPG_FRESHNESS_MAX_AGE_HOURS,
    isEpgSourceFresh,
} from './lib/queries/epg-freshness.query';
```

- [ ] **Step 7: Run the library suite**

```bash
pnpm nx test shared-epg-store
pnpm exec tsc -p libs/shared/epg-store/tsconfig.lib.json --noEmit
pnpm nx lint shared-epg-store
```

Expected: PASS (including `index.spec.ts`: `createEpgDrizzle` loads drizzle's driver only when called); no type errors; lint clean.

- [ ] **Step 8: Commit**

```bash
git add libs/shared/epg-store/src
git commit -m "feat(epg): createEpgQueries, the EPG reads over any drizzle handle

Channel programmes, current programmes, metadata, guide window and
coverage, programme search and freshness, with manual mappings from an
optional resolver; search and freshness move from Electron's handlers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Electron's main process reads EPG through the library

**Files:**
- Create: `apps/electron-backend/src/app/events/epg-channel-program-mapping.ts`, `epg-channel-program-mapping.spec.ts`
- Create: `apps/electron-backend/src/app/events/epg-queries.ts`
- Modify: `apps/electron-backend/src/app/events/epg.events.ts:15-29` (imports), `:270-377` (query handlers)
- Modify: `apps/electron-backend/src/app/events/database/epg-db.events.ts` (rewritten), `database/epg-db.events.spec.ts:62-63` (comment)
- Modify: `apps/electron-backend/src/app/events/epg-fetch.service.ts:1-18, 53-62`
- Modify: `apps/electron-backend/src/app/events/epg-mapping.service.ts:10-73`, `epg-mapping.service.spec.ts`
- Modify: `apps/electron-backend/src/app/events/epg-guide.events.spec.ts` (rewritten)
- Modify: `tools/eslint/max-lines-baseline.mjs` (regenerated)

- [ ] **Step 1: Write the failing spec for the timeline's mapping lookup**

`apps/electron-backend/src/app/events/epg-channel-program-mapping.spec.ts` (the join case moved from `epg-query.service.spec.ts`):

```ts
const getDatabase = jest.fn();

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

import { resolveChannelProgramMappings } from './epg-channel-program-mapping';

/** `select().from().where().limit()` resolving to `rows`. */
function directLookup(rows: unknown[]) {
    const chain: Record<string, jest.Mock> = {};
    chain.where = jest.fn(() => chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    return { from: jest.fn(() => chain) };
}

describe('resolveChannelProgramMappings', () => {
    beforeEach(() => getDatabase.mockReset());

    it('returns a direct mapping without the Xtream fallback', async () => {
        const select = jest
            .fn()
            .mockReturnValueOnce(directLookup([{ epgChannelId: 'BBC.ONE' }]));
        getDatabase.mockResolvedValue({ select });

        await expect(
            resolveChannelProgramMappings(['bbc.one.uk'])
        ).resolves.toEqual(new Map([['bbc.one.uk', 'BBC.ONE']]));
        expect(select).toHaveBeenCalledTimes(1);
    });

    it('resolves a manual mapping saved under any stream sharing the epg_channel_id via a single join', async () => {
        const joinLimit = jest
            .fn()
            .mockResolvedValue([{ epgChannelId: 'BBC.MAPPED' }]);
        let innerJoinCount = 0;
        const joinChain: Record<string, jest.Mock> = {};
        joinChain.innerJoin = jest.fn(() => {
            innerJoinCount += 1;
            return joinChain;
        });
        joinChain.where = jest.fn(() => ({
            orderBy: jest.fn(() => ({ limit: joinLimit })),
        }));
        const select = jest
            .fn()
            // Direct lookup by channel key — miss.
            .mockReturnValueOnce(directLookup([]))
            // Xtream fallback — one join across content, categories and mappings.
            .mockReturnValueOnce({ from: jest.fn(() => joinChain) });
        getDatabase.mockResolvedValue({ select });

        const result = await resolveChannelProgramMappings(['provider.epg.id']);

        expect(innerJoinCount).toBe(2);
        expect(joinLimit).toHaveBeenCalledWith(1);
        expect(result).toEqual(new Map([['provider.epg.id', 'BBC.MAPPED']]));
    });

    it('leaves a key unmapped when its lookup fails', async () => {
        getDatabase.mockResolvedValue({
            select: jest.fn(() => {
                throw new Error('database is locked');
            }),
        });

        await expect(
            resolveChannelProgramMappings(['bbc.one.uk'])
        ).resolves.toEqual(new Map());
    });
});
```

Run: `pnpm exec jest --config apps/electron-backend/jest.config.ts apps/electron-backend/src/app/events/epg-channel-program-mapping.spec.ts`
Expected: FAIL, `Cannot find module './epg-channel-program-mapping'`.

- [ ] **Step 2: Create the timeline's mapping lookup**

`apps/electron-backend/src/app/events/epg-channel-program-mapping.ts` (the body of the deleted `EpgQueryService.getMapping`, `epg-query.service.ts:911-973` at `002faebb0`):

```ts
import { eq, sql } from 'drizzle-orm';
import { getDatabase, type DatabaseInstance } from '../database/connection';
import * as schema from '../database/schema';

/**
 * Manual mappings for the single-channel timeline (`GET_CHANNEL_PROGRAMS`):
 * the direct lookup by channel key, then — for a key that is an Xtream
 * provider `epg_channel_id` — a mapping saved under the playlist-scoped
 * Xtream key of any stream sharing that id. The batch reads use
 * `resolveChannelIdsStrict` (direct lookups only), as before. A failed
 * lookup leaves its key unmapped.
 */
export async function resolveChannelProgramMappings(
    channelKeys: string[]
): Promise<Map<string, string>> {
    const db = await getDatabase();
    const mappings = new Map<string, string>();
    for (const channelKey of channelKeys) {
        const mapped = await getChannelProgramMapping(db, channelKey);
        if (mapped) {
            mappings.set(channelKey, mapped);
        }
    }
    return mappings;
}

async function getChannelProgramMapping(
    db: DatabaseInstance,
    channelKey: string
): Promise<string | null> {
    try {
        // Direct lookup by channel key.
        const rows = await db
            .select({
                epgChannelId: schema.epgChannelMappings.epgChannelId,
            })
            .from(schema.epgChannelMappings)
            .where(eq(schema.epgChannelMappings.channelKey, channelKey))
            .limit(1);
        if (rows.length > 0) {
            return rows[0].epgChannelId;
        }

        // Fallback: the key may be an Xtream provider epg_channel_id
        // while the mapping was saved under the playlist-scoped Xtream
        // key. Resolve the owning streams (joined through categories for
        // the playlist ID) and look up their mapping keys in a single
        // join, so a mapping saved under any matching stream is found —
        // an earlier "check the first few" cap could silently miss a
        // mapping saved under a later stream sharing this epg_channel_id.
        //
        // The join key is built in SQL to mirror
        // buildXtreamEpgMappingKey(playlistId, xtreamId) →
        // `xtream:{playlistId}:{xtreamId}`; keep the two in sync.
        //
        // This layer only receives the provider epg_channel_id, not the
        // caller's playlist, so when the same id exists in several
        // playlists it cannot scope to the caller's own mapping — the
        // renderer resolves the playlist-scoped key directly and this is
        // a best-effort fallback. Order deterministically so the chosen
        // mapping is at least stable rather than storage-order dependent.
        const mapped = await db
            .select({
                epgChannelId: schema.epgChannelMappings.epgChannelId,
            })
            .from(schema.content)
            .innerJoin(
                schema.categories,
                eq(schema.content.categoryId, schema.categories.id)
            )
            .innerJoin(
                schema.epgChannelMappings,
                eq(
                    schema.epgChannelMappings.channelKey,
                    sql`'xtream:' || ${schema.categories.playlistId} || ':' || ${schema.content.xtreamId}`
                )
            )
            .where(eq(schema.content.epgChannelId, channelKey))
            .orderBy(schema.categories.playlistId, schema.content.xtreamId)
            .limit(1);
        if (mapped.length > 0) {
            return mapped[0].epgChannelId;
        }

        return null;
    } catch {
        return null;
    }
}
```

- [ ] **Step 3: Wire the queries for Electron**

`apps/electron-backend/src/app/events/epg-queries.ts` (`getAllEpgChannels` is the deleted `EpgQueryService.getAllChannels`, `epg-query.service.ts:322-345`):

```ts
import { createEpgQueries } from '@iptvnator/shared/epg-store';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';
import { epgLogger } from '../util/epg-logger';
import { resolveChannelProgramMappings } from './epg-channel-program-mapping';
import { resolveChannelIdsStrict } from './epg-mapping.service';

const loggerLabel = '[EPG Events]';

/** EPG reads for the IPC handlers, over the main database and its manual mappings. */
export const epgQueries = createEpgQueries({
    getDb: getDatabase,
    resolveMappings: resolveChannelIdsStrict,
});

/**
 * `GET_CHANNEL_PROGRAMS` only: its mapping lookup also finds a mapping
 * saved under an Xtream stream that shares the requested provider
 * `epg_channel_id` (`epg-channel-program-mapping.ts`). The batch reads
 * never did, so they keep `epgQueries`.
 */
export const epgChannelProgramQueries = createEpgQueries({
    getDb: getDatabase,
    resolveMappings: resolveChannelProgramMappings,
});

/** `EPG_GET_CHANNELS`: every XMLTV channel id and display name, by name. */
export async function getAllEpgChannels(): Promise<{
    channels: Array<{ id: string; displayName: string }>;
    programs: never[];
}> {
    try {
        const db = await getDatabase();
        const channels = await db
            .select({
                id: schema.epgChannels.id,
                displayName: schema.epgChannels.displayName,
            })
            .from(schema.epgChannels)
            .orderBy(schema.epgChannels.displayName);

        return { channels, programs: [] };
    } catch (error) {
        epgLogger.error(loggerLabel, 'Error getting all channels:', error);
        return { channels: [], programs: [] };
    }
}
```

- [ ] **Step 4: Let `epg-mapping.service.ts` supply only the lookup and the CRUD**

In `apps/electron-backend/src/app/events/epg-mapping.service.ts`:

1. Replace the module comment

```ts
/**
 * Manual EPG channel mapping resolution and CRUD, called at the IPC boundary
 * before EPG queries run. Every method fails soft: a mapping lookup must never
 * take down an EPG request, it just falls back to the unmapped channel id.
 */
```

with

```ts
/**
 * Manual EPG channel mapping lookups and CRUD. The CRUD handlers fail soft;
 * `resolveChannelIdsStrict` rejects, and `createEpgQueries` decides where a
 * failed lookup falls back to the unmapped channel id.
 */
```

2. Delete `resolveChannelIds` (with its doc comment) and `queryByResolvedChannelIds` (with its doc comment); `createEpgQueries` does both now (`libs/shared/epg-store/src/lib/queries/epg-mapping-resolution.ts`).
3. Replace the doc comment of `resolveChannelIdsStrict` with:

```ts
/**
 * Manual mappings for `epgQueries` (`epg-queries.ts`): channel key → EPG
 * channel id. A database failure rejects; the library falls back to the
 * unmapped keys for every read except guide coverage, which must stay
 * unknown rather than report a mapped channel as uncovered.
 */
```

In `apps/electron-backend/src/app/events/epg-mapping.service.spec.ts`:

1. In the import list replace `queryByResolvedChannelIds,` and `resolveChannelIds,` with `resolveChannelIdsStrict,`.
2. Delete the `failSoftCases` entry whose `name` is `'resolveChannelIds'`.
3. Replace the blocks `describe('resolveChannelIds', …)` and `describe('queryByResolvedChannelIds', …)` (their cases now live in `epg-mapping-resolution.spec.ts`) with:

```ts
    describe('resolveChannelIdsStrict', () => {
        it('returns the mapping batch keyed by original channel id', async () => {
            const mappings = new Map([['channel-a', 'epg-a']]);
            getEpgMappingsBatch.mockResolvedValue(mappings);

            await expect(
                resolveChannelIdsStrict(['channel-a'])
            ).resolves.toEqual(mappings);
            expect(getEpgMappingsBatch).toHaveBeenCalledWith(DB_HANDLE, [
                'channel-a',
            ]);
        });

        it('rejects when the lookup or the database fails', async () => {
            getEpgMappingsBatch.mockRejectedValue(OP_ERROR);
            await expect(resolveChannelIdsStrict(['channel-a'])).rejects.toBe(
                OP_ERROR
            );

            getDatabase.mockRejectedValue(DB_ERROR);
            await expect(resolveChannelIdsStrict(['channel-a'])).rejects.toBe(
                DB_ERROR
            );
        });
    });
```

- [ ] **Step 5: Point the IPC handlers at the library**

In `apps/electron-backend/src/app/events/epg.events.ts`:

1. Imports. Delete

```ts
import { epgQueryService } from './epg-query.service';
import { epgGuideQueryService } from './epg-guide-query.service';
```

and replace the `./epg-mapping.service` import

```ts
import {
    handleDeleteEpgMapping,
    handleGetEpgMapping,
    handleGetEpgMappingsBatch,
    handleSearchEpgChannels,
    handleSetEpgMapping,
    queryByResolvedChannelIds,
    resolveChannelIds,
    resolveChannelIdsStrict,
} from './epg-mapping.service';
```

with

```ts
import {
    handleDeleteEpgMapping,
    handleGetEpgMapping,
    handleGetEpgMappingsBatch,
    handleSearchEpgChannels,
    handleSetEpgMapping,
} from './epg-mapping.service';
import {
    epgChannelProgramQueries,
    epgQueries,
    getAllEpgChannels,
} from './epg-queries';
```

2. In the class comment replace `channel-mapping resolution and CRUD live in \`epg-mapping.service.ts\`.` with `channel-mapping CRUD lives in \`epg-mapping.service.ts\`; EPG reads go through \`epg-queries.ts\` (\`@iptvnator/shared/epg-store\`).`
3. Replace the handlers from `private static async handleGetChannelPrograms(` through the end of `handleGetGuideCoverage` (including `resolvedGuideKey` and the doc comments between them) with:

```ts
    private static async handleGetChannelPrograms(
        channelId: string,
        options?: { sourceUrls?: string[] }
    ): Promise<EpgProgram[]> {
        return epgChannelProgramQueries.getChannelPrograms(channelId, options);
    }

    private static async handleGetCurrentProgramsBatch(
        channelIds: string[],
        options?: ElectronBridgeCurrentProgramsOptions
    ): Promise<Record<string, EpgProgram | null>> {
        return epgQueries.getCurrentProgramsBatch(channelIds, options);
    }

    private static async handleGetAllChannels(): Promise<{
        channels: Array<{ id: string; displayName: string }>;
        programs: never[];
    }> {
        return getAllEpgChannels();
    }

    private static async handleGetChannelMetadata(
        channelIds: string[],
        options?: { sourceUrls?: string[] }
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        return epgQueries.getChannelMetadata(channelIds, options);
    }

    /**
     * Guide reads take playlist channel keys; `epgQueries` applies manual
     * mappings and keys the answer back by the requested key.
     */
    private static async handleGetGuidePrograms(
        args: ElectronBridgeEpgGuideWindow
    ): Promise<Record<string, EpgProgram[]>> {
        return epgQueries.getProgramsForChannels(args);
    }

    /** A thrown error rejects the renderer's `invoke`, which is the intended fail-open path for coverage. */
    private static async handleGetGuideCoverage(
        args: ElectronBridgeEpgGuideWindow
    ): Promise<string[]> {
        return epgQueries.getProgramCoverage(args);
    }
```

The handler names stay: `epg.events.spec.ts` calls `handleGetChannelPrograms` and `handleGetChannelMetadata` directly with a mocked `getDatabase`, and the same `select()` sequence still reaches it (mapping lookups first, then the programme queries).

- [ ] **Step 6: Search through the library**

Overwrite `apps/electron-backend/src/app/events/database/epg-db.events.ts`:

```ts
/**
 * EPG Database IPC event handlers
 *
 * Only the programme search is exposed to the renderer
 * (`window.electron.searchEpgPrograms`); it runs `searchPrograms` from
 * `@iptvnator/shared/epg-store`. All other EPG persistence and lookups run
 * through the EPG worker and the handlers registered in `epg.events.ts`.
 */

import { ipcMain } from 'electron';
import { epgQueries } from '../epg-queries';

const loggerLabel = '[EPG DB]';

ipcMain.handle(
    'EPG_DB_SEARCH_PROGRAMS',
    async (_event, searchTerm: string, limit = 50) => {
        try {
            return await epgQueries.searchPrograms(searchTerm, limit);
        } catch (error) {
            console.error(loggerLabel, 'Error searching EPG programs:', error);
            throw error;
        }
    }
);
```

`database/epg-db.events.spec.ts` keeps its cases: it mocks `../../database/connection`, which `epg-queries.ts` uses. Only its comment in the first case changes, from

```ts
        // Every other EPG persistence/lookup path lives in the EPG worker and
        // epg-query.service.ts; the removed EPG_DB_* handlers must not return.
```

to

```ts
        // Every other EPG persistence/lookup path lives in the EPG worker and
        // epg.events.ts (shared-epg-store); the removed EPG_DB_* handlers
        // must not return.
```

- [ ] **Step 7: Freshness through the library**

In `apps/electron-backend/src/app/events/epg-fetch.service.ts`:

1. Replace

```ts
import { eq } from 'drizzle-orm';
```

with

```ts
import {
    EPG_FRESHNESS_MAX_AGE_HOURS,
    isEpgSourceFresh,
} from '@iptvnator/shared/epg-store';
```

and delete `import * as schema from '../database/schema';`.

2. Replace

```ts
/** Age after which stored EPG data is refetched. */
export const EPG_FRESHNESS_MAX_AGE_HOURS = 12;
```

with

```ts
/** Age after which stored EPG data is refetched (12 h, from the library). */
export { EPG_FRESHNESS_MAX_AGE_HOURS };
```

3. In `checkEpgFreshness`, replace

```ts
            const result = await db
                .select({ updatedAt: schema.epgChannelSources.updatedAt })
                .from(schema.epgChannelSources)
                .where(eq(schema.epgChannelSources.sourceUrl, url))
                .limit(1);

            const isFresh =
                result.length > 0 &&
                result[0].updatedAt &&
                result[0].updatedAt >= cutoffTime;
```

with

```ts
            const isFresh = await isEpgSourceFresh(db, url, cutoffTime);
```

The generation checks around it, `markFetchedUrl` and the "all stale on failure" catch stay.

- [ ] **Step 8: Replace the guide IPC spec with a delegation test**

Overwrite `apps/electron-backend/src/app/events/epg-guide.events.spec.ts` (the remap cases moved to `libs/shared/epg-store/src/lib/queries/epg-guide-mapping.spec.ts`):

```ts
import type EpgEventsType from './epg.events';

const getProgramsForChannels = jest.fn();
const getProgramCoverage = jest.fn();
const ipcHandlers = new Map<
    string,
    (event: unknown, args: unknown) => Promise<unknown>
>();

jest.mock('../services/store.service', () => ({
    TRUSTED_LOCAL_EPG_SOURCES: 'TRUSTED_LOCAL_EPG_SOURCES',
    store: { get: jest.fn(), set: jest.fn() },
}));

jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => '/mock/app.asar',
    },
    BrowserWindow: {
        getAllWindows: () => [],
    },
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('./epg-queries', () => ({
    epgQueries: {
        getProgramsForChannels: (...args: unknown[]) =>
            getProgramsForChannels(...args),
        getProgramCoverage: (...args: unknown[]) => getProgramCoverage(...args),
    },
    epgChannelProgramQueries: {},
    getAllEpgChannels: jest.fn(),
}));

/**
 * `EPG_GET_PROGRAMS_FOR_CHANNELS` / `EPG_GET_PROGRAM_COVERAGE` hand the
 * renderer's guide window to `epgQueries`, which applies manual mappings
 * and keys the answer by the requested keys (shared-epg-store).
 */
describe('EPG guide IPC handlers', () => {
    let EpgEvents: typeof EpgEventsType;
    const guideWindow = { channelIds: ['m3u-key'], fromMs: 0, toMs: 1 };

    beforeEach(async () => {
        jest.resetModules();
        ipcHandlers.clear();
        getProgramsForChannels.mockReset();
        getProgramCoverage.mockReset();

        ({ default: EpgEvents } = await import('./epg.events'));

        const { ipcMain } = jest.requireMock('electron');
        (ipcMain.handle as jest.Mock).mockReset();
        (ipcMain.handle as jest.Mock).mockImplementation(
            (
                channel: string,
                handler: (event: unknown, args: unknown) => Promise<unknown>
            ) => {
                ipcHandlers.set(channel, handler);
            }
        );

        EpgEvents.bootstrapEpgEvents();
    });

    function invoke(channel: string, args: unknown): Promise<unknown> {
        const handler = ipcHandlers.get(channel);
        if (!handler) {
            throw new Error(`No IPC handler registered for "${channel}"`);
        }
        return handler({}, args);
    }

    it('answers guide programmes from the EPG queries', async () => {
        const answer = { 'm3u-key': [] };
        getProgramsForChannels.mockResolvedValue(answer);

        await expect(
            invoke('EPG_GET_PROGRAMS_FOR_CHANNELS', guideWindow)
        ).resolves.toBe(answer);
        expect(getProgramsForChannels).toHaveBeenCalledWith(guideWindow);
    });

    it('answers coverage from the EPG queries', async () => {
        getProgramCoverage.mockResolvedValue(['m3u-key']);

        await expect(
            invoke('EPG_GET_PROGRAM_COVERAGE', guideWindow)
        ).resolves.toEqual(['m3u-key']);
        expect(getProgramCoverage).toHaveBeenCalledWith(guideWindow);
    });

    it('rejects coverage when the EPG queries reject, keeping coverage unknown', async () => {
        getProgramCoverage.mockRejectedValue(new Error('mapping db down'));

        await expect(
            invoke('EPG_GET_PROGRAM_COVERAGE', guideWindow)
        ).rejects.toThrow('mapping db down');
    });
});
```

- [ ] **Step 9: Shrink the max-lines baseline**

```bash
node tools/eslint/generate-max-lines-baseline.mjs
git diff --stat tools/eslint/max-lines-baseline.mjs
git diff tools/eslint/max-lines-baseline.mjs | grep '^-    '
```

Expected: one deleted line, `-    'apps/electron-backend/src/app/events/epg-query.service.ts',`, and no added line.

- [ ] **Step 10: Run the whole backend suite, type checks and lint**

```bash
pnpm nx test electron-backend 2>&1 | tail -5
pnpm nx test shared-epg-store
pnpm run typecheck:backend
pnpm run typecheck:spec electron-backend
pnpm nx run-many -t lint -p electron-backend shared-epg-store
git grep -n -E "epg-query\.service|epg-guide-query\.service|epgQueryService|epgGuideQueryService|queryByResolvedChannelIds|resolveChannelIds[^S]" -- apps libs
```

Expected: `electron-backend` shows only the Task 2 baseline failures (in particular `epg.events.spec.ts`, `epg-mapping.events.spec.ts`, `database/epg-db.events.spec.ts`, `epg-worker.service*.spec.ts` pass unchanged); the library passes; type checks and lint clean; the grep prints only paths inside `libs/shared/epg-store`.

- [ ] **Step 11: Commit**

```bash
git add apps/electron-backend/src/app/events tools/eslint/max-lines-baseline.mjs
git commit -m "refactor(epg): Electron answers EPG reads through createEpgQueries

IPC handlers, programme search and freshness use shared-epg-store with
the main database and its manual mappings. The timeline keeps its Xtream
epg_channel_id mapping fallback in epg-channel-program-mapping.ts. The
epg-query.service.ts max-lines baseline entry is gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Streaming mode with a byte cap in `ValidatedHttpClient`

Independent of Tasks 3–14 (spec section 13); PR 3c's EPG opener is built on it. No server EPG wiring here.

**Files:**
- Modify: `apps/web-backend/src/app/validated-http-client.ts` (rewritten around a shared redirect loop)
- Modify: `apps/web-backend/src/app/provider-response.ts` (append)
- Modify: `apps/web-backend/src/app/provider-axios-transport.ts:78-87` (raw headers)
- Modify: `apps/web-backend/src/app/web-backend-app.spec-helpers.ts:27-133` (`StubHttpClient`)
- Test: `apps/web-backend/src/app/validated-http-client.spec.ts`, `apps/web-backend/src/app/validated-http-client.integration.spec.ts`

- [ ] **Step 1: Let the stub transport serve streams**

In `apps/web-backend/src/app/web-backend-app.spec-helpers.ts`:

1. Add `import { Readable } from 'node:stream';` after `import { Server } from 'node:http';`.
2. Add a field to `HttpRequest`, after `readonly url: string;`:

```ts
    /** `false` when the caller asked for the raw, still encoded body. */
    readonly decompress?: boolean;
```

3. In the `queuedResponses` element type, after `readonly headers?: { location?: string };`, add:

```ts
        readonly rawHeaders?: Record<string, string>;
```

4. Add after `queueRedirect`:

```ts
    /** A final body as the real transport delivers it: an unread stream. */
    queueStream(body: string | Buffer, rawHeaders: Record<string, string> = {}): void {
        this.queuedResponses.push({
            data: Readable.from([Buffer.from(body)]),
            rawHeaders,
        });
    }
```

5. In `get`, replace

```ts
        this.requests.push({
            headers: options.headers,
            params: options.params,
            timeout: options.timeout,
            url,
        });
```

with

```ts
        this.requests.push({
            headers: options.headers,
            params: options.params,
            timeout: options.timeout,
            url,
            ...(options.decompress === undefined
                ? {}
                : { decompress: options.decompress }),
        });
```

and the final `return` with

```ts
        return {
            data: response.data as T,
            status: response.status ?? 200,
            headers: response.headers ?? {},
            rawHeaders: response.rawHeaders,
        };
```

- [ ] **Step 2: Write the failing unit tests**

In `apps/web-backend/src/app/validated-http-client.spec.ts`, add `import { Readable } from 'node:stream';` and `import { PROVIDER_BODY_TOO_LARGE_CODE, ProviderBodyTooLargeError } from './provider-response';` to the imports, and append:

```ts
describe('validated HTTP streaming mode', () => {
    async function readText(stream: Readable): Promise<string> {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks).toString('utf8');
    }

    it('keeps the redirect policy, asks for the raw body and returns the final hop', async () => {
        const transport = new StubHttpClient();
        transport.queueRedirect('https://cdn.example/guide.xml.gz');
        transport.queueStream('<tv></tv>', {
            'content-type': 'application/gzip',
        });

        const result = await new ValidatedHttpClient(policy, transport).stream(
            'https://provider.example/guide',
            {
                headers: { Authorization: 'Bearer secret', 'User-Agent': 'player' },
                maxBytes: 1024,
                timeout: 1234,
            }
        );

        expect(result).toMatchObject({
            requestUrl: 'https://provider.example/guide',
            finalUrl: 'https://cdn.example/guide.xml.gz',
            status: 200,
            headers: { 'content-type': 'application/gzip' },
        });
        expect(await readText(result.stream)).toBe('<tv></tv>');
        expect(transport.requests.map((request) => request.decompress)).toEqual([
            false,
            false,
        ]);
        expect(transport.requests[1]).toMatchObject({
            url: 'https://cdn.example/guide.xml.gz',
            timeout: 1234,
        });
        // Cross-origin hop: credentials are stripped, as in get().
        expect(transport.requests[1].headers).toEqual({
            'User-Agent': 'player',
        });
    });

    it('rejects a sixth redirect before its destination', async () => {
        const transport = new StubHttpClient();
        for (let i = 0; i < 6; i++) transport.queueRedirect(`/hop${i}`);

        await expect(
            new ValidatedHttpClient(policy, transport).stream(
                'https://provider.example/start',
                { maxBytes: 1024 }
            )
        ).rejects.toMatchObject({
            policyError: { status: 502, message: 'Too many redirects' },
        });
        expect(transport.requests).toHaveLength(6);
    });

    it('fails the body once it passes maxBytes', async () => {
        const transport = new StubHttpClient();
        transport.queueStream(Buffer.alloc(10));

        const result = await new ValidatedHttpClient(policy, transport).stream(
            'https://provider.example/guide.xml',
            { maxBytes: 4 }
        );

        const failure = await readText(result.stream).catch(
            (error: unknown) => error
        );
        expect(failure).toBeInstanceOf(ProviderBodyTooLargeError);
        expect(failure).toMatchObject({
            code: PROVIDER_BODY_TOO_LARGE_CODE,
            maxBytes: 4,
        });
    });
});
```

Run: `pnpm nx test web-backend --testPathPatterns=validated-http-client.spec`
Expected: FAIL: `stream` is not a function and `ProviderBodyTooLargeError` is not exported.

- [ ] **Step 3: Add the stream limiter**

Append to `apps/web-backend/src/app/provider-response.ts`, and change its imports to `import { Socket } from 'node:net';` and `import { pipeline, Readable, Transform } from 'node:stream';`:

```ts
/** `code` of `ProviderBodyTooLargeError`; callers classify the failure by it. */
export const PROVIDER_BODY_TOO_LARGE_CODE = 'ERR_PROVIDER_BODY_TOO_LARGE';

/** A streamed provider body carried more bytes than the caller allows. */
export class ProviderBodyTooLargeError extends Error {
    readonly code = PROVIDER_BODY_TOO_LARGE_CODE;

    constructor(readonly maxBytes: number) {
        super(`Provider response body exceeds ${maxBytes} bytes`);
        this.name = 'ProviderBodyTooLargeError';
    }
}

export interface ProviderStreamLimits {
    readonly maxBytes: number;
    readonly timeout?: number;
    readonly socket?: Socket;
    readonly signal?: AbortSignal;
}

/**
 * A final body handed to the caller unread, with the guarantees
 * `readProviderBody` gives a buffered one: the native socket's inactivity
 * timer stays armed until the stream closes (axios stops its own timeout at
 * headers) and the caller's signal still cancels it. More than `maxBytes`
 * wire bytes fail it with `ProviderBodyTooLargeError`. Destroying the
 * returned stream destroys the response.
 */
export function limitProviderStream(
    source: Readable,
    limits: ProviderStreamLimits
): Readable {
    const { maxBytes, timeout, socket, signal } = limits;
    let received = 0;
    const limited = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length;
            if (received > maxBytes) {
                callback(new ProviderBodyTooLargeError(maxBytes));
                return;
            }
            callback(null, chunk);
        },
    });
    const onTimeout = () =>
        limited.destroy(
            Object.assign(new Error('Provider response body timed out'), {
                code: 'ECONNABORTED',
            })
        );
    const onAbort = () =>
        limited.destroy(
            Object.assign(new Error('Provider request aborted'), {
                code: 'ERR_CANCELED',
            })
        );
    if (timeout && socket) socket.setTimeout(timeout, onTimeout);
    signal?.addEventListener('abort', onAbort, { once: true });
    limited.once('close', () => {
        if (timeout && socket) {
            socket.removeListener('timeout', onTimeout);
            socket.setTimeout(0);
        }
        signal?.removeEventListener('abort', onAbort);
    });
    // pipeline destroys the response when the limit fails or the caller
    // destroys `limited`; response errors surface on `limited`.
    pipeline(source, limited, () => undefined);
    if (signal?.aborted) onAbort();
    return limited;
}
```

- [ ] **Step 4: Hand all response headers through the transport**

In `apps/web-backend/src/app/provider-axios-transport.ts`, replace the final `return` of `get` (lines 78–86) with:

```ts
        return {
            ...response,
            headers: {
                location:
                    typeof response.headers['location'] === 'string'
                        ? response.headers['location']
                        : undefined,
            },
            rawHeaders: plainHeaders(response.headers),
        };
```

and add at the end of the file:

```ts
/** Axios headers as a plain lower-case record (`AxiosHeaders` carries methods). */
function plainHeaders(
    headers: unknown
): Record<string, string | string[] | undefined> {
    const source =
        typeof (headers as { toJSON?: unknown } | undefined)?.toJSON ===
        'function'
            ? (headers as { toJSON(): Record<string, unknown> }).toJSON()
            : ((headers ?? {}) as Record<string, unknown>);
    return Object.fromEntries(
        Object.entries(source).map(([name, value]) => [
            name.toLowerCase(),
            Array.isArray(value)
                ? value.map(String)
                : value === undefined || value === null
                  ? undefined
                  : String(value),
        ])
    );
}
```

- [ ] **Step 5: Add the streaming mode on the shared redirect loop**

Overwrite `apps/web-backend/src/app/validated-http-client.ts`. `get` behaves exactly as before; its loop becomes `follow`, which `stream` reuses.

```ts
import { ProviderAxiosTransport } from './provider-axios-transport';
import {
    discardProviderBody,
    discardProviderErrorBody,
    limitProviderStream,
    readProviderBody,
} from './provider-response';
import axios, { AxiosRequestConfig } from 'axios';
import { Agent as HttpAgent, ClientRequest } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import { ProviderRequestError } from './provider-request-error';
import { ProviderUrlPolicy, validateProviderUrl } from './provider-url-policy';

export interface WebBackendHttpGetOptions {
    readonly headers?: Record<string, string>;
    readonly params?: Record<string, string>;
    readonly responseType?: 'arraybuffer';
    readonly timeout?: number;
    readonly signal?: AbortSignal;
    /**
     * Called once a hop's TCP connection is established. The host guard uses
     * it to tell a provider that never accepted the connection from one that
     * accepted it and then went silent. Honoured by the transport, which owns
     * the `ClientRequest` (see `ProviderAxiosTransport`).
     */
    readonly onConnect?: () => void;
}

export interface WebBackendHttpStreamOptions
    extends Omit<WebBackendHttpGetOptions, 'responseType'> {
    /** Wire bytes the final body may carry; more fail it with `ProviderBodyTooLargeError`. */
    readonly maxBytes: number;
}

export type ProviderTransportOptions = Omit<
    WebBackendHttpGetOptions,
    'responseType'
> &
    Pick<
        AxiosRequestConfig,
        | 'responseType'
        | 'maxRedirects'
        | 'validateStatus'
        | 'httpAgent'
        | 'httpsAgent'
        | 'proxy'
        | 'adapter'
        | 'decompress'
    >;

export interface WebBackendHttpResponse<T> {
    readonly data: T;
    readonly status: number;
    readonly statusText?: string;
    readonly request?: ClientRequest;
    readonly headers: { readonly location?: string };
    /** Every response header, lower-case; the streaming mode hands them over. */
    readonly rawHeaders?: Readonly<
        Record<string, string | string[] | undefined>
    >;
}

/** A final 2xx response whose body has not been read. */
export interface WebBackendHttpStream {
    readonly stream: Readable;
    /** The URL the caller asked for. */
    readonly requestUrl: string;
    /** The URL of the hop that answered, after redirects. */
    readonly finalUrl: string;
    readonly headers: Readonly<Record<string, string | string[] | undefined>>;
    readonly status: number;
}

/** Injected transports must honor the same options and status contract as axios. */
export interface WebBackendHttpClient {
    get<T>(
        url: string,
        options?: ProviderTransportOptions
    ): Promise<WebBackendHttpResponse<T>>;
}

/**
 * Builds the caller's result from the final hop. `keepAgents` hands the
 * hop's pinned agents to a body that outlives the request.
 */
type FinalHop<T, R> = (
    response: WebBackendHttpResponse<T>,
    sentUrl: URL,
    keepAgents: (body: Readable) => void
) => Promise<R> | R;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = new Set([
    'authorization',
    'cookie',
    'proxy-authorization',
    'sn',
]);

export class ValidatedHttpClient implements WebBackendHttpClient {
    constructor(
        private readonly policy: ProviderUrlPolicy,
        private readonly transport: WebBackendHttpClient = new ProviderAxiosTransport()
    ) {}

    async get<T>(
        rawUrl: string,
        options: WebBackendHttpGetOptions = {}
    ): Promise<WebBackendHttpResponse<T>> {
        return this.follow<T, WebBackendHttpResponse<T>>(
            rawUrl,
            options,
            {},
            async (response) => {
                try {
                    return {
                        ...response,
                        data: await readProviderBody(
                            response.data,
                            options.responseType === 'arraybuffer',
                            options.timeout,
                            response.request?.socket ?? undefined
                        ),
                    };
                } catch (error) {
                    if (axios.isCancel(error)) throw error;
                    // A broken/stalled body still proves the endpoint
                    // answered. Preserve buffered axios error semantics.
                    throw Object.assign(
                        new Error('Provider response body failed'),
                        {
                            cause: error,
                            response: {
                                status: response.status,
                                statusText: response.statusText,
                            },
                        }
                    );
                }
            }
        );
    }

    /**
     * Streaming GET for large bodies such as XMLTV, under the same per-hop
     * policy as `get`. Resolves at the final 2xx headers with the raw body
     * (not decompressed). The body keeps the socket inactivity timer and the
     * caller's signal, fails past `maxBytes` and owns the hop's agents until
     * it closes, so the caller must read or destroy it.
     */
    async stream(
        rawUrl: string,
        options: WebBackendHttpStreamOptions
    ): Promise<WebBackendHttpStream> {
        const { maxBytes, ...requestOptions } = options;
        return this.follow<Readable, WebBackendHttpStream>(
            rawUrl,
            requestOptions,
            { decompress: false },
            (response, sentUrl, keepAgents) => {
                const stream = limitProviderStream(response.data, {
                    maxBytes,
                    timeout: options.timeout,
                    socket: response.request?.socket ?? undefined,
                    signal: options.signal,
                });
                keepAgents(stream);
                return {
                    stream,
                    requestUrl: rawUrl,
                    finalUrl: sentUrl.href,
                    headers: response.rawHeaders ?? {},
                    status: response.status,
                };
            }
        );
    }

    private async follow<T, R>(
        rawUrl: string,
        options: WebBackendHttpGetOptions,
        transportOptions: Pick<ProviderTransportOptions, 'decompress'>,
        finalHop: FinalHop<T, R>
    ): Promise<R> {
        let currentUrl = rawUrl;
        let params = options.params;
        let headers = options.headers;
        let initialResponded = false;
        const visited = new Set<string>();
        try {
            for (let redirects = 0; ; redirects++) {
                options.signal?.throwIfAborted();
                const target = await validateProviderUrl(
                    currentUrl,
                    this.policy
                );
                options.signal?.throwIfAborted();
                if ('message' in target) {
                    throw new ProviderRequestError(
                        initialResponded,
                        target.lookupError,
                        target
                    );
                }
                // Match axios serialization once. Location is resolved against
                // the URL actually sent; original params are never replayed.
                const sentUrl = new URL(
                    axios.getUri({ url: target.url.href, params })
                );
                sentUrl.hash = '';
                if (visited.has(sentUrl.href))
                    throw redirectError('Redirect cycle detected');
                visited.add(sentUrl.href);
                const lookup = pinnedLookup(target.addresses);
                // Fresh agents prevent socket-pool reuse across validations.
                // Empty proxyEnv also disables Node's native env proxy support.
                const agentOptions = { lookup, proxyEnv: {} };
                const httpAgent = new HttpAgent(agentOptions);
                const httpsAgent = new HttpsAgent(agentOptions);
                let agentsKept = false;
                const keepAgents = (body: Readable) => {
                    agentsKept = true;
                    body.once('close', () => {
                        httpAgent.destroy();
                        httpsAgent.destroy();
                    });
                };
                let response: WebBackendHttpResponse<T>;
                try {
                    response = await this.transport.get<T>(target.url.href, {
                        ...options,
                        ...transportOptions,
                        headers,
                        params,
                        adapter: 'http',
                        proxy: false,
                        maxRedirects: 0,
                        responseType: 'stream',
                        httpAgent,
                        httpsAgent,
                        validateStatus: (status) =>
                            REDIRECT_STATUSES.has(status) ||
                            (status >= 200 && status < 300),
                    });
                    if (!REDIRECT_STATUSES.has(response.status)) {
                        return await finalHop(response, sentUrl, keepAgents);
                    }
                    initialResponded = true;
                    discardProviderBody(response.data);
                } catch (error) {
                    discardProviderErrorBody(error);
                    throw error;
                } finally {
                    if (!agentsKept) {
                        httpAgent.destroy();
                        httpsAgent.destroy();
                    }
                }
                if (redirects >= 5) throw redirectError('Too many redirects');
                const location = response.headers.location;
                if (!location)
                    throw redirectError(
                        'Redirect response did not include a location'
                    );
                let nextUrl: URL;
                try {
                    nextUrl = new URL(location, sentUrl);
                } catch {
                    throw redirectError('Redirect location is not a valid URL');
                }
                if (nextUrl.origin !== sentUrl.origin) {
                    headers = Object.fromEntries(
                        Object.entries(headers ?? {}).filter(
                            ([name]) =>
                                !SENSITIVE_HEADERS.has(name.toLowerCase()) &&
                                name.toLowerCase() !== 'host'
                        )
                    );
                }
                params = undefined;
                currentUrl = nextUrl.href;
            }
        } catch (error) {
            if (error instanceof ProviderRequestError) throw error;
            throw new ProviderRequestError(initialResponded, error);
        }
    }
}

function redirectError(message: string): ProviderRequestError {
    return new ProviderRequestError(true, undefined, { message, status: 502 });
}

function pinnedLookup(addresses: readonly string[]): LookupFunction {
    const records = addresses.map((address) => ({
        address,
        family: isIP(address),
    }));
    return (_hostname, options, callback) => {
        const eligible = options.family
            ? records.filter((record) => record.family === options.family)
            : records;
        if (!eligible.length) {
            callback(
                Object.assign(
                    new Error('No validated address for the requested family'),
                    { code: 'ENOTFOUND' }
                ),
                []
            );
        } else if (options.all) {
            callback(null, eligible);
        } else {
            callback(null, eligible[0].address, eligible[0].family);
        }
    };
}
```

- [ ] **Step 6: Run the unit tests**

Run: `pnpm nx test web-backend --testPathPatterns=validated-http-client.spec`
Expected: PASS, the existing redirect cases and the three streaming cases.

- [ ] **Step 7: Write the integration tests against real servers**

In `apps/web-backend/src/app/validated-http-client.integration.spec.ts`, add `import type { Readable } from 'node:stream';` and `import { PROVIDER_BODY_TOO_LARGE_CODE } from './provider-response';` to the imports and append after the existing `describe`:

```ts
describe('real axios validated transport, streaming mode', () => {
    async function readAll(stream: Readable): Promise<Buffer> {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    }

    it('hands over the raw final body and its headers after a pinned, validated redirect', async () => {
        const body = gzipSync(gzipSync('<tv></tv>'));
        const provider = express();
        provider.get('/start', (_req, res) => res.redirect('/guide.xml.gz'));
        provider.get('/guide.xml.gz', (req, res) => {
            res.set({
                'Content-Encoding': 'gzip',
                'Content-Type': 'application/gzip',
                'X-Host': String(req.headers.host),
            }).end(body);
        });
        await withServer(provider, async (url) => {
            const { port } = new URL(url);

            const result = await new ValidatedHttpClient(lan).stream(
                `http://provider.example:${port}/start`,
                { maxBytes: 1024 * 1024, timeout: 1_000 }
            );

            expect(result).toMatchObject({
                requestUrl: `http://provider.example:${port}/start`,
                finalUrl: `http://provider.example:${port}/guide.xml.gz`,
                status: 200,
                headers: expect.objectContaining({
                    'content-encoding': 'gzip',
                    'content-type': 'application/gzip',
                    'x-host': `provider.example:${port}`,
                }),
            });
            expect(await readAll(result.stream)).toEqual(body);
        });
    });

    it('fails the stream once the body passes maxBytes', async () => {
        const provider = express().use((_req, res) =>
            res.end(Buffer.alloc(4096, 0x61))
        );
        await withServer(provider, async (url) => {
            const result = await new ValidatedHttpClient(lan).stream(url, {
                maxBytes: 1024,
            });

            await expect(readAll(result.stream)).rejects.toMatchObject({
                code: PROVIDER_BODY_TOO_LARGE_CODE,
                maxBytes: 1024,
            });
        });
    });

    it('keeps the socket inactivity timer armed while the caller reads', async () => {
        const provider = express().use((_req, res) => {
            res.write('<tv>');
        });
        await withServer(provider, async (url) => {
            const result = await new ValidatedHttpClient(lan).stream(url, {
                maxBytes: 1024,
                timeout: 100,
            });

            await expect(readAll(result.stream)).rejects.toMatchObject({
                code: 'ECONNABORTED',
            });
        });
    });

    it('times out before headers like the buffered mode', async () => {
        const provider = express().use(() => {
            /* Deliberately silent synthetic provider. */
        });
        await withServer(provider, async (url) => {
            await expect(
                new ValidatedHttpClient(lan).stream(url, {
                    maxBytes: 1024,
                    timeout: 100,
                })
            ).rejects.toMatchObject({
                initialResponded: false,
                cause: { code: 'ECONNABORTED' },
            });
        });
    });

    it('cancels a streamed body when the caller aborts', async () => {
        const controller = new AbortController();
        const provider = express().use((_req, res) => {
            res.write('<tv>');
        });
        await withServer(provider, async (url) => {
            const result = await new ValidatedHttpClient(lan).stream(url, {
                maxBytes: 1024,
                signal: controller.signal,
            });
            controller.abort();

            await expect(readAll(result.stream)).rejects.toBeInstanceOf(Error);
        });
    });

    it('refuses a private target without the LAN opt-in', async () => {
        await expect(
            new ValidatedHttpClient({
                allowPrivateNetworkTargets: false,
                resolveHostname: async () => ['127.0.0.1'],
            }).stream('http://provider.example/guide.xml', { maxBytes: 1024 })
        ).rejects.toMatchObject({ policyError: { status: 400 } });
    });
});
```

- [ ] **Step 8: Run the backend suite, its type check and lint**

```bash
pnpm nx test web-backend
pnpm run typecheck:spec apps/web-backend
pnpm nx lint web-backend
```

Expected: all pass. The spec program type-checks `validated-http-client.ts` and `provider-response.ts` under the strict `web-backend` settings, and lint's `max-lines` rule (blank lines and comments not counted) sees about 276 lines in `validated-http-client.ts`.

- [ ] **Step 9: Commit**

```bash
git add apps/web-backend/src/app
git commit -m "feat(self-hosted): streaming mode with a byte cap in ValidatedHttpClient

stream() follows the same validated, pinned, manual redirects as get()
and returns the raw final body with its headers, capped by maxBytes and
guarded by the socket inactivity timer and the caller's signal.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Documentation

**Files:**
- Create: `libs/shared/epg-store/README.md`
- Modify: `docs/architecture/m3u-playlist-module.md`, `docs/architecture/sqlite-db-worker.md`, `docs/architecture/nx-workspace-boundaries.md`, `docs/architecture/pwa-self-hosted.md`, `docs/architecture/validation-map.md`, `docs/maintenance/agent-context-map.md`, `libs/shared/database/README.md`

Edit only the lines named here; never run whole-file Prettier on `docs/**` (AGENTS.md). After #1941/#1947 merged, some sentences quoted below may read slightly differently: change the sentence that carries the same fact.

- [ ] **Step 1: Library README**

Create `libs/shared/epg-store/README.md`:

```markdown
# shared-epg-store

`@iptvnator/shared/epg-store`: XMLTV import, EPG maintenance and EPG queries
for Node, used by the Electron EPG worker and main process and by the
self-hosted web backend. Renderer code must not import it; `eslint.config.mjs`
rejects the alias outside Node projects.

## API

- `ensureEpgSchema(db, { fts })`: the epg_* tables on a standalone database,
  from the DDL in `@iptvnator/shared/database/epg-schema-sql`. Idempotent.
- `runEpgImport({ url, db, openSource, signal, onProgress?, onPublishStart?, maxDecompressedBytes? })`:
  opens the source through the caller's `EpgSourceOpener`, decodes, parses,
  stages and publishes in one transaction. `onPublishStart` fires once right
  before that transaction, which reports no progress; stall watchdogs pause
  then. Empty, unparsable, too large and
  aborted imports throw `EpgImportError` (`EPG_IMPORT_ERROR_CODES`); other
  errors pass unchanged. Nothing is published when it throws.
- `clearAllEpgData(db)`, `clearEpgSource(db, url)`,
  `pruneEpgPrograms(db, { olderThanDays, now? })`.
- `createEpgQueries({ getDb, resolveMappings? })` returns `EpgQueries`;
  `createEpgDrizzle(db)` builds the handle for a standalone database.
- `isEpgSourceFresh`, `EPG_FRESHNESS_MAX_AGE_HOURS`, and `epgLogger`, which
  never logs URLs.
- `@iptvnator/shared/epg-store/testing`: `seedEpgSource()` for tests.

## Rules

- Callers own connections: they open them, set pragmas and close them.
- Nothing loads `better-sqlite3` at import time (`src/index.spec.ts`);
  `createEpgDrizzle()` loads drizzle's driver on its first call. The Electron
  worker registers its native search paths before that.
- Compiled with `strict`; production files stay under 300 lines.
- Tests run on real SQLite in Node: `pnpm nx test shared-epg-store`.

Contracts: [XMLTV pipeline ownership](../../../docs/architecture/m3u-playlist-module.md#xmltv-pipeline-ownership),
[DB worker](../../../docs/architecture/sqlite-db-worker.md),
[EPG DDL](../database/README.md#epg-ddl-epg-schema-sqlts).
```

- [ ] **Step 2: M3U module contract**

In `docs/architecture/m3u-playlist-module.md`:

1. Insert before `### XMLTV response compression`:

```markdown
### XMLTV pipeline ownership

The XMLTV import and the EPG reads are Node code in `libs/shared/epg-store`
(`@iptvnator/shared/epg-store`), shared by the desktop app and the
self-hosted web backend:

- `runEpgImport()` opens a source through a caller-supplied `EpgSourceOpener`,
  decodes it (`Content-Encoding`, gzip file hints, the optional second gzip
  layer, an optional decompressed-size cap), parses it with the SAX streaming
  parser, stages the batches and publishes them in one transaction; a
  caller's `onPublishStart` fires just before that transaction, which reports
  no progress, so stall watchdogs can pause. It never configures or closes
  the connection it is given. Its own failures carry
  `EpgImportError` codes (`epg_empty`, `epg_parse_failed`, `epg_too_large`,
  `epg_aborted`); opener, transport, zlib and SQLite errors pass unchanged.
- `clearAllEpgData()`, `clearEpgSource()` and `pruneEpgPrograms()` maintain
  the tables. `ensureEpgSchema()` creates them on a standalone database from
  `libs/shared/database/src/lib/epg-schema-sql.ts`, the same statements
  `initDatabase()` runs for the desktop database.
- `createEpgQueries({ getDb, resolveMappings })` answers channel programmes,
  current programmes, channel metadata, the guide window and coverage,
  programme search and freshness. A failed mapping lookup falls back to the
  unmapped keys, except for guide coverage, which rejects.

Electron keeps what is Electron-specific. `workers/epg-parser.worker.ts` loads
`better-sqlite3` from the native search paths, opens its connections with the
[shared pragmas](sqlite-db-worker.md#sqlite-concurrency-rules), builds its
opener (`workers/epg-source-opener.ts`: validated redirects, trust options,
authorized local files) and maps errors to the bridge's security codes; library
error codes are not forwarded to the renderer. `events/epg-queries.ts` wires
the queries to the main database and its manual mappings; the single-channel
timeline keeps its Xtream `epg_channel_id` mapping fallback
(`events/epg-channel-program-mapping.ts`). Fetch orchestration, generation
fences, workers and IPC stay in `events/`.
```

2. In `### XMLTV response compression`, replace `The Electron EPG worker decodes HTTP` with ``The XMLTV import (`runEpgImport`) decodes HTTP``, and in the UTF-8 paragraph replace `the parser worker uses a single UTF-8 stream` with `` `runEpgImport` uses a single UTF-8 stream``.
3. In `### Local XMLTV files`, replace the sentence below (it ends inside the line `` `.xml.gz` and an extension-less gzip file all parse. A missing file, a ``; keep `A missing file, …` that follows)

```markdown
In the worker, `openEpgSourceStream()` (`epg-source-stream.ts`) is the single
entry that yields decoded XMLTV bytes: remote sources still go through
`requestWithValidatedRedirects` with the private-network/TLS trust policy,
while local sources are read with `fs.createReadStream` behind the same
signature-sniffing optional gunzip stage the HTTP path uses, so `.xml`,
`.xml.gz` and an extension-less gzip file all parse.
```

with

```markdown
In the worker, `createElectronEpgSourceOpener()` (`workers/epg-source-opener.ts`)
is the single entry that opens a source for `runEpgImport`: remote sources
still go through `requestWithValidatedRedirects` with the private-network/TLS
trust policy and hand over the raw body and headers, while local sources are
read with `fs.createReadStream` and marked `kind: 'file'`, so the import runs
only the signature-sniffing optional gunzip stage and `.xml`, `.xml.gz` and an
extension-less gzip file all parse.
```

4. Replace `` (`EpgQueryService.isAiringAt`) `` with `` (`isAiringAt` in `libs/shared/epg-store/src/lib/queries/epg-query-scope.ts`) ``.
5. Replace `` (`apps/electron-backend/src/app/events/epg-guide-query.service.ts`) answers `` with `` (`libs/shared/epg-store/src/lib/queries/epg-guide-query.service.ts`) answers ``.
6. In `### XMLTV source lifecycle`, in the staging paragraph from #1941, replace `The parser worker stages incoming channel and programme batches` with `` `runEpgImport` stages incoming channel and programme batches`` and `Temporary rows disappear when the worker connection closes.` with `Temporary rows are dropped after the commit or failure, and with the connection.`; replace `Main-process and parser-worker diagnostics use \`epgLogger\`` with `` Main-process and parser-worker diagnostics use `epgLogger` (`@iptvnator/shared/epg-store`) ``.

- [ ] **Step 3: DB worker contract**

In `docs/architecture/sqlite-db-worker.md`:

1. In `### Deliberate direct-main exceptions`, replace item 3

```markdown
3. `apps/electron-backend/src/app/events/epg-fetch.service.ts`,
   `apps/electron-backend/src/app/events/epg-mapping.service.ts`, and
   `apps/electron-backend/src/app/events/epg-query.service.ts` keep EPG
   freshness, mapping, and lookup behavior in their focused main-process
   owners, while EPG parsing/import remains in its dedicated worker.
```

with

```markdown
3. `apps/electron-backend/src/app/events/epg-fetch.service.ts`,
   `apps/electron-backend/src/app/events/epg-mapping.service.ts`, and
   `apps/electron-backend/src/app/events/epg-queries.ts` keep EPG freshness,
   mapping, and lookup calls on the main process, while EPG parsing/import
   remains in its dedicated worker. The import and query code itself lives in
   `libs/shared/epg-store` ([XMLTV pipeline ownership](m3u-playlist-module.md#xmltv-pipeline-ownership)).
```

2. In the main-process EPG ownership list under `## SQLite Concurrency Rules`, replace item 5 and the paragraph after the list

```markdown
5. `apps/electron-backend/src/app/events/epg-query.service.ts` owns EPG
   channel/program database lookups, metadata resolution, and DB row mapping.

Keep worker lifecycle state out of the IPC registration layer. Add new EPG DB
lookup behavior to `epg-query.service.ts`; add new EPG worker/progress behavior
to `epg-worker.service.ts`.
```

with

```markdown
5. `apps/electron-backend/src/app/events/epg-queries.ts` creates the EPG reads
   (`createEpgQueries` from `@iptvnator/shared/epg-store`) over the main
   database and its manual mappings.

Keep worker lifecycle state out of the IPC registration layer. Add new EPG DB
lookup behavior to `libs/shared/epg-store/src/lib/queries/` (shared with the
self-hosted server); add new EPG worker/progress behavior to
`epg-worker.service.ts`.
```

3. In `### Worker bundling`, replace

```markdown
1. `@iptvnator/shared/database/schema`
2. `@iptvnator/shared/database/path-utils`

These aliases avoid importing the shared database barrel from inside the worker,
which would otherwise pull in runtime code that assumes the main Electron
process environment.
```

with

```markdown
1. `@iptvnator/shared/database/schema`
2. `@iptvnator/shared/database/path-utils`
3. `@iptvnator/shared/database/app-playlist`
4. `@iptvnator/shared/database/epg-schema-sql`
5. `@iptvnator/shared/epg-store`

These aliases avoid importing the shared database barrel from inside the worker,
which would otherwise pull in runtime code that assumes the main Electron
process environment. The EPG worker bundles `@iptvnator/shared/epg-store`; the
library loads `better-sqlite3` (through drizzle's driver) only inside
`createEpgDrizzle()`, never at import, because the worker registers its native
search paths first (`libs/shared/epg-store/src/index.spec.ts` guards this).
```

- [ ] **Step 4: Workspace boundaries**

In `docs/architecture/nx-workspace-boundaries.md`, after the paragraph about `libs/playback/data-access` (ending `only reached from lazy player and portal code.`), insert:

```markdown
`libs/shared/epg-store` is the `shared-epg-store` Nx project, imported through
`@iptvnator/shared/epg-store` (tags `scope:shared`, `domain:shared-runtime`,
`type:data-access`). It holds the XMLTV import pipeline, EPG maintenance and the
EPG queries for Node: the Electron EPG worker and main process, and the
self-hosted web backend. It is Node-only, and tags cannot express that
(`services`, a renderer library, carries the same three tags, as `web` and
`web-backend` share theirs), so `eslint.config.mjs` bans the alias with
`no-restricted-imports` for `apps/web/src`, `apps/remote-control-web/src` and
every `libs/**` file outside the library. It depends on
`@iptvnator/shared/database` only through the `schema` and `epg-schema-sql`
sub-entries: the EPG DDL stays in the database library because `initDatabase()`
creates it, and the database library never imports `epg-store` (the same lint
block rejects it). `@iptvnator/shared/epg-store/testing` exports test fixtures.
```

- [ ] **Step 5: PWA contract, validation map, context map, database README**

In `docs/architecture/pwa-self-hosted.md`, section `### Provider redirects and connection policy`, after the paragraph that ends with `inconclusive before any redirect.`, insert:

```markdown
`ValidatedHttpClient.stream()` is the streaming variant for large bodies such
as XMLTV feeds (server EPG, phase 3c). It runs the same per-hop validation, DNS
pinning, manual redirects (at most five), cross-origin header stripping and
header timeout, asks the transport for the raw body (`decompress: false`; the
caller decodes `Content-Encoding`) and resolves at the final 2xx headers with
`{ stream, requestUrl, finalUrl, headers, status }`. The stream keeps the
native socket inactivity timer and the caller's abort signal, fails with
`ProviderBodyTooLargeError` (`PROVIDER_BODY_TOO_LARGE_CODE`, `ERR_PROVIDER_BODY_TOO_LARGE`) after `maxBytes`
wire bytes, and holds the hop's pinned agents until it closes, so callers read
or destroy it.
```

In `docs/architecture/validation-map.md`, in the `## Unit And Type Checks` table, after the `Shared SQLite schema/connection` row, add:

```markdown
| EPG import pipeline and queries    | `pnpm nx test shared-epg-store`     |
```

In `docs/maintenance/agent-context-map.md`, in the row that starts `| M3U import/state/player, XMLTV,`, replace `` `libs/m3u-state`, `libs/playlist`, `libs/epg` `` with `` `libs/m3u-state`, `libs/playlist`, `libs/epg`, `libs/shared/epg-store` ``.

In `libs/shared/database/README.md`, after the `### Connection observer (\`connection-observer.ts\`)` section, insert:

```markdown
### EPG DDL (`epg-schema-sql.ts`)
- `EPG_TABLE_STATEMENTS`, `EPG_PROGRAMS_FTS_STATEMENTS`, `EPG_COLUMN_MIGRATION_STATEMENTS`, `EPG_INDEX_MIGRATION_STATEMENTS` - the `epg_channels`, `epg_channel_sources` and `epg_programs` tables, their FTS5 table and triggers, and their migrations. `connection.ts` splices them into `initDatabase()` at their historical positions; `ensureEpgSchema()` in `@iptvnator/shared/epg-store` applies the same lists to a standalone EPG database (FTS optional). Importable as `@iptvnator/shared/database/epg-schema-sql`. Change EPG DDL only here: `epg-schema-sql.spec.ts` fails when `connection.ts` creates an imported-EPG table, index or trigger outside these lists. Manual mappings (`epg_channel_mappings`) are user data and stay in `connection.ts`.
```

- [ ] **Step 6: Validate guidance and commit**

```bash
pnpm run agents:validate
git diff --stat
git add libs/shared/epg-store/README.md docs/architecture/m3u-playlist-module.md docs/architecture/sqlite-db-worker.md docs/architecture/nx-workspace-boundaries.md docs/architecture/pwa-self-hosted.md docs/architecture/validation-map.md docs/maintenance/agent-context-map.md libs/shared/database/README.md
git commit -m "docs(epg): document shared-epg-store and the streaming HTTP mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `agents:validate` passes; the diff touches only the listed lines.

---

### Task 17: Full validation

**Files:** none (fixes go into the task that owns the file, as new commits).

- [ ] **Step 1: Type checks**

```bash
pnpm run typecheck:ci
pnpm run typecheck:spec
pnpm exec tsc -p libs/shared/epg-store/tsconfig.lib.json --noEmit
```

Expected: no errors.

- [ ] **Step 2: Unit tests and lint of every touched project**

```bash
node tools/testing/ensure-electron-binary.mjs
pnpm nx run-many -t test -p shared-epg-store database electron-backend web-backend
pnpm nx run-many -t lint -p shared-epg-store database electron-backend web-backend services web electron-backend-e2e
pnpm run coverage:policy:check
pnpm nx run electron-backend-e2e:test-performance-harness
```

Expected: everything passes except the `electron-backend` failures recorded in Task 2; no new lint errors.

- [ ] **Step 3: Coverage ratchet**

```bash
pnpm run coverage:ci
```

Expected: PASS. The moved code is now measured in `shared-epg-store`, whose specs cover it. If the merged ratchet drops, the report names the files; add library tests for their uncovered lines. Never lower a ratchet (`docs/architecture/validation-map.md`).

- [ ] **Step 4: Electron EPG end-to-end**

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/epg.e2e.ts
```

Expected: PASS: gzip imports (single and double, UTF-8 across chunks), M3U-declared sources, local files, refresh and clear flows (including #1947's Refresh All scenario), programme search and `getEpgChannels`.

- [ ] **Step 5: Packaging layout**

```bash
pnpm run package:app
pnpm run verify:package-layout -- macos arm64
```

Use `-- linux` or `-- windows` on those hosts. Expected: the verifier finds `epg-parser.worker.js` and `database.worker.js` and `better-sqlite3` in its unpacked location.

- [ ] **Step 6: Confirm the moves kept their history**

```bash
git diff -M --stat origin/master...HEAD | grep "=>"
git diff --name-only origin/master...HEAD | grep -v -E "^(libs/shared/epg-store|libs/shared/database|apps/electron-backend|apps/web-backend|docs/|tools/|eslint\.config\.mjs|tsconfig\.base\.json)"
```

Expected: the first command lists the renamed files from the file map; the second prints nothing.

---

### Task 18: Local review, push, pull request

**Files:** none.

- [ ] **Step 1: Bring in master if it moved**

```bash
git fetch origin
git merge origin/master
```

Expected: fast or clean merge. On conflicts in a moved file, apply the incoming change to the file's new location, then repeat Task 17 Steps 1–2.

- [ ] **Step 2: Local review gate (at most five rounds)**

```bash
git status --short   # must be empty: review the committed branch
codex review --base origin/master -c model_reasoning_effort=high
greptile review --json
```

Fix every finding as a new commit, then run both again on the new head. Stop when both are clean or the findings repeat; after five rounds ask the maintainer. If a CLI is unavailable, record that in the PR body (`docs/development/agent-workflow.md#local-review-before-a-pull-request`).

- [ ] **Step 3: Push once and open the pull request**

Fill the `electron-backend` line with the baseline failures from Task 2 (or "none"), then:

```bash
git push -u origin claude/server-epg-store
gh pr create --title "refactor(epg): move XMLTV import and queries into @iptvnator/shared/epg-store" --label no-release-note --body "$(cat <<'EOF'
## What changed

- New Node-only library `@iptvnator/shared/epg-store` (Nx `shared-epg-store`, tags `scope:shared`, `domain:shared-runtime`, `type:data-access`): `runEpgImport` with `EpgSourceOpener` and `onPublishStart`, `EpgImportError`, `ensureEpgSchema`, `clearAllEpgData`, `clearEpgSource`, `pruneEpgPrograms`, `createEpgQueries`, `createEpgDrizzle`, `epgLogger`, and `@iptvnator/shared/epg-store/testing`.
- The XMLTV pipeline (decoding, SAX parser, staged writer from #1941, source metadata, clears) and the EPG queries move there from `apps/electron-backend`. `epg-query.service.ts` (976 lines, baselined) is split into files under 300 lines; its max-lines baseline entry is removed.
- The epg_* DDL moves into `libs/shared/database/src/lib/epg-schema-sql.ts`, spliced back into `initDatabase()` at the same positions; `ensureEpgSchema` uses the same statements.
- Electron keeps its worker entry (thin, around `runEpgImport`), its opener (validated axios, trust options, authorized local files), error classification, fetch orchestration, generation fences and IPC.
- `ValidatedHttpClient.stream()` in `web-backend`: the same validated, pinned, manual redirects with a raw streamed body capped by `maxBytes` (`ProviderBodyTooLargeError`, code `PROVIDER_BODY_TOO_LARGE_CODE`).
- Lint keeps the library out of renderer code.

Move map changes found while refreshing against master: (list from Task 1, or "none").

## Why

Server-side EPG for the self-hosted PWA (phase 3, spec `docs/superpowers/specs/2026-10-15-server-epg-design.md`): PR 3c runs this import and these queries in `web-backend`. No behavior change for Electron.

## Release note

None: behavior-preserving refactor; label `no-release-note`.

## Checks

- `pnpm run typecheck:ci`, `pnpm run typecheck:spec`, strict `tsc` of the library: pass
- `pnpm nx test shared-epg-store`, `database`, `web-backend`: pass
- `pnpm nx test electron-backend`: same failures as unchanged master (baseline from Task 2)
- `pnpm run coverage:ci`: pass
- Electron EPG E2E (`electron-backend-e2e:e2e-ci--src/epg.e2e.ts`): pass
- Packaging layout (`verify:package-layout`): pass
- Lint of touched projects, `coverage:policy:check`, `agents:validate`, performance harness: pass
- Local review: Codex and Greptile clean on the pushed head

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Report**

Report to the maintainer: the PR link, every check with its result, skipped checks with reasons, the docs changed, the contract deviations at the top of this plan (PR 3c's plan depends on them), and that no release note was added because Electron behavior is unchanged.
