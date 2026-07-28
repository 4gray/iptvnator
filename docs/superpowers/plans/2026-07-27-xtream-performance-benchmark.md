# Xtream Performance Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible, fail-closed Electron benchmark for large Xtream initial import, refresh, deletion, cancellation, and concurrent UI interaction, with process-separated profiles and count-only phase attribution, without changing normal production behavior.

**Architecture:** A performance-only 100,000-item Xtream mock fixture is materialized and hashed before capture. An opt-in, fail-neutral instrumentation layer emits sanitized renderer, preload, Electron-main, and database-worker markers. A Playwright orchestrator runs five scenarios in fresh Electron processes with exactly one warm-up, five measured iterations, and one diagnostic iteration per scenario, writes only to the ignored `dist/performance/<timestamp>` tree, and rejects incomplete or contaminated measurements. The existing M3U capture implementation remains behaviorally unchanged and supplies stable process/worker primitives through small, tested extensions rather than a broad rewrite.

**Tech Stack:** Angular 21 signals and router, Electron 41 IPC/preload, Chrome DevTools Protocol, Node `inspector`/`perf_hooks`/Worker APIs, Axios, better-sqlite3, Express, Jest, Playwright, TypeScript, Nx.

---

## Non-Negotiable Measurement Contract

- Formal runs use only a clean tracked worktree and exact CDP endpoint
  `127.0.0.1:9222`. An alternate loopback CDP port is smoke-only and makes the
  run ineligible for before/after claims.
- The mock binds to `127.0.0.1`, uses only the committed
  `performance-100k` fixture, and rejects arbitrary provider URLs,
  credentials, payloads, and cardinalities. No response field used by the
  benchmark may reference a non-loopback URL.
- Every formal scenario has exactly:
  `warmup-01`, `run-01` through `run-05`, and `diagnostic`.
  Warm-up and diagnostic values never enter headline distributions.
- Each iteration gets a fresh Electron process and data directory. Stateful
  refresh/delete/UI iterations seed the portal before capture in that same
  process, verify database idleness, and atomically roll capture into the
  measured operation.
- Renderer, Electron main, and `database.worker` metrics remain separate.
  Main RSS is labelled process-wide and includes worker/native/SQLite memory;
  worker RSS is unavailable because a Node Worker is a thread. Native/SQLite
  memory is never inferred by subtracting JS heaps.
- Xtream does not instantiate `playlist-refresh.worker`. Report it as
  `N/A: not-instantiated-by-xtream-flow` only after observing zero matching
  workers and artifacts. Any instance invalidates the iteration.
- IPC boundary deltas are named structured-clone proxies because they include
  queueing/scheduling. SQLite transaction spans include commit. Index creation
  is `N/A: schema-indexes-pre-exist; operation-creates-none`.
- Cancellation acknowledgement is the terminal database `cancelled` event.
  Also retain click-to-preload return, main HTTP abort, DB cancel dispatch, and
  dev-only worker-receipt timestamps as separate diagnostics.
- Instrumentation is active only when `IPTVNATOR_PERF_CAPTURE=1` and/or
  `IPTVNATOR_PERF_WORKER_PROFILING=1`, is count/identifier-only, never logs
  credentials/URLs/titles/search text/payloads, and is fail-neutral.
- No production bottleneck fix belongs in this branch. This branch establishes
  the benchmark and instrumentation required to prove a later fix.

## Scenario Matrix

| Scenario ID                   | Seed state              | Measured trigger                                             | Authoritative terminal                                                                                         |
| ----------------------------- | ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `xtream-initial-import-large` | Empty DB, prepared mock | Final Add button                                             | All three import states completed, overlay absent, expected DB counts, two painted frames                      |
| `xtream-refresh-large`        | Complete 100k import    | Refresh-confirm button                                       | Delete/reimport/empty restore complete, exact counts, no duplicate or stale rows                               |
| `xtream-delete-large`         | Complete 100k import    | Delete-confirm button                                        | `DB_DELETE_PLAYLIST` completed, source row absent, playlist/category/content counts zero                       |
| `xtream-cancel-import`        | Empty DB, prepared mock | Final Add; cancel at first real live save progress threshold | Worker receipt plus authoritative DB `cancelled`, visible cancelled state painted, no later VOD/series request |
| `xtream-background-ui`        | Complete 100k import    | Refresh-confirm button                                       | Fixed navigation/search/action sequence paints while DB operation is active, then normal refresh terminal      |

The fixture contains 60 live categories/items groups, 20 VOD groups, and 20
series groups with 1,000 items each: exactly 60,000 live + 20,000 VOD +
20,000 series = 100,000 imported catalog rows and 100 categories.

## Task 0: Reconfirm Branch, Baseline, And Safety Preconditions

**Files:**

- Verify only: `AGENTS.md`
- Verify only: `package.json`
- Verify only: `pnpm-lock.yaml`
- Verify only: `apps/electron-backend-e2e/project.json`

- [ ] **Step 1: Confirm the linked worktree and branch**

Run:

```bash
git status --short --branch
git rev-parse --show-toplevel
git rev-parse --git-common-dir
git log -1 --oneline
```

Expected: branch `agent/perf-xtream-harness`, clean tracked tree, repository root
`/Users/4gray/.codex/worktrees/05cf/iptvnator`, and base commit
`24f0dee6f033613148aeab4b699e9db667041927`.

- [ ] **Step 2: Verify dependencies and Nx discovery**

