# Server-side EPG for the Self-hosted PWA — Design

Date: 2026-10-15, against `master` at `ea1ac41fc`.
Status: design approved in brainstorming with the maintainer; this document
awaits review before the implementation plan is written.

Phase 3 of the [server storage design](2026-10-08-server-storage-design.md)
("Server-side EPG for the PWA", closes the PWA EPG gap). Upstream demand:
#444 (EPG for the Docker installation), #1683 (no Xtream EPG in Docker).

## 1. Summary

The browser PWA shows no EPG at all. Every EPG capability is derived from
Electron preload methods, so the PWA hides M3U guides, and it also hides the
Xtream and Stalker provider EPG although the web-backend proxy already
carries those calls.

This design does two things:

1. **Provider EPG in every PWA.** Xtream (`get_short_epg`,
   `get_simple_data_table`) and Stalker (`get_epg_info`, `get_short_epg`)
   EPG are gated by a new provider capability instead of the XMLTV one. They
   work through the existing proxy in any Docker deployment, with or without
   server storage.
2. **XMLTV on the server.** With server storage, `web-backend` imports
   XMLTV sources itself, on a daily schedule and on demand, into a separate
   SQLite file on the data volume, with the desktop import pipeline and query
   logic extracted into a shared Node library. The PWA reads programmes over
   a `/v1/epg` API that mirrors the renderer's EPG bridge, and turns on the
   same M3U EPG surfaces as the desktop app.

## 2. Goals

1. Xtream and Stalker live channels show their provider EPG in the PWA.
2. In server mode, M3U playlists get the channel-list programme line, the
   player EPG panel, the programme guide with programme search, and
   Settings → EPG, with sources shared by every device of the instance.
3. The server refreshes XMLTV once a day at a configurable time, imports a
   new source right after it is added, and refreshes on demand.
4. Channel matching gives the same answers as the desktop app, because both
   run the same query code.
5. No behavior change for Electron, and for PWA deployments without server
   storage beyond goal 1.
6. The HTTP contract mirrors the renderer's EPG bridge, so phase 4
   (Electron connects to a server) can reuse it.

## 3. Non-goals for this phase

- Manual EPG channel mapping in server mode, and XMLTV for Xtream and Stalker
  channels through mappings. They follow as PR 3e (section 13) with their
  own short design section in its plan.
- Importing Xtream `xmltv.php` automatically as an XMLTV source.
- Local XMLTV files on the server (the desktop file picker has no server
  equivalent). Sources are `http(s)` URLs.
- An offline EPG copy in the browser.
- Live push (SSE). The PWA polls while an import runs.
- Per-user source lists or roles. One shared access token, as in phase 2.

## 4. Findings that shaped the design

