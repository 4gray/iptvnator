# Server-side EPG for the Self-hosted PWA — Overview

Spec: `docs/superpowers/specs/2026-10-15-server-epg-design.md`.
Branch base: `origin/master` at `ea1ac41fc` (2026-10-15).

## Order of work

Six pull requests. Each one leaves the app working and fully tested.

| Plan | PR title | Depends on | Release note |
| --- | --- | --- | --- |
| [3a: provider EPG](2026-10-15-server-epg-3a-provider-epg.md) | `feat(pwa): show Xtream and Stalker EPG in the browser version` | — | `.changes/pwa-provider-epg.md`, closes #1683 |
| [3b-1: renderer seam](2026-10-15-server-epg-3b1-renderer-seam.md) | `refactor(epg): pluggable EPG runtime backend` | — | none, label `no-release-note` |
| [3b-2: epg-store library](2026-10-15-server-epg-3b2-epg-store.md) | `refactor(epg): move XMLTV import and queries into @iptvnator/shared/epg-store` | #1941, #1946, #1947 (+#1800) merged | none, label `no-release-note` |
| [3c: server](2026-10-15-server-epg-3c-backend.md) | `feat(self-hosted): XMLTV import and EPG API in web-backend` | 3b-2 | none, label `no-release-note` (`IPTVNATOR_EPG` defaults to `off`) |
| [3d: PWA](2026-10-15-server-epg-3d-pwa.md) | `feat(self-hosted): EPG for M3U playlists from the server` | 3b-1, 3c | `.changes/self-hosted-server-epg.md`, closes #444 |
| 3e: mapping | `feat(self-hosted): shared EPG channel mapping` | 3d | yes; plan written after 3d merges (outline below) |

3a and 3b-1 start now and run in parallel. 3b-2 starts when the four open
EPG pipeline PRs are merged (or closed); refresh its move map against
`master` first, because they change the files it moves.

## Branches and worktrees

- One worktree per PR under `.claude/worktrees/`, each with its own
  `pnpm install --frozen-lockfile` (AGENTS.md).
- `claude/server-epg` holds the spec and these plans. The 3a branch
  `claude/server-epg-provider` is created from it, so the 3a PR carries the
  spec and plans to `master`.
- 3b-1: `claude/server-epg-seam` from `origin/master`; merge `origin/master`
  after 3a lands.
- 3b-2: `claude/server-epg-store`, 3c: `claude/server-epg-backend`,
  3d: `claude/server-epg-pwa`, each from `origin/master` after its
  dependencies merged. Never stack on an unmerged branch unless the
  maintainer asks.
- Updates to an open PR arrive as merges of `origin/master`, never as a
  rebase or force-push (auto-fix and the review bots track the head).

## Gates for every PR (AGENTS.md)

1. Targeted unit tests and lint of every touched project
   (`pnpm nx test <project>`, `pnpm nx lint <project>`).
2. `pnpm run typecheck:ci`.
3. Affected E2E from `docs/architecture/validation-map.md`.
4. Docs updated in the canonical owner (listed per plan).
5. `pnpm run release:notes:validate` when a note is added; label
   `no-release-note` otherwise.
6. Local review gate: commit, `git fetch origin`, then
   `codex review --base origin/master -c model_reasoning_effort=high` and
   `greptile review --json` on the same commit; fix, repeat until both are
   clean or findings repeat, at most five rounds, then ask the maintainer.
7. Push once, open the PR, report checks, skipped checks with reasons, docs
   and release-note status.

## Shared contracts

These names and shapes are fixed across plans. A plan that needs to change
one updates this section and every plan that uses it.

### A. Renderer EPG backend (3b-1; used by 3d)

`libs/shared/interfaces/src/lib/epg-runtime-backend.ts`, exported from the
`@iptvnator/shared/interfaces` barrel:

```ts
import type { ElectronBridgeApi } from './electron-api.interface';

/**
 * Bridge methods the renderer's EPG layer calls. A capability is "the method
 * is present on the selected backend".
 */
export const EPG_RUNTIME_BACKEND_METHODS = [
    'fetchEpg',
    'forceFetchEpg',
    'openEpgFileDialog',
    'clearEpgData',
    'clearEpgDataForSource',
    'reconcileEpgSources',
    'getChannelPrograms',
    'getCurrentProgramsBatch',
    'getEpgChannelMetadata',
    'checkEpgFreshness',
    'getEpgProgramsForChannels',
    'getEpgProgramCoverage',
    'searchEpgPrograms',
    'onEpgProgress',
    'getEpgMapping',
    'getEpgMappingsBatch',
    'setEpgMapping',
    'deleteEpgMapping',
    'searchEpgChannels',
] as const;

export type EpgRuntimeBackendMethod =
    (typeof EPG_RUNTIME_BACKEND_METHODS)[number];

export type EpgRuntimeBackend = Partial<
    Pick<ElectronBridgeApi, EpgRuntimeBackendMethod>
>;
```