Run:

```bash
pnpm install --frozen-lockfile
pnpm nx show projects
pnpm nx show projects --withTarget test
pnpm nx show projects --withTarget e2e
```

Expected: all commands exit 0 and the project list includes
`electron-backend`, `electron-backend-e2e`, `portal-xtream-data-access`,
`portal-xtream-feature`, and `xtream-mock-server`.

- [ ] **Step 3: Record the pre-change regression baseline**

Run:

```bash
pnpm nx run electron-backend-e2e:test-performance-harness --skip-nx-cache
pnpm nx test portal-xtream-data-access --skip-nx-cache
pnpm nx test portal-xtream-feature --skip-nx-cache
```

Expected baseline: performance harness 156/156, Xtream data-access 162 tests,
Xtream feature 144 tests. Stop and use `systematic-debugging` if the baseline
changes before editing code.

- [ ] **Step 4: Preserve the CDP blocker as an external precondition**

Run:

```bash
lsof -nP -iTCP:9222 -sTCP:LISTEN || true
```

Do not terminate an unrelated listener without explicit user authorization.
Harness implementation and unit tests may continue; no formal M3U or Xtream
run may start while `9222` is occupied.

## Task 1: Add A Deterministic, Local-Only 100k Xtream Fixture

**Files:**

- Create: `apps/xtream-mock-server/jest.config.ts`
- Create: `apps/xtream-mock-server/tsconfig.spec.json`
- Create: `apps/xtream-mock-server/src/app/generators/performance.generator.ts`
- Create: `apps/xtream-mock-server/src/app/generators/performance.generator.spec.ts`
- Modify: `apps/xtream-mock-server/project.json`
- Modify: `apps/xtream-mock-server/src/app/scenarios.ts`
- Modify: `apps/xtream-mock-server/src/app/data-store.ts`

- [ ] **Step 1: Add the mock-server Jest target**

Mirror the established `stalker-mock-server` Node/Jest configuration:

```ts
export default {
    displayName: 'xtream-mock-server',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    transform: {
        '^.+\\.[tj]s$': [
            'ts-jest',
            { tsconfig: '<rootDir>/tsconfig.spec.json' },
        ],
    },
    moduleFileExtensions: ['ts', 'js', 'html'],
    coverageDirectory: '../../coverage/apps/xtream-mock-server',
};
```

Add an `@nx/jest:jest` `test` target with `jestConfig` and `tsConfig` paths.

- [ ] **Step 2: Write failing fixture identity tests**

The tests must require:

- scenario key `performance:performance`, name `performance-100k`, seed
  `91001`;
- exactly 100 categories and 100,000 catalog items with the 60k/20k/20k split;
- unique stream/series IDs and valid category references;
- two full resets/rebuilds serialize to identical byte counts and SHA-256;
- every artwork/backdrop/stream URL field is empty or begins with the exact
  supplied `http://127.0.0.1:<port>` origin;
- the account-info call does not eagerly materialize 20,000 series-detail
  objects; a detail is built lazily on `getSeriesInfo`;
- VOD/series detail caches are keyed by portal plus item ID, not global ID.

Run and preserve the red result:

```bash
pnpm nx test xtream-mock-server --skip-nx-cache
```

Expected: failure because the fixture and test target do not yet exist.

- [ ] **Step 3: Implement the dedicated deterministic generator**

Add this scenario shape without changing `large`, `stress`, or other existing
fixtures:

```ts
'performance:performance': {
    name: 'performance-100k',
    description: 'Deterministic local-only 100k performance catalog',
    seed: 91001,
    categoryCount: { live: 60, vod: 20, series: 20 },
    itemsPerCategory: 1000,
    seasonsPerSeries: 1,
    episodesPerSeason: 1,
    accountStatus: 'Active',
    expiryDate: '2099-12-31',
    performanceFixture: 'catalog-100k',
    deferSeriesDetails: true,
},
```

`performance.generator.ts` must use no Faker date clock, `Math.random`, or
`Date.now`. Derive names, ratings, timestamps, extensions, IDs, and ordering
from stable integer indices plus fixed epoch `1_767_225_600` (2026-01-01 UTC).
Use empty artwork/backdrop fields for the list payloads. Do not create stream
URLs in catalog objects.

- [ ] **Step 4: Make performance series details lazy and cache-safe**

Branch only the performance fixture in `data-store.ts`; leave every other
scenario's output unchanged. Use `${username}:${password}:${id}` cache keys for
VOD/series details, and skip prepopulation when `deferSeriesDetails` is true.

- [ ] **Step 5: Run the green mock tests and lint**

```bash
pnpm nx test xtream-mock-server --skip-nx-cache
pnpm nx lint xtream-mock-server --skip-nx-cache
```

Expected: all fixture identity, local-only, lazy-detail, existing mock tests,
and lint checks pass.

## Task 2: Add A Locked-Down Mock Performance Control Plane

**Files:**

- Create: `apps/xtream-mock-server/src/app/performance-control.ts`
- Create: `apps/xtream-mock-server/src/app/performance-control.spec.ts`
- Create: `apps/xtream-mock-server/src/app/server.ts`
- Create: `apps/xtream-mock-server/src/app/server.spec.ts`
- Modify: `apps/xtream-mock-server/src/main.ts`
- Modify: `apps/xtream-mock-server/src/app/data-store.ts`
- Modify: `apps/xtream-mock-server/README.md`
- Modify: `docs/architecture/xtream-mock-server.md`