| Finding | Consequence |
| --- | --- |
| `initDatabase()` already creates `epg_channels`, `epg_channel_sources`, `epg_programs` (+ FTS5 and triggers) and `epg_channel_mappings` in the server database; they stay empty. | The schema is reusable as is. EPG still goes to its own file (rule 5.5). |
| The desktop import (`apps/electron-backend/src/app/workers/`: `epg-source-stream`, `epg-stream-decoder`, `epg-optional-gunzip`, `epg-streaming-parser` on `saxes`, `epg-database`, `epg-parser.worker`) is plain Node; only the worker runtime, progress push and IPC are Electron-bound. | Extract the pipeline and the query services into a Node library; Nx lets `type:app` depend only on libraries. |
| `EpgDatabase` opens its own connection on `getIptvnatorDatabasePath()`; the query services use the `getDatabase()` singleton. | The library takes a connection (or path) as a parameter. Electron keeps passing its main database. |
| `epg-query.service.ts` has 976 lines and is in the max-lines baseline. | It is split below 300 lines while moving; a moved file cannot keep a baseline entry. |
| Open PRs change the same pipeline: #1941 (staged, atomic import), #1946 (UTF-8 across chunks), #1947 (clear/refresh fences), #1800 (forced refresh). | The extraction starts after they merge and carries their behavior. |
| After #1941 an import publishes a source in one transaction. On a NAS, hundreds of thousands of rows with FTS triggers take tens of seconds; the server's main connection waits 5 s (`busy_timeout`) and fails. | Server EPG lives in `epg.db`, not in `iptvnator.db`; playlist and user-data writes never wait for an import. |
| Desktop programme search uses `LIKE`, not the FTS table. | `epg.db` has no FTS table and no triggers; imports are cheaper. |
| `/parse-xml` buffers the whole feed, uses `gunzipSync` and `epg-parser`; no client calls it. | Not reused. It stays as it is. |
| `ValidatedHttpClient` buffers whole bodies and has no size cap. | It gains a streaming mode with a byte cap; XMLTV fetches keep its SSRF policy, DNS pinning and redirect rules. |
| All `supportsEpg*` flags in `RuntimeCapabilitiesService` test `window.electron` methods; `EpgRuntimeBridgeService` is a concrete class around `window.electron`. Some portal code calls `window.electron` EPG methods directly. | A renderer seam: an EPG runtime backend (Electron or server) provides both the methods and the capability flags; direct calls move behind the bridge. |
| Xtream and Stalker EPG calls already go through `PwaService` to `/xtream` and `/stalker`; `withEpg()`, `with-stalker-epg.feature`, the channel lists and panels return early on `runtime.supportsEpg`. Two Stalker E2E tests assert the PWA hides EPG. | A provider EPG capability decouples them (PR 3a). |
| Global XMLTV URLs are `Settings.epgUrl`, stored per device; per-playlist URLs (`epgUrls`, `detectedEpgUrls`, `manualEpgUrls`, `disabledEpgUrls`) are fields of the playlist document and projected columns of `playlists`. | In server mode the global list moves to the server; per-playlist URLs are already there. |
| `settings.epgUrl` is read in eight places (channel list, player, playlist info, M3U effects, `EpgService`, backup, startup fetch, `EpgSourceSettingsService`). | The server list is loaded into `SettingsStore.epgUrl`, so consumers stay unchanged. |
| The backend `/parse` route has its own `createPlaylistObject` and drops `x-tvg-url` / `url-tvg`; PWA file imports keep them. | `/parse` uses the shared `createPlaylistObject` from `m3u-utils` (PR 3d). |
| The xtream mock serves `/demo/guide.xml` with times relative to now; its channel ids differ from playlist `tvg-id`s, its display names match the marketing channel names. | E2E uses it as the XMLTV fixture and matches by name. |
| Real provider feeds are large: one Xtream `xmltv.php` measured 20 MB gzip / 174 MB XML / 359k programmes, an M3U provider's guide 569k programmes; indexed SQLite takes about 1 KB per programme. | Size guidance in the Docker docs: 150–350 MB per typical feed. |

## 5. Product decisions

1. **Provider EPG first.** PR 3a turns on Xtream and Stalker EPG in every PWA
   through the existing proxy. XMLTV-based portal features (the Xtream XMLTV
   fallback, "Map EPG channel") keep the XMLTV gates.
2. **Server-wide sources.** In server mode Settings → EPG edits one list on
   the server. Any device with access may change it (same trust level as
   playlists). The server imports the union of this list and the enabled
   per-playlist URLs of all M3U playlists on the server.
3. **Daily refresh at a set time.** Default 04:00 in the container's `TZ`,
   changeable in Settings → EPG. On start the server catches up sources whose
   last success is older than 24 h or that were never imported. Adding a
   source imports it at once; "Refresh" and "Refresh all" work on demand.
4. **LAN sources need an EPG-only switch.** XMLTV fetches follow the proxy's
   private-network policy unless `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS=1`
   (also implied by `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1`). The import
   never returns a fetched body, only state, counts and an error code.
5. **Separate EPG file.** `/data/databases/epg.db` holds imported data only.
   The source list and refresh time are configuration and stay in
   `iptvnator.db` (`app_state`), so they survive deleting `epg.db`.
6. **No XMLTV without server storage.** Hosted PWA and Docker with
   `IPTVNATOR_STORAGE=none` keep XMLTV hidden. `IPTVNATOR_EPG=off` disables
   server EPG with storage on.
7. **Mapping later.** In server mode "Map EPG channel" stays hidden until
   PR 3e; matching by `tvg-id`, `tvg-name` and name works from 3d.

## 6. Architecture

