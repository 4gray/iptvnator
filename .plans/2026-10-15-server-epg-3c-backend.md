# Server EPG 3c: XMLTV Import and EPG API in web-backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With server storage, `web-backend` imports XMLTV guides itself (daily at `HH:MM`, after start for stale sources, and on demand) into `<IPTVNATOR_DATA_DIR>/databases/epg.db`, and serves them over `/v1/epg`, so PR 3d can give the PWA the M3U EPG surfaces. `IPTVNATOR_EPG` defaults to `off` in this PR.

**Architecture:** New modules in `apps/web-backend/src/app/epg/`, each under 300 lines. `openServerEpg()` (called from `main.ts` after storage opened) reads the environment, opens `epg.db` (renamed and recreated when unusable) and starts the EPG service: a source registry (server list in `app_state` ∪ `epg_urls` of M3U playlists), a scheduler, an import queue that runs one job at a time in a worker thread (`epg-import.worker.ts`, a second esbuild entry) on the `@iptvnator/shared/epg-store` library (PR 3b-2) with `ValidatedHttpClient.stream()`, status bookkeeping in the server-only table `server_epg_imports`, and query routes over `createEpgQueries`. `mountServerStorage` mounts `/v1/epg` behind the existing CORS, token guard and error envelope; `/v1/instance` reports `features.epg`.

**Tech Stack:** Express 5.3, better-sqlite3 13 (Node-API), Drizzle 0.45, `@iptvnator/shared/epg-store` (PR 3b-2), `node:worker_threads`, Jest 30 (modern fake timers), esbuild through `@nx/esbuild` (`additionalEntryPoints`), tsx 4 for source runs, Docker (node:24-alpine + nginx).

Spec: `docs/superpowers/specs/2026-10-15-server-epg-design.md` (sections 5, 6.2, 7, 10, 11, 12 "3c").
Overview and shared contracts B, C, D: `.plans/2026-10-15-server-epg.md`.
Precedent and style: `.plans/2026-10-11-server-storage-phase-2a-backend.md`.
Branch: `claude/server-epg-backend` from `origin/master` after PR 3b-2 merged. PR title `feat(self-hosted): XMLTV import and EPG API in web-backend`, label `no-release-note`.

---

## Contract deviations and assumptions

Items 1–3 are reconciled with the 3b-2 plan
(`.plans/2026-10-15-server-epg-3b2-epg-store.md`, "Contract deviations" and
Task 15); Task 0 checks the merged code against them. Items 4 onwards are
decisions of this plan.

1. **Streaming HTTP (3b-2 deviation 7, Task 15).**
   `ValidatedHttpClient.stream(url, { maxBytes, timeout?, signal?, headers?,
   params?, onConnect? })` resolves at the final 2xx headers with
   `WebBackendHttpStream { stream, requestUrl, finalUrl, headers, status }`.
   The body is not decompressed; `runEpgImport` decodes it. Failures before
   the headers are `ProviderRequestError` exactly as with `get()` (policy
   errors carry `policyError`, an HTTP error status `cause.response.status`).
   The returned stream fails with `ProviderBodyTooLargeError`, whose code
   `PROVIDER_BODY_TOO_LARGE_CODE = 'ERR_PROVIDER_BODY_TOO_LARGE'` is exported
   from `apps/web-backend/src/app/provider-response.ts`, past `maxBytes` wire
   bytes, and with code `ECONNABORTED` after `timeout` of socket inactivity
   (mapped to `epg_timeout`). The opener passes `maxBytes` equal to the
   decompressed cap (the wire is never larger) and a 120 s `timeout`
   (`EPG_SOCKET_TIMEOUT_MS`): some providers build `xmltv.php` for a minute
   before the first byte. Only `epg-source-opener.ts` and
   `epg-error-codes.ts` use these names.
2. **Library (contract B with 3b-2 deviations 2, 4, 5 and 6).** Used:
   `ensureEpgSchema`, `runEpgImport` (with `onPublishStart`, below),
   `EpgImportError`, `EPG_IMPORT_ERROR_CODES`, `clearAllEpgData`,
   `clearEpgSource`, `pruneEpgPrograms`, `createEpgDrizzle`,
   `createEpgQueries`, `epgLogger`, and the types `EpgQueries`,
   `EpgImportStats`, `EpgSourceOpener`. The Nx project is
   `shared-epg-store`. `runEpgImport` maps SAX errors to `epg_parse_failed`,
   the decoded-size cap to `epg_too_large`, an abort to `epg_aborted` and no
   channels to `epg_empty`; it lets opener, transport, zlib and SQLite errors
   through unchanged and never sets pragmas on, or closes, its connection
   (`openEpgConnection` sets WAL, `busy_timeout` and foreign keys; the job
   closes it). `epg-error-codes.ts` maps the pass-throughs: zlib (`Z_*`,
   such as `Z_DATA_ERROR` and `Z_BUF_ERROR`) → `epg_parse_failed`, transport
   → `epg_network`, `epg_timeout` (including `ECONNABORTED`) or
   `epg_too_large` (`ERR_PROVIDER_BODY_TOO_LARGE`), opener → policy, TLS,
   HTTP status, timeout or network, SQLite → unclassified (item 4). The
   worker reports any failure after an abort as `epg_aborted`, whatever was
   thrown. `EpgDrizzle` is structural and `createEpgDrizzle` loads drizzle's
   driver lazily: the service creates it once and reuses it
   (`getDb: () => drizzleDb`). The service's default logger writes through
   `epgLogger`, which drops anything URL-shaped. The query-route spec seeds
   through `runEpgImport` with an in-memory opener instead of
   `@iptvnator/shared/epg-store/testing`'s `seedEpgSource`: the XML fixture is
   shorter than `ParsedChannel`/`ParsedProgram` objects and also exercises
   staging and the publish.
3. **Publish phase.** 3b-2 adds `onPublishStart?: () => void` to
   `RunEpgImportOptions`, called right before the synchronous publish
   transaction. The worker posts `{ type: 'publishing' }` from it; the runner
   calls its optional `onPublishing` callback, and the queue calls
   `EpgJobWatch.suspendStall()`, which clears the stall timer and keeps
   `touch()` from re-arming it. The wall clock (60 min) still applies. The
   status keeps showing the source as `loading` meanwhile.
4. **Unclassified failures** (disk full, SQLite errors, a crashed worker):
   state `error` without `errorCode` (optional in contract C; 3d shows a
   generic message), stored as `unknown` in `server_epg_imports`. A worker
   that runs out of heap (`ERR_WORKER_OUT_OF_MEMORY`) reports
   `epg_too_large`.
5. **`ProviderUrlError.privateNetwork?: true`** is added in
   `provider-url-policy.ts`, so the XMLTV error mapping does not match the
   policy's message text. HTTP bodies are unchanged
   (`providerUrlErrorBody` copies only `message` and `status`).
6. **Worker location.** The entry stays at
   `apps/web-backend/src/app/epg/epg-import.worker.ts`. With
   `additionalEntryPoints`, esbuild writes outputs relative to the entries'
   common folder (`src/`), so the bundle holds
   `app/epg/epg-import.worker.cjs` beside `main.cjs`; one rule
   (`<dir of main>/app/epg/epg-import.worker.{cjs,ts}`) finds it in the
   bundle, under `node --import tsx` (Playwright), `pnpm tsx` (`serve`) and
   Jest. A `.ts` entry starts as an `eval` worker that registers
   `tsx/cjs/api` (resolved from the working directory, the workspace root in
   all three), with `execArgv: []` so a parent `--import tsx` is not loaded
   twice. The Dockerfile already copies the whole `dist/apps/web-backend`;
   it gains a build-time check for the worker file.
7. **Unforced imports** (decided). `POST /v1/epg/import` without `force`
   (`fetchEpg`) queues only stale sources (no success in 24 h, matching the
   daily schedule and the 3d plan; the desktop skips for 12 h). The
   "finished less than 60 s ago" drop applies to every request, forced or
   not (a superset of the spec).
8. **Shutdown order.** `epg.stop()` (scheduler, abort, ≤ 5 s, close
   `epg.db`) runs in parallel with `closeGracefully(server)` (also 5 s), then
   storage closes. Run in sequence they could take 10 s, which is Docker's
   default stop timeout.
9. **`revision`** starts at the start time in milliseconds, so it never
   repeats across restarts, and also moves after the nightly prune.
10. **Clear requests** need a JSON object: `{}` clears all data,
    `{ url: '' }` and a bodyless `POST` answer `400`. Every `/v1/epg` `POST`
    and `PUT` needs a JSON object body.
11. **Time zone in tests.** Jest copies `process.env`, so assigning `TZ` in a
    spec does not move `Intl`'s zone. The scheduler takes the zone as a
    parameter (default `processTimeZone()`); specs pass zones explicitly, and
    one spec starts a child `node` with `TZ` to pin how the process reads it.
    An invalid `TZ` falls back to `UTC`.
12. **`errorHost`** is set for network, HTTP, TLS, private-network, timeout
    and wire-cap failures, not for library failures (parse, zlib, empty
    feed, decoded size).
13. **Source cap order.** Global URLs first, then playlists by creation date
    and id; a new global URL can push a playlist source over the cap of 100,
    which clears its data.
14. **`IPTVNATOR_EPG=on` without storage** (decided): the backend starts
    without EPG (no exit) and logs one line only when the variable says `on`
    explicitly (`ServerEpgConfig.requested`); the default, `on` from 3d,
    stays quiet on a stateless backend.
15. **Clears and the nightly prune are queue jobs** in a worker thread too
    (the desktop clears in a worker as well): the main thread never blocks
    on a large delete or waits on the import's write lock, and writes only
    the small `server_epg_imports` rows between jobs. `POST /v1/epg/clear`
    answers once its job is done.

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `libs/shared/interfaces/src/lib/server-epg.contract.ts` | create | Contract C, verbatim |
| `libs/shared/interfaces/src/lib/server-storage.contract.ts` | modify | `ServerInstanceFeatures`, `features`, `epgDatabaseBytes` |
| `libs/shared/interfaces/src/index.ts` | modify | Export the contract |
| `apps/web-backend/src/app/provider-url-policy.ts` (+ spec) | modify | `privateNetwork` flag on the policy error |
| `apps/web-backend/src/app/epg/epg-config.ts` (+ spec) | create | `IPTVNATOR_EPG*` (contract D) |
| `apps/web-backend/src/app/epg/epg-database.ts` (+ spec) | create | Open/recover `epg.db`, `server_epg_imports` DDL |
| `apps/web-backend/src/app/epg/epg-import-records.ts` | create | `server_epg_imports` rows, staleness |
| `apps/web-backend/src/app/epg/epg-request-body.ts` | create | JSON body validators (400 `invalid_body`) |
| `apps/web-backend/src/app/epg/epg-settings.ts` (+ spec) | create | `server:epg-settings` in `app_state`, validation |
| `apps/web-backend/src/app/epg/epg-source-registry.ts` (+ spec) | create | Source set, owners, cap, diff |
| `apps/web-backend/src/app/epg/epg-scheduler.ts` (+ spec) | create | Next `HH:MM` in a zone, timers, catch-up |
| `apps/web-backend/src/app/epg/epg-worker-protocol.ts` | create | Job, message and runner types |
| `apps/web-backend/src/app/epg/epg-error-codes.ts` (+ spec) | create | Error → `ServerEpgErrorCode` + host |
| `apps/web-backend/src/app/epg/epg-import-queue.ts` (+ spec) | create | FIFO, coalescing, cancel, stop |
| `apps/web-backend/src/app/epg/epg-job-watch.ts` | create | Stall timer (suspended while publishing), wall clock, abort then terminate |
| `apps/web-backend/src/app/epg/fake-epg-job-runner.spec-helpers.ts` | create | Runner without threads for specs |
| `apps/web-backend/src/app/epg/epg-status.ts` (+ spec) | create | `ServerEpgStatus`, cached programme count |
| `apps/web-backend/src/app/epg/epg-source-opener.ts` | create | `EpgSourceOpener` on `ValidatedHttpClient.stream()` |
| `apps/web-backend/src/app/epg/epg-worker-job.ts` | create | One job on its own `epg.db` connection |
| `apps/web-backend/src/app/epg/epg-import.worker.ts` | create | Worker entry (second esbuild entry) |
| `apps/web-backend/src/app/epg/epg-worker-runner.ts` | create | Spawn, messages, abort, terminate, entry lookup |
| `apps/web-backend/src/app/epg/xmltv.spec-helpers.ts` | create | XMLTV fixtures, local feed server, `waitFor` |
| `apps/web-backend/src/app/epg/epg-import-worker.spec.ts` | create | Jobs in-thread and in real worker threads |
| `apps/web-backend/src/app/epg/epg-service.ts` (+ spec) | create | Wires registry, queue, scheduler, status, queries |
| `apps/web-backend/src/app/epg/open-server-epg.ts` (+ spec) | create | Env → service or `null`, logged failures |
| `apps/web-backend/src/app/epg/epg.spec-helpers.ts` | create | `withTempEpg`, `settle`, `silentLogger` |
| `apps/web-backend/src/app/epg/epg-settings-router.ts` | create | `GET|PUT /v1/epg/settings` |
| `apps/web-backend/src/app/epg/epg-import-router.ts` | create | `status`, `import` (202), `clear` |
| `apps/web-backend/src/app/epg/epg-query-router.ts` | create | `current`, `metadata`, `channel-programs`, `window`, `coverage`, `search` |
| `apps/web-backend/src/app/epg/mount-server-epg.ts` | create | `/v1/epg` with `no-store` and 256 KB JSON |
| `apps/web-backend/src/app/epg/epg-routes.spec.ts`, `epg-query-routes.spec.ts` | create | Route tests with `withServer` + `fetch` |
| `apps/web-backend/src/app/storage/mount-server-storage.ts` | modify | Mount EPG, playlist change hook |
| `apps/web-backend/src/app/storage/instance-router.ts` | modify | `features.epg`, `epgDatabaseBytes` |
| `apps/web-backend/src/app/storage/playlists-router.ts` | modify | Call `onPlaylistsChanged` after writes |
| `apps/web-backend/src/app/storage/storage-routes.spec.ts` | modify | Instance body with `features` |
| `apps/web-backend/src/app/web-backend-app.ts` | modify | `epg` option, passed to the mount (mounting lines only) |
| `apps/web-backend/src/main.ts` | modify | Start EPG, parallel shutdown |
| `apps/web-backend/project.json` | modify | `additionalEntryPoints` |
| `apps/web-backend/src/app/project-config.spec.ts` | modify | Worker entry and lookup agree |
| `docker/Dockerfile`, `docker/docker-compose.yml`, `docker/README.md` | modify | Worker check, env, docs |
| `docs/architecture/pwa-self-hosted.md`, `docs/architecture/validation-map.md` | modify | Routes, Server EPG section, check |

## Existing symbols this plan relies on

| Symbol | Where |
| --- | --- |
| `withTempStorage`, `m3uDocument` | `apps/web-backend/src/app/storage/server-storage.spec-helpers.ts:8`, `:29` |
| `withServer`, `StubHttpClient`, `resolvePublicHost` | `apps/web-backend/src/app/web-backend-app.spec-helpers.ts:165`, `:36`, `:148` |
| `createWebBackendApp`, `WebBackendAppOptions` | `apps/web-backend/src/app/web-backend-app.ts:85`, `:62` |
| `isPrivateNetworkProxyAllowed` (flag semantics mirrored) | `apps/web-backend/src/app/web-backend-app.ts:492-495` |
| `mountServerStorage`, `createInstanceRouter`, `createPlaylistsRouter` | `storage/mount-server-storage.ts:24`, `storage/instance-router.ts:10`, `storage/playlists-router.ts:11` |
| `ServerStorage`, `openServerStorage` | `storage/server-storage.ts:6`, `:14` |
| `ServerPlaylistRepository.getAppState` / `setAppState` | `storage/server-playlist-repository.ts:150`, `:160` |
| `StorageRequestError`, `toStorageErrorBody`, `describeStorageError`, `storageErrorHandler` | `storage/storage-route-errors.ts:8`, `:19`, `:74`, `:80` |
| `ValidatedHttpClient` | `apps/web-backend/src/app/validated-http-client.ts:68` |
| `ValidatedHttpClient.stream`, `WebBackendHttpStream` | added by 3b-2 Task 15 in `validated-http-client.ts` |
| `PROVIDER_BODY_TOO_LARGE_CODE`, `ProviderBodyTooLargeError` | added by 3b-2 Task 15 in `apps/web-backend/src/app/provider-response.ts` |
| `@iptvnator/shared/epg-store` (project `shared-epg-store`) | contract B plus 3b-2 deviations 2, 4, 5 and `onPublishStart` |
| `ProviderRequestError` | `apps/web-backend/src/app/provider-request-error.ts:4` |
| `ProviderUrlError`, `resolveHostname`, `privateAddressError` | `apps/web-backend/src/app/provider-url-policy.ts:9`, `:27`, `:95` |
| `collectProviderErrorCodes` | `apps/web-backend/src/app/provider-error.ts:40` |
| `closeGracefully` | `apps/web-backend/src/app/graceful-shutdown.ts:11` |
| `readServerStorageConfig`, `serverStorageConfigProblem` | `storage/storage-config.ts:26`, `:18` |
| `getIptvnatorDatabaseDirectory`, `IPTVNATOR_DATA_DIR_ENV` | `libs/shared/database/src/lib/path-utils.ts:37`, `:11` (aliases `tsconfig.base.json:157-166`) |
| `playlists` (`epgUrls`, `serverUrl`, `macAddress`, `dateCreated`) | `libs/shared/database/src/lib/schema.ts:26-57` |
| `DatabaseInstance` | `libs/shared/database/src/lib/connection.ts:33` |
| `ELECTRON_BRIDGE_SECURITY_ERROR_CODES`, `ElectronBridgeSecurityErrorCode` | `libs/shared/interfaces/src/lib/electron-api.interface.ts:111`, `:116` |
| `ElectronBridgeEpgGuideWindow`, `ElectronBridgeEpgProgressStats` | `electron-api.interface.ts:428`, `:440` |
| `EpgProgram` | `libs/shared/interfaces/src/lib/epg-program.model.ts:4` |
| `ServerInstanceInfo`, `ServerStorageStatusResponse` | `libs/shared/interfaces/src/lib/server-storage.contract.ts:30`, `:52` |
| `applyDefaultAutoSelectFamilyAttemptTimeout` | `libs/shared/host-health/src/lib/network-family-autoselection.ts:69` |
| Portal rule mirrored (`serverUrl || macAddress`) | `libs/services/src/lib/epg-source-settings.service.ts:115` |
| Desktop TLS code list mirrored | `apps/electron-backend/src/app/util/security-errors.ts:11-19` |
| Desktop search default limit 50 | `apps/electron-backend/src/app/events/database/epg-db.events.ts:60` |

Conventions for every task: run the commands from the worktree root;
before each commit run `pnpm exec prettier --write` on the TypeScript and
JSON files the task touched (never on `docs/**`, `AGENTS.md` or
`CLAUDE.md`); keep every production file below 300 lines.

---

### Task 0: Worktree, install and discovery

**Files:** none (no commit).

- [ ] **Step 1: Create the worktree from `origin/master` after 3b-2 merged**

```bash
git -C /Users/4gray/Code/iptvnator fetch origin
git -C /Users/4gray/Code/iptvnator worktree add .claude/worktrees/server-epg-backend -b claude/server-epg-backend origin/master
cd /Users/4gray/Code/iptvnator/.claude/worktrees/server-epg-backend
pnpm install --frozen-lockfile
pnpm nx show projects | grep -Ei 'web-backend|epg|shared-interfaces'
```

Expected: install succeeds; the list shows `web-backend`, `shared-interfaces` and the 3b-2 library project.

- [ ] **Step 2: Verify the 3b-2 library and the streaming mode**

```bash
pnpm nx show projects | grep -x shared-epg-store
grep -n '"@iptvnator/shared/epg-store' tsconfig.base.json
for symbol in ensureEpgSchema runEpgImport EpgImportError EPG_IMPORT_ERROR_CODES clearAllEpgData clearEpgSource pruneEpgPrograms createEpgDrizzle createEpgQueries epgLogger EpgQueries EpgImportStats EpgSourceOpener onPublishStart; do
  grep -rqw "$symbol" libs/shared/epg-store/src && echo "ok $symbol" || echo "MISSING $symbol"
done
grep -nE 'async stream\(|WebBackendHttpStream|maxBytes' apps/web-backend/src/app/validated-http-client.ts
grep -n 'PROVIDER_BODY_TOO_LARGE_CODE' apps/web-backend/src/app/provider-response.ts
grep -n '"additionalEntryPoints"' node_modules/@nx/esbuild/src/executors/esbuild/schema.json
```

Expected: the project and the aliases (main entry and `/testing`) exist, every symbol prints `ok` (`onPublishStart` is a `RunEpgImportOptions` field), `stream(` and `WebBackendHttpStream` are in `validated-http-client.ts`, `PROVIDER_BODY_TOO_LARGE_CODE` is exported from `provider-response.ts`, and `@nx/esbuild` lists `additionalEntryPoints`. For each difference, adapt the files named in "Contract deviations and assumptions" (items 1–3: `epg-source-opener.ts`, `epg-error-codes.ts`, `epg-worker-job.ts`, `epg-import.worker.ts`) before starting the task that creates them, and note it for the PR body.

- [ ] **Step 3: Baseline**

```bash
pnpm nx test web-backend
pnpm nx lint web-backend
```

Expected: both pass on the untouched branch.

---

### Task 1: HTTP contract

**Files:**
- Create: `libs/shared/interfaces/src/lib/server-epg.contract.ts`
- Modify: `libs/shared/interfaces/src/lib/server-storage.contract.ts`
- Modify: `libs/shared/interfaces/src/index.ts`

- [ ] **Step 1: Create the contract (contract C, verbatim)**

```ts
/**
 * HTTP contract of server-side EPG. Routes live under `/v1/epg` of the web
 * backend (`/api/v1/epg` behind the Docker nginx) and mirror the renderer's
 * EPG bridge. Source URLs and channel keys travel only in JSON bodies.
 */
import type {
    ElectronBridgeEpgProgressStats,
    ElectronBridgeSecurityErrorCode,
} from './electron-api.interface';

export const SERVER_EPG_ROUTES = {
    settings: '/v1/epg/settings',
    status: '/v1/epg/status',
    import: '/v1/epg/import',
    clear: '/v1/epg/clear',
    current: '/v1/epg/current',
    metadata: '/v1/epg/metadata',
    channelPrograms: '/v1/epg/channel-programs',
    window: '/v1/epg/window',
    coverage: '/v1/epg/coverage',
    search: '/v1/epg/search',
} as const;

export const SERVER_EPG_LIMITS = {
    settingsUrls: 50,
    importedSources: 100,
    currentKeys: 500,
    metadataKeys: 500,
    windowKeys: 100,
    coverageKeys: 2000,
    channelPrograms: 500,
    searchLimit: 50,
    bodyBytes: 256 * 1024,
} as const;

export const SERVER_EPG_DEFAULT_REFRESH_TIME = '04:00';

export const SERVER_EPG_ERROR_CODES = {
    HttpStatus: 'epg_http_status',
    Network: 'epg_network',
    Timeout: 'epg_timeout',
    TooLarge: 'epg_too_large',
    ParseFailed: 'epg_parse_failed',
    Empty: 'epg_empty',
    TooManySources: 'epg_too_many_sources',
} as const;

export type ServerEpgErrorCode =
    | (typeof SERVER_EPG_ERROR_CODES)[keyof typeof SERVER_EPG_ERROR_CODES]
    | ElectronBridgeSecurityErrorCode;

export interface ServerEpgSettings {
    readonly urls: readonly string[];
    readonly refreshTime: string; // "HH:MM", 24 h, server time zone
}

export interface ServerEpgSettingsUpdate {
    readonly urls?: readonly string[];
    readonly refreshTime?: string;
}

export type ServerEpgSourceState = 'idle' | 'queued' | 'loading' | 'error';

export interface ServerEpgSourceStatus {
    readonly url: string;
    readonly owners: { readonly global: boolean; readonly playlists: number };
    readonly state: ServerEpgSourceState;
    readonly queuePosition?: number;
    readonly stats?: ElectronBridgeEpgProgressStats; // while loading
    readonly lastAttemptAt?: string; // ISO
    readonly lastSuccessAt?: string; // ISO
    readonly channels?: number; // from the last success
    readonly programmes?: number;
    readonly errorCode?: ServerEpgErrorCode;
    readonly errorHost?: string;
}

export interface ServerEpgStatus {
    readonly revision: number;
    readonly refreshTime: string;
    readonly timeZone: string; // IANA name the server schedules in
    readonly nextRunAt: string | null; // ISO
    readonly sources: readonly ServerEpgSourceStatus[];
    readonly totals: {
        readonly programmes: number;
        readonly databaseBytes: number;
    };
}

export interface ServerEpgImportRequest {
    readonly urls?: readonly string[]; // omitted: every source
    readonly force?: boolean;
}

export interface ServerEpgClearRequest {
    readonly url?: string; // omitted: all data
}

export interface ServerEpgCurrentRequest {
    readonly channelIds: readonly string[];
    readonly sourceUrls?: readonly string[];
    readonly nowMs?: number;
}

export interface ServerEpgMetadataRequest {
    readonly channelIds: readonly string[];
    readonly sourceUrls?: readonly string[];
}

export interface ServerEpgChannelProgramsRequest {
    readonly channelId: string;
    readonly sourceUrls?: readonly string[];
}

export interface ServerEpgSearchRequest {
    readonly term: string;
    readonly limit?: number;
}
```

- [ ] **Step 2: Extend the storage contract**

In `libs/shared/interfaces/src/lib/server-storage.contract.ts`, replace

```ts
export interface ServerInstanceInfo {
    readonly service: 'iptvnator';
    readonly apiVersion: number;
    /** Stable per database; `null` without server storage. */
    readonly instanceId: string | null;
    readonly storage: 'server' | 'none';
    readonly auth: 'none' | 'token';
}
```

with

```ts
/** Optional server features; an older server sends no `features` at all. */
export interface ServerInstanceFeatures {
    /** `/v1/epg` is mounted (`IPTVNATOR_EPG=on` with server storage). */
    readonly epg?: boolean;
}

export interface ServerInstanceInfo {
    readonly service: 'iptvnator';
    readonly apiVersion: number;
    /** Stable per database; `null` without server storage. */
    readonly instanceId: string | null;
    readonly storage: 'server' | 'none';
    readonly auth: 'none' | 'token';
    readonly features?: ServerInstanceFeatures;
}
```

and replace

```ts
export interface ServerStorageStatusResponse {
    readonly playlists: number;
    readonly databaseBytes: number;
    readonly databasePath: string;
    readonly startedAt: string;
}
```

with

```ts
export interface ServerStorageStatusResponse {
    readonly playlists: number;
    readonly databaseBytes: number;
    readonly databasePath: string;
    readonly startedAt: string;
    /** `epg.db` with its WAL; only with server EPG. */
    readonly epgDatabaseBytes?: number;
}
```

- [ ] **Step 3: Export it**

In `libs/shared/interfaces/src/index.ts`, replace

```ts
export * from './lib/server-storage.contract';
```

with

```ts
export * from './lib/server-storage.contract';
export * from './lib/server-epg.contract';
```

- [ ] **Step 4: Verify and commit**