`libs/services/src/lib/epg-runtime-backend.token.ts`, exported from the
`@iptvnator/services` main barrel:

```ts
import { InjectionToken } from '@angular/core';
import type { EpgRuntimeBackend } from '@iptvnator/shared/interfaces';

/** Resolves the EPG backend on every call, as `window.electron` is read today. */
export type EpgRuntimeBackendResolver = () => EpgRuntimeBackend | undefined;

export const EPG_RUNTIME_BACKEND = new InjectionToken<EpgRuntimeBackendResolver>(
    'EPG_RUNTIME_BACKEND',
    {
        providedIn: 'root',
        factory: () => () =>
            typeof window === 'undefined' ? undefined : window.electron,
    }
);
```

- The EPG flags live in `libs/services/src/lib/epg-runtime-capabilities.ts`
  and check `typeof resolver()?.[method] === 'function'` instead of
  `hasElectronMethod`; the method lists per flag stay as they are.
  `RuntimeCapabilitiesService` keeps its `supportsEpg*` getters as thin
  delegates, so no consumer changes.
- `isElectronRuntime()` (main barrel) answers "Electron?" without an
  injector: `main.ts`'s probe builds `RuntimeCapabilitiesService` with `new`
  before Angular starts, which an `inject()` field would break.
- `EpgRuntimeBridgeService` and `EpgSourceSettingsService` keep the
  resolver and call it per use (`this.backend()?.method(...)`); nobody
  caches the backend object. 3d provides a resolver that creates the server
  backend lazily on its first call (a DI cycle with `ServerStorageSession`
  otherwise).
- `supportsProviderEpg` (3a) is a separate getter on
  `RuntimeCapabilitiesService` and does not use this token.

### B. `@iptvnator/shared/epg-store` (3b-2; used by 3c)

`libs/shared/epg-store`, Nx project `shared-epg-store`, Node only, tags
`scope:shared`, `domain:shared-runtime`, `type:data-access`; a
`no-restricted-imports` rule keeps renderer projects from importing it (Nx
tags cannot, since `services` and `database` share them). The epg_* DDL
lives in `libs/shared/database/src/lib/epg-schema-sql.ts`, used by both
`connection.ts` and `ensureEpgSchema`. Public API (`src/index.ts`):