```
Browser (PWA)                                          Docker container
┌──────────────────────────────────────────┐          ┌──────────────────────────────────────────┐
│ RuntimeCapabilitiesService               │          │ web-backend (Express)                    │
│   EPG flags ← EPG runtime backend        │          │  ├ /xtream, /stalker proxy (3a)          │
│ EpgRuntimeBridgeService                  │   /api   │  ├ access guard                          │
│   └ EPG runtime backend                  │─────────►│  ├ /v1 storage (phase 2)                 │
│       ├ Electron (IPC)       (desktop)   │          │  └ /v1/epg (3c)                          │
│       └ ServerEpgBackend     (server)    │◄─────────│      ├ settings, status, import, clear   │
│ SettingsStore.epgUrl ← GET /v1/epg/...   │   HTTP   │      └ current, metadata, programs,      │
│ EpgProgressService ← status polling      │          │        window, coverage, search          │
│ Xtream / Stalker stores                  │          │ EpgService (server)                      │
│   provider EPG via PwaService (3a)       │          │  ├ source registry (app_state + playlists)│
└──────────────────────────────────────────┘          │  ├ scheduler (daily HH:MM, catch-up)     │
                                                      │  ├ import queue → worker thread          │
                                                      │  │    @iptvnator/shared/epg-store        │
                                                      │  └ queries   @iptvnator/shared/epg-store │
                                                      │ /data/databases/iptvnator.db (config)    │
                                                      │ /data/databases/epg.db       (EPG data)  │
                                                      └──────────────────────────────────────────┘
```

### 6.1 Shared library `@iptvnator/shared/epg-store`

`libs/shared/epg-store` (tags `scope:shared`, `domain:shared-runtime`,
`type:data-access`; Node only, lint keeps renderer projects from importing
it). Contents, moved from `apps/electron-backend` with the behavior of
#1941, #1946 and #1947:

- source stream, decoder, optional gunzip, response utilities;
- streaming parser and XMLTV date parsing;
- import writer with staging and atomic publish, source metadata restore,
  per-source replacement keeping seven days of past programmes, the lazy
  dedup index;
- `runEpgImport(source, connection, { signal, onProgress, limits })`, the
  body of today's worker, without `worker_threads` wiring;
- queries: channel programmes, current-programme batch, channel metadata,
  guide window, coverage, search, freshness; split into files under 300
  lines, taking a database handle instead of `getDatabase()`;
- `ensureEpgSchema(connection, { fts })`: the `epg_*` DDL, shared with
  `connection.ts` so the desktop schema does not fork.

Electron keeps its worker entry (`epg-parser.worker.ts`, which the packaging
check expects), its fetch orchestration, fences and IPC; they call the
library. The esbuild alias table in `apps/electron-backend/build-worker.js`
gains the new sub-path. Mapping lookups stay in Electron until 3e.

### 6.2 Server

`apps/web-backend/src/app/epg/`, mounted by `mount-server-storage.ts` when
storage and EPG are enabled. Every file stays under 300 lines.

- **Config** (`epg-config.ts`): `IPTVNATOR_EPG` (`on` or `off`; the
  default is `off` in 3c and `on` from 3d), `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS`,
  `IPTVNATOR_EPG_MAX_MB` (decompressed megabytes per source, default 1024).
- **Database** (`epg-database.ts`): opens `<data>/databases/epg.db` with
  WAL, `auto_vacuum=INCREMENTAL` (set before the first table), `busy_timeout`,
  `ensureEpgSchema(…, { fts: false })`, plus the server-only table
  `server_epg_imports(source_url PRIMARY KEY, last_attempt_at,
  last_success_at, channels, programmes, error_code, error_host)`. A file that
  fails to open or migrate is renamed `epg.db.broken-<time>` and recreated;
  it holds no user data.
- **Source registry** (`epg-source-registry.ts`): the server list and refresh
  time in `app_state` (`server:epg-settings`, JSON `{ urls, refreshTime }`),
  union with the `epg_urls` column of non-portal playlists. Recomputed after
  `PUT /v1/epg/settings` and, debounced by 2 s, after any playlist write or
  delete; only a changed source set acts: new URLs are queued, and URLs
  without an owner have their data cleared after the running import, if
  any, stops.