```bash
pnpm nx lint shared-interfaces
pnpm run typecheck:web
pnpm exec tsc -p apps/web-backend/tsconfig.app.json --noEmit
git add libs/shared/interfaces/src/lib/server-epg.contract.ts libs/shared/interfaces/src/lib/server-storage.contract.ts libs/shared/interfaces/src/index.ts
git commit -m "feat(interfaces): add the server EPG HTTP contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: no errors.

---

### Task 2: EPG configuration

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-config.ts`
- Test: `apps/web-backend/src/app/epg/epg-config.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import { readServerEpgConfig } from './epg-config';

const GIB = 1024 * 1024 * 1024;

describe('readServerEpgConfig', () => {
    it('keeps server EPG off by default', () => {
        expect(readServerEpgConfig({})).toEqual({
            enabled: false,
            requested: false,
            allowPrivateNetworks: false,
            maxDecompressedBytes: GIB,
        });
    });

    it('turns server EPG on only for on, 1 or true, and says it was asked for', () => {
        for (const value of ['on', ' ON ', '1', 'true']) {
            expect(readServerEpgConfig({ IPTVNATOR_EPG: value })).toMatchObject(
                { enabled: true, requested: true }
            );
        }
        for (const value of ['off', '0', 'yes', '']) {
            expect(readServerEpgConfig({ IPTVNATOR_EPG: value })).toMatchObject(
                { enabled: false, requested: false }
            );
        }
    });

    it('allows private networks with its own flag or the proxy flag', () => {
        expect(
            readServerEpgConfig({ IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS: '1' })
                .allowPrivateNetworks
        ).toBe(true);
        expect(
            readServerEpgConfig({
                IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS: 'true',
            }).allowPrivateNetworks
        ).toBe(true);
        expect(
            readServerEpgConfig({
                IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS: '0',
                IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS: '0',
            }).allowPrivateNetworks
        ).toBe(false);
    });

    it('reads a positive whole number of decompressed megabytes', () => {
        expect(
            readServerEpgConfig({ IPTVNATOR_EPG_MAX_MB: '64' })
                .maxDecompressedBytes
        ).toBe(64 * 1024 * 1024);
        for (const value of ['0', '-5', '1.5', 'lots']) {
            expect(
                readServerEpgConfig({ IPTVNATOR_EPG_MAX_MB: value })
                    .maxDecompressedBytes
            ).toBe(GIB);
        }
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=epg-config`
Expected: FAIL, `Cannot find module './epg-config'`.

- [ ] **Step 3: Implement**

```ts
/**
 * Server EPG environment (overview contract D). The service exists only
 * when `enabled` is set and server storage is open.
 */
export interface ServerEpgConfig {
    /** `IPTVNATOR_EPG`, or `EPG_ENABLED_BY_DEFAULT` when it is unset. */
    readonly enabled: boolean;
    /**
     * `IPTVNATOR_EPG` itself says on. Only then does a missing server
     * storage earn a log line; the default stays quiet.
     */
    readonly requested: boolean;
    /**
     * XMLTV fetches may reach loopback, LAN and reserved addresses:
     * `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS`, implied by the proxy's
     * `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS`.
     */
    readonly allowPrivateNetworks: boolean;
    /** Decompressed bytes one source may have (`IPTVNATOR_EPG_MAX_MB`). */
    readonly maxDecompressedBytes: number;
}

/** Server EPG when `IPTVNATOR_EPG` is unset: off until the PWA uses it (3d). */
export const EPG_ENABLED_BY_DEFAULT = false;
export const DEFAULT_EPG_MAX_MB = 1024;
const BYTES_PER_MB = 1024 * 1024;
const ENABLED_VALUES = new Set(['on', '1', 'true']);

export function readServerEpgConfig(
    env: Record<string, string | undefined> = process.env
): ServerEpgConfig {
    const megabytes = Number(env['IPTVNATOR_EPG_MAX_MB']);
    const mode = env['IPTVNATOR_EPG']?.trim().toLowerCase() || undefined;
    const requested = mode !== undefined && ENABLED_VALUES.has(mode);
    return {
        enabled: mode === undefined ? EPG_ENABLED_BY_DEFAULT : requested,
        requested,
        allowPrivateNetworks:
            isFlagSet(env['IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS']) ||
            isFlagSet(env['IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS']),
        maxDecompressedBytes:
            (Number.isInteger(megabytes) && megabytes > 0
                ? megabytes
                : DEFAULT_EPG_MAX_MB) * BYTES_PER_MB,
    };
}

/** The proxy's own test (`isPrivateNetworkProxyAllowed` in web-backend-app.ts). */
function isFlagSet(value: string | undefined): boolean {
    return value === '1' || value === 'true';
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns=epg-config
git add apps/web-backend/src/app/epg/epg-config.ts apps/web-backend/src/app/epg/epg-config.spec.ts
git commit -m "feat(web-backend): read the server EPG configuration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 4 tests.

---

### Task 3: Mark private-network policy errors

**Files:**
- Modify: `apps/web-backend/src/app/provider-url-policy.ts`
- Test: `apps/web-backend/src/app/provider-url-policy.spec.ts`

- [ ] **Step 1: Write the failing test**

In `provider-url-policy.spec.ts`, add this test inside `describe('provider URL policy', ...)`, after the test `'resolves and pins trusted LAN hosts while still rejecting schemes and credentials'`:

```ts
    it('marks private and local targets so callers can tell them apart', async () => {
        await expect(
            validateProviderUrl('http://127.0.0.1:8080/guide.xml', policy)
        ).resolves.toMatchObject({ status: 400, privateNetwork: true });
        await expect(
            validateProviderUrl('https://provider.example', {
                ...policy,
                resolveHostname: async () => ['10.0.0.5'],
            })
        ).resolves.toMatchObject({ privateNetwork: true });
        expect(
            await validateProviderUrl('http://user:secret@provider.example', policy)
        ).not.toHaveProperty('privateNetwork');
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=provider-url-policy`
Expected: FAIL, the received object has no `privateNetwork`.

- [ ] **Step 3: Implement**

In `provider-url-policy.ts`, replace

```ts
export interface ProviderUrlError {
    readonly message: string;
    readonly status: number;
    readonly lookupError?: unknown;
}
```

with

```ts
export interface ProviderUrlError {
    readonly message: string;
    readonly status: number;
    readonly lookupError?: unknown;
    /** The URL leads to a loopback, private or reserved address. */
    readonly privateNetwork?: true;
}
```

and replace

```ts
function privateAddressError(): ProviderUrlError {
    return {
        message: 'Provider URL points to a private or local network address',
        status: 400,
    };
}
```

with

```ts
function privateAddressError(): ProviderUrlError {
    return {
        message: 'Provider URL points to a private or local network address',
        status: 400,
        privateNetwork: true,
    };
}
```

- [ ] **Step 4: Run the policy and proxy specs, then commit**

```bash
pnpm nx test web-backend --testPathPatterns="provider-url-policy|web-backend-app"
git add apps/web-backend/src/app/provider-url-policy.ts apps/web-backend/src/app/provider-url-policy.spec.ts
git commit -m "refactor(web-backend): mark private-network URL policy errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS; the proxy specs that compare whole error bodies stay green because `providerUrlErrorBody` copies only `message` and `status`.

---

### Task 4: `epg.db` and import records

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-database.ts`
- Create: `apps/web-backend/src/app/epg/epg-import-records.ts`
- Test: `apps/web-backend/src/app/epg/epg-database.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import {
    existsSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPTVNATOR_DATA_DIR_ENV } from '@iptvnator/shared/database';
import { epgDatabasePath, openEpgDatabase } from './epg-database';
import { EpgImportRecords, isStaleRecord } from './epg-import-records';

const A = 'https://epg.example/a.xml';
const HOUR = 3_600_000;
const stats = { totalChannels: 2, totalPrograms: 30 };

describe('openEpgDatabase', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'iptvnator-epg-db-'));
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('lives in the databases folder of the data directory', () => {
        const previous = process.env[IPTVNATOR_DATA_DIR_ENV];
        process.env[IPTVNATOR_DATA_DIR_ENV] = dir;
        try {
            expect(epgDatabasePath()).toBe(join(dir, 'databases', 'epg.db'));
        } finally {
            if (previous === undefined) {
                delete process.env[IPTVNATOR_DATA_DIR_ENV];
            } else {
                process.env[IPTVNATOR_DATA_DIR_ENV] = previous;
            }
        }
    });

    it('creates the EPG schema without FTS, in WAL with incremental auto-vacuum', () => {
        const database = openEpgDatabase(join(dir, 'epg.db'));
        try {
            expect(database.db.pragma('auto_vacuum', { simple: true })).toBe(2);
            expect(database.db.pragma('journal_mode', { simple: true })).toBe(
                'wal'
            );
            const tables = (
                database.db
                    .prepare(
                        `SELECT name FROM sqlite_master WHERE type = 'table'`
                    )
                    .all() as { name: string }[]
            ).map(({ name }) => name);
            expect(tables).toEqual(
                expect.arrayContaining([
                    'epg_channels',
                    'epg_programs',
                    'server_epg_imports',
                ])
            );
            expect(tables).not.toContain('epg_programs_fts');
            expect(database.recoveredFrom).toBeNull();
            expect(database.sizeBytes()).toBeGreaterThan(0);
        } finally {
            database.close();
        }
    });

    it('keeps its rows when the server starts again', () => {
        const path = join(dir, 'epg.db');
        const first = openEpgDatabase(path);
        new EpgImportRecords(first.db).markSuccess(A, new Date(), stats);
        first.close();

        const second = openEpgDatabase(path);
        try {
            expect(second.recoveredFrom).toBeNull();
            expect(new EpgImportRecords(second.db).all().get(A)).toMatchObject({
                channels: 2,
                programmes: 30,
            });
            expect(second.db.pragma('auto_vacuum', { simple: true })).toBe(2);
            expect(
                readdirSync(dir).filter((name) => name.includes('broken'))
            ).toEqual([]);
        } finally {
            second.close();
        }
    });

    it('moves a file it cannot open aside and starts empty', () => {
        const path = join(dir, 'epg.db');
        writeFileSync(path, 'not a database '.repeat(512));

        const database = openEpgDatabase(
            path,
            () => new Date('2026-10-15T04:00:00.000Z')
        );
        try {
            expect(database.recoveredFrom).toBe(
                `${path}.broken-2026-10-15T04-00-00-000Z`
            );
            expect(
                readFileSync(String(database.recoveredFrom), 'utf8')
            ).toContain('not a database');
            expect(new EpgImportRecords(database.db).all().size).toBe(0);
        } finally {
            database.close();
        }
    });

    it('fails when the folder for the file does not exist', () => {
        expect(() => openEpgDatabase(join(dir, 'missing', 'epg.db'))).toThrow();
        expect(existsSync(join(dir, 'missing'))).toBe(false);
    });
});

describe('EpgImportRecords', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'iptvnator-epg-records-'));
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('keeps the last attempt, the last success and the last error per source', () => {
        const database = openEpgDatabase(join(dir, 'epg.db'));
        const records = new EpgImportRecords(database.db);
        try {
            records.markAttempt(A, new Date('2026-10-15T04:00:00.000Z'));
            records.markFailure(A, new Date('2026-10-15T04:01:00.000Z'), {
                code: 'epg_http_status',
                host: 'epg.example',
            });
            expect(records.all().get(A)).toEqual({
                sourceUrl: A,
                lastAttemptAt: '2026-10-15T04:00:00.000Z',
                lastSuccessAt: null,
                channels: null,
                programmes: null,
                errorCode: 'epg_http_status',
                errorHost: 'epg.example',
            });

            records.markSuccess(A, new Date('2026-10-15T04:05:00.000Z'), stats);
            records.markFailure(A, new Date('2026-10-16T04:01:00.000Z'), {
                code: 'epg_timeout',
            });
            expect(records.all().get(A)).toMatchObject({
                lastSuccessAt: '2026-10-15T04:05:00.000Z',
                channels: 2,
                programmes: 30,
                errorCode: 'epg_timeout',
                errorHost: null,
            });

            records.markSuccess(A, new Date('2026-10-16T04:05:00.000Z'), stats);
            expect(records.all().get(A)).toMatchObject({
                errorCode: null,
                errorHost: null,
            });

            records.markAttempt('https://epg.example/b.xml', new Date());
            records.delete(A);
            expect([...records.all().keys()]).toEqual([
                'https://epg.example/b.xml',
            ]);
            records.deleteAll();
            expect(records.all().size).toBe(0);
        } finally {
            database.close();
        }
    });

    it('calls a source stale without a success in the last 24 hours', () => {
        const now = Date.parse('2026-10-15T12:00:00.000Z');
        const record = (lastSuccessAt: string | null) => ({
            sourceUrl: A,
            lastAttemptAt: null,
            lastSuccessAt,
            channels: null,
            programmes: null,
            errorCode: null,
            errorHost: null,
        });

        expect(isStaleRecord(undefined, now)).toBe(true);
        expect(isStaleRecord(record(null), now)).toBe(true);
        expect(
            isStaleRecord(record(new Date(now - 23 * HOUR).toISOString()), now)
        ).toBe(false);
        expect(
            isStaleRecord(record(new Date(now - 25 * HOUR).toISOString()), now)
        ).toBe(true);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=epg-database`
Expected: FAIL, `Cannot find module './epg-database'`.

- [ ] **Step 3: Implement the database**

`apps/web-backend/src/app/epg/epg-database.ts`:

```ts
import Database from 'better-sqlite3';
import { existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getIptvnatorDatabaseDirectory } from '@iptvnator/shared/database/path-utils';
import { ensureEpgSchema } from '@iptvnator/shared/epg-store';

export const EPG_DATABASE_FILE = 'epg.db';

/**
 * Server-only table: how the last import of each source went. It lives in
 * epg.db beside the data it describes, so deleting the file resets both.
 */
export const SERVER_EPG_IMPORTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS server_epg_imports (
    source_url TEXT PRIMARY KEY NOT NULL,
    last_attempt_at TEXT,
    last_success_at TEXT,
    channels INTEGER,
    programmes INTEGER,
    error_code TEXT,
    error_host TEXT
)`;

export interface EpgDatabase {
    readonly db: Database.Database;
    readonly path: string;
    /** Where an unusable file was moved on open, else `null`. */
    readonly recoveredFrom: string | null;
    sizeBytes(): number;
    close(): void;
}

/** `<IPTVNATOR_DATA_DIR>/databases/epg.db`, next to `iptvnator.db`. */
export function epgDatabasePath(): string {
    return join(getIptvnatorDatabaseDirectory(), EPG_DATABASE_FILE);
}

/**
 * One connection to epg.db. The main thread opens it with `schema: true`;
 * the import worker opens its own without running the DDL again.
 */
export function openEpgConnection(
    path: string,
    options: { readonly schema: boolean }
): Database.Database {
    const db = new Database(path);
    try {
        db.pragma('busy_timeout = 5000');
        if (options.schema) {
            // Takes effect only while the file has no table yet.
            db.pragma('auto_vacuum = INCREMENTAL');
        }
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');
        if (options.schema) {
            ensureEpgSchema(db, { fts: false });
            db.exec(SERVER_EPG_IMPORTS_TABLE_SQL);
        }
        return db;
    } catch (error) {
        db.close();
        throw error;
    }
}

/**
 * Opens epg.db. It holds imported data only, so a file that cannot be
 * opened or migrated is moved to `epg.db.broken-<time>` and replaced by an
 * empty one; its sources import again on the catch-up run.
 */
export function openEpgDatabase(
    path: string = epgDatabasePath(),
    now: () => Date = () => new Date()
): EpgDatabase {
    let recoveredFrom: string | null = null;
    let db: Database.Database;
    try {
        db = openEpgConnection(path, { schema: true });
    } catch (error) {
        if (!existsSync(path)) {
            throw error;
        }
        recoveredFrom = moveAside(path, now());
        db = openEpgConnection(path, { schema: true });
    }

    return {
        db,
        path,
        recoveredFrom,
        sizeBytes: () => fileSize(path) + fileSize(`${path}-wal`),
        close: () => {
            if (!db.open) {
                return;
            }
            try {
                db.pragma('optimize');
            } catch {
                // Advisory; never block the close on it.
            }
            db.close();
        },
    };
}

function moveAside(path: string, at: Date): string {
    const target = `${path}.broken-${at.toISOString().replace(/[:.]/g, '-')}`;
    renameSync(path, target);
    for (const suffix of ['-wal', '-shm']) {
        if (existsSync(`${path}${suffix}`)) {
            renameSync(`${path}${suffix}`, `${target}${suffix}`);
        }
    }
    return target;
}

function fileSize(path: string): number {
    try {
        return statSync(path).size;
    } catch {
        return 0;
    }
}
```

- [ ] **Step 4: Implement the records**

`apps/web-backend/src/app/epg/epg-import-records.ts`:

```ts
import type Database from 'better-sqlite3';
import type { EpgImportStats } from '@iptvnator/shared/epg-store';

/** Without a success in this window a source is stale (catch-up, unforced imports). */
export const EPG_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface EpgImportRecord {
    readonly sourceUrl: string;
    readonly lastAttemptAt: string | null;
    readonly lastSuccessAt: string | null;
    readonly channels: number | null;
    readonly programmes: number | null;
    /** A `ServerEpgErrorCode`, or `unknown` for an unclassified failure. */
    readonly errorCode: string | null;
    readonly errorHost: string | null;
}

export function isStaleRecord(
    record: EpgImportRecord | undefined,
    nowMs: number
): boolean {
    const success = record?.lastSuccessAt
        ? Date.parse(record.lastSuccessAt)
        : Number.NaN;
    return !Number.isFinite(success) || nowMs - success > EPG_STALE_AFTER_MS;
}

/**
 * `server_epg_imports`, written by the main thread before and after a
 * job, never while a worker holds the write lock.
 */
export class EpgImportRecords {
    private readonly selectAll: Database.Statement;
    private readonly attempt: Database.Statement;
    private readonly success: Database.Statement;
    private readonly failure: Database.Statement;
    private readonly removeOne: Database.Statement;
    private readonly removeAll: Database.Statement;

    constructor(db: Database.Database) {
        this.selectAll = db.prepare(
            `SELECT source_url AS sourceUrl, last_attempt_at AS lastAttemptAt,
                last_success_at AS lastSuccessAt, channels, programmes,
                error_code AS errorCode, error_host AS errorHost
             FROM server_epg_imports`
        );
        this.attempt = db.prepare(
            `INSERT INTO server_epg_imports (source_url, last_attempt_at)
             VALUES (?, ?)
             ON CONFLICT(source_url) DO UPDATE
             SET last_attempt_at = excluded.last_attempt_at`
        );
        this.success = db.prepare(
            `INSERT INTO server_epg_imports
                (source_url, last_attempt_at, last_success_at, channels, programmes)
             VALUES (@url, @at, @at, @channels, @programmes)
             ON CONFLICT(source_url) DO UPDATE
             SET last_success_at = excluded.last_success_at,
                 channels = excluded.channels,
                 programmes = excluded.programmes,
                 error_code = NULL,
                 error_host = NULL`
        );
        this.failure = db.prepare(
            `INSERT INTO server_epg_imports
                (source_url, last_attempt_at, error_code, error_host)
             VALUES (@url, @at, @code, @host)
             ON CONFLICT(source_url) DO UPDATE
             SET error_code = excluded.error_code,
                 error_host = excluded.error_host`
        );
        this.removeOne = db.prepare(
            `DELETE FROM server_epg_imports WHERE source_url = ?`
        );
        this.removeAll = db.prepare(`DELETE FROM server_epg_imports`);
    }

    all(): Map<string, EpgImportRecord> {
        return new Map(
            (this.selectAll.all() as EpgImportRecord[]).map((record) => [
                record.sourceUrl,
                record,
            ])
        );
    }

    markAttempt(url: string, at: Date): void {
        this.attempt.run(url, at.toISOString());
    }

    markSuccess(url: string, at: Date, stats: EpgImportStats): void {
        this.success.run({
            url,
            at: at.toISOString(),
            channels: stats.totalChannels,
            programmes: stats.totalPrograms,
        });
    }

    /** Keeps the counts of the last success; the attempt time is set at start. */
    markFailure(
        url: string,
        at: Date,
        failure: { readonly code: string; readonly host?: string }
    ): void {
        this.failure.run({
            url,
            at: at.toISOString(),
            code: failure.code,
            host: failure.host ?? null,
        });
    }

    delete(url: string): void {
        this.removeOne.run(url);
    }

    deleteAll(): void {
        this.removeAll.run();
    }
}
```

- [ ] **Step 5: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns=epg-database
git add apps/web-backend/src/app/epg/epg-database.ts apps/web-backend/src/app/epg/epg-import-records.ts apps/web-backend/src/app/epg/epg-database.spec.ts
git commit -m "feat(web-backend): open epg.db and record import outcomes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 7 tests. If `ensureEpgSchema` creates differently named tables, adjust only the `arrayContaining` list to the names Task 0 found.

---

### Task 5: Settings and request bodies

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-request-body.ts`
- Create: `apps/web-backend/src/app/epg/epg-settings.ts`
- Test: `apps/web-backend/src/app/epg/epg-settings.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import { StorageRequestError } from '../storage/storage-route-errors';
import { stringList } from './epg-request-body';
import {
    isFetchableEpgUrl,
    mergeEpgSettings,
    parseEpgSettingsUpdate,
    readEpgSettings,
    SERVER_EPG_SETTINGS_KEY,
    writeEpgSettings,
} from './epg-settings';

const A = 'https://epg.example/a.xml';

function memoryStore() {
    const values = new Map<string, string>();
    return {
        values,
        getAppState: (key: string) => values.get(key) ?? null,
        setAppState: (key: string, value: string) => {
            values.set(key, value);
        },
    };
}

function errorOf(run: () => unknown): StorageRequestError {
    try {
        run();
    } catch (error) {
        if (error instanceof StorageRequestError) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected a StorageRequestError');
}

describe('server EPG settings', () => {
    it('defaults to no sources at 04:00', () => {
        expect(readEpgSettings(memoryStore())).toEqual({
            urls: [],
            refreshTime: '04:00',
        });
    });

    it('round-trips through app_state under a server key', () => {
        const store = memoryStore();
        writeEpgSettings(store, { urls: [A], refreshTime: '05:15' });

        expect(SERVER_EPG_SETTINGS_KEY).toBe('server:epg-settings');
        expect(
            JSON.parse(store.values.get(SERVER_EPG_SETTINGS_KEY) ?? '')
        ).toEqual({ urls: [A], refreshTime: '05:15' });
        expect(readEpgSettings(store)).toEqual({
            urls: [A],
            refreshTime: '05:15',
        });
    });

    it('falls back to defaults for a damaged stored value', () => {
        const store = memoryStore();
        store.setAppState(SERVER_EPG_SETTINGS_KEY, '{not json');
        expect(readEpgSettings(store)).toEqual({
            urls: [],
            refreshTime: '04:00',
        });

        store.setAppState(
            SERVER_EPG_SETTINGS_KEY,
            JSON.stringify({ urls: [A, 7, 'ftp://x'], refreshTime: '25:00' })
        );
        expect(readEpgSettings(store)).toEqual({
            urls: [A],
            refreshTime: '04:00',
        });
    });

    it('parses a partial update', () => {
        expect(parseEpgSettingsUpdate({ urls: [` ${A} `, A, ''] })).toEqual({
            urls: [A],
        });
        expect(parseEpgSettingsUpdate({ refreshTime: ' 23:59 ' })).toEqual({
            refreshTime: '23:59',
        });
        expect(parseEpgSettingsUpdate({})).toEqual({});
    });

    it.each<[unknown, string]>([
        [{ urls: ['ftp://epg.example/a.xml'] }, 'invalid_url'],
        [{ urls: ['https://user:secret@epg.example/a.xml'] }, 'invalid_url'],
        [{ urls: ['not a url'] }, 'invalid_url'],
        [
            {
                urls: Array.from(
                    { length: 51 },
                    (_, index) => `https://epg.example/${index}.xml`
                ),
            },
            'too_many_urls',
        ],
        [{ urls: A }, 'invalid_body'],
        [{ refreshTime: '4:00' }, 'invalid_time'],
        [{ refreshTime: '24:00' }, 'invalid_time'],
        [null, 'invalid_body'],
    ])('rejects case %# with %s', (body, code) => {
        const error = errorOf(() => parseEpgSettingsUpdate(body));

        expect(error).toMatchObject({ status: 400, code });
        expect(error.message).not.toContain('secret');
    });

    it('merges an update over the stored settings', () => {
        const stored = { urls: [A], refreshTime: '04:00' };
        expect(mergeEpgSettings(stored, { refreshTime: '06:00' })).toEqual({
            urls: [A],
            refreshTime: '06:00',
        });
        expect(mergeEpgSettings(stored, { urls: [] })).toEqual({
            urls: [],
            refreshTime: '04:00',
        });
    });

    it('fetches only http(s) URLs without credentials', () => {
        expect(isFetchableEpgUrl(A)).toBe(true);
        expect(isFetchableEpgUrl('http://192.168.1.2:8080/guide.xml.gz')).toBe(
            true
        );
        expect(isFetchableEpgUrl('file:///guide.xml')).toBe(false);
        expect(isFetchableEpgUrl('https://u:p@epg.example/a.xml')).toBe(false);
        expect(isFetchableEpgUrl('guide.xml')).toBe(false);
    });
});

describe('stringList', () => {
    it('trims, drops blanks and duplicates, and keeps the first entries', () => {
        expect(stringList([' a ', 'a', '', 'b', 'c'], 'ids', 2)).toEqual([
            'a',
            'b',
        ]);
    });

    it('rejects anything but an array of strings', () => {
        expect(errorOf(() => stringList(['a', 1], 'ids', 5))).toMatchObject({
            status: 400,
            code: 'invalid_body',
        });
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=epg-settings`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the body helpers**

`apps/web-backend/src/app/epg/epg-request-body.ts`:

```ts
import { StorageRequestError } from '../storage/storage-route-errors';

/** A 400 in the storage envelope. Messages name fields, never values. */
export function invalidBody(
    message: string,
    code = 'invalid_body'
): StorageRequestError {
    return new StorageRequestError(400, code, message);
}

export function requireBody(value: unknown): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw invalidBody('Expected a JSON object.');
    }
    return value as Record<string, unknown>;
}

/** Trimmed, non-empty strings without duplicates, in their first order. */
export function uniqueStrings(value: unknown, field: string): string[] {
    if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== 'string')
    ) {
        throw invalidBody(`${field} must be an array of strings.`);
    }
    return [
        ...new Set(
            (value as string[])
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
        ),
    ];
}

/** Like `uniqueStrings`; entries beyond `max` are ignored, as the IPC caps do. */
export function stringList(
    value: unknown,
    field: string,
    max: number
): string[] {
    return uniqueStrings(value, field).slice(0, max);
}

export function optionalStringList(
    value: unknown,
    field: string,
    max: number
): string[] | undefined {
    return value === undefined ? undefined : stringList(value, field, max);
}

export function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string') {
        throw invalidBody(`${field} must be a string.`);
    }
    return value.trim();
}

export function optionalString(
    value: unknown,
    field: string
): string | undefined {
    return value === undefined ? undefined : requireString(value, field);
}

/** A finite number, else `undefined` (window routes then answer empty). */
export function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}
```

- [ ] **Step 4: Implement the settings**

`apps/web-backend/src/app/epg/epg-settings.ts`:

```ts
import {
    SERVER_EPG_DEFAULT_REFRESH_TIME,
    SERVER_EPG_LIMITS,
    type ServerEpgSettings,
    type ServerEpgSettingsUpdate,
} from '@iptvnator/shared/interfaces';
import { invalidBody, requireBody, uniqueStrings } from './epg-request-body';

/**
 * `app_state` key of the server source list and refresh time. Configuration
 * stays in iptvnator.db, so deleting epg.db keeps it; the `server:` prefix
 * keeps it apart from browser keys (`client:`).
 */
export const SERVER_EPG_SETTINGS_KEY = 'server:epg-settings';

const REFRESH_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `ServerPlaylistRepository` satisfies it (`getAppState`, `setAppState`). */
export interface EpgAppStateStore {
    getAppState(key: string): string | null;
    setAppState(key: string, value: string): void;
}

/** http(s) without user name or password, as the XMLTV fetch requires. */
export function isFetchableEpgUrl(value: string): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password
    );
}

export function isRefreshTime(value: string): boolean {
    return REFRESH_TIME_PATTERN.test(value);
}