- [ ] **Step 1: Write failing control-plane tests**

Use a real loopback HTTP server on port `0`; do not add `supertest`.
Cover:

- controls are absent unless `IPTVNATOR_XTREAM_MOCK_CONTROL=1`;
- performance mode rejects non-loopback bind hosts;
- every `/__control/*` request requires the exact per-process token header;
- JSON bodies reject unknown fields, arbitrary scenarios/cardinalities/URLs,
  duplicate rules, past occurrences, and delays outside integer `0..5000`;
- `prepare` materializes `performance-100k` and returns only
  `{epoch, scenario, seed, counts, bytes, catalogSha256}`;
- `reset observations` clears ledger/rules but preserves the prepared fixture;
  `reset all` also clears fixture caches and increments epoch;
- request identity is
  `(epoch,scenario,transport,canonicalAction,categoryId|'all',occurrence)`,
  so parallel category arrival order does not affect matching;
- barrier release and request-abort both settle and remove held responses;
- ledger entries contain only safe action/scenario/count/status/timestamps and
  never password, username, raw URL, query, or response payload;
- performance stream and `/playlist.m3u` endpoints return `410`, while no
  non-loopback request is made.

Run and preserve the red result:

```bash
pnpm nx test xtream-mock-server --skip-nx-cache
```

- [ ] **Step 2: Extract an Express app factory**

Move route wiring, without behavior changes, into:

```ts
export interface XtreamMockServerOptions {
    readonly control?: {
        readonly enabled: boolean;
        readonly token: string;
    };
    readonly host: string;
    readonly port: number;
}

export function createXtreamMockApp(
    options: XtreamMockServerOptions
): express.Express;
```

Keep `main.ts` responsible only for validated environment parsing, HTTP
startup, logging, and signal/error shutdown. Normal `serve` behavior remains
port 3211 and existing routes remain compatible.

- [ ] **Step 3: Implement bounded observations, barriers, and delays**

Use an exact allowlist for canonical Xtream actions. Cap ledger and rule counts.
A barrier matches before dispatch/serialization, is one-shot, and records
`arrived -> blocked -> responded|aborted`. A delay is abort-aware and exists
only for deterministic smoke/control tests; formal scenario manifests require
zero delay rules.

- [ ] **Step 4: Add fixture preparation and manifest hashing**

Hash stable UTF-8 JSON for the three category arrays and three catalog arrays
in a documented fixed order. The hash input contains no credentials or server
origin. Materialization happens before capture, so mock generation is excluded
from application acquisition time.

- [ ] **Step 5: Run focused tests and docs checks**

```bash
pnpm nx test xtream-mock-server --skip-nx-cache
pnpm nx lint xtream-mock-server --skip-nx-cache
pnpm exec prettier --check apps/xtream-mock-server/README.md docs/architecture/xtream-mock-server.md
```

Expected: green. Docs explain the opt-in control flag, loopback/token
requirements, fixed scenario, prepare/reset/ledger semantics, and that delays
are forbidden in formal timing.

## Task 3: Add Sanitized Xtream IPC And Main-Process Phase Markers

**Files:**

- Create: `libs/shared/interfaces/src/lib/xtream-performance-marker.interface.ts`
- Create: `apps/electron-backend/src/app/api/xtream-preload-performance-capture.ts`
- Create: `apps/electron-backend/src/app/api/xtream-preload-performance-capture.spec.ts`
- Create: `apps/electron-backend/src/app/events/xtream-performance.ts`
- Create: `apps/electron-backend/src/app/events/xtream-performance.spec.ts`
- Modify: `libs/shared/interfaces/src/index.ts`
- Modify: `apps/electron-backend/src/app/api/main.preload.ts`
- Modify: `apps/electron-backend/src/app/api/main.preload.performance.contract.spec.ts`
- Modify: `apps/electron-backend/src/app/api/main.preload.performance.gates.spec.ts`
- Modify: `apps/electron-backend/src/app/events/xtream.events.ts`
- Modify: `apps/electron-backend/src/app/events/xtream.events.spec.ts`

- [ ] **Step 1: Write failing schema, gating, redaction, and lifecycle tests**

Target only these bridge methods:

```text
xtreamRequest
xtreamCancelSession
dbGetCategories
dbSaveCategories
dbGetContent
dbSaveContent
dbDeleteXtreamContent
dbDeletePlaylist
dbRestoreXtreamUserData
dbSearchContent
dbGlobalSearch
dbCancelOperation
```

Markers may include only schema version, IPC call ID, method, boundary/outcome,
epoch, playlist/operation/session identifiers, Xtream action, content/category
type, and item count. Tests must reject or prove absence of URL, username,
password, params, titles, search term, arrays, and result bodies. Prove exact
pass-through result identity, error propagation, no marker work when disabled,
and fail-neutral behavior when the marker sink throws.

Run the red tests:

```bash
pnpm nx test electron-backend --skip-nx-cache --testPathPatterns='xtream-preload-performance-capture|main.preload.performance|xtream.events|xtream-performance'
```

- [ ] **Step 2: Implement a separate Xtream preload marker protocol**

Do not overload `preload-performance-correlation.ts`, whose state machine is
M3U refresh-specific. Add a separate channel and schema. Extract safe identity
from arguments without cloning/traversing payload arrays. Emit start and
success/error around the existing proxied call only when
`IPTVNATOR_PERF_CAPTURE=1`.