- **Scheduler** (`epg-scheduler.ts`): one timer to the next `HH:MM` in the
  process time zone, re-armed after each run and after a settings change;
  at the run it queues every source. Sixty seconds after start it queues
  sources never imported or last successful more than 24 h ago.
- **Import queue** (`epg-import-queue.ts`): one import at a time, FIFO,
  duplicate requests coalesced; a forced request for a source finished
  less than 60 s ago is dropped. Each import runs in a worker thread
  (`epg-import.worker.ts`, second esbuild entry, `resourceLimits`
  `maxOldGenerationSizeMb: 512`) with its own `epg.db` connection, fed by
  `ValidatedHttpClient` in streaming mode. Stall timeout 5 min without
  progress (suspended once the import starts its publish transaction,
  which sends no progress), wall clock 60 min, decompressed cap from
  config. A failed or
  cancelled import publishes nothing; old data stays. After the nightly run:
  prune programmes that stopped more than seven days ago, then
  `incremental_vacuum`.
- **Status** (`epg-status.ts`): per source state (`idle`, `queued`,
  `loading`, `error`), queue position, progress counters, last attempt and
  success, counts, error code and host; a `revision` counter that increases
  after every publish and clear.
- **Routers** (`epg-settings-router.ts`, `epg-import-router.ts`,
  `epg-query-router.ts`), JSON body limit 256 KB, behind the access guard.
- **Shutdown**: `main.ts` stops the scheduler, aborts the worker and waits up
  to 5 s for it before closing both databases.
- **Logging**: error names, codes and hosts only; never URLs, query strings
  or bodies (XMLTV URLs often carry credentials).
- `GET /v1/instance` adds `features: { epg: boolean }`; `apiVersion` stays 1.
  `/v1/instance/status` adds `epgDatabaseBytes`.

### 6.3 Client

- **Seam (3b).** The EPG runtime backend is the EPG subset of the bridge
  API: `EpgRuntimeBackend`, a `Partial<Pick<ElectronBridgeApi, …>>` of the
  methods `EpgRuntimeBridgeService` and `EpgSourceSettingsService` call
  (including `reconcileEpgSources`), in `@iptvnator/shared/interfaces`. The
  token `EPG_RUNTIME_BACKEND` in the `@iptvnator/services` main barrel
  provides a getter for it; the default getter returns `window.electron`.
  A capability stays "the method is present", now checked on the backend
  instead of on `window.electron`, so every desktop flag keeps its value and
  stays a synchronous getter. The server backend simply has no file picker
  and no mapping methods. `XtreamXmltvFallbackService`, `with-epg.feature`,
  `epg-queue.service` and `portal-channels-list` stop calling
  `window.electron` and use the bridge.
- **Server backend (3d)**, in the `@iptvnator/services/server-storage`
  sub-entry, provided by `provideServerStorage()` when the instance reports
  `features.epg` (remembered with the instance, so an offline start knows
  it):
  - `ServerEpgClient`: the `/v1/epg` calls through `ServerApiClient` (token,
    timeouts, offline and 401 handling from phase 2); key lists chunked to
    the route caps.
  - `ServerEpgBackend`: capability flags (section 9) and bridge methods.
    `fetchEpg` → `POST /v1/epg/import` with `force: false`, `forceFetchEpg`
    → `force: true`; the server ignores URLs it does not own.
  - `ServerEpgStatusPoller`: polls `/v1/epg/status` every 2 s while a
    source is queued or loading or Settings → EPG is open, and on
    `visibilitychange`; turns changes into `EpgImportProgress` events for
    `EpgProgressService` and the source status chips. A new `revision`
    clears the current-programme and guide caches.
  - Source list: on settings load `SettingsStore.epgUrl` is replaced by
    `urls` from `GET /v1/epg/settings` (re-read when the tab becomes
    visible); the server backend's `reconcileEpgSources` commits a changed
    list with `PUT /v1/epg/settings`. The device copy of `epgUrl` is not
    used in server mode.

## 7. HTTP API (`/v1/epg`, behind the access guard)

All reads that take keys or source URLs are `POST` with a JSON body: key
lists exceed URL limits, and source URLs carry credentials that must not
reach access logs. Caps mirror the desktop IPC: keys beyond a cap are
ignored and missing keys are left out of the answer; an invalid window
answers `{}` or `[]`.