```ts
import type BetterSqlite3 from 'better-sqlite3';
import type { RunResult } from 'better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { Readable } from 'node:stream';
import type {
    ElectronBridgeCurrentProgramsOptions,
    ElectronBridgeEpgFreshnessResult,
    ElectronBridgeEpgGuideWindow,
    ElectronBridgeEpgSearchProgram,
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';

// Schema: the epg_* DDL shared with libs/shared/database's connection.ts.
export function ensureEpgSchema(
    db: BetterSqlite3.Database,
    options: { fts: boolean }
): void;

// Import
export interface EpgSourceResponse {
    readonly stream: Readable;          // raw body, before Content-Encoding
    readonly requestUrl: string;
    readonly finalUrl: string;          // after redirects
    readonly headers: Readonly<Record<string, string | string[] | undefined>>;
    /** Electron's local files: gzip is detected from the first bytes only. */
    readonly kind?: 'http' | 'file';
}
export type EpgSourceOpener = (
    url: string,
    signal: AbortSignal
) => Promise<EpgSourceResponse>;
export interface EpgImportStats {
    readonly totalChannels: number;
    readonly totalPrograms: number;
}
export const EPG_IMPORT_ERROR_CODES = {
    Empty: 'epg_empty',
    ParseFailed: 'epg_parse_failed',
    TooLarge: 'epg_too_large',
    Aborted: 'epg_aborted',
} as const;
export type EpgImportErrorCode =
    (typeof EPG_IMPORT_ERROR_CODES)[keyof typeof EPG_IMPORT_ERROR_CODES];
export class EpgImportError extends Error {
    constructor(readonly code: EpgImportErrorCode, message?: string);
}
export interface RunEpgImportOptions {
    readonly url: string;
    readonly db: BetterSqlite3.Database;
    readonly openSource: EpgSourceOpener;   // its errors propagate unchanged
    readonly signal: AbortSignal;
    readonly onProgress?: (stats: EpgImportStats) => void;
    /**
     * Called once right before the synchronous publish transaction, which
     * sends no progress; a stall watcher suspends its timer here.
     */
    readonly onPublishStart?: () => void;
    readonly maxDecompressedBytes?: number;
}
/**
 * Stages, then publishes atomically (#1941); nothing is published on throw.
 * Raises only the four codes above itself; zlib (`Z_*`), transport, opener
 * and SQLite errors pass through unchanged. Never sets pragmas or closes `db`.
 */
export function runEpgImport(options: RunEpgImportOptions): Promise<EpgImportStats>;

// Maintenance
export function clearAllEpgData(db: BetterSqlite3.Database): void;
export function clearEpgSource(db: BetterSqlite3.Database, sourceUrl: string): void;
/** Deletes programmes that stopped before now − olderThanDays; returns the count. */
export function pruneEpgPrograms(
    db: BetterSqlite3.Database,
    options: { olderThanDays: number; now?: Date }
): number;

// Queries
/** Structural, so any drizzle instance over the epg_* tables fits. */
export type EpgDrizzle = Pick<
    BaseSQLiteDatabase<'sync', RunResult>,
    'select' | 'selectDistinct' | 'all'
>;
/** Loads drizzle's better-sqlite3 driver only when called. */
export function createEpgDrizzle(db: BetterSqlite3.Database): EpgDrizzle;
export interface EpgQueries {
    getChannelPrograms(channelId: string, options?: { sourceUrls?: string[] }): Promise<EpgProgram[]>;
    getCurrentProgramsBatch(channelIds: string[], options?: ElectronBridgeCurrentProgramsOptions): Promise<Record<string, EpgProgram | null>>;
    getChannelMetadata(channelIds: string[], options?: { sourceUrls?: string[] }): Promise<Record<string, EpgChannelMetadata | null>>;
    getProgramsForChannels(window: ElectronBridgeEpgGuideWindow): Promise<Record<string, EpgProgram[]>>;
    getProgramCoverage(window: ElectronBridgeEpgGuideWindow): Promise<string[]>;
    searchPrograms(term: string, limit?: number): Promise<ElectronBridgeEpgSearchProgram[]>;
    checkFreshness(urls: string[], maxAgeHours?: number): Promise<ElectronBridgeEpgFreshnessResult>;
}
export function createEpgQueries(options: {
    readonly getDb: () => EpgDrizzle | Promise<EpgDrizzle>;
    /**
     * Manual mappings (Electron; server from 3e): channel key → EPG channel
     * id. A rejection falls back to unmapped ids, except for coverage.
     */
    readonly resolveMappings?: (keys: string[]) => Promise<Map<string, string>>;
}): EpgQueries;

// Also exported: epgLogger, isEpgSourceFresh, EPG_FRESHNESS_MAX_AGE_HOURS;
// `@iptvnator/shared/epg-store/testing` exports seedEpgSource.
```

3b-2 also gives `ValidatedHttpClient` (web-backend) a streaming mode for 3c:
`stream(url, { maxBytes, timeout?, signal?, headers?, params?, onConnect? })`
resolves at the final 2xx headers with
`WebBackendHttpStream { stream, requestUrl, finalUrl, headers, status }`,
body not decompressed. Failures before headers are `ProviderRequestError`
as in `get()`; the stream fails with `ProviderBodyTooLargeError`
(`code === PROVIDER_BODY_TOO_LARGE_CODE`, `'ERR_PROVIDER_BODY_TOO_LARGE'`,
exported from `provider-response.ts`) past `maxBytes` wire bytes, or with
`ECONNABORTED` after `timeout` of socket inactivity.

Electron keeps its worker entry, fetch orchestration, generation fences,
error classification (private network, TLS) and IPC; they call this API.

### C. HTTP contract (3c; used by 3d)

`libs/shared/interfaces/src/lib/server-epg.contract.ts`, exported from the
barrel. Routes under `/v1/epg` (`/api/v1/epg` behind the Docker nginx).