- [ ] **Step 3: Instrument main HTTP phases without changing normal Axios behavior**

Emit count-only main phases:

```text
xtream.network.total
xtream.json.transform
xtream.response.ready
xtream.cancel-session
```

Under capture only, wrap Axios's existing default `transformResponse` chain and
invoke the same functions with the same context. Do not switch response type or
introduce a separate manual `JSON.parse`. `network.total` contains the nested
transform; the report derives acquisition as total minus JSON transform.
Every success, error, and abort path must close its phase exactly once.

- [ ] **Step 4: Keep debug-copy overhead explicit**

Electron imports always create a portal-debug request ID, but performance
builds use the production environment and disable portal-debug sanitize/send
before the payload is copied. Record that work as
`N/A: production-debug-send-disabled`; do not infer that the request ID is
absent. If a future diagnostic build enables the send path, instrument
redaction/send separately and never fold that development-only copy into
production acquisition.

`ElectronService.forwardXtreamRequest()` also posts the full returned payload
through `window.postMessage()` after the preload call completes. Keep that
second renderer clone unchanged until a baseline proves it is the selected
bottleneck; attribute it through the preload-end to store-marker gap and the
renderer CPU profile.

- [ ] **Step 5: Run focused backend tests and lint**

```bash
pnpm nx test electron-backend --skip-nx-cache --testPathPatterns='xtream-preload-performance-capture|main.preload.performance|xtream.events|xtream-performance'
pnpm nx lint electron-backend --skip-nx-cache
```

Expected: green with no changes to normal IPC payloads or Axios results.

## Task 4: Add Database-Worker Phase And Cancellation-Receipt Markers

**Files:**

- Modify: `libs/shared/interfaces/src/lib/performance-phase.interface.ts`
- Modify: `apps/electron-backend/src/app/workers/worker-performance-capture.model.ts`
- Modify: `apps/electron-backend/src/app/workers/worker-performance-phase.ts`
- Modify: `apps/electron-backend/src/app/workers/database.worker.ts`
- Modify: `apps/electron-backend/src/app/database/operations/category.operations.ts`
- Modify: `apps/electron-backend/src/app/database/operations/content.operations.ts`
- Modify: `apps/electron-backend/src/app/database/operations/xtream.operations.ts`
- Modify: `apps/electron-backend/src/app/database/operations/playlist.operations.ts`
- Modify: `apps/electron-backend/src/app/events/database/worker-ipc-contract.spec.ts`
- Modify: `apps/electron-backend/src/app/services/database-worker-client.spec.ts`
- Modify: `apps/electron-backend/src/app/workers/worker-performance-phase.spec.ts`
- Modify: `apps/electron-backend/src/app/workers/worker-performance-capture.concurrency.spec.ts`
- Modify: `apps/electron-backend/src/app/workers/worker-performance-cancellation.spec.ts`
- Modify: `apps/electron-backend/src/app/workers/worker-performance-integration.spec.ts`
- Modify: `apps/electron-backend/src/app/database/operations/category.operations.spec.ts`
- Modify: `apps/electron-backend/src/app/database/operations/content.operations.spec.ts`
- Create: `apps/electron-backend/src/app/database/operations/xtream.operations.spec.ts`
- Modify: `apps/electron-backend/src/app/database/operations/playlist.operations.spec.ts`

- [ ] **Step 1: Write failing phase-placement and cancellation tests**

Require one ordered pair per aggregate phase, count-only metadata, closure on
success/error/cancel, and no calls when worker profiling is off. Required phase
names:

```text
sqlite.categories.read
normalize.categories
sqlite.categories.write-transactions
sqlite.content.read
sqlite.content.category-map-read
normalize.content
sqlite.content.write-transactions
sqlite.xtream-cache-clear.write-transactions
sqlite.xtream-delete.collect-user-data
sqlite.xtream-delete.write-transactions
sqlite.playlist-delete.collect-ids
sqlite.playlist-delete.write-transactions
sqlite.search.query
normalize.search-rank
```

Wrap the complete batch loop in one aggregate `write-transactions` span;
metadata reports total items. This avoids ambiguous repeated phase pairs.
Tests must state that the span includes all transaction commits.

Cancellation cleanup runs `DB_CLEAR_XTREAM_IMPORT_CACHE` after an aborted
import. Measure its complete delete loops with the dedicated cache-clear phase
instead of hiding that work in the request envelope or mislabelling it as a
content-save phase. Synthetic benchmark fixtures keep favorites/recent data
empty, so restore-user-data remains explicitly `N/A: no-user-data`.

Require a dev-only `performance-cancel-received` worker message containing only
operation/request IDs and epoch. It must not change
`DatabaseWorkerClient.cancel()` into a wait or alter normal cancellation order.

- [ ] **Step 2: Extend the worker phase union generically**

Change the capture helper/model to accept the union of existing app-playlist
phases and new Xtream database phases. Preserve existing M3U phase strings and
tests exactly.

- [ ] **Step 3: Add operation adapters without changing SQL or concurrency**

Pass the optional capture adapter from `database.worker.ts` into the existing
operations. Measure around existing normalization, query, and transaction-loop
blocks. Do not reorder statements, change batch size, add indexes, serialize
parallel requests, or alter transaction boundaries.

- [ ] **Step 4: Preserve overlap invalidation**