| Route | Body → answer | Bridge method |
| --- | --- | --- |
| `GET /v1/epg/settings` | → `{ urls, refreshTime }` | source list |
| `PUT /v1/epg/settings` | `{ urls? ≤ 50, refreshTime? "HH:MM" }` (an omitted field keeps its value) → the stored settings; `400` on a non-`http(s)` URL, URL userinfo, too many URLs or a bad time | `reconcileEpgSources`, refresh time |
| `GET /v1/epg/status` | → `{ revision, refreshTime, timeZone, nextRunAt, sources: [{ url, owners, state, queuePosition?, stats?, lastAttemptAt?, lastSuccessAt?, channels?, programmes?, errorCode?, errorHost? }], totals: { programmes, databaseBytes } }` | freshness, progress |
| `POST /v1/epg/import` | `{ urls?, force? }` → `202` + status | `fetchEpg`, `forceFetchEpg` |
| `POST /v1/epg/clear` | `{ url? }` → `{ success }` | `clearEpgData`, `clearEpgDataForSource` |
| `POST /v1/epg/current` | `{ channelIds ≤ 500, sourceUrls?, nowMs? }` → `{ [id]: EpgProgram \| null }` | `getCurrentProgramsBatch` |
| `POST /v1/epg/metadata` | `{ channelIds ≤ 500, sourceUrls? }` → `{ [id]: { id, displayName, iconUrl } \| null }` | `getChannelMetadata` |
| `POST /v1/epg/channel-programs` | `{ channelId, sourceUrls? }` → `EpgProgram[]` (≤ 500) | `getChannelPrograms` |
| `POST /v1/epg/window` | `{ channelIds ≤ 100, fromMs, toMs, sourceUrls? }` → `{ [key]: EpgProgram[] }` | `getProgramsForChannels` |
| `POST /v1/epg/coverage` | `{ channelIds ≤ 2000, fromMs, toMs, sourceUrls? }` → `string[]` | `getProgramCoverage` |
| `POST /v1/epg/search` | `{ term, limit ≤ 50 }` → `(EpgProgram & { channelName })[]` | `searchPrograms` |

Errors use the phase 2 envelope `{ message, status, code? }`. Import error
codes: the existing bridge security codes (private network blocked,
invalid TLS certificate) plus `epg_http_status`, `epg_timeout`,
`epg_too_large`, `epg_parse_failed`, `epg_empty`, `epg_too_many_sources`.
Answers carry `Cache-Control: no-store`.

## 8. Matching

Unchanged from the desktop contract in `m3u-playlist-module.md`: the renderer
resolves the lookup key (`tvg-id`, then `tvg-name`, then the name) and the
scope (playlist sources, then global sources, then the optional any-source
fallback); the server runs the extracted query code (exact id, case-
insensitive id, display name, Unicode lowercase). Timeline, guide and search
stay unscoped. Times are stored as UTC ISO strings; the display offset stays
a device setting applied in the renderer.

## 9. UI and capability gating

| Surface | Electron | PWA, no server EPG | PWA, server EPG |
| --- | --- | --- | --- |
| Xtream / Stalker provider EPG (lists, panels, favorites, dashboard) | on | on (3a) | on |
| Xtream XMLTV fallback | on | off | on (3d, via the bridge) |
| M3U channel-list programme line, player EPG panel, guide, search | on | off | on |
| Settings → EPG | device list | display settings only (time offset, view mode), from 3a | server list and refresh time (saved with Save), "On the server" source list, display settings |
| Playlist info → EPG sources, Refresh | on | shown, Refresh disabled | on, `http(s)` URLs only |
| EPG import progress panel | push | — | polling, imports started on this device only |
| Local XMLTV file picker | on | — | off |
| "Map EPG channel" | on | off | off until 3e |

Server flags: import, progress, program lookup, current batch, channel
metadata, source freshness, data management, guide and program search are
true, so `supportsEpg` is true; file picker and mapping are false.
`supportsProviderEpg` is true wherever the portal transport exists (Electron
IPC or the PWA backend proxy).