```ts
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
    readonly lastAttemptAt?: string;  // ISO
    readonly lastSuccessAt?: string;  // ISO
    readonly channels?: number;       // from the last success
    readonly programmes?: number;
    readonly errorCode?: ServerEpgErrorCode;
    readonly errorHost?: string;
}

export interface ServerEpgStatus {
    readonly revision: number;
    readonly refreshTime: string;
    readonly timeZone: string;        // IANA name the server schedules in
    readonly nextRunAt: string | null; // ISO
    readonly sources: readonly ServerEpgSourceStatus[];
    readonly totals: { readonly programmes: number; readonly databaseBytes: number };
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

`POST /v1/epg/window` and `/coverage` take `ElectronBridgeEpgGuideWindow`.
Answers: `GET|PUT settings` → `ServerEpgSettings`; `status` and `import`
(`202`) → `ServerEpgStatus`; `clear` → `{ success: true }`; `current` →
`Record<string, EpgProgram | null>`; `metadata` →
`Record<string, EpgChannelMetadata | null>`; `channel-programs` →
`EpgProgram[]`; `window` → `Record<string, EpgProgram[]>`; `coverage` →
`string[]`; `search` → `ElectronBridgeEpgSearchProgram[]`. Every answer has
`Cache-Control: no-store`.

`server-storage.contract.ts` gains:

```ts
export interface ServerInstanceFeatures {
    readonly epg?: boolean;
}
// ServerInstanceInfo: readonly features?: ServerInstanceFeatures;
// ServerStorageStatusResponse: readonly epgDatabaseBytes?: number;
```

### D. Environment (3c)

| Variable | Values | Default |
| --- | --- | --- |
| `IPTVNATOR_EPG` | `on`, `off` | `off` in 3c, `on` from 3d; ignored without `IPTVNATOR_STORAGE=server` |
| `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS` | `1`/`true` | off; `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1` implies it |
| `IPTVNATOR_EPG_MAX_MB` | positive integer | `1024` (decompressed per source) |
| `TZ` | IANA zone | container default (UTC); the schedule uses it |

## Product decisions from the plan review (2026-10-15)

- 3a shows Settings → EPG in the PWA with only the display settings (EPG
  time offset and view mode) when provider EPG is available; the XMLTV
  source part stays hidden without XMLTV capabilities.
- 3a checks Xtream catch-up (timeshift URL) in the browser players against
  a real provider; if it does not play, archive actions are hidden in the
  PWA until a separate task fixes them.
- 3a's loading skeleton follows the per-source EPG rule (no row jump).
- 3d saves the daily refresh time through the Settings Save bar together
  with the URL list (one `PUT /v1/epg/settings`).
- 3d shows a separate "On the server" list of every imported source
  (including playlist-owned ones) below the URL list; inline status chips
  on URL rows stay and use 24 h freshness in server mode.
- 3d's import progress panel shows only imports started on this device.
- 3d: "Clear EPG data" re-imports every source; playlist info accepts only
  http(s) EPG URLs in server mode; an offline start shows an empty list
  with the offline banner.

## Decisions to keep in mind

- Never add files to `tools/eslint/max-lines-baseline.mjs`. New production
  files stay under 300 lines; the moved `epg-query.service.ts` (976 lines,
  baselined) is split, and its baseline entry is removed.
- Never log XMLTV URLs, query strings or fetched bodies; log error names,
  codes and hosts.
- Source URLs travel only in JSON bodies, never in query strings.
- Electron behavior does not change in 3b-1, 3b-2 or 3c. The full
  `electron-backend` suite and the Electron EPG E2E (`epg.e2e.ts`) are the
  regression signal.
- `apps/electron-backend/build-worker.js` keeps its own esbuild alias table:
  add `@iptvnator/shared/epg-store` there (3b-2).
- New i18n keys are translated in all locales; `pnpm run i18n:check` must
  pass (3a, 3d).

## 3e outline (plan written after 3d)

- Mappings stay in `iptvnator.db` (`epg_channel_mappings`, user data, shared
  by every device); the server resolves them before querying `epg.db`
  through `createEpgQueries({ resolveMappings })`.
- Routes: `GET|PUT|DELETE /v1/epg/mappings`, batch read, EPG channel search;
  the server backend gains the mapping methods, so `supportsEpgMapping`
  turns on by itself.
- Xtream and Stalker channels use XMLTV through their mapping keys
  (`xtream:{playlistId}:{id}`, `stalker:{playlistId}:{id}`).
- Deleting a playlist deletes its mappings.