`registerDatabaseWorkerPerformanceCapture()` must continue marking overlapping
request CPU/ELU/event-loop-delay data invalid. Tests must prove no hidden
serialization is introduced. Whole-worker profiles remain valid diagnostics;
request-scoped overlapping metrics remain explicitly invalid.

- [ ] **Step 5: Run focused and full backend tests**

```bash
pnpm nx test electron-backend --skip-nx-cache --testPathPatterns='worker-performance|worker-ipc-contract|database-worker-client|category.operations|content.operations|xtream.operations|playlist.operations'
pnpm nx test electron-backend --skip-nx-cache
pnpm nx lint electron-backend --skip-nx-cache
```

Expected: green and no SQL/business-result changes.

## Task 5: Add Renderer Store Markers Without Equating Them To Paint

**Files:**

- Modify: `libs/shared/logging/src/lib/renderer-performance-phase.ts`
- Modify: `libs/shared/logging/src/lib/renderer-performance-phase.spec.ts`
- Modify: `libs/portal/xtream/data-access/src/lib/stores/features/with-content.feature.ts`
- Modify: `libs/portal/xtream/data-access/src/lib/stores/features/with-content.feature.spec.ts`
- Modify: `libs/portal/xtream/data-access/src/lib/stores/features/with-search.feature.ts`
- Modify: `libs/portal/xtream/data-access/src/lib/stores/features/with-search.feature.spec.ts`
- Modify: `libs/playlist/shared/ui/src/lib/playlist-refresh-action.service.ts`
- Modify: `libs/playlist/shared/ui/src/lib/playlist-refresh-action.service.spec.ts`
- Modify: `libs/playlist/shared/ui/src/lib/recent-playlists/recent-playlists.component.ts`
- Modify: `libs/playlist/shared/ui/src/lib/recent-playlists/recent-playlists.component.spec.ts`

- [ ] **Step 1: Write failing opt-in/fail-neutral store-marker tests**

Add count-only phase names:

```text
store.xtream-publish-categories
store.xtream-publish-live
store.xtream-publish-vod
store.xtream-publish-series
store.xtream-import-terminal
store.xtream-search-results
store.xtream-refresh-meta
store.xtream-delete-row
```

Tests must prove the marker wraps only the synchronous `patchState` or NgRx
dispatch, emits one start/end pair, preserves thrown errors/results, performs
no metadata work without a hook, and ignores hook failures.

- [ ] **Step 2: Wrap the exact existing publication sites**

Use `measureRendererPerformancePhase` around the category publication at
`with-content.feature.ts:965`, live/VOD/series publications at
`:1047/:1083/:1119`, import-terminal publication, search result publication,
refresh metadata dispatch, and delete-row dispatch. Do not change fetch order,
signals, routes, or visible behavior.

- [ ] **Step 3: Keep Angular paint external to store timing**

Document in code comments and benchmark contracts that a synchronous store
span is not render time. The Playwright renderer probe will observe a
scenario-specific DOM sentinel and two `requestAnimationFrame` callbacks after
the marker end.

- [ ] **Step 4: Run affected project tests**

```bash
pnpm nx test shared-logging --skip-nx-cache
pnpm nx test portal-xtream-data-access --skip-nx-cache
pnpm nx test playlist-shared-ui --skip-nx-cache
```

If the exact project names differ, discover them with:

```bash
pnpm nx show projects --withTarget test
```

Then run the owning targets; do not guess a project name.

## Task 6: Extend The Existing Process Capture For Xtream Attribution

**Files:**

- Create: `apps/electron-backend-e2e/src/performance/xtream-ipc-marker-events.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-ipc-marker-events.spec.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-worker-phase-events.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-worker-phase-events.spec.ts`
- Modify: `apps/electron-backend-e2e/src/performance/m3u-refresh-main-capture.ts`
- Modify: `apps/electron-backend-e2e/src/performance/worker-performance-phase-events.ts`
- Modify: `apps/electron-backend-e2e/src/performance/worker-request-performance.ts`
- Modify: `apps/electron-backend-e2e/src/performance/worker-request-performance-envelope.spec.ts`
- Modify: `apps/electron-backend-e2e/src/performance/performance-phase-events.ts`
- Modify: `apps/electron-backend-e2e/src/performance/performance-phase-events.spec.ts`

- [ ] **Step 1: Write failing parsing/correlation tests**

Require:

- exact schema validation and count-only fields;
- ordered start/end pairs and no unclosed/duplicate boundaries;
- FIFO correlation by safe method/playlist/type/action/operation key;
- quarantine rather than guessing when the same key overlaps;
- handler/preload/worker timestamps remain monotonic;
- acquisition = `network.total - json.transform`, never negative;
- main-to-worker and worker-to-main deltas are named IPC proxies;
- worker cancel receipt and terminal cancel are separate;
- existing M3U parsers produce byte-equivalent normalized output.

- [ ] **Step 2: Parameterize main capture phase subscriptions**

Extend `installMainCapture()` to subscribe to both existing M3U and new Xtream
diagnostics channels. Keep the old state key and exported API for compatibility;
do not rename or copy the 1,500-line injected protocol in this task. Add only
the minimum channel allowlists and timeline record shapes.

- [ ] **Step 3: Capture Xtream preload and main-handler boundaries**

Listen for sanitized preload markers in main and record handler receive/ready
phases. Match DB worker requests using safe operation ID where supplied and
FIFO/quarantine otherwise. Never attach raw IPC payloads to the timeline.

- [ ] **Step 4: Record true worker cancellation receipt**