export function readEpgSettings(store: EpgAppStateStore): ServerEpgSettings {
    const defaults: ServerEpgSettings = {
        urls: [],
        refreshTime: SERVER_EPG_DEFAULT_REFRESH_TIME,
    };
    const raw = store.getAppState(SERVER_EPG_SETTINGS_KEY);
    if (!raw) {
        return defaults;
    }
    try {
        const parsed = JSON.parse(raw) as {
            urls?: unknown;
            refreshTime?: unknown;
        };
        return {
            urls: Array.isArray(parsed.urls)
                ? parsed.urls.filter(
                      (url): url is string =>
                          typeof url === 'string' && isFetchableEpgUrl(url)
                  )
                : [],
            refreshTime:
                typeof parsed.refreshTime === 'string' &&
                isRefreshTime(parsed.refreshTime)
                    ? parsed.refreshTime
                    : defaults.refreshTime,
        };
    } catch {
        return defaults;
    }
}

export function writeEpgSettings(
    store: EpgAppStateStore,
    settings: ServerEpgSettings
): void {
    store.setAppState(
        SERVER_EPG_SETTINGS_KEY,
        JSON.stringify({
            urls: settings.urls,
            refreshTime: settings.refreshTime,
        })
    );
}

/** `PUT /v1/epg/settings`; an omitted field keeps its stored value. */
export function parseEpgSettingsUpdate(body: unknown): ServerEpgSettingsUpdate {
    const record = requireBody(body);
    const update: { urls?: string[]; refreshTime?: string } = {};
    if (record['urls'] !== undefined) {
        const urls = uniqueStrings(record['urls'], 'urls');
        if (urls.length > SERVER_EPG_LIMITS.settingsUrls) {
            throw invalidBody(
                `At most ${SERVER_EPG_LIMITS.settingsUrls} EPG sources are allowed.`,
                'too_many_urls'
            );
        }
        if (!urls.every(isFetchableEpgUrl)) {
            throw invalidBody(
                'EPG sources must be http or https URLs without a user name or password.',
                'invalid_url'
            );
        }
        update.urls = urls;
    }
    if (record['refreshTime'] !== undefined) {
        const time =
            typeof record['refreshTime'] === 'string'
                ? record['refreshTime'].trim()
                : '';
        if (!isRefreshTime(time)) {
            throw invalidBody(
                'refreshTime must be HH:MM between 00:00 and 23:59.',
                'invalid_time'
            );
        }
        update.refreshTime = time;
    }
    return update;
}

export function mergeEpgSettings(
    current: ServerEpgSettings,
    update: ServerEpgSettingsUpdate
): ServerEpgSettings {
    return {
        urls: update.urls ?? current.urls,
        refreshTime: update.refreshTime ?? current.refreshTime,
    };
}
```

- [ ] **Step 5: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns=epg-settings
git add apps/web-backend/src/app/epg/epg-request-body.ts apps/web-backend/src/app/epg/epg-settings.ts apps/web-backend/src/app/epg/epg-settings.spec.ts
git commit -m "feat(web-backend): store and validate server EPG settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 16 tests.

---

### Task 6: Source registry

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-source-registry.ts`
- Test: `apps/web-backend/src/app/epg/epg-source-registry.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import {
    m3uDocument,
    withTempStorage,
} from '../storage/server-storage.spec-helpers';
import {
    computeEpgSources,
    EpgSourceRegistry,
    readPlaylistEpgRows,
} from './epg-source-registry';

const A = 'https://epg.example/a.xml';
const B = 'https://epg.example/b.xml.gz';
const C = 'https://epg.example/c.xml';

describe('computeEpgSources', () => {
    it('joins the server list with the EPG URLs of M3U playlists', () =>
        withTempStorage((storage) => {
            const write = (document: Record<string, unknown>) =>
                storage.playlists.upsert(document, { keepPayload: false });
            write({ ...m3uDocument('p1'), epgUrls: [B, A] });
            write({ ...m3uDocument('p2'), epgUrls: [B, 'file:///guide.xml'] });
            write({
                _id: 'x1',
                title: 'Xtream',
                serverUrl: 'http://portal.example',
                username: 'u',
                password: 'p',
                epgUrls: [C],
            });
            write({
                _id: 's1',
                title: 'Stalker',
                macAddress: '00:1A:79:00:00:01',
                portalUrl: 'http://stalker.example/c/',
                epgUrls: [C],
            });

            const set = computeEpgSources(
                [A, 'http://user:secret@epg.example/x.xml'],
                readPlaylistEpgRows(storage.database.db)
            );

            expect(set.sources).toEqual([
                { url: A, owners: { global: true, playlists: 1 } },
                { url: B, owners: { global: false, playlists: 2 } },
            ]);
            expect(set.overflow).toEqual([]);
        }));

    it('imports at most the cap and reports the rest', () => {
        const urls = Array.from(
            { length: 5 },
            (_, index) => `https://epg.example/${index}.xml`
        );
        const set = computeEpgSources(
            urls.slice(0, 2),
            [
                {
                    id: 'p',
                    epgUrls: JSON.stringify(urls.slice(2)),
                    serverUrl: null,
                    macAddress: null,
                },
            ],
            3
        );

        expect(set.sources.map(({ url }) => url)).toEqual(urls.slice(0, 3));
        expect(set.overflow.map(({ url }) => url)).toEqual(urls.slice(3));
    });

    it('skips an unreadable epg_urls column', () => {
        expect(
            computeEpgSources(
                [],
                [
                    {
                        id: 'p',
                        epgUrls: 'not json',
                        serverUrl: null,
                        macAddress: null,
                    },
                ]
            ).sources
        ).toEqual([]);
    });
});