Settings → EPG in server mode labels the list as shared by every device of
the server; the refresh time is part of the settings form and is saved with
the list by the Save bar. Below the list, "On the server" shows every
imported source, playlist-owned ones included, with state, last import,
channel and programme counts and errors; the inline status chips on URL
rows use 24 h freshness in server mode. "Clear EPG data" clears and
re-imports every source. The desktop error actions "Trust
private network source" and "Trust certificate" are replaced by a hint
naming `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS` or `NODE_EXTRA_CA_CERTS`.
Display offset, EPG view mode and `preferUploadedEpgOverXtream` stay device
settings. New strings are translated in all locales.

## 10. Error handling and offline

| Situation | Behavior |
| --- | --- |
| Server unreachable | Phase 2 status `offline` and banner. EPG reads answer as "no data": surfaces keep what they loaded or show "No programme information"; no EPG snackbar. |
| `401` | Phase 2 sign-in flow. |
| Import fails (network, HTTP status, size, timeout, parse, empty) | Source state `error` with a code; old data stays; next nightly run or a manual refresh retries. |
| Disk full during import | Publish rolls back; state `error`. |
| `epg.db` corrupt or from an incompatible version | Renamed and recreated; sources re-import on the catch-up run. |
| Settings `PUT` while offline | The save fails visibly; the server list is unchanged. |
| Source list changed on another device | Picked up on the next settings load or when the tab becomes visible. |
| Process stops during import | Worker aborted, nothing published; the catch-up run after start re-imports. |

## 11. Limits

| Limit | Value |
| --- | --- |
| Server list | 50 URLs |
| Sources imported in total (list + playlists) | 100; the rest get `epg_too_many_sources` |
| Decompressed feed size | `IPTVNATOR_EPG_MAX_MB`, default 1024 |
| Stall / wall-clock timeout | 5 min without progress / 60 min |
| Redirects | 5, `ValidatedHttpClient` rules |
| Concurrent imports | 1; worker heap 512 MB |
| Forced refresh of a source finished < 60 s ago | ignored |
| Request keys | 500 current / 500 metadata / 100 window / 2000 coverage; search ≤ 50 |
| Request body | 256 KB |
| Past programmes kept | 7 days |
| Disk (guidance) | about 1 KB per programme: 150–350 MB per typical feed |

## 12. Testing

- **3a.** Unit: flag split; Xtream `withEpg()` and Stalker EPG feature in PWA
  mode. E2E: the two Stalker tests flip to "PWA shows EPG"; a new Xtream
  test on the mock shows the programme line and the player EPG panel.
- **3b.** Moved specs travel with the code; the full `electron-backend` suite
  and the Electron EPG E2E stay green. Library tests: import from a local
  HTTP server into a temporary database (gzip, double gzip, UTF-8 split
  across chunks, failure keeps old data), queries on the same fixture.
  Renderer: Electron default flags unchanged; the bridge delegates to the
  provided backend; portal services no longer touch `window.electron`.
- **3c.** Real SQLite in a temp data directory, `withServer` + `fetch`:
  registry reconciliation on playlist writes, deletes and settings `PUT`;
  scheduler with fake timers (next `HH:MM` in `TZ`, re-arm, catch-up after
  start, coalescing); import queue with a real worker (abort on shutdown,
  size cap, private-network policy with and without the EPG flag); routes
  (caps, `400`s, access guard `401`, `features.epg`, `IPTVNATOR_EPG=off`,
  `Cache-Control`); repeated start on an existing `epg.db`; recovery from a
  corrupt file.
- **3d.** Unit: `ServerEpgClient` chunking, `ServerEpgBackend` flags and
  method mapping, poller to progress events and cache reset on `revision`,
  offline answers, settings load/commit of the server list, Settings → EPG
  server view, `/parse` keeps header EPG URLs. E2E `@server-epg` on the
  storage backend with the mock's `/demo/guide.xml`: add the source in
  Settings → EPG, wait for the import, open an M3U playlist with the
  marketing channel names, assert the programme line, the player EPG panel,
  the guide and a search hit; a second browser context sees the same source
  list. Docker: image build, start with a volume, import a fixture feed;
  on NAS-class hardware, import a large real feed (300k+ programmes) and
  record import time, worker memory and `epg.db` size for the Docker docs.
- Performance journeys: server EPG code loads only through the server-storage
  sub-entry; check the launch journey for new stylesheets or chunks.

## 13. Phases (one PR each)