Recognize `performance-cancel-received` without counting it as a normal
response. Store the epoch/IDs in the current capture generation. Late or
cross-generation markers invalidate cancellation attribution.

- [ ] **Step 5: Run the complete performance-harness unit suite**

```bash
pnpm nx run electron-backend-e2e:test-performance-harness --skip-nx-cache
```

Expected: all old M3U tests and new Xtream contracts pass.

## Task 7: Build Xtream Scenario, Summary, And Validity Contracts

**Files:**

- Create: `apps/electron-backend-e2e/src/performance/xtream-benchmark-contract.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-benchmark-contract.spec.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-control-client.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-control-client.spec.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-summary-contract.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-phase-attribution.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-phase-attribution.spec.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-benchmark-report.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-benchmark-report.spec.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-diagnostic-artifacts.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-diagnostic-artifacts.spec.ts`

- [ ] **Step 1: Write failing schedule and safety tests**

Require the five exact scenario IDs and formal iteration schedule:

```ts
[
    { runId: 'warmup-01', kind: 'warmup' },
    { runId: 'run-01', kind: 'measured' },
    { runId: 'run-02', kind: 'measured' },
    { runId: 'run-03', kind: 'measured' },
    { runId: 'run-04', kind: 'measured' },
    { runId: 'run-05', kind: 'measured' },
    { runId: 'diagnostic', kind: 'diagnostic' },
];
```

Smoke may reduce measured runs to one but must set `eligibleForComparison=false`.
Reject non-loopback origin, unexpected fixture name/hash/counts, any credential
field in serialized artifacts, nonzero formal delay/barrier residue, and any
unexpected mock action.

- [ ] **Step 2: Define the request and phase contract**

After observations reset, initial/reimport expects exactly seven application
actions:

```text
get_account_info
get_live_categories
get_vod_categories
get_series_categories
get_live_streams
get_vod_streams
get_series
```

Category order is irrelevant; content order is live -> VOD -> series. Cancel
requires account + categories + live only, with no VOD/series request after the
authoritative cancellation point.

- [ ] **Step 3: Define process-separated result types**

Each result stores:

- total and named phase durations;
- renderer peak/post-GC heap, long-task count/max, frame-gap p95/max,
  heartbeat p95/max, store-to-paint, navigation/search/action latency;
- main CPU, peak/post-GC heap, process-wide peak/post-GC RSS, ELD
  p95/p99/max, ELU/unavailable reason, BrowserWindow
  unresponsive/responsive events;
- database-worker CPU, peak/post-GC heap, external memory, ELD p95/p99/max,
  ELU, request validity, profile paths, and RSS `N/A` reason;
- playlist-refresh worker `N/A` reason;
- cancel dispatch/receipt/terminal/paint latencies;
- explicit index, exact-commit, native-memory, and debug-copy N/A/proxy labels.

- [ ] **Step 4: Fail closed on comparison validity**

Formal summaries require five valid measured values for every required metric;
never silently filter nulls. Require one renderer identity, one current database
worker, zero playlist-refresh workers, no late DB request after capture cutoff,
complete action/DB phase contracts, exact catalog invariants, no console errors,
and valid regular contained diagnostic artifacts.

- [ ] **Step 5: Run the harness unit suite**

```bash
pnpm nx run electron-backend-e2e:test-performance-harness --skip-nx-cache
```

## Task 8: Build The Renderer Probe And Initial/Cancel Drivers

**Files:**

- Create: `apps/electron-backend-e2e/src/performance/xtream-renderer-probe.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-renderer-probe.spec.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-renderer-capture.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-scenario-driver.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-scenario-driver.spec.ts`

- [ ] **Step 1: Write failing probe lifecycle tests**

Mirror the proven M3U capture lifecycle and require:

- Long Tasks clipped to operation boundaries;
- continuous rAF gaps and a 50 ms deadline-based UI heartbeat;
- 20 ms renderer heap sampling plus explicit GC/post-GC heap;
- route, store marker, DOM sentinel, and two-rAF paint timestamps;
- idempotent stop/dispose after partial startup failure;
- CPU/trace/heap snapshot only in diagnostic;
- no profile path in measured/warm-up runs.

- [ ] **Step 2: Implement initial-import trigger and terminal**

Prepare the Xtream dialog with only the fixed synthetic name, loopback origin,
and committed synthetic credential pair. Start clocks immediately before the
final Add button activation. Terminal requires overlay absent, all three
import-status values completed, exact 100k content/100 category DB counts, and
two rendered frames after the final store marker.

- [ ] **Step 3: Implement cancellation at real DB progress**

Install the DB-event listener before triggering import. On the first live
`save-content` progress event at or above
`max(100, floor(total * 0.10))`, synchronously record the click epoch and
activate the visible cancel button. Use no timeout/delay as the trigger.
Require worker receipt, terminal DB `cancelled`, painted cancelled state, no
later success, no automatic retry, and no VOD/series mock requests.

- [ ] **Step 4: Add interaction-free smoke driver tests**

Use deterministic mocked Page/CDP/main-capture adapters to prove trigger order,
terminal checks, cleanup, and that credential strings never enter result,
manifest, console label, or artifact filenames.

- [ ] **Step 5: Run the complete harness tests**

```bash
pnpm nx run electron-backend-e2e:test-performance-harness --skip-nx-cache
```

## Task 9: Build Refresh, Delete, And Background-UI Drivers