describe('EpgSourceRegistry', () => {
    it('reports added and removed sources on each recompute', () => {
        let globals = [A];
        const registry = new EpgSourceRegistry(() =>
            computeEpgSources(globals, [])
        );

        expect(registry.recompute()).toEqual({ added: [A], removed: [] });
        globals = [A, B];
        expect(registry.recompute()).toEqual({ added: [B], removed: [] });
        globals = [B];
        expect(registry.recompute()).toEqual({ added: [], removed: [A] });
        expect(registry.owns(A)).toBe(false);
        expect(registry.urls()).toEqual([B]);
        expect(registry.sources()).toEqual([
            { url: B, owners: { global: true, playlists: 0 } },
        ]);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=epg-source-registry`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { asc } from 'drizzle-orm';
import type { DatabaseInstance } from '@iptvnator/shared/database';
import { playlists } from '@iptvnator/shared/database/schema';
import {
    SERVER_EPG_LIMITS,
    type ServerEpgSourceStatus,
} from '@iptvnator/shared/interfaces';
import { isFetchableEpgUrl } from './epg-settings';

export interface PlaylistEpgRow {
    readonly id: string;
    /** JSON array of the playlist's enabled XMLTV URLs (`epg_urls`). */
    readonly epgUrls: string | null;
    readonly serverUrl: string | null;
    readonly macAddress: string | null;
}

export interface EpgSourceEntry {
    readonly url: string;
    readonly owners: ServerEpgSourceStatus['owners'];
}

export interface EpgSourceSet {
    /** Imported: global sources first, at most `importedSources`. */
    readonly sources: readonly EpgSourceEntry[];
    /** Owned but beyond the cap; reported as `epg_too_many_sources`. */
    readonly overflow: readonly EpgSourceEntry[];
}

export interface EpgSourceChanges {
    readonly added: readonly string[];
    readonly removed: readonly string[];
}

/** Projected columns only: the payload column is never read. */
export function readPlaylistEpgRows(db: DatabaseInstance): PlaylistEpgRow[] {
    return db
        .select({
            id: playlists.id,
            epgUrls: playlists.epgUrls,
            serverUrl: playlists.serverUrl,
            macAddress: playlists.macAddress,
        })
        .from(playlists)
        .orderBy(asc(playlists.dateCreated), asc(playlists.id))
        .all();
}

/**
 * Server list ∪ `epg_urls` of M3U playlists. Xtream (`serverUrl`) and
 * Stalker (`macAddress`) playlists take their guide from the portal, as
 * `EpgSourceSettingsService` does on the desktop.
 */
export function computeEpgSources(
    globalUrls: readonly string[],
    rows: readonly PlaylistEpgRow[],
    cap: number = SERVER_EPG_LIMITS.importedSources
): EpgSourceSet {
    const owners = new Map<string, { global: boolean; playlists: number }>();
    for (const url of globalUrls) {
        if (isFetchableEpgUrl(url)) {
            owners.set(url, { global: true, playlists: 0 });
        }
    }
    for (const row of rows) {
        if (row.serverUrl?.trim() || row.macAddress?.trim()) {
            continue;
        }
        for (const url of new Set(parseUrlList(row.epgUrls))) {
            if (!isFetchableEpgUrl(url)) {
                continue;
            }
            const owner = owners.get(url) ?? { global: false, playlists: 0 };
            owners.set(url, {
                global: owner.global,
                playlists: owner.playlists + 1,
            });
        }
    }
    const entries = [...owners].map(([url, owner]) => ({ url, owners: owner }));
    return { sources: entries.slice(0, cap), overflow: entries.slice(cap) };
}

function parseUrlList(value: string | null): string[] {
    if (!value) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => item.trim())
                  .filter((item) => item.length > 0)
            : [];
    } catch {
        return [];
    }
}

/** The current source set; `recompute` says what changed since the last one. */
export class EpgSourceRegistry {
    private current: EpgSourceSet = { sources: [], overflow: [] };
    private imported = new Set<string>();

    constructor(private readonly read: () => EpgSourceSet) {}

    recompute(): EpgSourceChanges {
        const previous = this.imported;
        this.current = this.read();
        this.imported = new Set(this.current.sources.map(({ url }) => url));
        return {
            added: [...this.imported].filter((url) => !previous.has(url)),
            removed: [...previous].filter((url) => !this.imported.has(url)),
        };
    }

    sources(): readonly EpgSourceEntry[] {
        return this.current.sources;
    }

    overflow(): readonly EpgSourceEntry[] {
        return this.current.overflow;
    }

    urls(): string[] {
        return [...this.imported];
    }

    owns(url: string): boolean {
        return this.imported.has(url);
    }
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns=epg-source-registry
git add apps/web-backend/src/app/epg/epg-source-registry.ts apps/web-backend/src/app/epg/epg-source-registry.spec.ts
git commit -m "feat(web-backend): derive EPG sources from settings and playlists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 4 tests.

---

### Task 7: Scheduler

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-scheduler.ts`
- Test: `apps/web-backend/src/app/epg/epg-scheduler.spec.ts`

- [ ] **Step 1: Write the failing spec**

Expected values: Berlin is CEST (+2) until 25 October 2026 01:00 UTC and
CET (+1) after; DST starts on 29 March 2026 at 01:00 UTC; New York is EDT
(−4) in October.

```ts
import { execFileSync } from 'node:child_process';
import {
    computeNextRunAt,
    EpgScheduler,
    processTimeZone,
} from './epg-scheduler';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('computeNextRunAt', () => {
    it.each([
        [
            '04:00',
            '2026-10-15T03:00:00.000Z',
            'UTC',
            '2026-10-15T04:00:00.000Z',
        ],
        [
            '04:00',
            '2026-10-15T04:00:00.000Z',
            'UTC',
            '2026-10-16T04:00:00.000Z',
        ],
        [
            '04:00',
            '2026-10-15T10:00:00.000Z',
            'Europe/Berlin',
            '2026-10-16T02:00:00.000Z',
        ],
        [
            '04:00',
            '2026-10-15T12:00:00.000Z',
            'America/New_York',
            '2026-10-16T08:00:00.000Z',
        ],
        [
            '00:00',
            '2026-10-15T21:59:00.000Z',
            'Europe/Berlin',
            '2026-10-15T22:00:00.000Z',
        ],
        // DST ends in Berlin that night: 04:00 is CET.
        [
            '04:00',
            '2026-10-24T12:00:00.000Z',
            'Europe/Berlin',
            '2026-10-25T03:00:00.000Z',
        ],
        // 02:30 happens twice that night; the run takes one of them.
        [
            '02:30',
            '2026-10-24T12:00:00.000Z',
            'Europe/Berlin',
            '2026-10-25T01:30:00.000Z',
        ],
        // 02:30 does not exist on 29 March; the run moves to 03:30 CEST.
        [
            '02:30',
            '2026-03-28T12:00:00.000Z',
            'Europe/Berlin',
            '2026-03-29T01:30:00.000Z',
        ],
        [
            '02:30',
            '2026-03-29T01:30:00.000Z',
            'Europe/Berlin',
            '2026-03-30T00:30:00.000Z',
        ],
    ])('%s after %s in %s is %s', (refreshTime, now, timeZone, expected) => {
        expect(
            computeNextRunAt(refreshTime, new Date(now), timeZone).toISOString()
        ).toBe(expected);
    });
});

describe('processTimeZone', () => {
    it('is the zone Intl resolves for this process', () => {
        expect(processTimeZone()).toBe(
            Intl.DateTimeFormat().resolvedOptions().timeZone
        );
    });

    it('follows the TZ variable a container sets', () => {
        const zone = execFileSync(
            process.execPath,
            [
                '-e',
                'process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone)',
            ],
            { env: { ...process.env, TZ: 'Asia/Tokyo' }, encoding: 'utf8' }
        );
        expect(zone).toBe('Asia/Tokyo');
    });
});

describe('EpgScheduler', () => {
    beforeEach(() => {
        jest.useFakeTimers({ now: new Date('2026-10-15T03:59:00.000Z') });
    });

    afterEach(() => jest.useRealTimers());

    function create(refreshTime: () => string = () => '04:00') {
        const onRun = jest.fn();
        const onCatchUp = jest.fn();
        const onError = jest.fn();
        const scheduler = new EpgScheduler({
            refreshTime,
            timeZone: 'UTC',
            onRun,
            onCatchUp,
            onError,
        });
        return { scheduler, onRun, onCatchUp, onError };
    }

    it('runs at the refresh time and arms the next day', () => {
        const { scheduler, onRun } = create();
        scheduler.start();
        expect(scheduler.nextRunAt()?.toISOString()).toBe(
            '2026-10-15T04:00:00.000Z'
        );

        jest.advanceTimersByTime(MINUTE - 1);
        expect(onRun).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(onRun).toHaveBeenCalledTimes(1);
        expect(scheduler.nextRunAt()?.toISOString()).toBe(
            '2026-10-16T04:00:00.000Z'
        );

        jest.advanceTimersByTime(DAY);
        expect(onRun).toHaveBeenCalledTimes(2);
        scheduler.stop();
    });

    it('catches up once, a minute after start', () => {
        const { scheduler, onCatchUp } = create();
        scheduler.start();

        jest.advanceTimersByTime(MINUTE - 1);
        expect(onCatchUp).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        jest.advanceTimersByTime(2 * DAY);
        expect(onCatchUp).toHaveBeenCalledTimes(1);
        scheduler.stop();
    });

    it('re-arms for a new refresh time', () => {
        let refreshTime = '04:00';
        const { scheduler, onRun } = create(() => refreshTime);
        scheduler.start();

        refreshTime = '05:00';
        scheduler.rearm();
        expect(scheduler.nextRunAt()?.toISOString()).toBe(
            '2026-10-15T05:00:00.000Z'
        );
        jest.advanceTimersByTime(MINUTE);
        expect(onRun).not.toHaveBeenCalled();
        jest.advanceTimersByTime(60 * MINUTE);
        expect(onRun).toHaveBeenCalledTimes(1);
        scheduler.stop();
    });

    it('keeps the schedule when a run throws', () => {
        const { scheduler, onRun, onError } = create();
        onRun.mockImplementation(() => {
            throw new Error('boom');
        });
        scheduler.start();

        jest.advanceTimersByTime(MINUTE);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(scheduler.nextRunAt()?.toISOString()).toBe(
            '2026-10-16T04:00:00.000Z'
        );
        scheduler.stop();
    });

    it('stops every timer', () => {
        const { scheduler, onRun, onCatchUp } = create();
        scheduler.start();
        scheduler.stop();
        scheduler.rearm();

        jest.advanceTimersByTime(2 * DAY);
        expect(onRun).not.toHaveBeenCalled();
        expect(onCatchUp).not.toHaveBeenCalled();
        expect(scheduler.nextRunAt()).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=epg-scheduler`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/** Sources never imported or stale are queued this long after start. */
export const EPG_CATCH_UP_DELAY_MS = 60_000;

interface LocalDateTime {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The IANA zone of this process (`TZ` in a container), `UTC` if invalid. */
export function processTimeZone(): string {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try {
        formatter(zone);
        return zone;
    } catch {
        return 'UTC';
    }
}

/**
 * The first instant after `now` whose wall clock in `timeZone` reads
 * `refreshTime`. A time in a spring-forward gap runs an hour away from it
 * and a repeated time on one of its two occurrences; either way it runs
 * once that day.
 */
export function computeNextRunAt(
    refreshTime: string,
    now: Date,
    timeZone: string
): Date {
    const [hour, minute] = refreshTime.split(':').map(Number);
    const today = localParts(now.getTime(), timeZone);
    for (let offset = 0; offset <= 2; offset += 1) {
        const day = new Date(
            Date.UTC(today.year, today.month - 1, today.day + offset)
        );
        const instant = localTimeToInstant(
            {
                year: day.getUTCFullYear(),
                month: day.getUTCMonth() + 1,
                day: day.getUTCDate(),
                hour,
                minute,
            },
            timeZone
        );
        if (instant > now.getTime()) {
            return new Date(instant);
        }
    }
    // Unreachable: the wall time two days ahead is always later than now.
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

export interface EpgSchedulerOptions {
    readonly refreshTime: () => string;
    readonly timeZone: string;
    readonly onRun: () => void;
    readonly onCatchUp: () => void;
    readonly onError: (error: unknown) => void;
    readonly catchUpDelayMs?: number;
}

/** One timer to the next refresh time, re-armed after each run. */
export class EpgScheduler {
    private runTimer: ReturnType<typeof setTimeout> | null = null;
    private catchUpTimer: ReturnType<typeof setTimeout> | null = null;
    private next: Date | null = null;
    private active = false;

    constructor(private readonly options: EpgSchedulerOptions) {}

    start(): void {
        if (this.active) {
            return;
        }
        this.active = true;
        this.arm();
        this.catchUpTimer = setTimeout(() => {
            this.catchUpTimer = null;
            this.call(this.options.onCatchUp);
        }, this.options.catchUpDelayMs ?? EPG_CATCH_UP_DELAY_MS);
        this.catchUpTimer.unref();
    }

    /** After the refresh time changed. */
    rearm(): void {
        if (this.active) {
            this.call(() => this.arm());
        }
    }

    nextRunAt(): Date | null {
        return this.next;
    }

    stop(): void {
        this.active = false;
        if (this.runTimer) {
            clearTimeout(this.runTimer);
        }
        if (this.catchUpTimer) {
            clearTimeout(this.catchUpTimer);
        }
        this.runTimer = null;
        this.catchUpTimer = null;
        this.next = null;
    }

    private arm(): void {
        if (this.runTimer) {
            clearTimeout(this.runTimer);
        }
        const now = new Date();
        const next = computeNextRunAt(
            this.options.refreshTime(),
            now,
            this.options.timeZone
        );
        this.next = next;
        this.runTimer = setTimeout(() => {
            this.runTimer = null;
            this.call(this.options.onRun);
            if (this.active) {
                this.call(() => this.arm());
            }
        }, next.getTime() - now.getTime());
        this.runTimer.unref();
    }

    private call(callback: () => void): void {
        try {
            callback();
        } catch (error) {
            this.options.onError(error);
        }
    }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
    let value = formatters.get(timeZone);
    if (!value) {
        value = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        });
        formatters.set(timeZone, value);
    }
    return value;
}

function localParts(instant: number, timeZone: string): LocalDateTime {
    const parts: Record<string, number> = {};
    for (const part of formatter(timeZone).formatToParts(new Date(instant))) {
        if (part.type !== 'literal') {
            parts[part.type] = Number(part.value);
        }
    }
    return {
        year: parts['year'],
        month: parts['month'],
        day: parts['day'],
        hour: parts['hour'],
        minute: parts['minute'],
        second: parts['second'],
    };
}

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function zoneOffset(instant: number, timeZone: string): number {
    const local = localParts(instant, timeZone);
    const asUtc = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second
    );
    return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Two passes settle the offset when the wall time is next to a DST change. */
function localTimeToInstant(
    local: Omit<LocalDateTime, 'second'>,
    timeZone: string
): number {
    const guess = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute
    );
    const first = guess - zoneOffset(guess, timeZone);
    return guess - zoneOffset(first, timeZone);
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns=epg-scheduler
git add apps/web-backend/src/app/epg/epg-scheduler.ts apps/web-backend/src/app/epg/epg-scheduler.spec.ts
git commit -m "feat(web-backend): schedule the daily EPG refresh

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 16 tests.

---

### Task 8: Worker protocol and error codes

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-worker-protocol.ts`
- Create: `apps/web-backend/src/app/epg/epg-error-codes.ts`
- Test: `apps/web-backend/src/app/epg/epg-error-codes.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import {
    EpgImportError,
    EPG_IMPORT_ERROR_CODES,
} from '@iptvnator/shared/epg-store';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    SERVER_EPG_ERROR_CODES,
} from '@iptvnator/shared/interfaces';
import { ProviderRequestError } from '../provider-request-error';
import { PROVIDER_BODY_TOO_LARGE_CODE } from '../provider-response';
import { classifyEpgFailure, EPG_FAILURE_UNKNOWN } from './epg-error-codes';

const URL_WITH_SECRET =
    'https://epg.example/xmltv.php?username=u&password=secret';
const coded = (code: string) => Object.assign(new Error('failed'), { code });

describe('classifyEpgFailure', () => {
    it.each<[string, unknown, string, string | undefined]>([
        [
            'an empty feed',
            new EpgImportError(EPG_IMPORT_ERROR_CODES.Empty),
            'epg_empty',
            undefined,
        ],
        [
            'a parse failure',
            new EpgImportError(EPG_IMPORT_ERROR_CODES.ParseFailed),
            'epg_parse_failed',
            undefined,
        ],
        [
            'the library size cap',
            new EpgImportError(EPG_IMPORT_ERROR_CODES.TooLarge),
            'epg_too_large',
            undefined,
        ],
        [
            'a private-network block',
            new ProviderRequestError(false, undefined, {
                message: 'blocked',
                status: 400,
                privateNetwork: true,
            }),
            ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked,
            'epg.example',
        ],
        [
            'a DNS failure',
            new ProviderRequestError(false, coded('ENOTFOUND'), {
                message: 'unresolved',
                status: 400,
                lookupError: coded('ENOTFOUND'),
            }),
            SERVER_EPG_ERROR_CODES.Network,
            'epg.example',
        ],
        [
            'a redirect loop',
            new ProviderRequestError(true, undefined, {
                message: 'Redirect cycle detected',
                status: 502,
            }),
            SERVER_EPG_ERROR_CODES.HttpStatus,
            'epg.example',
        ],
        [
            'an invalid certificate',
            new ProviderRequestError(false, coded('CERT_HAS_EXPIRED')),
            ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate,
            'epg.example',
        ],
        [
            'an HTTP status',
            new ProviderRequestError(
                true,
                Object.assign(coded('ERR_BAD_REQUEST'), {
                    response: { status: 404 },
                })
            ),
            SERVER_EPG_ERROR_CODES.HttpStatus,
            'epg.example',
        ],
        [
            'a timeout',
            new ProviderRequestError(false, coded('ETIMEDOUT')),
            SERVER_EPG_ERROR_CODES.Timeout,
            'epg.example',
        ],
        [
            'a body over the byte cap',
            coded(PROVIDER_BODY_TOO_LARGE_CODE),
            SERVER_EPG_ERROR_CODES.TooLarge,
            'epg.example',
        ],
        [
            'a body that went silent',
            coded('ECONNABORTED'),
            SERVER_EPG_ERROR_CODES.Timeout,
            'epg.example',
        ],
        [
            'an invalid gzip body',
            coded('Z_DATA_ERROR'),
            SERVER_EPG_ERROR_CODES.ParseFailed,
            undefined,
        ],
        [
            'a truncated gzip body',
            coded('Z_BUF_ERROR'),
            SERVER_EPG_ERROR_CODES.ParseFailed,
            undefined,
        ],
        [
            'a refused connection',
            new ProviderRequestError(false, coded('ECONNREFUSED')),
            SERVER_EPG_ERROR_CODES.Network,
            'epg.example',
        ],
        [
            'a reset stream',
            coded('ECONNRESET'),
            SERVER_EPG_ERROR_CODES.Network,
            'epg.example',
        ],
        ['a full disk', coded('SQLITE_FULL'), EPG_FAILURE_UNKNOWN, undefined],
        ['a thrown string', 'boom', EPG_FAILURE_UNKNOWN, undefined],
    ])('maps %s', (_label, error, code, host) => {
        const failure = classifyEpgFailure(error, URL_WITH_SECRET, false);

        expect(failure.code).toBe(code);
        expect(failure.host).toBe(host);
    });

    it('reports an abort as epg_aborted, whatever was thrown', () => {
        expect(
            classifyEpgFailure(coded('ECONNRESET'), URL_WITH_SECRET, true)
        ).toEqual({ code: EPG_IMPORT_ERROR_CODES.Aborted, name: 'Error' });
    });

    it('never carries the URL or the error message', () => {
        const failure = classifyEpgFailure(
            new ProviderRequestError(
                true,
                Object.assign(new Error(`GET ${URL_WITH_SECRET} failed`), {
                    response: { status: 500 },
                })
            ),
            URL_WITH_SECRET,
            false
        );

        expect(failure).toEqual({
            code: SERVER_EPG_ERROR_CODES.HttpStatus,
            name: 'ProviderRequestError',
            host: 'epg.example',
        });
        expect(JSON.stringify(failure)).not.toContain('secret');
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=epg-error-codes`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the protocol**

`apps/web-backend/src/app/epg/epg-worker-protocol.ts`:

```ts
import type { EpgImportStats } from '@iptvnator/shared/epg-store';
import type { EpgFailure } from './epg-error-codes';

/** The nightly clean-up deletes programmes that stopped this long ago. */
export const EPG_PAST_DAYS_KEPT = 7;

/** Work for one worker thread; each job gets its own thread. */
export type EpgWorkerJob =
    | { readonly kind: 'import'; readonly url: string }
    | { readonly kind: 'clear'; readonly url: string | null }
    | { readonly kind: 'maintenance' };

export interface EpgImportSettings {
    readonly maxDecompressedBytes: number;
    readonly allowPrivateNetworks: boolean;
}

/** `workerData` of `epg-import.worker.ts`. */
export interface EpgWorkerData {
    readonly dbPath: string;
    readonly job: EpgWorkerJob;
    readonly importSettings: EpgImportSettings;
}

/** Worker → main thread. */
export type EpgWorkerMessage =
    | { readonly type: 'progress'; readonly stats: EpgImportStats }
    /** The import parsed and now runs its publish transaction (no progress). */
    | { readonly type: 'publishing' }
    | { readonly type: 'done'; readonly stats?: EpgImportStats }
    | { readonly type: 'failed'; readonly failure: EpgFailure };

/** Main thread → worker. */
export interface EpgWorkerCommand {
    readonly type: 'abort';
}

export type EpgJobOutcome =
    | { readonly ok: true; readonly stats?: EpgImportStats }
    | { readonly ok: false; readonly failure: EpgFailure };

/** A started job. `done` never rejects. */
export interface EpgJobHandle {
    readonly done: Promise<EpgJobOutcome>;
    /** Asks the job to stop; it then ends with `epg_aborted`. */
    abort(): void;
    /** Ends the thread at once; SQLite rolls an open transaction back. */
    terminate(): Promise<void>;
}

export type EpgJobRunner = (
    job: EpgWorkerJob,
    onProgress: (stats: EpgImportStats) => void,
    /** The import entered its publish transaction (`onPublishStart`). */
    onPublishing?: () => void
) => EpgJobHandle;
```

- [ ] **Step 4: Implement the error codes**

`apps/web-backend/src/app/epg/epg-error-codes.ts`:

```ts
import {
    EPG_IMPORT_ERROR_CODES,
    EpgImportError,
} from '@iptvnator/shared/epg-store';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    SERVER_EPG_ERROR_CODES,
    type ServerEpgErrorCode,
} from '@iptvnator/shared/interfaces';
import { collectProviderErrorCodes } from '../provider-error';
import { ProviderRequestError } from '../provider-request-error';
import { PROVIDER_BODY_TOO_LARGE_CODE } from '../provider-response';

/** An unclassified failure: disk full, SQLite, a crashed worker. */
export const EPG_FAILURE_UNKNOWN = 'unknown';

export type EpgFailureCode =
    | ServerEpgErrorCode
    | typeof EPG_IMPORT_ERROR_CODES.Aborted
    | typeof EPG_FAILURE_UNKNOWN;

/** A failed job: never a message or a URL, both can carry credentials. */
export interface EpgFailure {
    readonly code: EpgFailureCode;
    /** Error class name for the log line. */
    readonly name: string;
    readonly host?: string;
}

// The desktop's list (apps/electron-backend/src/app/util/security-errors.ts).
const TLS_CERTIFICATE_CODES = new Set([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const TIMEOUT_CODES = new Set([
    'ETIMEDOUT',
    'ECONNABORTED',
    'ESOCKETTIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
]);
const NETWORK_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'ERR_STREAM_PREMATURE_CLOSE',
]);

/** Classifies a job failure inside the worker, where the error object lives. */
export function classifyEpgFailure(
    error: unknown,
    url: string,
    aborted: boolean
): EpgFailure {
    const name = errorName(error);
    if (aborted) {
        return { code: EPG_IMPORT_ERROR_CODES.Aborted, name };
    }
    if (error instanceof EpgImportError) {
        return { code: error.code, name };
    }
    const codes = collectProviderErrorCodes(error);
    // runEpgImport lets zlib errors through: an invalid or truncated gzip
    // body is a broken feed, like an XML error.
    if (codes.some((code) => code.startsWith('Z_'))) {
        return { code: SERVER_EPG_ERROR_CODES.ParseFailed, name };
    }
    const host = hostOf(url);
    const withHost = (code: ServerEpgErrorCode): EpgFailure => ({
        code,
        name,
        ...(host ? { host } : {}),
    });

    if (error instanceof ProviderRequestError && error.policyError) {
        if (error.policyError.privateNetwork) {
            return withHost(
                ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked
            );
        }
        // 502: a redirect cycle, too many redirects or a missing location.
        return withHost(
            error.policyError.status === 502
                ? SERVER_EPG_ERROR_CODES.HttpStatus
                : SERVER_EPG_ERROR_CODES.Network
        );
    }
    if (codes.some((code) => TLS_CERTIFICATE_CODES.has(code))) {
        return withHost(
            ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate
        );
    }
    if (codes.includes(PROVIDER_BODY_TOO_LARGE_CODE)) {
        return withHost(SERVER_EPG_ERROR_CODES.TooLarge);
    }
    if (httpStatusOf(error) !== undefined) {
        return withHost(SERVER_EPG_ERROR_CODES.HttpStatus);
    }
    if (codes.some((code) => TIMEOUT_CODES.has(code))) {
        return withHost(SERVER_EPG_ERROR_CODES.Timeout);
    }
    if (
        error instanceof ProviderRequestError ||
        codes.some((code) => NETWORK_CODES.has(code))
    ) {
        return withHost(SERVER_EPG_ERROR_CODES.Network);
    }
    return { code: EPG_FAILURE_UNKNOWN, name };
}

function httpStatusOf(error: unknown): number | undefined {
    const cause = error instanceof ProviderRequestError ? error.cause : error;
    const status = (cause as { response?: { status?: unknown } } | null)
        ?.response?.status;
    return typeof status === 'number' ? status : undefined;
}

function errorName(error: unknown): string {
    if (!(error instanceof Error)) {
        return typeof error;
    }
    return error.name === 'Error' && error.constructor.name
        ? error.constructor.name
        : error.name;
}

function hostOf(url: string): string | undefined {
    try {
        return new URL(url).hostname || undefined;
    } catch {
        return undefined;
    }
}
```

- [ ] **Step 5: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns=epg-error-codes
git add apps/web-backend/src/app/epg/epg-worker-protocol.ts apps/web-backend/src/app/epg/epg-error-codes.ts apps/web-backend/src/app/epg/epg-error-codes.spec.ts
git commit -m "feat(web-backend): EPG worker protocol and error codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 19 tests.

---

### Task 9: Import queue

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-import-queue.ts`
- Create: `apps/web-backend/src/app/epg/epg-job-watch.ts`
- Create: `apps/web-backend/src/app/epg/fake-epg-job-runner.spec-helpers.ts`
- Test: `apps/web-backend/src/app/epg/epg-import-queue.spec.ts`

- [ ] **Step 1: Create the fake runner**

Spec helpers are type-checked by `tsconfig.app.json` (node types only), so
they use no Jest globals.

`apps/web-backend/src/app/epg/fake-epg-job-runner.spec-helpers.ts`:

```ts
import type { EpgImportStats } from '@iptvnator/shared/epg-store';
import type { EpgFailure } from './epg-error-codes';
import type {
    EpgJobHandle,
    EpgJobOutcome,
    EpgJobRunner,
    EpgWorkerJob,
} from './epg-worker-protocol';

export const FAKE_IMPORT_STATS: EpgImportStats = {
    totalChannels: 2,
    totalPrograms: 3,
};

export interface FakeJob {
    readonly job: EpgWorkerJob;
    aborted: boolean;
    terminated: boolean;
    progress(stats: EpgImportStats): void;
    /** The import entered its publish transaction. */
    publishing(): void;
    succeed(stats?: EpgImportStats): void;
    fail(failure: EpgFailure): void;
}

export interface FakeEpgJobRunnerOptions {
    /** `auto` finishes each job on the next turn of the event loop. */
    readonly mode: 'auto' | 'manual';
    /** An abort ends the job, as the worker does; else only `terminate`. */
    readonly settleOnAbort?: boolean;
}

/** A job runner without threads, for queue, service and route specs. */
export class FakeEpgJobRunner {
    readonly jobs: FakeJob[] = [];

    constructor(
        private readonly options: FakeEpgJobRunnerOptions = { mode: 'auto' }
    ) {}

    readonly run: EpgJobRunner = (job, onProgress, onPublishing) => {
        let settled = false;
        let resolveDone: (outcome: EpgJobOutcome) => void = () => undefined;
        const done = new Promise<EpgJobOutcome>((resolve) => {
            resolveDone = resolve;
        });
        const finish = (outcome: EpgJobOutcome) => {
            if (!settled) {
                settled = true;
                resolveDone(outcome);
            }
        };
        const fake: FakeJob = {
            job,
            aborted: false,
            terminated: false,
            progress: (stats) => onProgress(stats),
            publishing: () => onPublishing?.(),
            succeed: (stats = FAKE_IMPORT_STATS) =>
                finish(
                    job.kind === 'import' ? { ok: true, stats } : { ok: true }
                ),
            fail: (failure) => finish({ ok: false, failure }),
        };
        this.jobs.push(fake);
        if (this.options.mode === 'auto') {
            setImmediate(() => fake.succeed());
        }
        const handle: EpgJobHandle = {
            done,
            abort: () => {
                fake.aborted = true;
                if (this.options.settleOnAbort) {
                    fake.fail({ code: 'epg_aborted', name: 'AbortError' });
                }
            },
            terminate: async () => {
                fake.terminated = true;
                fake.fail({ code: 'unknown', name: 'Terminated' });
            },
        };
        return handle;
    };

    importUrls(): string[] {
        return this.jobs.flatMap(({ job }) =>
            job.kind === 'import' ? [job.url] : []
        );
    }

    /** `import:<url>`, `clear:<url>`, `clear:*` or `maintenance`, in run order. */
    kinds(): string[] {
        return this.jobs.map(({ job }) =>
            job.kind === 'maintenance'
                ? 'maintenance'
                : `${job.kind}:${job.url ?? '*'}`
        );
    }
}
```

- [ ] **Step 2: Write the failing spec**

`setImmediate` stays real so promise chains settle; `setTimeout` and `Date`
are fake.

```ts
import { SERVER_EPG_ERROR_CODES } from '@iptvnator/shared/interfaces';
import { EpgImportQueue, type EpgQueueHooks } from './epg-import-queue';
import {
    FAKE_IMPORT_STATS,
    FakeEpgJobRunner,
} from './fake-epg-job-runner.spec-helpers';

const A = 'https://epg.example/a.xml';
const B = 'https://epg.example/b.xml';
const MINUTE = 60_000;
const TIMED_OUT = {
    ok: false,
    failure: { code: SERVER_EPG_ERROR_CODES.Timeout, name: 'EpgImportTimeout' },
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function hooks(): jest.Mocked<EpgQueueHooks> {
    return {
        importStarted: jest.fn(),
        importFinished: jest.fn(),
        cleared: jest.fn(),
        maintained: jest.fn(),
        hookFailed: jest.fn(),
    };
}

function setup(
    runner = new FakeEpgJobRunner({ mode: 'manual', settleOnAbort: true })
) {
    const queueHooks = hooks();
    const queue = new EpgImportQueue({ run: runner.run, hooks: queueHooks });
    return { runner, queue, queueHooks };
}

describe('EpgImportQueue', () => {
    beforeEach(() => {
        jest.useFakeTimers({
            now: new Date('2026-10-15T04:00:00.000Z'),
            doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
        });
    });

    afterEach(() => jest.useRealTimers());

    it('runs one import at a time in request order', async () => {
        const { runner, queue, queueHooks } = setup();
        queue.enqueueImports([A, B]);

        expect(runner.importUrls()).toEqual([A]);
        expect(queueHooks.importStarted).toHaveBeenCalledWith(A);
        expect(queue.snapshot()).toEqual({ running: { url: A }, queued: [B] });

        runner.jobs[0].progress({ totalChannels: 1, totalPrograms: 10 });
        expect(queue.snapshot().running).toEqual({
            url: A,
            stats: { totalChannels: 1, totalPrograms: 10 },
        });

        runner.jobs[0].succeed();
        await flush();
        expect(queueHooks.importFinished).toHaveBeenCalledWith(A, {
            ok: true,
            stats: FAKE_IMPORT_STATS,
        });
        expect(runner.importUrls()).toEqual([A, B]);
    });

    it('coalesces requests and drops one for a source finished in the last minute', async () => {
        const { runner, queue } = setup();
        queue.enqueueImports([A]);
        queue.enqueueImports([A, B, B]);
        expect(queue.snapshot().queued).toEqual([B]);

        runner.jobs[0].succeed();
        await flush();
        runner.jobs[1].succeed();
        await flush();
        queue.enqueueImports([A]);
        expect(runner.importUrls()).toEqual([A, B]);

        jest.advanceTimersByTime(MINUTE);
        queue.enqueueImports([A]);
        expect(runner.importUrls()).toEqual([A, B, A]);

        runner.jobs[2].succeed();
        await flush();
        queue.forget(A);
        queue.enqueueImports([A]);
        expect(runner.importUrls()).toEqual([A, B, A, A]);
    });

    it('times out an import that stops making progress', async () => {
        const { runner, queue, queueHooks } = setup();
        queue.enqueueImports([A]);

        jest.advanceTimersByTime(4 * MINUTE);
        runner.jobs[0].progress({ totalChannels: 1, totalPrograms: 100 });
        jest.advanceTimersByTime(4 * MINUTE);
        expect(runner.jobs[0].aborted).toBe(false);
        jest.advanceTimersByTime(MINUTE);
        expect(runner.jobs[0].aborted).toBe(true);

        await flush();
        expect(queueHooks.importFinished).toHaveBeenCalledWith(A, TIMED_OUT);
    });

    it('times out after an hour even with progress', async () => {
        const { runner, queue, queueHooks } = setup();
        queue.enqueueImports([A]);

        for (let minute = 1; minute < 60; minute += 1) {
            jest.advanceTimersByTime(MINUTE);
            runner.jobs[0].progress(FAKE_IMPORT_STATS);
        }
        expect(runner.jobs[0].aborted).toBe(false);
        jest.advanceTimersByTime(MINUTE);
        expect(runner.jobs[0].aborted).toBe(true);

        await flush();
        expect(queueHooks.importFinished).toHaveBeenCalledWith(A, TIMED_OUT);
    });

    it('does not stall a job while it publishes', async () => {
        const { runner, queue, queueHooks } = setup();
        queue.enqueueImports([A]);

        jest.advanceTimersByTime(MINUTE);
        runner.jobs[0].publishing();
        runner.jobs[0].progress(FAKE_IMPORT_STATS);
        jest.advanceTimersByTime(30 * MINUTE);
        expect(runner.jobs[0].aborted).toBe(false);

        runner.jobs[0].succeed();
        await flush();
        expect(queueHooks.importFinished).toHaveBeenCalledWith(A, {
            ok: true,
            stats: FAKE_IMPORT_STATS,
        });
    });

    it('still stops a publishing job at the wall clock', async () => {
        const { runner, queue, queueHooks } = setup();
        queue.enqueueImports([A]);

        runner.jobs[0].publishing();
        jest.advanceTimersByTime(60 * MINUTE - 1);
        expect(runner.jobs[0].aborted).toBe(false);
        jest.advanceTimersByTime(1);
        expect(runner.jobs[0].aborted).toBe(true);

        await flush();
        expect(queueHooks.importFinished).toHaveBeenCalledWith(A, TIMED_OUT);
    });

    it('terminates a job that ignores the abort', async () => {
        const { runner, queue, queueHooks } = setup(
            new FakeEpgJobRunner({ mode: 'manual' })
        );
        queue.enqueueImports([A]);

        jest.advanceTimersByTime(5 * MINUTE);
        expect(runner.jobs[0].aborted).toBe(true);
        expect(runner.jobs[0].terminated).toBe(false);
        jest.advanceTimersByTime(5_000);
        expect(runner.jobs[0].terminated).toBe(true);

        await flush();
        expect(queueHooks.importFinished).toHaveBeenCalledWith(A, TIMED_OUT);
    });

    it('clears a source: drops and cancels its imports, then clears first', async () => {
        const { runner, queue, queueHooks } = setup();
        queue.enqueueImports([A, B]);
        const cleared = queue.clear(A);

        expect(runner.jobs[0].aborted).toBe(true);
        await flush();
        expect(runner.kinds()).toEqual([`import:${A}`, `clear:${A}`]);

        runner.jobs[1].succeed();
        await expect(cleared).resolves.toBeUndefined();
        expect(queueHooks.cleared).toHaveBeenCalledWith(A);
        expect(queueHooks.importFinished).not.toHaveBeenCalled();
        await flush();
        expect(runner.kinds()).toEqual([
            `import:${A}`,
            `clear:${A}`,
            `import:${B}`,
        ]);
    });

    it('clears everything: drops every import and aborts the running one', async () => {
        const { runner, queue, queueHooks } = setup();
        queue.enqueueImports([A, B]);
        const cleared = queue.clear(null);
        await flush();

        runner.jobs[1].succeed();
        await cleared;
        await flush();
        expect(runner.kinds()).toEqual([`import:${A}`, 'clear:*']);
        expect(queueHooks.cleared).toHaveBeenCalledWith(null);
    });

    it('rejects a clear that failed', async () => {
        const { runner, queue } = setup();
        const cleared = queue.clear(A);

        runner.jobs[0].fail({ code: 'unknown', name: 'SqliteError' });
        await expect(cleared).rejects.toMatchObject({
            name: 'EpgClearFailedError',
            failure: { name: 'SqliteError' },
        });
    });

    it('runs maintenance once, after the queued imports', async () => {
        const { runner, queue, queueHooks } = setup();
        queue.enqueueImports([A]);
        queue.enqueueMaintenance();
        queue.enqueueMaintenance();

        runner.jobs[0].succeed();
        await flush();
        expect(runner.kinds()).toEqual([`import:${A}`, 'maintenance']);
        runner.jobs[1].succeed();
        await flush();
        expect(queueHooks.maintained).toHaveBeenCalledWith({ ok: true });
    });

    it('reports a runner that cannot start and keeps going', async () => {
        const queueHooks = hooks();
        const queue = new EpgImportQueue({
            run: () => {
                throw new TypeError('spawn failed');
            },
            hooks: queueHooks,
        });
        queue.enqueueImports([A, B]);
        await flush();

        expect(queueHooks.importFinished).toHaveBeenCalledTimes(2);
        expect(queueHooks.importFinished).toHaveBeenCalledWith(B, {
            ok: false,
            failure: { code: 'unknown', name: 'TypeError' },
        });
    });

    it('keeps going when a hook throws', async () => {
        const { runner, queue, queueHooks } = setup();
        queueHooks.importFinished.mockImplementation(() => {
            throw new Error('disk');
        });
        queue.enqueueImports([A, B]);

        runner.jobs[0].succeed();
        await flush();
        expect(queueHooks.hookFailed).toHaveBeenCalledTimes(1);
        expect(runner.importUrls()).toEqual([A, B]);
    });

    it('stops: aborts the running job, rejects waiting clears, starts nothing', async () => {
        const { runner, queue, queueHooks } = setup();
        queue.enqueueImports([A]);
        const waitingClear = queue.clear(B);

        const stopping = queue.stop();
        await expect(waitingClear).rejects.toThrow(
            'The EPG queue has stopped.'
        );
        await stopping;
        expect(runner.jobs[0].aborted).toBe(true);
        expect(queueHooks.importFinished).not.toHaveBeenCalled();

        queue.enqueueImports([B]);
        await flush();
        expect(runner.jobs).toHaveLength(1);
    });

    it('terminates on stop when the job does not end within 5 s', async () => {
        const { runner, queue } = setup(
            new FakeEpgJobRunner({ mode: 'manual' })
        );
        queue.enqueueImports([A]);

        const stopping = queue.stop();
        await flush();
        expect(runner.jobs[0].terminated).toBe(false);
        jest.advanceTimersByTime(5_000);
        await stopping;
        expect(runner.jobs[0].terminated).toBe(true);
    });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=epg-import-queue`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the job watch**

The timers around one job live in their own file, so the queue stays
below 300 lines.

`apps/web-backend/src/app/epg/epg-job-watch.ts`:

```ts
import type { EpgJobHandle } from './epg-worker-protocol';

export interface EpgJobWatchTimings {
    /** `null` for jobs without progress messages (clear, maintenance). */
    readonly stallTimeoutMs: number | null;
    readonly wallClockTimeoutMs: number;
    readonly abortGraceMs: number;
}

/**
 * The timers around one running job: a wall clock, a stall timer that each
 * progress message restarts, and abort-then-terminate.
 */
export class EpgJobWatch {
    /** A timer fired; the queue records `epg_timeout`. */
    timedOut = false;
    private handle: EpgJobHandle | null = null;
    private stallTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly wallTimer: ReturnType<typeof setTimeout>;
    private ended = false;
    private stallSuspended = false;

    constructor(private readonly timings: EpgJobWatchTimings) {
        this.wallTimer = setTimeout(
            () => this.expire(),
            timings.wallClockTimeoutMs
        );
        this.wallTimer.unref();
        this.touch();
    }

    attach(handle: EpgJobHandle): void {
        this.handle = handle;
    }

    /** Progress arrived: the stall timer starts again. */
    touch(): void {
        if (
            this.ended ||
            this.stallSuspended ||
            this.timings.stallTimeoutMs === null
        ) {
            return;
        }
        if (this.stallTimer) {
            clearTimeout(this.stallTimer);
        }
        this.stallTimer = setTimeout(
            () => this.expire(),
            this.timings.stallTimeoutMs
        );
        this.stallTimer.unref();
    }

    /**
     * The import entered its publish transaction, which sends no progress
     * and may take minutes on a NAS: only the wall clock applies from now.
     */
    suspendStall(): void {
        this.stallSuspended = true;
        if (this.stallTimer) {
            clearTimeout(this.stallTimer);
            this.stallTimer = null;
        }
    }

    /** Asks the job to stop; terminates it if it still runs after the grace. */
    stopJob(): void {
        const handle = this.handle;
        if (!handle || this.ended) {
            return;
        }
        handle.abort();
        const grace = setTimeout(() => {
            handle.terminate().catch(() => undefined);
        }, this.timings.abortGraceMs);
        grace.unref();
        const clear = () => clearTimeout(grace);
        handle.done.then(clear, clear);
    }

    end(): void {
        this.ended = true;
        clearTimeout(this.wallTimer);
        if (this.stallTimer) {
            clearTimeout(this.stallTimer);
        }
    }

    private expire(): void {
        if (this.ended) {
            return;
        }
        this.timedOut = true;
        this.stopJob();
    }
}

/** Whether `promise` settles within `ms`. */
export function settlesWithin(
    promise: Promise<unknown>,
    ms: number
): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        timer.unref();
        const settle = () => {
            clearTimeout(timer);
            resolve(true);
        };
        promise.then(settle, settle);
    });
}
```

- [ ] **Step 5: Implement the queue**

`apps/web-backend/src/app/epg/epg-import-queue.ts`:

```ts
import {
    EPG_IMPORT_ERROR_CODES,
    type EpgImportStats,
} from '@iptvnator/shared/epg-store';
import { SERVER_EPG_ERROR_CODES } from '@iptvnator/shared/interfaces';
import { EPG_FAILURE_UNKNOWN, type EpgFailure } from './epg-error-codes';
import { EpgJobWatch, settlesWithin } from './epg-job-watch';
import type {
    EpgJobHandle,
    EpgJobOutcome,
    EpgJobRunner,
    EpgWorkerJob,
} from './epg-worker-protocol';

export interface EpgQueueTimings {
    /** An import without a progress message for this long times out. */
    readonly stallTimeoutMs: number;
    /** Any job running this long times out. */
    readonly wallClockTimeoutMs: number;
    /** A request for a source that finished this recently is dropped. */
    readonly recentFinishMs: number;
    /** An aborted job still running after this is terminated. */
    readonly abortGraceMs: number;
}

export const EPG_QUEUE_TIMINGS: EpgQueueTimings = {
    stallTimeoutMs: 5 * 60_000,
    wallClockTimeoutMs: 60 * 60_000,
    recentFinishMs: 60_000,
    abortGraceMs: 5_000,
};

export interface EpgQueueHooks {
    /** Before an import starts (records the attempt). */
    importStarted(url: string): void;
    /** After an import that was not cancelled; timeouts included. */
    importFinished(url: string, outcome: EpgJobOutcome): void;
    /** After a clear job succeeded; `null` cleared everything. */
    cleared(url: string | null): void;
    /** After the prune-and-vacuum job, whatever its outcome. */
    maintained(outcome: EpgJobOutcome): void;
    /** A hook threw; the queue goes on. */
    hookFailed(error: unknown): void;
}

export interface EpgImportQueueOptions {
    readonly run: EpgJobRunner;
    readonly hooks: EpgQueueHooks;
    readonly timings?: Partial<EpgQueueTimings>;
    readonly now?: () => number;
}

export interface EpgQueueSnapshot {
    readonly running: {
        readonly url: string;
        readonly stats?: EpgImportStats;
    } | null;
    readonly queued: readonly string[];
}

export class EpgClearFailedError extends Error {
    constructor(readonly failure: EpgFailure) {
        super('Clearing EPG data failed.');
        this.name = 'EpgClearFailedError';
    }
}

type QueueEntry =
    | { readonly kind: 'import'; readonly url: string }
    | {
          readonly kind: 'clear';
          readonly url: string | null;
          readonly resolve: () => void;
          readonly reject: (error: Error) => void;
      }
    | { readonly kind: 'maintenance' };

interface RunningJob {
    readonly entry: QueueEntry;
    readonly watch: EpgJobWatch;
    handle: EpgJobHandle | null;
    stats?: EpgImportStats;
    cancelled: boolean;
}

const TIMEOUT_FAILURE: EpgFailure = {
    code: SERVER_EPG_ERROR_CODES.Timeout,
    name: 'EpgImportTimeout',
};
const STOPPED_MESSAGE = 'The EPG queue has stopped.';

/**
 * One EPG job at a time, first in first out. Imports of the same source
 * coalesce; a clear jumps the queue and cancels the imports of its source.
 */
export class EpgImportQueue {
    private readonly pending: QueueEntry[] = [];
    private readonly finishedAt = new Map<string, number>();
    private readonly timings: EpgQueueTimings;
    private readonly now: () => number;
    private running: RunningJob | null = null;
    private stopped = false;

    constructor(private readonly options: EpgImportQueueOptions) {
        this.timings = { ...EPG_QUEUE_TIMINGS, ...options.timings };
        this.now = options.now ?? (() => Date.now());
    }

    enqueueImports(urls: readonly string[]): void {
        if (this.stopped) {
            return;
        }
        const now = this.now();
        for (const url of urls) {
            const finished = this.finishedAt.get(url);
            const recent =
                finished !== undefined &&
                now - finished < this.timings.recentFinishMs;
            if (!recent && !this.hasImport(url)) {
                this.pending.push({ kind: 'import', url });
            }
        }
        this.pump();
    }

    enqueueMaintenance(): void {
        if (
            this.stopped ||
            this.pending.some((entry) => entry.kind === 'maintenance')
        ) {
            return;
        }
        this.pending.push({ kind: 'maintenance' });
        this.pump();
    }

    /** Resolves once the data is gone; `null` clears every source. */
    clear(url: string | null): Promise<void> {
        if (this.stopped) {
            return Promise.reject(new Error(STOPPED_MESSAGE));
        }
        const matches = (entry: QueueEntry | undefined) =>
            entry?.kind === 'import' && (url === null || entry.url === url);
        return new Promise<void>((resolve, reject) => {
            const kept = this.pending.filter((entry) => !matches(entry));
            this.pending.splice(0, this.pending.length, ...kept);
            if (url === null) {
                this.finishedAt.clear();
            } else {
                this.finishedAt.delete(url);
            }
            this.pending.unshift({ kind: 'clear', url, resolve, reject });
            const running = this.running;
            if (running && matches(running.entry)) {
                running.cancelled = true;
                running.watch.stopJob();
            }
            this.pump();
        });
    }

    /** Lets the next request for `url` run even if it finished recently. */
    forget(url: string): void {
        this.finishedAt.delete(url);
    }

    snapshot(): EpgQueueSnapshot {
        const running = this.running;
        return {
            running:
                running?.entry.kind === 'import'
                    ? {
                          url: running.entry.url,
                          ...(running.stats ? { stats: running.stats } : {}),
                      }
                    : null,
            queued: this.pending.flatMap((entry) =>
                entry.kind === 'import' ? [entry.url] : []
            ),
        };
    }

    /** Aborts the running job and waits for it; terminates it after the grace. */
    async stop(): Promise<void> {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        for (const entry of this.pending.splice(0)) {
            if (entry.kind === 'clear') {
                entry.reject(new Error(STOPPED_MESSAGE));
            }
        }
        const running = this.running;
        if (!running?.handle) {
            return;
        }
        running.cancelled = true;
        running.handle.abort();
        const ended = await settlesWithin(
            running.handle.done,
            this.timings.abortGraceMs
        );
        if (!ended) {
            await running.handle.terminate();
        }
    }

    private hasImport(url: string): boolean {
        return [this.running?.entry, ...this.pending].some(
            (entry) => entry?.kind === 'import' && entry.url === url
        );
    }

    private pump(): void {
        if (this.stopped || this.running) {
            return;
        }
        const entry = this.pending.shift();
        if (!entry) {
            return;
        }
        const running: RunningJob = {
            entry,
            watch: new EpgJobWatch({
                stallTimeoutMs:
                    entry.kind === 'import'
                        ? this.timings.stallTimeoutMs
                        : null,
                wallClockTimeoutMs: this.timings.wallClockTimeoutMs,
                abortGraceMs: this.timings.abortGraceMs,
            }),
            handle: null,
            cancelled: false,
        };
        this.running = running;
        void this.execute(running).finally(() => {
            this.running = null;
            this.pump();
        });
    }

    private async execute(running: RunningJob): Promise<void> {
        const { entry, watch } = running;
        let outcome: EpgJobOutcome;
        try {
            if (entry.kind === 'import') {
                this.options.hooks.importStarted(entry.url);
            }
            const handle = this.options.run(
                toWorkerJob(entry),
                (stats) => {
                    running.stats = stats;
                    watch.touch();
                },
                () => watch.suspendStall()
            );
            running.handle = handle;
            watch.attach(handle);
            outcome = await handle.done;
        } catch (error) {
            outcome = {
                ok: false,
                failure: {
                    code: EPG_FAILURE_UNKNOWN,
                    name: error instanceof Error ? error.name : typeof error,
                },
            };
        } finally {
            watch.end();
        }
        try {
            this.finish(running, outcome);
        } catch (error) {
            this.options.hooks.hookFailed(error);
        }
    }

    private finish(running: RunningJob, outcome: EpgJobOutcome): void {
        const { entry } = running;
        const { hooks } = this.options;
        if (entry.kind === 'clear') {
            if (!outcome.ok) {
                entry.reject(new EpgClearFailedError(outcome.failure));
                return;
            }
            try {
                hooks.cleared(entry.url);
            } finally {
                entry.resolve();
            }
            return;
        }
        if (entry.kind === 'maintenance') {
            hooks.maintained(outcome);
            return;
        }
        // Removed, cleared or shutting down: nothing to record.
        if (running.cancelled) {
            return;
        }
        this.finishedAt.set(entry.url, this.now());
        if (running.watch.timedOut) {
            hooks.importFinished(entry.url, {
                ok: false,
                failure: TIMEOUT_FAILURE,
            });
        } else if (
            outcome.ok ||
            outcome.failure.code !== EPG_IMPORT_ERROR_CODES.Aborted
        ) {
            hooks.importFinished(entry.url, outcome);
        }
    }
}

function toWorkerJob(entry: QueueEntry): EpgWorkerJob {
    return entry.kind === 'clear' ? { kind: 'clear', url: entry.url } : entry;
}
```

- [ ] **Step 6: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns=epg-import-queue
pnpm nx lint web-backend
git add apps/web-backend/src/app/epg/epg-import-queue.ts apps/web-backend/src/app/epg/epg-job-watch.ts apps/web-backend/src/app/epg/fake-epg-job-runner.spec-helpers.ts apps/web-backend/src/app/epg/epg-import-queue.spec.ts
git commit -m "feat(web-backend): one-at-a-time EPG import queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 15 tests; lint clean (the queue has about 280 counted lines, below the 300 target).

---

### Task 10: Status

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-status.ts`
- Test: `apps/web-backend/src/app/epg/epg-status.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import type Database from 'better-sqlite3';
import type { EpgImportRecord } from './epg-import-records';
import { buildEpgStatus, ProgrammeCounter } from './epg-status';

const [A, B, C, D, E, F] = ['a', 'b', 'c', 'd', 'e', 'f'].map(
    (name) => `https://epg.example/${name}.xml`
);
const owners = { global: true, playlists: 0 };

function record(
    sourceUrl: string,
    fields: Partial<EpgImportRecord>
): EpgImportRecord {
    return {
        sourceUrl,
        lastAttemptAt: null,
        lastSuccessAt: null,
        channels: null,
        programmes: null,
        errorCode: null,
        errorHost: null,
        ...fields,
    };
}

describe('buildEpgStatus', () => {
    it('reports each source with its state, history and queue position', () => {
        const status = buildEpgStatus({
            revision: 7,
            settings: { urls: [A], refreshTime: '04:00' },
            timeZone: 'Europe/Berlin',
            nextRunAt: new Date('2026-10-16T02:00:00.000Z'),
            sources: [A, B, C, D, E].map((url) => ({ url, owners })),
            overflow: [{ url: F, owners: { global: false, playlists: 1 } }],
            records: new Map([
                [
                    A,
                    record(A, {
                        lastAttemptAt: '2026-10-15T02:00:00.000Z',
                        lastSuccessAt: '2026-10-15T02:01:00.000Z',
                        channels: 2,
                        programmes: 30,
                    }),
                ],
                [
                    D,
                    record(D, {
                        lastAttemptAt: '2026-10-15T02:02:00.000Z',
                        errorCode: 'epg_http_status',
                        errorHost: 'epg.example',
                    }),
                ],
                [
                    E,
                    record(E, {
                        lastAttemptAt: '2026-10-15T02:03:00.000Z',
                        errorCode: 'unknown',
                    }),
                ],
            ]),
            queue: {
                running: {
                    url: B,
                    stats: { totalChannels: 1, totalPrograms: 10 },
                },
                queued: [C],
            },
            totalProgrammes: 30,
            databaseBytes: 4096,
        });

        expect(status).toEqual({
            revision: 7,
            refreshTime: '04:00',
            timeZone: 'Europe/Berlin',
            nextRunAt: '2026-10-16T02:00:00.000Z',
            sources: [
                {
                    url: A,
                    owners,
                    state: 'idle',
                    lastAttemptAt: '2026-10-15T02:00:00.000Z',
                    lastSuccessAt: '2026-10-15T02:01:00.000Z',
                    channels: 2,
                    programmes: 30,
                },
                {
                    url: B,
                    owners,
                    state: 'loading',
                    stats: { totalChannels: 1, totalPrograms: 10 },
                },
                { url: C, owners, state: 'queued', queuePosition: 1 },
                {
                    url: D,
                    owners,
                    state: 'error',
                    lastAttemptAt: '2026-10-15T02:02:00.000Z',
                    errorCode: 'epg_http_status',
                    errorHost: 'epg.example',
                },
                {
                    url: E,
                    owners,
                    state: 'error',
                    lastAttemptAt: '2026-10-15T02:03:00.000Z',
                },
                {
                    url: F,
                    owners: { global: false, playlists: 1 },
                    state: 'error',
                    errorCode: 'epg_too_many_sources',
                },
            ],
            totals: { programmes: 30, databaseBytes: 4096 },
        });
    });

    it('has no next run without a schedule', () => {
        expect(
            buildEpgStatus({
                revision: 1,
                settings: { urls: [], refreshTime: '04:00' },
                timeZone: 'UTC',
                nextRunAt: null,
                sources: [],
                overflow: [],
                records: new Map(),
                queue: { running: null, queued: [] },
                totalProgrammes: 0,
                databaseBytes: 0,
            }).nextRunAt
        ).toBeNull();
    });
});

describe('ProgrammeCounter', () => {
    it('counts again only after the revision moved', () => {
        let count = 5;
        let reads = 0;
        const db = {
            prepare: () => ({
                get: () => {
                    reads += 1;
                    return { count };
                },
            }),
        } as unknown as Database.Database;
        const counter = new ProgrammeCounter(db);

        expect(counter.count(1)).toBe(5);
        count = 9;
        expect(counter.count(1)).toBe(5);
        expect(counter.count(2)).toBe(9);
        expect(reads).toBe(2);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=epg-status`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type Database from 'better-sqlite3';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    SERVER_EPG_ERROR_CODES,
    type ServerEpgErrorCode,
    type ServerEpgSettings,
    type ServerEpgSourceStatus,
    type ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import type { EpgImportRecord } from './epg-import-records';
import type { EpgQueueSnapshot } from './epg-import-queue';
import type { EpgSourceEntry } from './epg-source-registry';

/** Codes a client may see; `unknown` stays internal (state `error`, no code). */
const KNOWN_ERROR_CODES = new Set<string>([
    ...Object.values(SERVER_EPG_ERROR_CODES),
    ...Object.values(ELECTRON_BRIDGE_SECURITY_ERROR_CODES),
]);

export interface EpgStatusInput {
    readonly revision: number;
    readonly settings: ServerEpgSettings;
    readonly timeZone: string;
    readonly nextRunAt: Date | null;
    readonly sources: readonly EpgSourceEntry[];
    readonly overflow: readonly EpgSourceEntry[];
    readonly records: ReadonlyMap<string, EpgImportRecord>;
    readonly queue: EpgQueueSnapshot;
    readonly totalProgrammes: number;
    readonly databaseBytes: number;
}

export function buildEpgStatus(input: EpgStatusInput): ServerEpgStatus {
    const positions = new Map(
        input.queue.queued.map((url, index) => [url, index + 1])
    );
    return {
        revision: input.revision,
        refreshTime: input.settings.refreshTime,
        timeZone: input.timeZone,
        nextRunAt: input.nextRunAt?.toISOString() ?? null,
        sources: [
            ...input.sources.map((entry) =>
                sourceStatus(entry, input, positions.get(entry.url))
            ),
            ...input.overflow.map((entry): ServerEpgSourceStatus => ({
                url: entry.url,
                owners: entry.owners,
                state: 'error',
                errorCode: SERVER_EPG_ERROR_CODES.TooManySources,
            })),
        ],
        totals: {
            programmes: input.totalProgrammes,
            databaseBytes: input.databaseBytes,
        },
    };
}

function sourceStatus(
    entry: EpgSourceEntry,
    input: EpgStatusInput,
    queuePosition: number | undefined
): ServerEpgSourceStatus {
    const record = input.records.get(entry.url);
    const base = { url: entry.url, owners: entry.owners, ...history(record) };
    const running = input.queue.running;
    if (running?.url === entry.url) {
        return {
            ...base,
            state: 'loading',
            ...(running.stats
                ? {
                      stats: {
                          totalChannels: running.stats.totalChannels,
                          totalPrograms: running.stats.totalPrograms,
                      },
                  }
                : {}),
        };
    }
    if (queuePosition !== undefined) {
        return { ...base, state: 'queued', queuePosition };
    }
    if (record?.errorCode) {
        return {
            ...base,
            state: 'error',
            ...(KNOWN_ERROR_CODES.has(record.errorCode)
                ? { errorCode: record.errorCode as ServerEpgErrorCode }
                : {}),
            ...(record.errorHost ? { errorHost: record.errorHost } : {}),
        };
    }
    return { ...base, state: 'idle' };
}

function history(
    record: EpgImportRecord | undefined
): Partial<ServerEpgSourceStatus> {
    if (!record) {
        return {};
    }
    return {
        ...(record.lastAttemptAt
            ? { lastAttemptAt: record.lastAttemptAt }
            : {}),
        ...(record.lastSuccessAt
            ? { lastSuccessAt: record.lastSuccessAt }
            : {}),
        ...(record.channels !== null ? { channels: record.channels } : {}),
        ...(record.programmes !== null
            ? { programmes: record.programmes }
            : {}),
    };
}

/** `COUNT(*)` of `epg_programs`, read again only after the revision moved. */
export class ProgrammeCounter {
    private readonly statement: Database.Statement;
    private cached: {
        readonly revision: number;
        readonly count: number;
    } | null = null;

    constructor(db: Database.Database) {
        this.statement = db.prepare(
            'SELECT COUNT(*) AS count FROM epg_programs'
        );
    }

    count(revision: number): number {
        if (this.cached?.revision !== revision) {
            const row = this.statement.get() as { count: number };
            this.cached = { revision, count: row.count };
        }
        return this.cached.count;
    }
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns=epg-status
git add apps/web-backend/src/app/epg/epg-status.ts apps/web-backend/src/app/epg/epg-status.spec.ts
git commit -m "feat(web-backend): build the server EPG status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 3 tests.

---

### Task 11: Jobs in a worker thread

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-source-opener.ts`
- Create: `apps/web-backend/src/app/epg/epg-worker-job.ts`
- Create: `apps/web-backend/src/app/epg/epg-import.worker.ts`
- Create: `apps/web-backend/src/app/epg/epg-worker-runner.ts`
- Create: `apps/web-backend/src/app/epg/xmltv.spec-helpers.ts`
- Test: `apps/web-backend/src/app/epg/epg-import-worker.spec.ts`

- [ ] **Step 1: Create the XMLTV spec helpers**

`apps/web-backend/src/app/epg/xmltv.spec-helpers.ts`:

```ts
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { EpgSourceOpener } from '@iptvnator/shared/epg-store';

export interface XmltvChannel {
    readonly id: string;
    readonly name: string;
}

export interface XmltvProgramme {
    readonly channel: string;
    readonly start: number;
    readonly stop: number;
    readonly title: string;
}

const HALF_HOUR_MS = 30 * 60 * 1000;

function xmltvTime(ms: number): string {
    const digits = new Date(ms).toISOString().replace(/[-:T]/g, '');
    return `${digits.slice(0, 14)} +0000`;
}

function xmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function xmltv(
    channels: readonly XmltvChannel[],
    programmes: readonly XmltvProgramme[]
): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        ...channels.map(
            (channel) =>
                `<channel id="${xmlText(channel.id)}"><display-name>${xmlText(channel.name)}</display-name></channel>`
        ),
        ...programmes.map(
            (programme) =>
                `<programme start="${xmltvTime(programme.start)}" stop="${xmltvTime(programme.stop)}" channel="${xmlText(programme.channel)}"><title>${xmlText(programme.title)}</title></programme>`
        ),
        '</tv>',
    ].join('\n');
}

/** Half-hour programmes per channel, starting two hours before `aroundMs`. */
export function guideAround(
    aroundMs: number,
    channels: readonly XmltvChannel[],
    perChannel: number,
    title: (channel: XmltvChannel, index: number) => string = (
        channel,
        index
    ) => `${channel.name} show ${index}`
): string {
    const first = aroundMs - 4 * HALF_HOUR_MS;
    return xmltv(
        channels,
        channels.flatMap((channel) =>
            Array.from({ length: perChannel }, (_, index) => ({
                channel: channel.id,
                start: first + index * HALF_HOUR_MS,
                stop: first + (index + 1) * HALF_HOUR_MS,
                title: title(channel, index),
            }))
        )
    );
}

/** An opener that serves `xml` from memory, for imports without HTTP. */
export function memoryOpener(xml: string): EpgSourceOpener {
    return async (url) => ({
        stream: Readable.from([Buffer.from(xml, 'utf8')]),
        requestUrl: url,
        finalUrl: url,
        headers: { 'content-type': 'application/xml' },
    });
}

export type XmltvRoute = (req: IncomingMessage, res: ServerResponse) => void;

export function gzipFeed(xml: string): XmltvRoute {
    const body = gzipSync(xml);
    return (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/gzip' });
        res.end(body);
    };
}

/** Starts a feed and never finishes it. */
export function hangingFeed(): XmltvRoute {
    return (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.write('<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n');
    };
}

export interface XmltvServer {
    readonly baseUrl: string;
    hits(path: string): number;
    close(): Promise<void>;
}

/** Serves `routes` on 127.0.0.1; any other path answers 404. */
export async function startXmltvServer(
    routes: Readonly<Record<string, XmltvRoute>>
): Promise<XmltvServer> {
    const hits = new Map<string, number>();
    const server = createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        hits.set(path, (hits.get(path) ?? 0) + 1);
        const route = routes[path];
        if (route) {
            route(req, res);
            return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        hits: (path) => hits.get(path) ?? 0,
        close: () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    };
}

export async function waitFor(
    condition: () => boolean,
    timeoutMs = 10_000
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error('The condition did not become true in time.');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
```

- [ ] **Step 2: Write the failing spec**

`apps/web-backend/src/app/epg/epg-import-worker.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EPG_IMPORT_ERROR_CODES } from '@iptvnator/shared/epg-store';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    SERVER_EPG_ERROR_CODES,
} from '@iptvnator/shared/interfaces';
import { openEpgDatabase, type EpgDatabase } from './epg-database';
import { EpgImportQueue } from './epg-import-queue';
import type {
    EpgImportSettings,
    EpgJobHandle,
    EpgJobRunner,
    EpgWorkerJob,
} from './epg-worker-protocol';
import { runEpgWorkerJob } from './epg-worker-job';
import {
    createWorkerJobRunner,
    resolveEpgWorkerScript,
} from './epg-worker-runner';
import {
    guideAround,
    gzipFeed,
    hangingFeed,
    startXmltvServer,
    waitFor,
    type XmltvServer,
} from './xmltv.spec-helpers';

// Each worker compiles its TypeScript with tsx on start.
jest.setTimeout(60_000);

/** `apps/web-backend/src`, the folder of `main.ts`. */
const WORKER_ROOT = join(__dirname, '..', '..');
const channels = [
    { id: 'one', name: 'Channel One' },
    { id: 'two', name: 'Channel Two' },
];
const lan: EpgImportSettings = {
    maxDecompressedBytes: 256 * 1024,
    allowPrivateNetworks: true,
};
const noop = () => undefined;

describe('EPG import jobs', () => {
    let feeds: XmltvServer;
    let dir: string;
    let database: EpgDatabase;

    beforeAll(async () => {
        const now = Date.now();
        feeds = await startXmltvServer({
            '/guide.xml.gz': gzipFeed(guideAround(now, channels, 10)),
            // About 1.4 MB of XML, a few kilobytes gzipped.
            '/huge.xml.gz': gzipFeed(
                guideAround(
                    now,
                    channels,
                    2000,
                    (channel, index) =>
                        `${channel.name} ${'a long title '.repeat(20)} ${index}`
                )
            ),
            '/hang.xml': hangingFeed(),
        });
    });

    afterAll(() => feeds.close());

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'iptvnator-epg-worker-'));
        database = openEpgDatabase(join(dir, 'epg.db'));
    });

    afterEach(() => {
        database.close();
        rmSync(dir, { recursive: true, force: true });
    });

    const programmeCount = () =>
        (
            database.db
                .prepare('SELECT COUNT(*) AS count FROM epg_programs')
                .get() as { count: number }
        ).count;
    const inThread = (job: EpgWorkerJob, onPublishStart: () => void = noop) =>
        runEpgWorkerJob(
            { dbPath: database.path, job, importSettings: lan },
            {
                signal: new AbortController().signal,
                onProgress: noop,
                onPublishStart,
            }
        );
    const runner = (settings: EpgImportSettings = lan) =>
        createWorkerJobRunner({
            workerScript: resolveEpgWorkerScript(WORKER_ROOT),
            dbPath: database.path,
            importSettings: settings,
        });

    describe('in this thread', () => {
        it('imports a gzip feed, prunes nothing recent and clears the source', async () => {
            const url = `${feeds.baseUrl}/guide.xml.gz`;
            const onPublishStart = jest.fn();

            await expect(
                inThread({ kind: 'import', url }, onPublishStart)
            ).resolves.toMatchObject({ totalChannels: 2, totalPrograms: 20 });
            expect(programmeCount()).toBe(20);
            expect(onPublishStart).toHaveBeenCalledTimes(1);

            await inThread({ kind: 'maintenance' });
            expect(programmeCount()).toBe(20);

            await inThread({ kind: 'clear', url });
            expect(programmeCount()).toBe(0);
        });
    });

    describe('in a worker thread', () => {
        it('imports a gzip feed from a LAN host and reports the publish', async () => {
            const onPublishing = jest.fn();
            const handle = runner()(
                { kind: 'import', url: `${feeds.baseUrl}/guide.xml.gz` },
                noop,
                onPublishing
            );

            await expect(handle.done).resolves.toMatchObject({
                ok: true,
                stats: { totalChannels: 2, totalPrograms: 20 },
            });
            expect(programmeCount()).toBe(20);
            expect(onPublishing).toHaveBeenCalledTimes(1);
        });

        it('stops at the decompressed size cap and keeps nothing', async () => {
            const handle = runner()(
                { kind: 'import', url: `${feeds.baseUrl}/huge.xml.gz` },
                noop
            );

            await expect(handle.done).resolves.toMatchObject({
                ok: false,
                failure: { code: SERVER_EPG_ERROR_CODES.TooLarge },
            });
            expect(programmeCount()).toBe(0);
        });

        it('blocks a LAN source without the private-network flag', async () => {
            const handle = runner({ ...lan, allowPrivateNetworks: false })(
                { kind: 'import', url: `${feeds.baseUrl}/guide.xml.gz` },
                noop
            );

            await expect(handle.done).resolves.toMatchObject({
                ok: false,
                failure: {
                    code: ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked,
                    host: '127.0.0.1',
                },
            });
        });

        it('reports an HTTP error status', async () => {
            const handle = runner()(
                { kind: 'import', url: `${feeds.baseUrl}/missing.xml` },
                noop
            );

            await expect(handle.done).resolves.toMatchObject({
                ok: false,
                failure: {
                    code: SERVER_EPG_ERROR_CODES.HttpStatus,
                    host: '127.0.0.1',
                },
            });
        });

        it('aborts a running import', async () => {
            const before = feeds.hits('/hang.xml');
            const handle = runner()(
                { kind: 'import', url: `${feeds.baseUrl}/hang.xml` },
                noop
            );
            await waitFor(() => feeds.hits('/hang.xml') > before, 30_000);

            handle.abort();
            await expect(handle.done).resolves.toMatchObject({
                ok: false,
                failure: { code: EPG_IMPORT_ERROR_CODES.Aborted },
            });
        });

        it('stops the queue on shutdown within the grace period', async () => {
            const handles: EpgJobHandle[] = [];
            const real = runner();
            const run: EpgJobRunner = (job, onProgress) => {
                const handle = real(job, onProgress);
                handles.push(handle);
                return handle;
            };
            const importFinished = jest.fn();
            const queue = new EpgImportQueue({
                run,
                hooks: {
                    importStarted: noop,
                    importFinished,
                    cleared: noop,
                    maintained: noop,
                    hookFailed: noop,
                },
            });
            const before = feeds.hits('/hang.xml');
            queue.enqueueImports([`${feeds.baseUrl}/hang.xml`]);
            await waitFor(() => feeds.hits('/hang.xml') > before, 30_000);

            const started = Date.now();
            await queue.stop();

            expect(Date.now() - started).toBeLessThan(5_500);
            await expect(handles[0].done).resolves.toMatchObject({ ok: false });
            expect(importFinished).not.toHaveBeenCalled();
        });
    });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=epg-import-worker`
Expected: FAIL, modules `./epg-worker-job` and `./epg-worker-runner` not found.

- [ ] **Step 4: Implement the opener and the job**

`apps/web-backend/src/app/epg/epg-source-opener.ts` (the only file that
calls `ValidatedHttpClient.stream()`):

```ts
import type { EpgSourceOpener } from '@iptvnator/shared/epg-store';
import { resolveHostname } from '../provider-url-policy';
import { ValidatedHttpClient } from '../validated-http-client';
import type { EpgImportSettings } from './epg-worker-protocol';

/**
 * Socket inactivity allowed before the headers and between body chunks.
 * Some providers build `xmltv.php` for a minute before the first byte; a
 * silent body fails with `ECONNABORTED` (`epg_timeout`) well before the
 * queue's five-minute stall timer.
 */
export const EPG_SOCKET_TIMEOUT_MS = 120_000;

/**
 * XMLTV fetches keep the proxy's URL policy, DNS pinning and redirect rules
 * (`ValidatedHttpClient.stream`); private networks need the EPG or proxy
 * flag. The body arrives undecoded and `runEpgImport` decodes it, so the
 * wire cap can equal the decompressed cap: the wire is never larger.
 */
export function createEpgSourceOpener(
    settings: EpgImportSettings,
    client = new ValidatedHttpClient({
        allowPrivateNetworkTargets: settings.allowPrivateNetworks,
        resolveHostname,
    })
): EpgSourceOpener {
    return async (url, signal) => {
        const response = await client.stream(url, {
            signal,
            maxBytes: settings.maxDecompressedBytes,
            timeout: EPG_SOCKET_TIMEOUT_MS,
        });
        return {
            stream: response.stream,
            requestUrl: response.requestUrl,
            finalUrl: response.finalUrl,
            headers: response.headers,
        };
    };
}
```

`apps/web-backend/src/app/epg/epg-worker-job.ts`:

```ts
import {
    clearAllEpgData,
    clearEpgSource,
    pruneEpgPrograms,
    runEpgImport,
    type EpgImportStats,
} from '@iptvnator/shared/epg-store';
import { openEpgConnection } from './epg-database';
import { createEpgSourceOpener } from './epg-source-opener';
import { EPG_PAST_DAYS_KEPT, type EpgWorkerData } from './epg-worker-protocol';

export interface EpgWorkerJobContext {
    readonly signal: AbortSignal;
    readonly onProgress: (stats: EpgImportStats) => void;
    /** Right before the import's publish transaction. */
    readonly onPublishStart: () => void;
}

/**
 * Runs one job on its own epg.db connection. The worker entry calls it;
 * specs call it in-thread. A throw is classified by the caller.
 */
export async function runEpgWorkerJob(
    data: EpgWorkerData,
    context: EpgWorkerJobContext
): Promise<EpgImportStats | undefined> {
    const db = openEpgConnection(data.dbPath, { schema: false });
    try {
        const { job } = data;
        if (job.kind === 'import') {
            return await runEpgImport({
                url: job.url,
                db,
                openSource: createEpgSourceOpener(data.importSettings),
                signal: context.signal,
                onProgress: context.onProgress,
                onPublishStart: context.onPublishStart,
                maxDecompressedBytes: data.importSettings.maxDecompressedBytes,
            });
        }
        if (job.kind === 'clear') {
            if (job.url === null) {
                clearAllEpgData(db);
            } else {
                clearEpgSource(db, job.url);
            }
            return undefined;
        }
        pruneEpgPrograms(db, { olderThanDays: EPG_PAST_DAYS_KEPT });
        db.exec('PRAGMA incremental_vacuum');
        return undefined;
    } finally {
        db.close();
    }
}
```

- [ ] **Step 5: Implement the worker entry**

`apps/web-backend/src/app/epg/epg-import.worker.ts`:

```ts
import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { applyDefaultAutoSelectFamilyAttemptTimeout } from '@iptvnator/shared/host-health';
import { classifyEpgFailure } from './epg-error-codes';
import type {
    EpgWorkerCommand,
    EpgWorkerData,
    EpgWorkerMessage,
} from './epg-worker-protocol';
import { runEpgWorkerJob } from './epg-worker-job';

/** Progress goes out at most this often; each message restarts the stall timer. */
const PROGRESS_INTERVAL_MS = 500;

async function runJob(port: MessagePort, data: EpgWorkerData): Promise<void> {
    // The IPv6/IPv4 fallback budget is set per thread (see main.ts).
    applyDefaultAutoSelectFamilyAttemptTimeout();
    const controller = new AbortController();
    port.on('message', (command: EpgWorkerCommand) => {
        if (command.type === 'abort') {
            controller.abort();
        }
    });
    const send = (message: EpgWorkerMessage) => port.postMessage(message);
    let lastProgressAt = 0;
    try {
        const stats = await runEpgWorkerJob(data, {
            signal: controller.signal,
            onProgress: ({ totalChannels, totalPrograms }) => {
                const now = Date.now();
                if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
                    lastProgressAt = now;
                    send({
                        type: 'progress',
                        stats: { totalChannels, totalPrograms },
                    });
                }
            },
            // The publish transaction sends no progress; the queue then
            // stops its stall timer and keeps only the wall clock.
            onPublishStart: () => send({ type: 'publishing' }),
        });
        send(
            stats
                ? {
                      type: 'done',
                      stats: {
                          totalChannels: stats.totalChannels,
                          totalPrograms: stats.totalPrograms,
                      },
                  }
                : { type: 'done' }
        );
    } catch (error) {
        const url = data.job.kind === 'import' ? data.job.url : '';
        send({
            type: 'failed',
            failure: classifyEpgFailure(error, url, controller.signal.aborted),
        });
    } finally {
        // Lets the thread end once the answer is out.
        port.unref();
    }
}

if (parentPort) {
    void runJob(parentPort, workerData as EpgWorkerData);
}
```

- [ ] **Step 6: Implement the runner**

`apps/web-backend/src/app/epg/epg-worker-runner.ts`:

```ts
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { SERVER_EPG_ERROR_CODES } from '@iptvnator/shared/interfaces';
import { EPG_FAILURE_UNKNOWN } from './epg-error-codes';
import type {
    EpgImportSettings,
    EpgJobHandle,
    EpgJobOutcome,
    EpgJobRunner,
    EpgWorkerCommand,
    EpgWorkerData,
    EpgWorkerMessage,
} from './epg-worker-protocol';

/** Heap of one import worker (spec section 11). */
export const EPG_WORKER_HEAP_MB = 512;

/**
 * The entry below the folder of `main.ts` and of `main.cjs`: esbuild keeps
 * its path relative to the entries' common folder (`src/`).
 */
const WORKER_ENTRY = join('app', 'epg', 'epg-import.worker');

/** The bundled `.cjs`, else the TypeScript source (tsx, Jest). */
export function resolveEpgWorkerScript(rootDir: string): string {
    for (const extension of ['.cjs', '.ts']) {
        const candidate = join(rootDir, `${WORKER_ENTRY}${extension}`);
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error('The EPG import worker is not part of this build.');
}

export interface WorkerJobRunnerOptions {
    readonly workerScript: string;
    readonly dbPath: string;
    readonly importSettings: EpgImportSettings;
}

/** One worker thread per job. */
export function createWorkerJobRunner(
    options: WorkerJobRunnerOptions
): EpgJobRunner {
    return (job, onProgress, onPublishing) => {
        const worker = startWorker(options.workerScript, {
            dbPath: options.dbPath,
            job,
            importSettings: options.importSettings,
        });
        let settled = false;
        let resolveDone: (outcome: EpgJobOutcome) => void = () => undefined;
        const done = new Promise<EpgJobOutcome>((resolveOutcome) => {
            resolveDone = resolveOutcome;
        });
        const settle = (outcome: EpgJobOutcome) => {
            if (!settled) {
                settled = true;
                resolveDone(outcome);
            }
        };
        worker.on('message', (message: EpgWorkerMessage) => {
            if (message.type === 'progress') {
                onProgress(message.stats);
            } else if (message.type === 'publishing') {
                onPublishing?.();
            } else if (message.type === 'done') {
                settle(
                    message.stats
                        ? { ok: true, stats: message.stats }
                        : { ok: true }
                );
            } else {
                settle({ ok: false, failure: message.failure });
            }
        });
        worker.on('error', (error: Error & { code?: string }) => {
            settle({
                ok: false,
                failure: {
                    code:
                        error.code === 'ERR_WORKER_OUT_OF_MEMORY'
                            ? SERVER_EPG_ERROR_CODES.TooLarge
                            : EPG_FAILURE_UNKNOWN,
                    name: error.name,
                },
            });
        });
        worker.on('exit', (code) => {
            settle({
                ok: false,
                failure: {
                    code: EPG_FAILURE_UNKNOWN,
                    name: `WorkerExit${code}`,
                },
            });
        });
        const handle: EpgJobHandle = {
            done,
            abort: () => {
                if (!settled) {
                    const command: EpgWorkerCommand = { type: 'abort' };
                    worker.postMessage(command);
                }
            },
            terminate: async () => {
                await worker.terminate();
            },
        };
        return handle;
    };
}

function startWorker(script: string, workerData: EpgWorkerData): Worker {
    const resourceLimits = { maxOldGenerationSizeMb: EPG_WORKER_HEAP_MB };
    if (!script.endsWith('.ts')) {
        return new Worker(script, { workerData, resourceLimits });
    }
    // Source runs (`node --import tsx`, `pnpm tsx`, Jest): register tsx in
    // the worker. `execArgv: []` keeps a parent's `--import tsx` from loading
    // it twice; TSX_TSCONFIG_PATH brings the @iptvnator/* path aliases.
    const tsconfig = resolve(
        process.env['TSX_TSCONFIG_PATH'] ?? 'tsconfig.base.json'
    );
    const bootstrap = [
        `process.env.TSX_TSCONFIG_PATH = ${JSON.stringify(tsconfig)};`,
        `require('tsx/cjs/api').register();`,
        `require(${JSON.stringify(script)});`,
    ].join('\n');
    return new Worker(bootstrap, {
        eval: true,
        execArgv: [],
        workerData,
        resourceLimits,
    });
}
```

- [ ] **Step 7: Run to verify it passes**

```bash
pnpm nx test web-backend --testPathPatterns=epg-import-worker
```

Expected: PASS, 7 tests (each worker compiles with tsx in roughly 0.1–2 s). The `eval` bootstrap resolves `tsx/cjs/api` and the tsconfig from `process.cwd()`, which is the workspace root under Nx Jest (`project-config.spec.ts` relies on it), Playwright and `serve`. If the worker fails with `Cannot find module 'tsx/cjs/api'` or with an unresolved `@iptvnator/*` alias, check that cwd and that `tsconfig.base.json` resolves; as a fallback, start the `.ts` worker with `execArgv: ['--import', 'tsx']` and the file path instead of the `eval` bootstrap, pass `TSX_TSCONFIG_PATH` through the worker's `env` option, and record the change in the PR body.

- [ ] **Step 8: Commit**

```bash
pnpm nx lint web-backend
git add apps/web-backend/src/app/epg/epg-source-opener.ts apps/web-backend/src/app/epg/epg-worker-job.ts apps/web-backend/src/app/epg/epg-import.worker.ts apps/web-backend/src/app/epg/epg-worker-runner.ts apps/web-backend/src/app/epg/xmltv.spec-helpers.ts apps/web-backend/src/app/epg/epg-import-worker.spec.ts
git commit -m "feat(web-backend): run EPG imports in a worker thread

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Bundle the worker

**Files:**
- Modify: `apps/web-backend/project.json`
- Test: `apps/web-backend/src/app/project-config.spec.ts`

- [ ] **Step 1: Write the failing test**

In `apps/web-backend/src/app/project-config.spec.ts`, replace

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
```

with

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveEpgWorkerScript } from './epg/epg-worker-runner';
```

and append at the end of the file:

```ts

describe('web-backend build', () => {
    const worker = 'apps/web-backend/src/app/epg/epg-import.worker.ts';
    const build = (
        JSON.parse(
            readFileSync(join(process.cwd(), 'apps/web-backend/project.json'), 'utf8')
        ) as {
            targets: {
                build: {
                    options: { main: string; additionalEntryPoints?: string[] };
                };
            };
        }
    ).targets.build.options;

    // esbuild writes each output relative to the entries' common folder
    // (src/), so the bundle has app/epg/epg-import.worker.cjs beside main.cjs,
    // where resolveEpgWorkerScript looks for it.
    it('bundles the EPG import worker as a second entry beside main', () => {
        expect(build.additionalEntryPoints).toEqual([worker]);
        expect(dirname(build.main)).toBe('apps/web-backend/src');
        expect(
            resolveEpgWorkerScript(join(process.cwd(), dirname(build.main)))
        ).toBe(join(process.cwd(), worker));
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=project-config`
Expected: FAIL, `additionalEntryPoints` is `undefined`.

- [ ] **Step 3: Add the entry**

In `apps/web-backend/project.json`, replace

```json
                "generatePackageJson": true,
                "external": ["better-sqlite3"]
            },
```

with

```json
                "generatePackageJson": true,
                "external": ["better-sqlite3"],
                "additionalEntryPoints": [
                    "apps/web-backend/src/app/epg/epg-import.worker.ts"
                ]
            },
```

- [ ] **Step 4: Run the spec and build**

```bash
pnpm nx test web-backend --testPathPatterns=project-config
pnpm nx build web-backend --skip-nx-cache
ls dist/apps/web-backend/main.cjs dist/apps/web-backend/app/epg/epg-import.worker.cjs
grep -c 'require("better-sqlite3")' dist/apps/web-backend/app/epg/epg-import.worker.cjs
```

Expected: PASS; the build succeeds (it type-checks `tsconfig.app.json`); both files exist; the grep prints at least `1` (the native module stays external in the worker bundle and resolves from `web-backend/node_modules` in the image). If esbuild placed the outputs elsewhere, set `"esbuildOptions": { "outbase": "apps/web-backend/src" }` in the same `options` object and build again.

- [ ] **Step 5: Commit**

```bash
git add apps/web-backend/project.json apps/web-backend/src/app/project-config.spec.ts
git commit -m "build(web-backend): bundle the EPG import worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: EPG service and start-up

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-service.ts`
- Create: `apps/web-backend/src/app/epg/open-server-epg.ts`
- Create: `apps/web-backend/src/app/epg/epg.spec-helpers.ts`
- Test: `apps/web-backend/src/app/epg/epg-service.spec.ts`
- Test: `apps/web-backend/src/app/epg/open-server-epg.spec.ts`

- [ ] **Step 1: Create the spec helper**

`apps/web-backend/src/app/epg/epg.spec-helpers.ts`:

```ts
import type { ServerStorage } from '../storage/server-storage';
import { withTempStorage } from '../storage/server-storage.spec-helpers';
import { openEpgDatabase, type EpgDatabase } from './epg-database';
import type { EpgQueueTimings } from './epg-import-queue';
import { startServerEpg, type EpgLogger, type ServerEpg } from './epg-service';
import { FakeEpgJobRunner } from './fake-epg-job-runner.spec-helpers';

export interface TempEpg {
    readonly storage: ServerStorage;
    readonly database: EpgDatabase;
    readonly epg: ServerEpg;
    readonly runner: FakeEpgJobRunner;
    readonly logs: string[];
}

export interface TempEpgOptions {
    readonly runner?: FakeEpgJobRunner;
    readonly queue?: Partial<EpgQueueTimings>;
    readonly catchUpDelayMs?: number;
}

export function silentLogger(logs: string[]): EpgLogger {
    return {
        info: (message) => {
            logs.push(message);
        },
        error: (message) => {
            logs.push(message);
        },
    };
}

/** Lets fake jobs run; each one ends on a later turn of the event loop. */
export async function settle(rounds = 20): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

/**
 * Server storage plus a started EPG service on a fake job runner, in UTC,
 * with a 10 ms playlist debounce and the catch-up an hour away.
 */
export function withTempEpg<T>(
    run: (context: TempEpg) => Promise<T> | T,
    options: TempEpgOptions = {}
): Promise<T> {
    return withTempStorage(async (storage) => {
        const database = openEpgDatabase();
        const runner = options.runner ?? new FakeEpgJobRunner();
        const logs: string[] = [];
        const epg = startServerEpg({
            storage,
            database,
            runJob: runner.run,
            logger: silentLogger(logs),
            timeZone: 'UTC',
            registryDebounceMs: 10,
            catchUpDelayMs: options.catchUpDelayMs ?? 3_600_000,
            queue: options.queue,
        });
        try {
            return await run({ storage, database, epg, runner, logs });
        } finally {
            await epg.stop();
        }
    });
}
```

- [ ] **Step 2: Write the failing service spec**

`apps/web-backend/src/app/epg/epg-service.spec.ts`:

```ts
import { withTempStorage } from '../storage/server-storage.spec-helpers';
import { openEpgDatabase } from './epg-database';
import { EpgImportRecords } from './epg-import-records';
import { startServerEpg } from './epg-service';
import { writeEpgSettings } from './epg-settings';
import { settle, silentLogger, withTempEpg } from './epg.spec-helpers';
import {
    FAKE_IMPORT_STATS,
    FakeEpgJobRunner,
} from './fake-epg-job-runner.spec-helpers';
import { waitFor } from './xmltv.spec-helpers';

const A = 'https://epg.example/a.xml';
const B = 'https://epg.example/b.xml';
const C = 'https://epg.example/c.xml';
const HOUR = 3_600_000;

describe('startServerEpg', () => {
    it('clears data of sources that lost their owners while it was off', () =>
        withTempStorage(async (storage) => {
            const database = openEpgDatabase();
            new EpgImportRecords(database.db).markSuccess(
                A,
                new Date(),
                FAKE_IMPORT_STATS
            );
            const runner = new FakeEpgJobRunner();
            const epg = startServerEpg({
                storage,
                database,
                runJob: runner.run,
                logger: silentLogger([]),
                timeZone: 'UTC',
            });
            try {
                await waitFor(() => runner.kinds().includes(`clear:${A}`));
                await settle();
                expect(new EpgImportRecords(database.db).all().has(A)).toBe(
                    false
                );
            } finally {
                await epg.stop();
            }
        }));

    it('catches up sources without a success in the last day', () =>
        withTempStorage(async (storage) => {
            writeEpgSettings(storage.playlists, {
                urls: [A, B, C],
                refreshTime: '04:00',
            });
            const database = openEpgDatabase();
            const records = new EpgImportRecords(database.db);
            records.markSuccess(A, new Date(), FAKE_IMPORT_STATS);
            records.markSuccess(
                B,
                new Date(Date.now() - 25 * HOUR),
                FAKE_IMPORT_STATS
            );
            const runner = new FakeEpgJobRunner();
            const epg = startServerEpg({
                storage,
                database,
                runJob: runner.run,
                logger: silentLogger([]),
                timeZone: 'UTC',
                catchUpDelayMs: 20,
            });
            try {
                await waitFor(() => runner.jobs.length === 2);
                await settle();
                expect(runner.importUrls()).toEqual([B, C]);
            } finally {
                await epg.stop();
            }
        }));

    it('imports every source and then cleans up at the refresh time', async () => {
        jest.useFakeTimers({
            now: new Date('2026-10-15T03:59:00.000Z'),
            doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
        });
        try {
            await withTempEpg(
                async ({ epg, runner }) => {
                    epg.updateSettings({ urls: [A, B] });
                    await settle();
                    expect(runner.kinds()).toEqual([
                        `import:${A}`,
                        `import:${B}`,
                    ]);

                    jest.advanceTimersByTime(60_000);
                    await settle();
                    expect(runner.kinds()).toEqual([
                        `import:${A}`,
                        `import:${B}`,
                        `import:${A}`,
                        `import:${B}`,
                        'maintenance',
                    ]);
                    expect(epg.status().nextRunAt).toBe(
                        '2026-10-16T04:00:00.000Z'
                    );
                },
                { queue: { recentFinishMs: 0 } }
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it('records a failure and logs the host, never the URL', () => {
        const runner = new FakeEpgJobRunner({ mode: 'manual' });
        const secretUrl =
            'https://epg.example/xmltv.php?username=u&password=secret';
        return withTempEpg(
            async ({ epg, logs }) => {
                epg.updateSettings({ urls: [secretUrl] });
                runner.jobs[0].fail({
                    code: 'epg_http_status',
                    name: 'ProviderRequestError',
                    host: 'epg.example',
                });
                await settle();

                expect(epg.status().sources).toEqual([
                    expect.objectContaining({
                        url: secretUrl,
                        state: 'error',
                        errorCode: 'epg_http_status',
                        errorHost: 'epg.example',
                    }),
                ]);
                expect(logs.join('\n')).toContain('epg.example');
                expect(logs.join('\n')).not.toContain('secret');
            },
            { runner }
        );
    });

    it('imports only owned sources, stale ones unless forced', () =>
        withTempEpg(
            async ({ epg, runner }) => {
                epg.updateSettings({ urls: [A] });
                await settle();

                epg.requestImport({ force: false });
                epg.requestImport({ urls: [C], force: true });
                await settle();
                expect(runner.importUrls()).toEqual([A]);

                epg.requestImport({ urls: [A], force: true });
                await settle();
                expect(runner.importUrls()).toEqual([A, A]);
            },
            { queue: { recentFinishMs: 0 } }
        ));

    it('stops the schedule and closes epg.db', () =>
        withTempStorage(async (storage) => {
            const database = openEpgDatabase();
            const epg = startServerEpg({
                storage,
                database,
                runJob: new FakeEpgJobRunner().run,
                logger: silentLogger([]),
                timeZone: 'UTC',
            });
            expect(epg.status().nextRunAt).not.toBeNull();

            await epg.stop();
            expect(database.db.open).toBe(false);
            expect(() => epg.playlistsChanged()).not.toThrow();
            await epg.stop();
        }));
});
```

- [ ] **Step 3: Write the failing start-up spec**

`apps/web-backend/src/app/epg/open-server-epg.spec.ts`:

```ts
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { withTempStorage } from '../storage/server-storage.spec-helpers';
import { silentLogger } from './epg.spec-helpers';
import { openServerEpg } from './open-server-epg';

/** `apps/web-backend/src`, where `main.ts` passes `__dirname`. */
const WORKER_ROOT = join(__dirname, '..', '..');

describe('openServerEpg', () => {
    it('stays off unless IPTVNATOR_EPG is on', () =>
        withTempStorage((storage) => {
            for (const env of [{}, { IPTVNATOR_EPG: 'off' }]) {
                expect(
                    openServerEpg({ storage, rootDir: WORKER_ROOT, env })
                ).toBeNull();
            }
            expect(
                existsSync(join(dirname(storage.database.path), 'epg.db'))
            ).toBe(false);
        }));

    it('stays off without server storage, saying why only when asked for', () => {
        const logs: string[] = [];
        const open = (env: Record<string, string>) =>
            openServerEpg({
                storage: null,
                rootDir: WORKER_ROOT,
                env,
                logger: silentLogger(logs),
            });

        expect(open({})).toBeNull();
        expect(logs).toEqual([]);
        expect(open({ IPTVNATOR_EPG: 'on' })).toBeNull();
        expect(logs).toEqual([
            expect.stringContaining('IPTVNATOR_STORAGE=server'),
        ]);
    });

    it('opens epg.db next to iptvnator.db and starts', () =>
        withTempStorage(async (storage) => {
            const logs: string[] = [];
            const epg = openServerEpg({
                storage,
                rootDir: WORKER_ROOT,
                env: { IPTVNATOR_EPG: 'on' },
                logger: silentLogger(logs),
            });
            try {
                expect(epg).not.toBeNull();
                expect(
                    existsSync(join(dirname(storage.database.path), 'epg.db'))
                ).toBe(true);
                expect(epg?.status()).toMatchObject({
                    sources: [],
                    refreshTime: '04:00',
                });
                expect(logs.join('\n')).toContain('server EPG at');
            } finally {
                await epg?.stop();
            }
        }));

    it('continues without EPG when the worker is missing', () =>
        withTempStorage((storage) => {
            const logs: string[] = [];

            expect(
                openServerEpg({
                    storage,
                    rootDir: join(WORKER_ROOT, 'missing'),
                    env: { IPTVNATOR_EPG: 'on' },
                    logger: silentLogger(logs),
                })
            ).toBeNull();
            expect(logs.join('\n')).toContain('server EPG could not start');
        }));
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns="epg-service|open-server-epg"`
Expected: FAIL, modules `./epg-service` and `./open-server-epg` not found.

- [ ] **Step 5: Implement the service**

`apps/web-backend/src/app/epg/epg-service.ts`:

```ts
import {
    createEpgDrizzle,
    createEpgQueries,
    epgLogger,
    type EpgQueries,
} from '@iptvnator/shared/epg-store';
import type {
    ServerEpgSettings,
    ServerEpgSettingsUpdate,
    ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import type { ServerStorage } from '../storage/server-storage';
import { describeStorageError } from '../storage/storage-route-errors';
import type { EpgDatabase } from './epg-database';
import { EpgImportQueue, type EpgQueueTimings } from './epg-import-queue';
import { EpgImportRecords, isStaleRecord } from './epg-import-records';
import { EpgScheduler, processTimeZone } from './epg-scheduler';
import {
    mergeEpgSettings,
    readEpgSettings,
    writeEpgSettings,
} from './epg-settings';
import {
    computeEpgSources,
    EpgSourceRegistry,
    readPlaylistEpgRows,
} from './epg-source-registry';
import { buildEpgStatus, ProgrammeCounter } from './epg-status';
import type { EpgJobOutcome, EpgJobRunner } from './epg-worker-protocol';

/** Playlist writes come in bursts (an import, a sync); recompute once after. */
export const EPG_REGISTRY_DEBOUNCE_MS = 2_000;

export interface EpgLogger {
    info(message: string): void;
    error(message: string): void;
}

/** The library's EPG logger, which drops anything URL-shaped as well. */
export const consoleEpgLogger: EpgLogger = {
    info: (message) => epgLogger.log(message),
    error: (message) => epgLogger.error(message),
};

/** What `main.ts`, the mount and the routes see of server EPG. */
export interface ServerEpg {
    readonly queries: EpgQueries;
    settings(): ServerEpgSettings;
    /** Stores, recomputes the sources (new ones import) and re-arms. */
    updateSettings(update: ServerEpgSettingsUpdate): ServerEpgSettings;
    status(): ServerEpgStatus;
    /** Owned URLs only; without `force`, only sources stale for 24 h. */
    requestImport(request: {
        readonly urls?: readonly string[];
        readonly force: boolean;
    }): void;
    /** Resolves once the data is gone; `null` clears every source. */
    clear(url: string | null): Promise<void>;
    /** A playlist was written or deleted; sources follow after a debounce. */
    playlistsChanged(): void;
    databaseBytes(): number;
    /** Stops the schedule, aborts the job (≤ 5 s) and closes epg.db. */
    stop(): Promise<void>;
}

export interface ServerEpgOptions {
    readonly storage: ServerStorage;
    readonly database: EpgDatabase;
    readonly runJob: EpgJobRunner;
    readonly logger?: EpgLogger;
    readonly timeZone?: string;
    readonly registryDebounceMs?: number;
    readonly catchUpDelayMs?: number;
    readonly queue?: Partial<EpgQueueTimings>;
}

export function startServerEpg(options: ServerEpgOptions): ServerEpg {
    const { storage, database } = options;
    const logger = options.logger ?? consoleEpgLogger;
    const timeZone = options.timeZone ?? processTimeZone();
    const records = new EpgImportRecords(database.db);
    const counter = new ProgrammeCounter(database.db);
    // Created once and reused; it loads drizzle's better-sqlite3 driver lazily.
    const drizzleDb = createEpgDrizzle(database.db);
    const queries = createEpgQueries({ getDb: () => drizzleDb });
    const settings = () => readEpgSettings(storage.playlists);
    const registry = new EpgSourceRegistry(() =>
        computeEpgSources(
            settings().urls,
            readPlaylistEpgRows(storage.database.db)
        )
    );
    // Starts at the clock, so a revision never repeats across restarts.
    let revision = Date.now();
    let stopped = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const recordImport = (url: string, outcome: EpgJobOutcome) => {
        const host = hostOf(url);
        if (outcome.ok) {
            const stats = outcome.stats ?? {
                totalChannels: 0,
                totalPrograms: 0,
            };
            records.markSuccess(url, new Date(), stats);
            revision += 1;
            logger.info(
                `[web-backend] EPG import from ${host}: ${stats.totalChannels} channels, ${stats.totalPrograms} programmes`
            );
            return;
        }
        const { failure } = outcome;
        records.markFailure(url, new Date(), failure);
        logger.error(
            `[web-backend] EPG import from ${failure.host ?? host} failed: ${failure.code} (${failure.name})`
        );
    };

    const queue = new EpgImportQueue({
        run: options.runJob,
        timings: options.queue,
        hooks: {
            importStarted: (url) => records.markAttempt(url, new Date()),
            importFinished: recordImport,
            cleared: (url) => {
                if (url === null) {
                    records.deleteAll();
                } else {
                    records.delete(url);
                }
                revision += 1;
            },
            maintained: (outcome) => {
                if (outcome.ok) {
                    revision += 1;
                    return;
                }
                logger.error(
                    `[web-backend] EPG clean-up failed: ${outcome.failure.code} (${outcome.failure.name})`
                );
            },
            hookFailed: (error) =>
                logger.error(
                    `[web-backend] EPG bookkeeping failed: ${describeStorageError(error)}`
                ),
        },
    });

    const clearInBackground = (url: string) => {
        queue.clear(url).catch((error: unknown) => {
            if (!stopped) {
                logger.error(
                    `[web-backend] clearing EPG data failed: ${describeStorageError(error)}`
                );
            }
        });
    };

    const applySourceChanges = () => {
        const { added, removed } = registry.recompute();
        queue.enqueueImports(added);
        removed.forEach(clearInBackground);
    };

    const requestImport: ServerEpg['requestImport'] = ({ urls, force }) => {
        const owned =
            urls === undefined
                ? registry.urls()
                : urls.filter((url) => registry.owns(url));
        const known = records.all();
        const now = Date.now();
        queue.enqueueImports(
            force
                ? owned
                : owned.filter((url) => isStaleRecord(known.get(url), now))
        );
    };

    const scheduler = new EpgScheduler({
        refreshTime: () => settings().refreshTime,
        timeZone,
        catchUpDelayMs: options.catchUpDelayMs,
        onRun: () => {
            queue.enqueueImports(registry.urls());
            queue.enqueueMaintenance();
        },
        onCatchUp: () => requestImport({ force: false }),
        onError: (error) =>
            logger.error(
                `[web-backend] EPG schedule failed: ${describeStorageError(error)}`
            ),
    });

    registry.recompute();
    // Data of sources that lost every owner while server EPG was off.
    for (const url of records.all().keys()) {
        if (!registry.owns(url)) {
            clearInBackground(url);
        }
    }
    scheduler.start();

    return {
        queries,
        settings,
        updateSettings: (update) => {
            const current = settings();
            const next = mergeEpgSettings(current, update);
            writeEpgSettings(storage.playlists, next);
            applySourceChanges();
            if (next.refreshTime !== current.refreshTime) {
                scheduler.rearm();
            }
            return next;
        },
        status: () =>
            buildEpgStatus({
                revision,
                settings: settings(),
                timeZone,
                nextRunAt: scheduler.nextRunAt(),
                sources: registry.sources(),
                overflow: registry.overflow(),
                records: records.all(),
                queue: queue.snapshot(),
                totalProgrammes: counter.count(revision),
                databaseBytes: database.sizeBytes(),
            }),
        requestImport,
        clear: (url) => queue.clear(url),
        playlistsChanged: () => {
            if (stopped) {
                return;
            }
            if (debounce) {
                clearTimeout(debounce);
            }
            debounce = setTimeout(() => {
                debounce = null;
                try {
                    applySourceChanges();
                } catch (error) {
                    logger.error(
                        `[web-backend] EPG sources could not be read: ${describeStorageError(error)}`
                    );
                }
            }, options.registryDebounceMs ?? EPG_REGISTRY_DEBOUNCE_MS);
            debounce.unref();
        },
        databaseBytes: () => database.sizeBytes(),
        stop: async () => {
            if (stopped) {
                return;
            }
            stopped = true;
            if (debounce) {
                clearTimeout(debounce);
            }
            scheduler.stop();
            try {
                await queue.stop();
            } finally {
                database.close();
            }
        },
    };
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return 'an unreadable URL';
    }
}
```

- [ ] **Step 6: Implement the start-up**

`apps/web-backend/src/app/epg/open-server-epg.ts`:

```ts
import { basename } from 'node:path';
import type { ServerStorage } from '../storage/server-storage';
import { describeStorageError } from '../storage/storage-route-errors';
import { readServerEpgConfig } from './epg-config';
import { openEpgDatabase, type EpgDatabase } from './epg-database';
import {
    consoleEpgLogger,
    startServerEpg,
    type EpgLogger,
    type ServerEpg,
} from './epg-service';
import {
    createWorkerJobRunner,
    resolveEpgWorkerScript,
} from './epg-worker-runner';

export interface OpenServerEpgOptions {
    readonly storage: ServerStorage | null;
    /** Folder of `main.ts` or `main.cjs`; the worker sits below it. */
    readonly rootDir: string;
    readonly env?: Record<string, string | undefined>;
    readonly logger?: EpgLogger;
}

/**
 * Server EPG for `main.ts`, or `null` when it is off, when server storage
 * is off, or when it cannot start; the backend then runs without `/v1/epg`.
 */
export function openServerEpg(options: OpenServerEpgOptions): ServerEpg | null {
    const logger = options.logger ?? consoleEpgLogger;
    const config = readServerEpgConfig(options.env);
    if (!config.enabled) {
        return null;
    }
    if (!options.storage) {
        // Only an explicit IPTVNATOR_EPG=on is worth a line; the default
        // (on from 3d) stays quiet on a stateless backend.
        if (config.requested) {
            logger.error(
                '[web-backend] IPTVNATOR_EPG=on needs IPTVNATOR_STORAGE=server; server EPG stays off.'
            );
        }
        return null;
    }
    let database: EpgDatabase | null = null;
    try {
        const workerScript = resolveEpgWorkerScript(options.rootDir);
        database = openEpgDatabase();
        if (database.recoveredFrom) {
            logger.error(
                `[web-backend] epg.db could not be opened and was moved to ${basename(database.recoveredFrom)}; its sources import again shortly.`
            );
        }
        const epg = startServerEpg({
            storage: options.storage,
            database,
            logger,
            runJob: createWorkerJobRunner({
                workerScript,
                dbPath: database.path,
                importSettings: {
                    maxDecompressedBytes: config.maxDecompressedBytes,
                    allowPrivateNetworks: config.allowPrivateNetworks,
                },
            }),
        });
        logger.info(
            `[web-backend] server EPG at ${database.path}${config.allowPrivateNetworks ? ', private-network sources allowed' : ''}`
        );
        return epg;
    } catch (error) {
        database?.close();
        logger.error(
            `[web-backend] server EPG could not start: ${describeStorageError(error)}. Continuing without it.`
        );
        return null;
    }
}
```

- [ ] **Step 7: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns="epg-service|open-server-epg"
pnpm nx lint web-backend
git add apps/web-backend/src/app/epg/epg-service.ts apps/web-backend/src/app/epg/open-server-epg.ts apps/web-backend/src/app/epg/epg.spec-helpers.ts apps/web-backend/src/app/epg/epg-service.spec.ts apps/web-backend/src/app/epg/open-server-epg.spec.ts
git commit -m "feat(web-backend): server EPG service

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 10 tests.

---

### Task 14: `/v1/epg` routes and mounting

**Files:**
- Create: `apps/web-backend/src/app/epg/epg-settings-router.ts`
- Create: `apps/web-backend/src/app/epg/epg-import-router.ts`
- Create: `apps/web-backend/src/app/epg/epg-query-router.ts`
- Create: `apps/web-backend/src/app/epg/mount-server-epg.ts`
- Modify: `apps/web-backend/src/app/storage/mount-server-storage.ts`
- Modify: `apps/web-backend/src/app/storage/instance-router.ts`
- Modify: `apps/web-backend/src/app/storage/playlists-router.ts`
- Modify: `apps/web-backend/src/app/web-backend-app.ts` (mounting lines only; the file is baselined)
- Modify: `apps/web-backend/src/app/storage/storage-routes.spec.ts`
- Test: `apps/web-backend/src/app/epg/epg-routes.spec.ts`
- Test: `apps/web-backend/src/app/epg/epg-query-routes.spec.ts`

- [ ] **Step 1: Write the failing route spec**

`apps/web-backend/src/app/epg/epg-routes.spec.ts`:

```ts
import { join } from 'node:path';
import type {
    ServerEpgSettings,
    ServerEpgStatus,
    ServerInstanceInfo,
    ServerStorageStatusResponse,
} from '@iptvnator/shared/interfaces';
import type { ServerStorage } from '../storage/server-storage';
import {
    m3uDocument,
    withTempStorage,
} from '../storage/server-storage.spec-helpers';
import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import type { ServerEpg } from './epg-service';
import { withTempEpg } from './epg.spec-helpers';
import { openServerEpg } from './open-server-epg';
import { waitFor } from './xmltv.spec-helpers';

const WORKER_ROOT = join(__dirname, '..', '..');
const A = 'https://epg.example/a.xml';
const B = 'https://epg.example/b.xml.gz';

function app(
    storage: ServerStorage | null,
    epg: ServerEpg | null,
    extra: { accessToken?: string } = {}
) {
    return createWebBackendApp({
        clientOrigins: ['http://localhost:4200'],
        httpClient: new StubHttpClient(),
        resolveHostname: resolvePublicHost,
        storage,
        epg,
        ...extra,
    });
}

const send = (method: string, body: unknown): RequestInit => ({
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
});

async function read<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
}

describe('server EPG routes', () => {
    it('reports the EPG feature and the epg.db size', () =>
        withTempEpg(({ storage, epg }) =>
            withServer(app(storage, epg), async (baseUrl) => {
                const instance = await read<ServerInstanceInfo>(
                    await fetch(`${baseUrl}/v1/instance`)
                );
                const status = await read<ServerStorageStatusResponse>(
                    await fetch(`${baseUrl}/v1/instance/status`)
                );

                expect(instance.features).toEqual({ epg: true });
                expect(status.epgDatabaseBytes).toBeGreaterThan(0);
            })
        ));

    // One temp storage at a time: `initDatabase()` is a process singleton.
    it('reports features.epg false with IPTVNATOR_EPG=off and without storage', async () => {
        await withTempStorage(async (storage) => {
            const off = openServerEpg({
                storage,
                rootDir: WORKER_ROOT,
                env: { IPTVNATOR_EPG: 'off' },
            });
            await withServer(app(storage, off), async (baseUrl) => {
                const instance = await read<ServerInstanceInfo>(
                    await fetch(`${baseUrl}/v1/instance`)
                );
                const status = await read<ServerStorageStatusResponse>(
                    await fetch(`${baseUrl}/v1/instance/status`)
                );

                expect(instance.features).toEqual({ epg: false });
                expect(status.epgDatabaseBytes).toBeUndefined();
                expect((await fetch(`${baseUrl}/v1/epg/status`)).status).toBe(
                    404
                );
            });
        });
        await withTempEpg(({ epg }) =>
            withServer(app(null, epg), async (baseUrl) => {
                const instance = await read<ServerInstanceInfo>(
                    await fetch(`${baseUrl}/v1/instance`)
                );
                expect(instance.features).toEqual({ epg: false });
                expect((await fetch(`${baseUrl}/v1/epg/status`)).status).toBe(
                    404
                );
            })
        );
    });

    it('stores the source list and refresh time and validates them', () =>
        withTempEpg(({ storage, epg }) =>
            withServer(app(storage, epg), async (baseUrl) => {
                const initial = await fetch(`${baseUrl}/v1/epg/settings`);
                expect(initial.headers.get('cache-control')).toBe('no-store');
                await expect(initial.json()).resolves.toEqual({
                    urls: [],
                    refreshTime: '04:00',
                });

                const saved = await read<ServerEpgSettings>(
                    await fetch(
                        `${baseUrl}/v1/epg/settings`,
                        send('PUT', { urls: [` ${A} `, A, B] })
                    )
                );
                const retimed = await read<ServerEpgSettings>(
                    await fetch(
                        `${baseUrl}/v1/epg/settings`,
                        send('PUT', { refreshTime: '05:30' })
                    )
                );
                expect(saved).toEqual({ urls: [A, B], refreshTime: '04:00' });
                expect(retimed).toEqual({ urls: [A, B], refreshTime: '05:30' });
                expect(epg.status().nextRunAt).toMatch(/T05:30:00\.000Z$/);

                const rejected: Array<[unknown, string]> = [
                    [{ urls: ['ftp://epg.example/a.xml'] }, 'invalid_url'],
                    [
                        { urls: ['https://user:secret@epg.example/a.xml'] },
                        'invalid_url',
                    ],
                    [
                        {
                            urls: Array.from(
                                { length: 51 },
                                (_, index) => `https://epg.example/${index}.xml`
                            ),
                        },
                        'too_many_urls',
                    ],
                    [{ refreshTime: '24:00' }, 'invalid_time'],
                    [{ urls: A }, 'invalid_body'],
                ];
                for (const [body, code] of rejected) {
                    const response = await fetch(
                        `${baseUrl}/v1/epg/settings`,
                        send('PUT', body)
                    );
                    const error = await read<{ code: string; message: string }>(
                        response
                    );
                    expect(response.status).toBe(400);
                    expect(error.code).toBe(code);
                    expect(error.message).not.toContain('secret');
                }
                await expect(
                    (await fetch(`${baseUrl}/v1/epg/settings`)).json()
                ).resolves.toEqual({ urls: [A, B], refreshTime: '05:30' });
            })
        ));

    it('imports a source added in the settings and reports it', () =>
        withTempEpg(({ storage, epg, runner }) =>
            withServer(app(storage, epg), async (baseUrl) => {
                const before = epg.status().revision;
                await fetch(
                    `${baseUrl}/v1/epg/settings`,
                    send('PUT', { urls: [A] })
                );
                await waitFor(
                    () => epg.status().sources[0]?.lastSuccessAt !== undefined
                );

                const status = await read<ServerEpgStatus>(
                    await fetch(`${baseUrl}/v1/epg/status`)
                );
                expect(runner.importUrls()).toEqual([A]);
                expect(status).toMatchObject({
                    refreshTime: '04:00',
                    timeZone: 'UTC',
                    sources: [
                        {
                            url: A,
                            owners: { global: true, playlists: 0 },
                            state: 'idle',
                            channels: 2,
                            programmes: 3,
                        },
                    ],
                });
                expect(status.revision).toBeGreaterThan(before);
                expect(status.totals.databaseBytes).toBeGreaterThan(0);
            })
        ));

    it('follows playlist writes and deletes', () =>
        withTempEpg(({ storage, epg, runner }) =>
            withServer(app(storage, epg), async (baseUrl) => {
                await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    send('PUT', { ...m3uDocument('p1'), epgUrls: [B] })
                );
                await fetch(
                    `${baseUrl}/v1/playlists/x1`,
                    send('PUT', {
                        _id: 'x1',
                        title: 'Portal',
                        serverUrl: 'http://portal.example',
                        username: 'u',
                        password: 'p',
                        epgUrls: [A],
                    })
                );
                await waitFor(() => runner.importUrls().includes(B));
                expect(epg.status().sources).toEqual([
                    expect.objectContaining({
                        url: B,
                        owners: { global: false, playlists: 1 },
                    }),
                ]);

                await fetch(`${baseUrl}/v1/playlists/p1`, { method: 'DELETE' });
                await waitFor(() => runner.kinds().includes(`clear:${B}`));
                await waitFor(() => epg.status().sources.length === 0);
                expect(runner.importUrls()).toEqual([B]);
            })
        ));

    it('imports owned sources on request, stale ones unless forced', () =>
        withTempEpg(
            ({ storage, epg, runner }) =>
                withServer(app(storage, epg), async (baseUrl) => {
                    await fetch(
                        `${baseUrl}/v1/epg/settings`,
                        send('PUT', { urls: [A] })
                    );
                    await waitFor(
                        () =>
                            epg.status().sources[0]?.lastSuccessAt !== undefined
                    );

                    const unforced = await fetch(
                        `${baseUrl}/v1/epg/import`,
                        send('POST', {})
                    );
                    expect(unforced.status).toBe(202);
                    expect(unforced.headers.get('cache-control')).toBe(
                        'no-store'
                    );
                    expect(
                        (await read<ServerEpgStatus>(unforced)).sources.map(
                            ({ url }) => url
                        )
                    ).toEqual([A]);
                    expect(runner.importUrls()).toEqual([A]);

                    await fetch(
                        `${baseUrl}/v1/epg/import`,
                        send('POST', {
                            urls: [A, 'https://other.example/x.xml'],
                            force: true,
                        })
                    );
                    await waitFor(() => runner.importUrls().length === 2);
                    expect(runner.importUrls()).toEqual([A, A]);
                }),
            { queue: { recentFinishMs: 0 } }
        ));

    it('clears one source or all data', () =>
        withTempEpg(({ storage, epg, runner }) =>
            withServer(app(storage, epg), async (baseUrl) => {
                const one = await fetch(
                    `${baseUrl}/v1/epg/clear`,
                    send('POST', { url: A })
                );
                const all = await fetch(
                    `${baseUrl}/v1/epg/clear`,
                    send('POST', {})
                );

                await expect(one.json()).resolves.toEqual({ success: true });
                await expect(all.json()).resolves.toEqual({ success: true });
                expect(runner.kinds()).toEqual([`clear:${A}`, 'clear:*']);
                expect(
                    (await fetch(`${baseUrl}/v1/epg/clear`, { method: 'POST' }))
                        .status
                ).toBe(400);
                expect(
                    (
                        await fetch(
                            `${baseUrl}/v1/epg/clear`,
                            send('POST', { url: ' ' })
                        )
                    ).status
                ).toBe(400);
            })
        ));

    it('answers errors in the storage envelope, uncached', () =>
        withTempEpg(({ storage, epg }) =>
            withServer(app(storage, epg), async (baseUrl) => {
                const broken = await fetch(
                    `${baseUrl}/v1/epg/current`,
                    send('POST', '{"channelIds": [')
                );
                const huge = await fetch(
                    `${baseUrl}/v1/epg/current`,
                    send('POST', { channelIds: ['x'.repeat(300 * 1024)] })
                );
                const wrongShape = await fetch(
                    `${baseUrl}/v1/epg/current`,
                    send('POST', { channelIds: 'ch1' })
                );

                expect(broken.status).toBe(400);
                expect(broken.headers.get('cache-control')).toBe('no-store');
                await expect(broken.json()).resolves.toMatchObject({
                    status: 400,
                    code: 'invalid_json',
                });
                expect(huge.status).toBe(413);
                await expect(wrongShape.json()).resolves.toMatchObject({
                    status: 400,
                    code: 'invalid_body',
                });
            })
        ));

    it('requires the access token', () =>
        withTempEpg(({ storage, epg }) =>
            withServer(
                app(storage, epg, { accessToken: 's3cret' }),
                async (baseUrl) => {
                    expect(
                        (await fetch(`${baseUrl}/v1/epg/status`)).status
                    ).toBe(401);
                    expect(
                        (
                            await fetch(
                                `${baseUrl}/v1/epg/current`,
                                send('POST', { channelIds: ['ch1'] })
                            )
                        ).status
                    ).toBe(401);
                    expect(
                        (
                            await fetch(`${baseUrl}/v1/epg/status`, {
                                headers: { authorization: 'Bearer s3cret' },
                            })
                        ).status
                    ).toBe(200);
                }
            )
        ));
});
```

- [ ] **Step 2: Write the failing query-route spec**

Programmes sit around the current hour: the import keeps only seven days of
past programmes, so fixed dates would age out of the fixture.

`apps/web-backend/src/app/epg/epg-query-routes.spec.ts`:

```ts
import { runEpgImport } from '@iptvnator/shared/epg-store';
import type {
    ElectronBridgeEpgSearchProgram,
    EpgChannelMetadata,
    EpgProgram,
    ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import { withTempEpg, type TempEpg } from './epg.spec-helpers';
import { memoryOpener, xmltv } from './xmltv.spec-helpers';

const HOUR = 3_600_000;
const NOW = Math.floor(Date.now() / HOUR) * HOUR;
const SOURCE = 'https://epg.example/guide.xml';

const post = (body: unknown): RequestInit => ({
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
});

async function read<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
}

function withGuide(
    run: (baseUrl: string, context: TempEpg) => Promise<void>
): Promise<void> {
    return withTempEpg(async (context) => {
        await runEpgImport({
            url: SOURCE,
            db: context.database.db,
            openSource: memoryOpener(
                xmltv(
                    [
                        { id: 'ch1', name: 'Channel One' },
                        { id: 'ch2', name: 'Channel Two' },
                    ],
                    [
                        {
                            channel: 'ch1',
                            start: NOW - HOUR / 2,
                            stop: NOW + HOUR / 2,
                            title: 'Morning News',
                        },
                        {
                            channel: 'ch1',
                            start: NOW + HOUR / 2,
                            stop: NOW + HOUR,
                            title: 'Weather',
                        },
                        {
                            channel: 'ch1',
                            start: NOW + HOUR,
                            stop: NOW + 3 * HOUR,
                            title: 'Film',
                        },
                        {
                            channel: 'ch2',
                            start: NOW - HOUR,
                            stop: NOW + HOUR,
                            title: 'Sports',
                        },
                    ]
                )
            ),
            signal: new AbortController().signal,
        });
        const app = createWebBackendApp({
            clientOrigins: ['http://localhost:4200'],
            httpClient: new StubHttpClient(),
            resolveHostname: resolvePublicHost,
            storage: context.storage,
            epg: context.epg,
        });
        await withServer(app, (baseUrl) => run(baseUrl, context));
    });
}

describe('server EPG query routes', () => {
    it('answers the programme on air per channel, uncached', () =>
        withGuide(async (baseUrl) => {
            const response = await fetch(
                `${baseUrl}/v1/epg/current`,
                post({ channelIds: ['ch1', 'ch2', 'nope'], nowMs: NOW })
            );
            const body =
                await read<Record<string, EpgProgram | null>>(response);

            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(body['ch1']?.title).toBe('Morning News');
            expect(body['ch2']?.title).toBe('Sports');
        }));

    it('ignores keys beyond the cap', () =>
        withGuide(async (baseUrl) => {
            const fillers = Array.from(
                { length: 500 },
                (_, index) => `x${index}`
            );
            const body = await read<Record<string, EpgProgram | null>>(
                await fetch(
                    `${baseUrl}/v1/epg/current`,
                    post({ channelIds: [...fillers, 'ch1'], nowMs: NOW })
                )
            );

            expect(body['ch1']).toBeUndefined();
        }));

    it('answers channel metadata and a channel programme list', () =>
        withGuide(async (baseUrl) => {
            const metadata = await read<
                Record<string, EpgChannelMetadata | null>
            >(
                await fetch(
                    `${baseUrl}/v1/epg/metadata`,
                    post({ channelIds: ['ch1'] })
                )
            );
            const programs = await read<EpgProgram[]>(
                await fetch(
                    `${baseUrl}/v1/epg/channel-programs`,
                    post({ channelId: 'ch1' })
                )
            );

            expect(metadata['ch1']).toMatchObject({
                id: 'ch1',
                displayName: 'Channel One',
            });
            expect(programs.map(({ title }) => title)).toEqual([
                'Morning News',
                'Weather',
                'Film',
            ]);
        }));

    it('answers a guide window and its coverage; an invalid window is empty', () =>
        withGuide(async (baseUrl) => {
            const range = {
                channelIds: ['ch1', 'ch2', 'nope'],
                fromMs: NOW,
                toMs: NOW + HOUR,
            };
            const programs = await read<Record<string, EpgProgram[]>>(
                await fetch(`${baseUrl}/v1/epg/window`, post(range))
            );
            const coverage = await read<string[]>(
                await fetch(`${baseUrl}/v1/epg/coverage`, post(range))
            );

            expect(programs['ch1'].map(({ title }) => title)).toEqual([
                'Morning News',
                'Weather',
            ]);
            expect([...coverage].sort()).toEqual(['ch1', 'ch2']);
            await expect(
                (
                    await fetch(
                        `${baseUrl}/v1/epg/window`,
                        post({ ...range, toMs: NOW })
                    )
                ).json()
            ).resolves.toEqual({});
            await expect(
                (
                    await fetch(
                        `${baseUrl}/v1/epg/coverage`,
                        post({ ...range, fromMs: 'soon' })
                    )
                ).json()
            ).resolves.toEqual([]);
            expect(
                (
                    await fetch(
                        `${baseUrl}/v1/epg/window`,
                        post({ ...range, channelIds: 'ch1' })
                    )
                ).status
            ).toBe(400);
        }));

    it('searches programmes with a capped limit', () =>
        withGuide(async (baseUrl) => {
            const hits = await read<ElectronBridgeEpgSearchProgram[]>(
                await fetch(`${baseUrl}/v1/epg/search`, post({ term: 'news' }))
            );
            const limited = await read<ElectronBridgeEpgSearchProgram[]>(
                await fetch(
                    `${baseUrl}/v1/epg/search`,
                    post({ term: 'e', limit: 1 })
                )
            );

            expect(hits).toEqual([
                expect.objectContaining({
                    title: 'Morning News',
                    channelName: 'Channel One',
                }),
            ]);
            expect(limited).toHaveLength(1);
            await expect(
                (
                    await fetch(
                        `${baseUrl}/v1/epg/search`,
                        post({ term: '  ' })
                    )
                ).json()
            ).resolves.toEqual([]);
            expect(
                (await fetch(`${baseUrl}/v1/epg/search`, post({ term: 5 })))
                    .status
            ).toBe(400);
        }));

    it('counts the imported programmes in the status', () =>
        withGuide(async (baseUrl) => {
            const status = await read<ServerEpgStatus>(
                await fetch(`${baseUrl}/v1/epg/status`)
            );

            expect(status.totals.programmes).toBe(4);
        }));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns="epg-routes|epg-query-routes"`
Expected: FAIL to compile: `epg` does not exist in `WebBackendAppOptions`.

- [ ] **Step 4: Implement the routers**

`apps/web-backend/src/app/epg/epg-settings-router.ts`:

```ts
import { Router } from 'express';
import type { ServerEpg } from './epg-service';
import { parseEpgSettingsUpdate } from './epg-settings';

export function createEpgSettingsRouter(epg: ServerEpg): Router {
    const router = Router();

    router.get('/settings', (_req, res) => {
        res.json(epg.settings());
    });

    router.put('/settings', (req, res) => {
        res.json(epg.updateSettings(parseEpgSettingsUpdate(req.body)));
    });

    return router;
}
```

`apps/web-backend/src/app/epg/epg-import-router.ts`:

```ts
import { Router } from 'express';
import { SERVER_EPG_LIMITS } from '@iptvnator/shared/interfaces';
import {
    invalidBody,
    optionalString,
    optionalStringList,
    requireBody,
} from './epg-request-body';
import type { ServerEpg } from './epg-service';

export function createEpgImportRouter(epg: ServerEpg): Router {
    const router = Router();

    router.get('/status', (_req, res) => {
        res.json(epg.status());
    });

    /** Queues owned URLs only; the PWA polls `/status` for the outcome. */
    router.post('/import', (req, res) => {
        const body = requireBody(req.body);
        epg.requestImport({
            urls: optionalStringList(
                body['urls'],
                'urls',
                SERVER_EPG_LIMITS.importedSources
            ),
            force: body['force'] === true,
        });
        res.status(202).json(epg.status());
    });

    /** `{}` clears every source; answers once the data is gone. */
    router.post('/clear', async (req, res) => {
        const url = optionalString(requireBody(req.body)['url'], 'url');
        if (url === '') {
            throw invalidBody('url must not be empty.');
        }
        await epg.clear(url ?? null);
        res.json({ success: true });
    });

    return router;
}
```

`apps/web-backend/src/app/epg/epg-query-router.ts`:

```ts
import { Router } from 'express';
import {
    SERVER_EPG_LIMITS,
    type ElectronBridgeEpgGuideWindow,
} from '@iptvnator/shared/interfaces';
import {
    finiteNumber,
    optionalStringList,
    requireBody,
    requireString,
    stringList,
} from './epg-request-body';
import type { ServerEpg } from './epg-service';

type Body = Readonly<Record<string, unknown>>;

/** The read routes of the EPG bridge; keys beyond a cap are ignored. */
export function createEpgQueryRouter(epg: ServerEpg): Router {
    const router = Router();

    router.post('/current', async (req, res) => {
        const body = requireBody(req.body);
        const channelIds = stringList(
            body['channelIds'],
            'channelIds',
            SERVER_EPG_LIMITS.currentKeys
        );
        const nowMs = finiteNumber(body['nowMs']);
        res.json(
            channelIds.length > 0
                ? await epg.queries.getCurrentProgramsBatch(channelIds, {
                      ...scope(body),
                      ...(nowMs !== undefined ? { nowMs } : {}),
                  })
                : {}
        );
    });

    router.post('/metadata', async (req, res) => {
        const body = requireBody(req.body);
        const channelIds = stringList(
            body['channelIds'],
            'channelIds',
            SERVER_EPG_LIMITS.metadataKeys
        );
        res.json(
            channelIds.length > 0
                ? await epg.queries.getChannelMetadata(channelIds, scope(body))
                : {}
        );
    });

    router.post('/channel-programs', async (req, res) => {
        const body = requireBody(req.body);
        const channelId = requireString(body['channelId'], 'channelId');
        const programs = channelId
            ? await epg.queries.getChannelPrograms(channelId, scope(body))
            : [];
        res.json(programs.slice(0, SERVER_EPG_LIMITS.channelPrograms));
    });

    router.post('/window', async (req, res) => {
        const range = guideWindow(
            requireBody(req.body),
            SERVER_EPG_LIMITS.windowKeys
        );
        res.json(range ? await epg.queries.getProgramsForChannels(range) : {});
    });

    router.post('/coverage', async (req, res) => {
        const range = guideWindow(
            requireBody(req.body),
            SERVER_EPG_LIMITS.coverageKeys
        );
        res.json(range ? await epg.queries.getProgramCoverage(range) : []);
    });

    router.post('/search', async (req, res) => {
        const body = requireBody(req.body);
        const term = requireString(body['term'], 'term');
        res.json(
            term
                ? await epg.queries.searchPrograms(
                      term,
                      searchLimit(body['limit'])
                  )
                : []
        );
    });

    return router;
}

/** Scope lists longer than the imported source set cannot match more. */
function scope(body: Body): { sourceUrls?: string[] } {
    const sourceUrls = optionalStringList(
        body['sourceUrls'],
        'sourceUrls',
        SERVER_EPG_LIMITS.importedSources
    );
    return sourceUrls ? { sourceUrls } : {};
}

/** `null` (empty answer) without keys or with bounds that are not finite and increasing. */
function guideWindow(
    body: Body,
    maxKeys: number
): ElectronBridgeEpgGuideWindow | null {
    const channelIds = stringList(body['channelIds'], 'channelIds', maxKeys);
    const fromMs = finiteNumber(body['fromMs']);
    const toMs = finiteNumber(body['toMs']);
    if (
        channelIds.length === 0 ||
        fromMs === undefined ||
        toMs === undefined ||
        fromMs >= toMs
    ) {
        return null;
    }
    return { channelIds, fromMs, toMs, ...scope(body) };
}

function searchLimit(value: unknown): number {
    const limit = finiteNumber(value);
    return limit === undefined
        ? SERVER_EPG_LIMITS.searchLimit
        : Math.min(
              Math.max(Math.floor(limit), 1),
              SERVER_EPG_LIMITS.searchLimit
          );
}
```

`apps/web-backend/src/app/epg/mount-server-epg.ts`:

```ts
import express, { type Express, type RequestHandler } from 'express';
import { SERVER_EPG_LIMITS } from '@iptvnator/shared/interfaces';
import { createEpgImportRouter } from './epg-import-router';
import { createEpgQueryRouter } from './epg-query-router';
import type { ServerEpg } from './epg-service';
import { createEpgSettingsRouter } from './epg-settings-router';

/** Every answer, errors included: guides and source URLs are never cached. */
const noStore: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
};

/**
 * `/v1/epg`. `mountServerStorage` calls it behind its CORS and token guard;
 * errors reach its `/v1` error handler (the phase 2 envelope).
 */
export function mountServerEpg(app: Express, epg: ServerEpg): void {
    app.use(
        '/v1/epg',
        noStore,
        express.json({ limit: SERVER_EPG_LIMITS.bodyBytes }),
        createEpgSettingsRouter(epg),
        createEpgImportRouter(epg),
        createEpgQueryRouter(epg)
    );
}
```

- [ ] **Step 5: Mount it from server storage**

Replace `apps/web-backend/src/app/storage/mount-server-storage.ts` with:

```ts
import type { Express, RequestHandler } from 'express';
import type { ServerEpg } from '../epg/epg-service';
import { mountServerEpg } from '../epg/mount-server-epg';
import { createAccessGuard } from './access-guard';
import { createInstanceRouter } from './instance-router';
import { createPlaylistsRouter } from './playlists-router';
import type { ServerStorage } from './server-storage';
import { storageErrorHandler } from './storage-route-errors';
import { createUserStateRouter } from './user-state-router';

export const DEFAULT_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

export interface ServerStorageMountOptions {
    readonly corsMiddleware: RequestHandler;
    readonly storage: ServerStorage | null;
    /** Server EPG; used only together with storage. */
    readonly epg: ServerEpg | null;
    readonly accessToken: string | null;
    readonly maxDocumentBytes: number;
}

/**
 * Mounts `/v1` and the optional token guard. Call it before the provider
 * proxy routes are registered so the guard also covers them. With a token
 * the CORS headers apply to every route, so a cross-origin 401 stays
 * readable for the PWA in development.
 */
export function mountServerStorage(
    app: Express,
    options: ServerStorageMountOptions
): void {
    const epg = options.storage ? options.epg : null;
    app.use('/v1', options.corsMiddleware);
    if (options.accessToken) {
        app.use(options.corsMiddleware);
        app.use(createAccessGuard(options.accessToken));
    }

    app.use(
        '/v1',
        createInstanceRouter({
            storage: options.storage,
            accessTokenRequired: !!options.accessToken,
            epg,
        })
    );
    if (options.storage) {
        app.use(
            '/v1',
            createPlaylistsRouter(
                options.storage,
                options.maxDocumentBytes,
                () => epg?.playlistsChanged()
            )
        );
        app.use('/v1', createUserStateRouter(options.storage));
        if (epg) {
            mountServerEpg(app, epg);
        }
    }
    app.use('/v1', storageErrorHandler());
}
```

- [ ] **Step 6: Report the feature and the file size**

In `apps/web-backend/src/app/storage/instance-router.ts`, replace

```ts
export function createInstanceRouter(deps: {
    readonly storage: ServerStorage | null;
    readonly accessTokenRequired: boolean;
}): Router {
```

with

```ts
export function createInstanceRouter(deps: {
    readonly storage: ServerStorage | null;
    readonly accessTokenRequired: boolean;
    /** Server EPG, present only with storage. */
    readonly epg: { databaseBytes(): number } | null;
}): Router {
```

replace

```ts
            auth: deps.accessTokenRequired ? 'token' : 'none',
        };
```

with

```ts
            auth: deps.accessTokenRequired ? 'token' : 'none',
            features: { epg: deps.epg !== null },
        };
```

and replace

```ts
            startedAt: storage.startedAt.toISOString(),
        };
```

with

```ts
            startedAt: storage.startedAt.toISOString(),
            ...(deps.epg ? { epgDatabaseBytes: deps.epg.databaseBytes() } : {}),
        };
```

- [ ] **Step 7: Tell EPG about playlist writes**

In `apps/web-backend/src/app/storage/playlists-router.ts`, replace

```ts
export function createPlaylistsRouter(
    storage: ServerStorage,
    maxDocumentBytes: number
): Router {
```

with

```ts
export function createPlaylistsRouter(
    storage: ServerStorage,
    maxDocumentBytes: number,
    /** After every write or delete; server EPG re-reads its sources. */
    onPlaylistsChanged: () => void = () => undefined
): Router {
```

replace

```ts
        playlists.upsert(
            { ...requireDocument(req.body), _id: id },
            { keepPayload: req.query['keepPayload'] === '1' }
        );
```

with

```ts
        playlists.upsert(
            { ...requireDocument(req.body), _id: id },
            { keepPayload: req.query['keepPayload'] === '1' }
        );
        onPlaylistsChanged();
```

and replace

```ts
    router.delete('/playlists/:id', (req, res) => {
        deletePlaylistWithState(storage, requirePlaylistId(req.params.id));
        res.json({ success: true });
    });

    router.delete('/playlists', (_req, res) => {
        deleteAllPlaylistsWithState(storage);
        res.json({ success: true });
    });
```

with

```ts
    router.delete('/playlists/:id', (req, res) => {
        deletePlaylistWithState(storage, requirePlaylistId(req.params.id));
        onPlaylistsChanged();
        res.json({ success: true });
    });

    router.delete('/playlists', (_req, res) => {
        deleteAllPlaylistsWithState(storage);
        onPlaylistsChanged();
        res.json({ success: true });
    });
```

- [ ] **Step 8: Pass the service through the app (mounting lines only)**

In `apps/web-backend/src/app/web-backend-app.ts`:

1. Replace

```ts
import type { ServerStorage } from './storage/server-storage';
```

with

```ts
import type { ServerStorage } from './storage/server-storage';
import type { ServerEpg } from './epg/epg-service';
```

2. Replace

```ts
    /** Server storage; `null` or absent keeps the backend stateless. */
    readonly storage?: ServerStorage | null;
}
```

with

```ts
    /** Server storage; `null` or absent keeps the backend stateless. */
    readonly storage?: ServerStorage | null;
    /** Server EPG (`/v1/epg`); only mounted together with storage. */
    readonly epg?: ServerEpg | null;
}
```

3. Replace

```ts
        storage: options.storage ?? null,
        accessToken: options.accessToken ?? null,
```

with

```ts
        storage: options.storage ?? null,
        epg: options.epg ?? null,
        accessToken: options.accessToken ?? null,
```

- [ ] **Step 9: Update the instance body the storage spec expects**

In `apps/web-backend/src/app/storage/storage-routes.spec.ts`, replace

```ts
                storage: 'none',
                auth: 'none',
            });
```

with

```ts
                storage: 'none',
                auth: 'none',
                features: { epg: false },
            });
```

- [ ] **Step 10: Run the route specs and the whole suite**

```bash
pnpm nx test web-backend --testPathPatterns="epg-routes|epg-query-routes|storage-routes"
pnpm nx test web-backend
pnpm nx lint web-backend
```

Expected: PASS (9 + 6 new route tests); the rest of the suite stays green; lint clean, including `max-lines` on the new files and the unchanged baseline entry of `web-backend-app.ts`.

- [ ] **Step 11: Commit**

```bash
git add apps/web-backend/src/app/epg apps/web-backend/src/app/storage/mount-server-storage.ts apps/web-backend/src/app/storage/instance-router.ts apps/web-backend/src/app/storage/playlists-router.ts apps/web-backend/src/app/storage/storage-routes.spec.ts apps/web-backend/src/app/web-backend-app.ts
git commit -m "feat(web-backend): serve /v1/epg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Start-up and shutdown in `main.ts`

**Files:**
- Modify: `apps/web-backend/src/main.ts`

- [ ] **Step 1: Start EPG after storage and stop it on shutdown**

In `apps/web-backend/src/main.ts`, replace

```ts
import { closeGracefully } from './app/graceful-shutdown';
```

with

```ts
import { openServerEpg } from './app/epg/open-server-epg';
import { closeGracefully } from './app/graceful-shutdown';
```

and replace

```ts
    const port = Number(process.env['PORT'] ?? 3000);
    const app = createWebBackendApp({
        storage,
        accessToken: config.accessToken,
        maxDocumentBytes: config.maxDocumentBytes,
    });
    const server = app.listen(port, () => {
        console.log(
            `IPTVnator web backend listening on http://localhost:${port}`
        );
    });

    const shutdown = () => {
        void closeGracefully(server).then(() => {
            storage?.database.close();
            process.exit(0);
        });
    };
```

with

```ts
    // After storage: the EPG settings and playlist sources live in it.
    // `__dirname` is dist/apps/web-backend in the bundle and
    // apps/web-backend/src under tsx; the worker sits below both.
    const epg = openServerEpg({ storage, rootDir: __dirname });

    const port = Number(process.env['PORT'] ?? 3000);
    const app = createWebBackendApp({
        storage,
        epg,
        accessToken: config.accessToken,
        maxDocumentBytes: config.maxDocumentBytes,
    });
    const server = app.listen(port, () => {
        console.log(
            `IPTVnator web backend listening on http://localhost:${port}`
        );
    });

    const shutdown = () => {
        // The EPG job (stopped, ≤ 5 s, then epg.db closed) and open requests
        // get their grace side by side, inside Docker's 10 s stop timeout.
        void Promise.allSettled([epg?.stop(), closeGracefully(server)]).then(
            () => {
                storage?.database.close();
                process.exit(0);
            }
        );
    };
```

- [ ] **Step 2: Type-check and run the suite**

```bash
pnpm exec tsc -p apps/web-backend/tsconfig.app.json --noEmit
pnpm nx test web-backend
```

Expected: no type errors; all specs pass.

- [ ] **Step 3: Smoke-test the bundle with a local feed**

```bash
export SMOKE_DIR="$(mktemp -d)"
cat > "$SMOKE_DIR/feed.mjs" <<'EOF'
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';

const now = Date.now();
const time = (ms) =>
    `${new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;
const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>'];
for (const id of ['one', 'two', 'three']) {
    lines.push(`<channel id="${id}"><display-name>Channel ${id}</display-name></channel>`);
    for (let index = 0; index < 50; index += 1) {
        const start = now - 2 * 3_600_000 + index * 1_800_000;
        lines.push(
            `<programme start="${time(start)}" stop="${time(start + 1_800_000)}" channel="${id}"><title>Show ${id} ${index}</title></programme>`
        );
    }
}
lines.push('</tv>');
const body = gzipSync(lines.join('\n'));
createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/gzip' });
    res.end(body);
}).listen(Number(process.env.FEED_PORT ?? 8765), '0.0.0.0');
EOF
FEED_PORT=8765 node "$SMOKE_DIR/feed.mjs" &
FEED_PID=$!
pnpm nx build web-backend --skip-nx-cache
IPTVNATOR_STORAGE=server IPTVNATOR_EPG=on IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS=1 \
  IPTVNATOR_DATA_DIR="$SMOKE_DIR/bundle" PORT=3399 NODE_PATH="$PWD/node_modules" \
  node dist/apps/web-backend/main.cjs > "$SMOKE_DIR/bundle.log" 2>&1 &
BACKEND_PID=$!
sleep 3
curl -s http://localhost:3399/v1/instance; echo
curl -s -X PUT -H 'content-type: application/json' \
  -d '{"urls":["http://127.0.0.1:8765/guide.xml.gz?token=secret"]}' \
  http://localhost:3399/v1/epg/settings; echo
for i in $(seq 1 30); do curl -s http://localhost:3399/v1/epg/status | grep -q '"lastSuccessAt"' && break; sleep 1; done
curl -s http://localhost:3399/v1/epg/status; echo
curl -s -X POST -H 'content-type: application/json' -d '{"term":"Show one","limit":3}' \
  http://localhost:3399/v1/epg/search; echo
kill -TERM "$BACKEND_PID"; wait "$BACKEND_PID"; echo "backend exit $?"
cat "$SMOKE_DIR/bundle.log"
grep -c secret "$SMOKE_DIR/bundle.log"
ls "$SMOKE_DIR/bundle/databases"
```

Expected: `/v1/instance` contains `"features":{"epg":true}`; the settings answer echoes the URL with `"refreshTime":"04:00"`; the status lists that source with `"state":"idle"`, `"channels":3` and `"programmes":150`; the search answers three hits with `"channelName":"Channel one"`; `backend exit 0`; the log has `server EPG at …/epg.db` and `EPG import from 127.0.0.1: 3 channels, 150 programmes`; the `grep -c secret` prints `0`; the folder lists `epg.db` and `iptvnator.db`.

- [ ] **Step 4: Smoke-test the source run Playwright uses**

```bash
IPTVNATOR_STORAGE=server IPTVNATOR_EPG=on IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS=1 \
  IPTVNATOR_DATA_DIR="$SMOKE_DIR/source" PORT=3398 TSX_TSCONFIG_PATH=tsconfig.base.json \
  node --import tsx apps/web-backend/src/main.ts > "$SMOKE_DIR/source.log" 2>&1 &
BACKEND_PID=$!
sleep 5
curl -s -X PUT -H 'content-type: application/json' \
  -d '{"urls":["http://127.0.0.1:8765/guide.xml.gz"]}' http://localhost:3398/v1/epg/settings; echo
for i in $(seq 1 60); do curl -s http://localhost:3398/v1/epg/status | grep -q '"lastSuccessAt"' && break; sleep 1; done
curl -s http://localhost:3398/v1/epg/status; echo
kill -TERM "$BACKEND_PID"; wait "$BACKEND_PID"; echo "backend exit $?"
kill "$FEED_PID"
```

Expected: the status shows `"programmes":150` (the `.ts` worker ran through the `tsx/cjs/api` bootstrap); `backend exit 0`.

- [ ] **Step 5: Commit**

```bash
git add apps/web-backend/src/main.ts
git commit -m "feat(web-backend): start server EPG with storage and stop it on shutdown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Docker

**Files:**
- Modify: `docker/Dockerfile`
- Modify: `docker/docker-compose.yml`
- Modify: `docker/README.md`

- [ ] **Step 1: Check the worker in the image**

The runtime stage already copies all of `dist/apps/web-backend` (the worker
lands in `/opt/iptvnator/web-backend/app/epg/`, and `require('better-sqlite3')`
resolves from `/opt/iptvnator/web-backend/node_modules`). In
`docker/Dockerfile`, replace

```Dockerfile
RUN chmod +x /usr/local/bin/iptvnator-entrypoint && mkdir -p /data
```

with

```Dockerfile
# The XMLTV import runs in a worker thread from its own bundle (a second
# esbuild entry); fail the build if the output lost it.
RUN chmod +x /usr/local/bin/iptvnator-entrypoint && mkdir -p /data \
    && test -f ./web-backend/app/epg/epg-import.worker.cjs
```

- [ ] **Step 2: Compose**

In `docker/docker-compose.yml`, replace

```yaml
      # Ask every browser for this token once before it shows the library.
      # IPTVNATOR_ACCESS_TOKEN: change-me
```

with

```yaml
      # Ask every browser for this token once before it shows the library.
      # IPTVNATOR_ACCESS_TOKEN: change-me
      # Server-side XMLTV guides (needs IPTVNATOR_STORAGE=server). Off until
      # the browser app uses them; see docker/README.md#server-epg.
      # IPTVNATOR_EPG: "on"
      # IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS: "0"
      # IPTVNATOR_EPG_MAX_MB: "1024"
      # The daily EPG refresh runs at 04:00 in this zone (UTC without it).
      # TZ: Europe/Berlin
```

- [ ] **Step 3: README**

In `docker/README.md`, after the table row that starts with
`` | `IPTVNATOR_BACKEND_START_TIMEOUT` `` add:

```markdown
| `IPTVNATOR_EPG`                          | `off`                   | `on` imports XMLTV guides on the server (needs `IPTVNATOR_STORAGE=server`) and serves `/api/v1/epg`. See [Server EPG](#server-epg).   |
| `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS`   | `0`                     | `1` or `true` lets XMLTV sources on loopback and LAN addresses through; `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1` implies it.          |
| `IPTVNATOR_EPG_MAX_MB`                   | `1024`                  | Largest decompressed size of one XMLTV feed, in megabytes.                                                                              |
| `TZ`                                     | UTC                     | Time zone of the daily EPG refresh (04:00 by default), for example `Europe/Berlin`.                                                    |
```

and insert this section directly before `## IPv6, VPNs, And Connection Fallback`:

```markdown
## Server EPG

With server storage the backend can import XMLTV guides itself: from a
source list kept on the server and from the EPG URLs of the M3U playlists
on it, once a day at 04:00 in the container's time zone, a minute after
start for sources without a fresh import, and on demand. It is off by
default (`IPTVNATOR_EPG=off`) until the browser app uses it; `on` starts
the import and serves the `/api/v1/epg` routes.

- **Time zone.** Containers run in UTC unless `TZ` is set (for example
  `TZ: Europe/Berlin`); the daily refresh follows it.
- **Disk.** Guides go to `databases/epg.db` on the data volume, apart from
  `iptvnator.db`. Plan about 1 KB per programme: a typical provider feed
  takes 150–350 MB. Programmes that ended more than 7 days ago are pruned
  after the nightly run.
- **Memory.** One import runs at a time, in a worker with up to 512 MB of
  heap. `IPTVNATOR_EPG_MAX_MB` (default 1024) caps the decompressed size of
  one feed; at most 100 sources are imported.
- **LAN sources.** XMLTV URLs on loopback or private addresses are blocked
  unless `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS=1` (or
  `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1`). With it on, anyone who can
  use the instance can make it fetch LAN URLs; keep it to trusted setups.
  For private certificate authorities use `NODE_EXTRA_CA_CERTS` as above.
- **Reset.** `epg.db` holds imported data only. Stop the container and
  delete it (with `epg.db-wal` and `epg.db-shm`) at any time: the source
  list and refresh time stay in `iptvnator.db`, and every source imports
  again a minute after the next start. A file the server cannot open is
  renamed `epg.db.broken-<time>` and replaced by an empty one.
- **Logs.** Import failures are logged with the host and an error code,
  never the URL, which often carries credentials.
```

- [ ] **Step 4: Validate the image with a feed served from the host**

```bash
docker compose -f docker/docker-compose.yml config >/dev/null && echo compose-ok
docker build -t iptvnator:server-epg-test -f docker/Dockerfile .
export SMOKE_DIR="${SMOKE_DIR:-$(mktemp -d)}"
test -f "$SMOKE_DIR/feed.mjs" || echo "Create feed.mjs as in Task 15, Step 3"
FEED_PORT=8765 node "$SMOKE_DIR/feed.mjs" &
FEED_PID=$!
docker run -d --name iptvnator-epg-test -p 4335:80 \
  --add-host=host.docker.internal:host-gateway \
  -e IPTVNATOR_EPG=on -e IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS=1 -e TZ=Europe/Berlin \
  -v iptvnator-epg-test:/data iptvnator:server-epg-test
sleep 10
curl -s http://localhost:4335/api/v1/instance; echo
curl -s -X PUT -H 'content-type: application/json' \
  -d '{"urls":["http://host.docker.internal:8765/guide.xml.gz"]}' \
  http://localhost:4335/api/v1/epg/settings; echo
for i in $(seq 1 60); do curl -s http://localhost:4335/api/v1/epg/status | grep -q '"lastSuccessAt"' && break; sleep 1; done
curl -s http://localhost:4335/api/v1/epg/status; echo
docker exec iptvnator-epg-test ls -la /data/databases
docker stop -t 10 iptvnator-epg-test
docker logs iptvnator-epg-test 2>&1 | grep -i epg
docker rm -f iptvnator-epg-test && docker volume rm iptvnator-epg-test
kill "$FEED_PID"
```

Expected: `compose-ok`; the image builds (the `test -f` passes); `/api/v1/instance` reports `"features":{"epg":true}`; the status shows `"timeZone":"Europe/Berlin"`, a `nextRunAt` at 04:00 Berlin time and the source `idle` with `"programmes":150`; `/data/databases` holds `epg.db` and `iptvnator.db`; `docker stop` returns within 10 s; the logs show the import line with `host.docker.internal` and no URL path. Without a Docker daemon, record the step as skipped and rely on the PR's Docker build check (`gh workflow run docker.yml --ref claude/server-epg-backend -f push=false`).

- [ ] **Step 5: Commit**

```bash
git add docker/Dockerfile docker/docker-compose.yml docker/README.md
git commit -m "feat(docker): document server EPG and check its worker bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Architecture docs

**Files:**
- Modify: `docs/architecture/pwa-self-hosted.md`
- Modify: `docs/architecture/validation-map.md`

Edit only the lines below; never run Prettier over `docs/**`.

- [ ] **Step 1: Routes**

In `docs/architecture/pwa-self-hosted.md`, replace

```markdown
- `GET /v1/instance` (always public): `{ service, apiVersion, instanceId,
  storage: 'server' | 'none', auth: 'none' | 'token' }`
- `GET /v1/instance/status`: playlist count, database size and path
```

with

```markdown
- `GET /v1/instance` (always public): `{ service, apiVersion, instanceId,
  storage: 'server' | 'none', auth: 'none' | 'token', features: { epg } }`
- `GET /v1/instance/status`: playlist count, database size and path, and
  with server EPG the size of `epg.db` (`epgDatabaseBytes`)
```

and replace

```markdown
- `GET|PUT /v1/app-state/:key`
```

with

```markdown
- `GET|PUT /v1/app-state/:key`
- with [server EPG](#server-epg): `GET|PUT /v1/epg/settings`,
  `GET /v1/epg/status`, `POST /v1/epg/import` (`202`), `POST /v1/epg/clear`,
  and the reads `POST /v1/epg/current`, `/metadata`, `/channel-programs`,
  `/window`, `/coverage` and `/search` (contract:
  `libs/shared/interfaces/src/lib/server-epg.contract.ts`)
```

- [ ] **Step 2: Server EPG section**

Insert directly before `## Server Storage Mode`:

```markdown
## Server EPG

`apps/web-backend/src/app/epg/` imports XMLTV on the server (PR 3c of the
[server EPG design](../superpowers/specs/2026-10-15-server-epg-design.md)).
`main.ts` calls `openServerEpg()` after server storage opened; it starts
the service only with `IPTVNATOR_EPG=on` (default `off` until the PWA uses
it) and logs and continues without it when `epg.db` or the worker bundle
cannot be used. `/v1/instance` reports it as `features.epg`, and
`mountServerStorage` mounts `/v1/epg` behind the same CORS, token guard and
error envelope as the storage routes, with `Cache-Control: no-store` and a
256 KB JSON limit.

- **Data.** `<IPTVNATOR_DATA_DIR>/databases/epg.db`, opened with
  `auto_vacuum=INCREMENTAL` (set before the first table), WAL and
  `busy_timeout`; schema from `ensureEpgSchema(db, { fts: false })` of
  `@iptvnator/shared/epg-store`, plus the server-only `server_epg_imports`
  (last attempt, last success, counts, error code and host per source). A
  file that fails to open or migrate is renamed `epg.db.broken-<time>` and
  recreated; it holds no configuration.
- **Sources** (`epg-source-registry.ts`). The server list and refresh time
  are `server:epg-settings` in `iptvnator.db`'s `app_state`. The source set
  is that list plus the `epg_urls` column of playlists without `serverUrl`
  or `macAddress`, http(s) only, at most 100 (the rest report
  `epg_too_many_sources`). `PUT /v1/epg/settings` recomputes it at once, a
  playlist write or delete after 2 s; new URLs are queued, and URLs left
  without an owner are cleared once their running import stopped.
- **Schedule** (`epg-scheduler.ts`). One timer to the next `HH:MM` in the
  process time zone (`TZ`): it queues every source, then prunes programmes
  that stopped more than seven days ago and runs `incremental_vacuum`. A
  minute after start, sources without a success in 24 h are queued. An
  unforced `POST /v1/epg/import` queues only such stale sources; a forced
  one every owned URL it names.
- **Queue and worker** (`epg-import-queue.ts`, `epg-job-watch.ts`,
  `epg-import.worker.ts`). One job at a time, FIFO, duplicates coalesced,
  a request for a source that finished less than a minute ago dropped.
  Imports, clears and the prune each run in a worker thread (512 MB heap)
  on their own `epg.db` connection; the main thread writes only
  `server_epg_imports` between jobs, so it never waits on the import's
  write lock. Fetches go through `ValidatedHttpClient.stream()` with the
  proxy's URL policy (raw body, wire cap equal to the decoded cap, 120 s of
  socket inactivity); private networks need
  `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS` or the proxy flag. Five minutes
  without progress or an hour in total time a job out; the stall timer
  stops once the import reports its publish transaction
  (`onPublishStart`), which sends no progress. A failed or cancelled
  import publishes nothing. The build bundles the worker as
  `app/epg/epg-import.worker.cjs` beside `main.cjs`
  (`additionalEntryPoints`); under tsx and Jest the runner starts the `.ts`
  source in an `eval` worker that registers `tsx/cjs/api`.
- **Errors and logs.** Failures map to `ServerEpgErrorCode`
  (`epg-error-codes.ts`; zlib errors count as `epg_parse_failed`); an
  unclassified one (disk full, SQLite) shows state `error` without a code.
  Logs go through the library's `epgLogger` and carry the host, code and
  error name, never the URL.
- **Shutdown.** SIGTERM and SIGINT stop the scheduler and abort the running
  job (terminated after 5 s) alongside the HTTP server's grace period, then
  close both databases.

Validation: `pnpm nx test web-backend --testPathPatterns=epg`; the worker
spec starts real worker threads against a local XMLTV server.
```

- [ ] **Step 3: Validation map**

In `docs/architecture/validation-map.md`, replace

```markdown
| Shared SQLite schema/connection    | `pnpm nx test database`             |
```

with

```markdown
| Shared SQLite schema/connection    | `pnpm nx test database`             |
| Server EPG (web-backend)           | `pnpm nx test web-backend --testPathPatterns=epg` |
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/pwa-self-hosted.md docs/architecture/validation-map.md
git commit -m "docs(self-hosted): server EPG backend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Full validation

**Files:** none unless a check fails.

- [ ] **Step 1: Run every gate**

```bash
pnpm nx run-many -t test,lint -p web-backend shared-interfaces
pnpm exec tsc -p apps/web-backend/tsconfig.app.json --noEmit
pnpm run typecheck:ci
pnpm run typecheck:spec apps/web-backend
pnpm nx build web-backend
pnpm nx run web-e2e:e2e -- --project=chromium --grep @self-hosted
pnpm exec prettier --check $(git diff --name-only origin/master -- '*.ts' '*.json')
git diff --stat origin/master -- tools/eslint/max-lines-baseline.mjs apps/electron-backend libs/shared/epg-store
```

Expected: tests, lint, type checks, the build and the `@self-hosted` E2E pass (the E2E storage backend runs with EPG off, so this is the regression signal for `/v1`); Prettier reports no differences; the last command prints nothing (no baseline entry added, Electron and the library untouched, so the Electron EPG E2E is not affected). Fix any failure in the task that owns the file and commit it as `fix(web-backend): <what>` with the attribution line.

---

### Task 19: Local review gate

**Files:** whatever the reviews flag.

- [ ] **Step 1: Review the committed branch**

```bash
git fetch origin
git merge origin/master   # only when origin/master moved; never rebase
codex review --base origin/master -c model_reasoning_effort=high
greptile review --json
```

- [ ] **Step 2: Fix, re-run, repeat**

Fix every valid finding, re-run the affected specs plus `pnpm nx lint web-backend`, and commit:

```bash
git add -A apps/web-backend libs/shared/interfaces docker docs
git commit -m "fix(web-backend): address local review findings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Repeat Step 1 until both reviews are clean or their findings repeat, at most five rounds. List findings left unfixed, with reasons, for the PR body; after five rounds ask the maintainer before pushing.

---

### Task 20: Push and open the pull request

**Files:** none.

- [ ] **Step 1: Push once**

```bash
git push -u origin claude/server-epg-backend
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(self-hosted): XMLTV import and EPG API in web-backend" --label no-release-note --body "$(cat <<'EOF'
## What changed

- With `IPTVNATOR_STORAGE=server` and `IPTVNATOR_EPG=on` (default `off` in this PR), `web-backend` imports XMLTV itself into `databases/epg.db` on the data volume: sources are the server list (`server:epg-settings` in `app_state`) plus the `epg_urls` of M3U playlists; a daily run at `HH:MM` in the process time zone, a catch-up a minute after start, and imports on demand.
- One job at a time in a worker thread on `@iptvnator/shared/epg-store`, fetched through `ValidatedHttpClient.stream()` with the proxy's URL policy (`IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS` for LAN sources), with socket-inactivity, stall (paused during the publish transaction), wall-clock and size limits; a failed import publishes nothing. The nightly run prunes programmes older than seven days and vacuums.
- `/v1/epg` (contract `libs/shared/interfaces/src/lib/server-epg.contract.ts`): settings, status, import (`202`), clear and the six reads, behind the access guard, `Cache-Control: no-store`, 256 KB bodies, phase 2 error envelope.
- `/v1/instance` reports `features.epg`; `/v1/instance/status` adds `epgDatabaseBytes`.
- The build bundles the worker as a second esbuild entry; the Dockerfile checks it. Docker README, compose and `docs/architecture/pwa-self-hosted.md` document the variables, `TZ`, disk use and resetting `epg.db`.

## Why

PR 3c of the server EPG design (`docs/superpowers/specs/2026-10-15-server-epg-design.md`): the server side of EPG for the self-hosted PWA (#444). The PWA starts using it in 3d.

## Release note

None, label `no-release-note`: `IPTVNATOR_EPG` is off by default and no client calls `/v1/epg` yet. 3d turns it on with a note.

## Checks

- `pnpm nx run-many -t test,lint -p web-backend shared-interfaces`
- `pnpm exec tsc -p apps/web-backend/tsconfig.app.json --noEmit`, `pnpm run typecheck:ci`, `pnpm run typecheck:spec apps/web-backend`
- `pnpm nx build web-backend` (worker bundle present)
- `pnpm nx run web-e2e:e2e -- --project=chromium --grep @self-hosted`
- Bundle and `node --import tsx` smoke tests with a local feed; Docker build and run with a feed served from the host
- Local review: Codex and Greptile clean

Electron and `@iptvnator/shared/epg-store` are unchanged, so the Electron EPG E2E does not apply.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report**

Report the PR URL, the checks and their results, skipped checks with reasons (for example Docker without a daemon), any adaptations to the 3b-2 API from Task 0, review findings left open, the docs changed and that no release note was added (`no-release-note`).