| PR | Content | Depends on | Release note |
| --- | --- | --- | --- |
| 3a | Provider EPG in the PWA: `supportsProviderEpg`, Xtream and Stalker gates, Settings → EPG display settings in the PWA, a browser check of Xtream catch-up (archive actions hidden in the PWA if it does not play), E2E, docs (`stalker-epg.md`, Xtream compatibility, PWA limitations). | — | yes |
| 3b-1 | Renderer seam: `EpgRuntimeBackend` and `EPG_RUNTIME_BACKEND`, EPG capability flags checked on the backend, portal `window.electron` calls behind the bridge, `EpgSourceSettingsService` reconciling through the backend. No behavior change. | — | no |
| 3b-2 | `@iptvnator/shared/epg-store`: pipeline and queries extracted (query service split), Electron on the library, streaming mode with a byte cap in `ValidatedHttpClient`. No behavior change. | #1941, #1946, #1947 (+#1800) merged | no |
| 3c | Server EPG in `web-backend`: `epg.db`, registry, scheduler, import queue and worker, `/v1/epg`, `features.epg`, shutdown hook, Docker env and docs. `IPTVNATOR_EPG` defaults to `off`. | 3b-2 | no |
| 3d | PWA server mode: `ServerEpgBackend`, poller, server source list, Settings → EPG server view, `/parse` header EPG URLs, i18n, `@server-epg` E2E, docs; `IPTVNATOR_EPG` defaults to `on`. | 3b-1, 3c | yes |
| 3e | Mapping in server mode: mappings in `iptvnator.db` shared by all devices, resolved before querying `epg.db`; mapping routes; Xtream and Stalker XMLTV through mappings. | 3d | yes |

3a and 3b-1 can start at once and run in parallel.

## 14. Documentation

- `docs/architecture/pwa-self-hosted.md`: a "Server EPG" section (routes,
  sources, schedule, polling, offline), routes list, Runtime Limitations
  rewritten for provider EPG and server EPG.
- `docs/architecture/m3u-playlist-module.md`: the import pipeline's new home,
  the server source lifecycle next to the desktop one.
- `docs/architecture/stalker-epg.md`, `xtream-portal-compatibility.md`:
  PWA transport for provider EPG.
- `docker/README.md` and `docker-compose.yml`: `IPTVNATOR_EPG`,
  `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS`, `IPTVNATOR_EPG_MAX_MB`, `TZ`, disk
  guidance, `epg.db` may be deleted at any time.
- `docs/architecture/validation-map.md` (new specs and tags),
  `nx-workspace-boundaries.md` (new library), `libs/shared/database/README.md`
  (shared EPG DDL).
- The phase table of the server storage design links here.

## 15. Risks

- **Rebase cost.** 3b-2 moves files that four open PRs edit; starting before
  they merge means repeated conflict work.
- **Proxy load from provider EPG.** Xtream row previews issue
  `get_short_epg` per visible channel through `/xtream`, and Stalker's bulk
  `get_epg_info` can be several megabytes through `/stalker`. The existing
  queues and host guard apply as on the desktop; 3a checks that EPG
  failures cannot open the host's circuit for playback requests.
- **Time zone.** The schedule uses the process time zone; containers default
  to UTC. Documented with `TZ`; Settings shows the zone the server uses.
- **NAS resources.** Large feeds cost hundreds of megabytes on disk and a
  worker of up to 512 MB during import. Documented; the size cap and
  `IPTVNATOR_EPG=off` bound it.
- **Blind SSRF.** With the EPG private-network switch on, anyone with access
  can make the server issue `GET` requests to LAN addresses without seeing
  answers. Off by default and documented.
- **Stale source list on open tabs.** Another device's change shows on the
  next visibility change or reload; no push.

## 16. Follow-ups outside this phase

Candidates the phase 3 data model leaves room for, each with its own design
when it is picked up:

- Full guides for portals on the server: import an Xtream playlist's
  `xmltv.php` with its stored credentials, and let Xtream and Stalker
  playlists carry their own XMLTV sources like M3U `epgUrls`. Gives portals
  the guide grid and programme search (#1671, item 1).
- Programme search in global search, grouped by programme and channel,
  with play, catch-up or details as the action (#1671, items 2–3), across
  all playlists of the instance.