**Files:**

- Modify: `apps/electron-backend-e2e/src/performance/xtream-scenario-driver.ts`
- Modify: `apps/electron-backend-e2e/src/performance/xtream-scenario-driver.spec.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-ui-action-probe.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-ui-action-probe.spec.ts`

- [ ] **Step 1: Write failing seed/rollover tests**

Require a complete seed import outside measured capture, an idle DB worker,
zero pending requests, and atomic main-capture rollover before trigger. Store
seed metrics separately as `seed-main-capture.json`; never include them in
measured summaries.

- [ ] **Step 2: Implement refresh**

Start at the refresh confirmation button. Include
`DB_DELETE_XTREAM_CONTENT`, playback/meta parallel work, navigation, the seven
mock actions, three category writes, three content writes, empty user-data
restore, final store publication, and paint. Assert exact counts and no
duplicate/stale rows.

- [ ] **Step 3: Implement full source deletion**

Start at the delete confirmation button. Require started/progress/completed DB
events, source row removal, zero playlist/category/content rows, and no stale
active-store route. Capture all delete transaction phases and final dispatch
to paint.

- [ ] **Step 4: Implement the fixed background UI sequence**

Start a natural delay-zero refresh. Only after proving the DB delete operation
active, perform:

1. Sources filter input and result paint;
2. navigation to Dashboard and two-rAF route paint;
3. navigation back to Sources;
4. source search input and result paint;
5. one stable, non-destructive UI action.

Record input/click to paint latency for every action and require the background
operation to be active both before and after each action. If it finishes too
early, invalidate the iteration and increase the fixed fixture cardinality in
a separately reviewed change; never add sleeps or mock delay to formal timing.

- [ ] **Step 5: Run harness and existing responsiveness tests**

```bash
pnpm nx run electron-backend-e2e:test-performance-harness --skip-nx-cache
pnpm nx run electron-backend-e2e:e2e-ci--src/xtream-responsiveness.e2e.ts --skip-nx-cache
```

The existing E2E may keep its deliberate worker batch delay because it is a
functional regression test. The benchmark must always set
`IPTVNATOR_DB_WORKER_BATCH_DELAY_MS=0`.

## Task 10: Add The Orchestrator, Nx Target, And Artifact Validation

**Files:**

- Create: `apps/electron-backend-e2e/src/performance/xtream-benchmark-orchestrator.ts`
- Create: `apps/electron-backend-e2e/src/performance/xtream-benchmark-lifecycle.spec.ts`
- Create: `apps/electron-backend-e2e/src/xtream.performance.ts`
- Create: `apps/electron-backend-e2e/playwright.xtream-performance.config.ts`
- Modify: `apps/electron-backend-e2e/project.json`
- Modify: `apps/electron-backend-e2e/src/performance/initial-import-diagnostic-artifacts.ts`

- [ ] **Step 1: Write failing lifecycle and artifact tests**

Require:

- preflight before directory creation;
- mock prepare before capture and observations reset immediately before trigger;
- fresh app/data dir per iteration and guaranteed cleanup;
- raw iteration JSON written before summary validity throws;
- diagnostic regular/non-symlink/nonempty JSON trace, CPU profile, and heap
  snapshot for renderer/main/database worker;
- no playlist-refresh worker artifacts;
- source-map/build hash manifest sufficient to map profiles after a rebuild;
- output contained by a fresh absolute
  `dist/performance/<timestamp>/<variant>` path;
- no `.cpuprofile`, `.heapsnapshot`, trace, or generated summary staged by Git.

- [ ] **Step 2: Implement the serial orchestrator**

For each scenario, run all seven definitions serially. Launch Electron with:

```text
--js-flags=--expose-gc
--remote-debugging-address=127.0.0.1
--remote-debugging-port=9222
--user-data-dir=<fresh temp path>
```

Set:

```text
IPTVNATOR_DB_WORKER_BATCH_DELAY_MS=0
IPTVNATOR_PERF_CAPTURE=1
IPTVNATOR_PERF_WORKER_PROFILING=1
IPTVNATOR_TRACE_RENDERER_CONSOLE=0
```

Start renderer/main capture before trigger, wait for authoritative terminal and
DB settlement, stop capture, write raw capture/result JSON, validate artifacts,
then build the scenario summary.

- [ ] **Step 3: Add the isolated mock web server**

`playwright.xtream-performance.config.ts` starts exactly one control-enabled
mock on a dedicated loopback port with a per-process token, `reuseExistingServer:
false`, one Playwright worker, no retries, and a 30-minute test timeout. The
token is passed to the control client but never serialized.

- [ ] **Step 4: Add the Nx target**

Add `benchmark-xtream` with:

```json
{
    "dependsOn": ["electron-backend:build-performance"],
    "executor": "nx:run-commands",
    "cache": false,
    "parallelism": false,
    "options": {
        "cwd": "apps/electron-backend-e2e",
        "command": "pnpm exec playwright test --config=playwright.xtream-performance.config.ts src/xtream.performance.ts"
    }
}
```

- [ ] **Step 5: Run all harness tests**

```bash
pnpm nx run electron-backend-e2e:test-performance-harness --skip-nx-cache
```

Expected: old M3U and new Xtream lifecycle/contract tests pass.

## Task 11: Run A Non-Claim Smoke And Close The Harness PR

**Files:**

- Modify: `docs/architecture/xtream-mock-server.md`
- Modify: `docs/architecture/sqlite-db-worker.md`
- Modify if command/environment text changed: `AGENTS.md`
- Modify if command/environment text changed: `CLAUDE.md`
- Verify only: `.gitignore`
- Verify only: `.changes/README.md`

- [ ] **Step 1: Run the full validation ladder**

```bash
pnpm nx test xtream-mock-server --skip-nx-cache
pnpm nx test electron-backend --skip-nx-cache
pnpm nx test portal-xtream-data-access --skip-nx-cache
pnpm nx test portal-xtream-feature --skip-nx-cache
pnpm nx run electron-backend-e2e:test-performance-harness --skip-nx-cache
pnpm nx run electron-backend-e2e:e2e-ci--src/xtream-responsiveness.e2e.ts --skip-nx-cache
pnpm nx run electron-backend-e2e:e2e-ci--src/sources.e2e.ts --skip-nx-cache
pnpm nx run electron-backend-e2e:e2e-ci--src/search.e2e.ts --skip-nx-cache
pnpm nx affected -t lint --base=24f0dee6f033613148aeab4b699e9db667041927 --head=HEAD --skip-nx-cache
pnpm run release:notes:validate
```

- [ ] **Step 2: Run a smoke benchmark only when a CDP port is available**

If `9222` remains occupied, use an unused alternate loopback port only for
smoke:

```bash
perf_output="$PWD/dist/performance/$(date -u +%Y%m%dT%H%M%SZ)-xtream-smoke"
IPTVNATOR_PERF_OUTPUT_DIR="$perf_output" \
IPTVNATOR_PERF_VARIANT=smoke \
IPTVNATOR_PERF_SMOKE=1 \
IPTVNATOR_PERF_CDP_PORT=9322 \
NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
pnpm nx run electron-backend-e2e:benchmark-xtream --skip-nx-cache
```

Validate that every smoke summary says `eligibleForComparison=false`. Never
quote smoke values as baseline or improvement evidence.

- [ ] **Step 3: Update canonical docs**

Document the future formal command, fixture identity, exact run schedule,
process/RSS/heap distinctions, Xtream worker topology, control-plane safety,
artifact layout, validity gates, and before/after rules. Keep `AGENTS.md` and
`CLAUDE.md` mirrored if their tracing/benchmark environment section changes.

- [ ] **Step 4: Test-impact and release-note decision**

This PR changes only opt-in development/test instrumentation and synthetic mock
tooling; normal user-visible behavior is unchanged. Do not add a `.changes`
note. Apply `no-release-note` when opening the PR because runtime paths under
`apps/**` and `libs/**` are touched.

- [ ] **Step 5: Verify tracked scope and ignored raw artifacts**

```bash
git status --short
git check-ignore -v dist/performance
git diff --check
git diff --stat 24f0dee6f033613148aeab4b699e9db667041927
git ls-files 'dist/performance/**'
```

Expected: tracked source/tests/docs only; `git ls-files` prints nothing.

- [ ] **Step 6: Commit, push, open the PR, and run the review loop**

Use focused conventional commits, push `agent/perf-xtream-harness`, open a
ready PR with validation and smoke caveats, apply `no-release-note`, trigger
`@codex review`, and inspect all CI/review threads. Do not merge until every
actionable item is fixed, re-tested, independently reviewed, and current-head
CI is green.

## Task 12: Run The Formal Xtream Baseline After Harness Merge

**Files:**

- Generated only, ignored: `dist/performance/<timestamp>-xtream/baseline/**`

- [ ] **Step 1: Start from the exact clean merged commit**

```bash
git switch master
git pull --ff-only
git status --short
lsof -nP -iTCP:9222 -sTCP:LISTEN
```

Expected: clean tree and port 9222 free. If an unrelated listener remains, stop
and request authorization rather than killing it.

- [ ] **Step 2: Run the formal benchmark**

```bash
perf_output="$PWD/dist/performance/$(date -u +%Y%m%dT%H%M%SZ)-xtream"
IPTVNATOR_PERF_OUTPUT_DIR="$perf_output" \
IPTVNATOR_PERF_VARIANT=baseline \
NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
pnpm nx run electron-backend-e2e:benchmark-xtream --skip-nx-cache
```

Do not set smoke or alternate-port flags.

- [ ] **Step 3: Validate and analyze raw profiles**

Verify every scenario has one warm-up, five measured, one diagnostic, valid
process identities, exact fixture/action hashes, zero external requests, and
all required artifacts. Run the ignored CPU/heap analyzers sequentially,
preserve source-mapped hotspot and retaining-path JSON beside the raw profiles,
and hash the analyzer/source-map inputs.

- [ ] **Step 4: Name and prove three bottlenecks**

For each candidate, cite:

- scenario and measured phase distribution;
- renderer/main/database-worker CPU stack;
- retaining path and retained/self sizes with process scope;
- corroborating event-loop/long-task/frame/heartbeat evidence;
- explicit confounders and attribution gaps.

Choose only the strongest candidate. Add a regression test that fails at the
merged baseline, implement the smallest production change, rerun all affected
tests, and repeat the identical formal benchmark into a fresh `after`
directory.

- [ ] **Step 5: Claim improvement only after matched five-run evidence**

Report before/after medians and p95 where appropriate, percentage change,
memory/process separation, variance, unchanged/counter-regressed metrics, and
tradeoffs. If the matched results do not improve, revert or describe the change
as unconfirmed; never call it an optimization.
