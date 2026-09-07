# Xtream Mock Server — Architecture

## Purpose

`apps/xtream-mock-server` is a self-contained Express server that emulates the
Xtream Codes API protocol. It is used for:

- **Local development** — run a full portal without a real Xtream subscription
- **E2E testing** — Playwright uses it for both web and Electron workflows
- **Performance investigation** — a locked-down loopback control plane
  prepares and identifies a fixed synthetic 100k catalog before capture

---

## Data Pipeline

```
credentials (username + password)
        │
        ▼
credentialsToSeed(u, p)   ←── deterministic polynomial hash
        │
        ▼
faker.seed(seed)           ←── all faker calls use same seed per credentials
        │
        ├── performance:performance?
        │          └── index-derived generator (no Faker/runtime clock)
        │
        ▼
  generateCategories()     ←── live / vod / series categories
        │
  generateLiveStreams()     ←── live TV stream list
  scenario EPG fixture?     ←── optional deterministic per-stream EPG override
  generateVodStreams()      ←── VOD movie list
  generateSeriesItems()     ←── series list
  generateSeriesInfo()      ←── nested seasons + episodes (pre-populated)
        │
        ▼
  PortalData (cached)       ←── Map<"username:password", PortalData>
```

Re-requesting with the same credentials returns the exact same data until
`POST /reset` clears all caches.

---

## File Structure

```
apps/xtream-mock-server/
├── project.json                  ← Nx serve, watch, lint, and test targets
├── public/
│   └── marketing/                ← committed fictional release artwork PNGs
├── tsconfig.json
└── src/
    ├── main.ts                   ← env validation, HTTP lifecycle, safe logging
    └── app/
        ├── server.ts             ← side-effect-free Express app factory/routes
        ├── server-lifecycle.ts   ← bounded, idempotent HTTP shutdown
        ├── scenarios.ts          ← Credential → ScenarioConfig mapping
        ├── data-store.ts         ← Lazy cache, per-credentials generation
        ├── performance-control.ts ← bounded request lifecycle controller
        ├── performance-interception-lifecycle.ts ← reset/shutdown generation
        ├── performance-control-routes.ts ← token-gated control HTTP API
        ├── performance-control-validation.ts ← strict request validation
        ├── performance-control.types.ts ← safe manifest/state contracts
        ├── performance-manifest.ts ← fixed-order catalog hash/counts
        ├── generators/
        │   ├── categories.generator.ts
        │   ├── live.generator.ts   ← Live streams + EPG listings
        │   ├── marketing.generator.ts ← Fictional release screenshot fixture
        │   ├── performance.generator.ts ← local-only deterministic 100k fixture
        │   ├── vod.generator.ts    ← VOD streams + VodDetails
        │   └── series.generator.ts ← Series items + SeriesInfo
        ├── handlers/
        │   ├── get-account-info.handler.ts
        │   ├── get-categories.handler.ts   ← live/vod/series categories
        │   ├── get-full-epg.handler.ts     ← full EPG + legacy typo alias
        │   ├── get-streams.handler.ts      ← live/vod/series stream lists
        │   ├── get-vod-info.handler.ts
        │   ├── get-series-info.handler.ts
        │   └── get-short-epg.handler.ts
        └── routes/
            └── dispatch.ts               ← Action → handler routing
```

---

## API Protocol

### Direct Xtream endpoint

```
GET /player_api.php?action=<action>&username=<u>&password=<p>[&...]
```

Response: raw JSON (no envelope). Matches the real Xtream Codes API format.

### PWA proxy endpoint

IPTVnator's PWA routes Xtream calls through:

```
GET /xtream?url=<serverUrl>&action=<action>&username=<u>&password=<p>
```

Response: `{ payload: <data>, action: <action> }`

This mirrors the backend proxy in `apps/electron-backend` so the same
Angular service code works in both environments.

### Performance control endpoint

The control plane is absent by default. It is mounted only when
`IPTVNATOR_XTREAM_MOCK_CONTROL=1`; startup then requires a non-empty
`IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN` and a literal loopback `HOST`
(`127.0.0.1` or `::1`). Every `/__control/*` request must carry that exact value
in `x-iptvnator-performance-token`, including `OPTIONS` preflight requests.
Configuration is validated before the HTTP listener opens. Both modes now
default to `127.0.0.1` when `HOST` is unset — the fixture serves fabricated but
unauthenticated content, so it should not be reachable from other hosts by
accident. Set `HOST=0.0.0.0` explicitly to expose it, which is what you need
when driving the mock from a phone, an STB, a container, or another machine.
Control mode additionally *rejects* an explicitly configured non-loopback host. The Nx serve targets do not pin `PORT`, so an explicit shell
value reaches the parser; its no-value default remains `3211`.

Use a dedicated port rather than the normal `3211` E2E server:

```bash
HOST=127.0.0.1 \
PORT=3221 \
IPTVNATOR_XTREAM_MOCK_CONTROL=1 \
IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN=local-benchmark-token \
pnpm nx run xtream-mock-server:serve
```

The strict control API is:

```text
POST /__control/prepare
POST /__control/reset
POST /__control/barriers
POST /__control/barriers/:id/release
POST /__control/delays
GET  /__control/state
```

`prepare` accepts exactly `{"scenario":"performance-100k"}` and materializes
the fixed `performance:performance` fixture before application capture. It
returns only this manifest:

```json
{
    "epoch": 1,
    "scenario": "performance-100k",
    "seed": 91001,
    "counts": {
        "categories": { "live": 60, "vod": 20, "series": 20, "total": 100 },
        "items": {
            "live": 60000,
            "vod": 20000,
            "series": 20000,
            "total": 100000
        }
    },
    "bytes": 123,
    "catalogSha256": "64-lowercase-hex-characters"
}
```

`bytes` is the UTF-8 byte length and `catalogSha256` is the SHA-256 of one JSON
object whose property order is fixed as:

1. live categories
2. VOD categories
3. series categories
4. live catalog
5. VOD catalog
6. series catalog

Credentials, server origins, response envelopes, and EPG/detail caches are not
part of the hash input.

`reset` accepts exactly `{"mode":"observations"}` or `{"mode":"all"}`.
Observation reset clears active/held rules, per-identity occurrences, and the
ledger while retaining the prepared manifest and epoch. All-state reset also
calls the data-store reset, clears the manifest, and increments the epoch.
Either mode first advances an internal observation generation and detaches all
pre-reset response listeners, so a late `finish` or `close` cannot repopulate
the freshly cleared ledger. Held barrier/delay clients retain the safe `409`
reset response where possible; unmatched active responses are aborted.

Barrier and delay rules have an ID plus the exact match tuple:

```text
(epoch, scenario, transport, canonicalAction, categoryId, occurrence)
```

`transport` is `direct` or `proxy`. Empty actions canonicalize to
`get_account_info`; the dispatcher's legacy `get_simple_date_table` alias is
allowlisted. Occurrences are counted per tuple excluding occurrence, so
parallel requests for different categories cannot consume each other's rule.
Numeric category IDs must use canonical decimal spelling. Signs, whitespace,
leading zeroes, non-decimal notation, unsafe integers, and values outside the
closed scenario ranges are rejected; invalid incoming aliases collapse to the
single `all` observation identity and cannot expand the bounded state map.
Rules are one-shot and match before dispatch or JSON serialization. Barrier
lifecycle is `arrived → blocked → responded|aborted`; delay lifecycle is
`arrived → delayed → responded|aborted`. Real request abort events release held
state; a normally consumed request's `close` event is not treated as an abort.

The state response contains only epoch, the safe manifest, active rules, held
IDs/count, bounded occurrence counts, and bounded lifecycle entries with
monotonic timestamps. It never stores or returns the token, username, password,
raw URL/query, request/response payload, titles, or catalog arrays. Unknown
incoming actions are represented only as `unknown`.

Control JSON is limited to 16 KiB. Bodies reject unknown/missing/wrong-type
fields. Each observation epoch accepts at most 32 rules, and the serialized
ledger retains at most 128 entries. Occurrence state has 512 slots: enough for
the complete closed scenario/action/category/transport identity domain without
eviction or counter restart; an unexpected overflow fails closed. IDs,
scenarios, transports, actions, categories, occurrences, and delays
(`0..5000` ms) use closed validation. Duplicate IDs/matches and already-past
occurrences fail closed.

The legacy unauthenticated `POST /reset` remains available in normal mode. It
returns `410` while the control plane is enabled, preventing cache invalidation
that would leave the controller's prepared manifest stale. Performance runs
must use the token-authenticated `/__control/reset`.

Barriers and delays exist for deterministic coordination and smoke tests only.
Formal performance captures must prove that both rule sets are empty and must
never add an artificial delay to the timed application path.

`SIGINT` and `SIGTERM` use one bounded, idempotent shutdown path. The
application hook invalidates active observations, settles barriers and delays,
and clears their timers/listeners before the HTTP listener closes. The shared
HTTP helper then closes idle and active connections, so an unreleased control
rule cannot keep the mock process alive.

### M3U fixture endpoint

```
GET /playlist.m3u
```

Returns a small deterministic four-channel playlist. The self-hosted PWA E2E
suite uses this endpoint to verify M3U URL imports through `apps/web-backend`
and the provider target registry.

### Stream stub endpoints

```
GET /live/<username>/<password>/<streamId>.m3u8
GET /movie/<username>/<password>/<streamId>.<ext>
GET /series/<username>/<password>/<streamId>.<ext>
```

In normal mode all redirect to a publicly available HLS test stream
(`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`). With the control plane
enabled, every stream/timeshift route for the performance credentials returns
`410` without a redirect or outbound request. `/playlist.m3u` is also `410` in
that mode. This keeps formal performance fixtures local-only; normal
control-disabled E2E behavior is unchanged.

---

## Key Response Shapes

### `get_account_info`

```json
{
    "user_info": {
        "username": "user1",
        "password": "pass1",
        "status": "active",
        "exp_date": "4102444799",
        "is_trial": "0",
        "active_cons": "1",
        "max_connections": "2",
        "allowed_output_formats": ["m3u8", "ts", "rtmp"]
    },
    "server_info": {
        "url": "http://localhost:3211",
        "port": "3211",
        "timezone": "UTC",
        "timestamp_now": 1234567890
    }
}
```

### `get_live_categories` / `get_vod_categories` / `get_series_categories`

```json
[
  { "category_id": "101", "category_name": "News", "parent_id": 0 },
  ...
]
```

### `get_live_streams` (sample item)

```json
{
    "num": 1,
    "name": "Acme Corp TV",
    "stream_type": "live",
    "stream_id": 10000,
    "stream_icon": "https://picsum.photos/seed/live-10000/100/100",
    "epg_channel_id": "channel-10000.mock",
    "category_id": "101",
    "tv_archive": 0,
    "tv_archive_duration": 0
}
```

### `get_short_epg` (sample item)

```json
{
    "epg_listings": [
        {
            "id": "1000000",
            "epg_id": "channel-10000.mock",
            "title": "base64encodedTitle",
            "description": "base64encodedDescription",
            "start": "2024-01-01 12:00:00",
            "end": "2024-01-01 12:30:00",
            "start_timestamp": "1704110400",
            "stop_timestamp": "1704112200"
        }
    ]
}
```

Note: `title` and `description` are **base64-encoded**, matching the real Xtream API.

### `get_simple_data_table` / `get_simple_date_table`

Both actions return the same full per-channel schedule shape:

```json
{
    "epg_listings": [
        {
            "id": "10000-current",
            "epg_id": "channel-10000.mock",
            "title": "base64encodedTitle",
            "description": "base64encodedDescription",
            "start": "2026-04-05 04:30:00",
            "end": "2026-04-05 05:00:00",
            "start_timestamp": "1775363400",
            "stop_timestamp": "1775365200",
            "channel_id": "channel-10000.mock"
        }
    ]
}
```

The legacy `get_simple_date_table` typo alias exists because real Xtream panels
sometimes only respond to that misspelled action.

### `get_series_info` (structure)

```json
{
  "seasons": [
    {
      "id": 3000100, "name": "Season 1", "season_number": 1,
      "episode_count": 8, "air_date": "2022-05-14",
      "cover": "https://picsum.photos/seed/season-30001-1/300/450"
    }
  ],
  "info": { "name": "...", "cover": "...", "plot": "...", "cast": "...", ... },
  "episodes": {
    "1": [
      {
        "id": "80001", "episode_num": 1, "title": "Series Name S1E1",
        "season": 1, "container_extension": "mkv",
        "info": { "duration_secs": 2400, "rating": 8.3, ... }
      }
    ]
  }
}
```

---

## Scenarios

| Key (`username:password`) | Seed  | Categories                 | Items/cat | Account status |
| ------------------------- | ----- | -------------------------- | --------- | -------------- |
| `user1:pass1`             | 1001  | 8 each                     | 40        | active         |
| `large:large`             | 9999  | 20 each                    | 200       | active         |
| `stress:stress`           | 7777  | 16 each                    | 120       | active         |
| `performance:performance` | 91001 | live:60, vod:20, series:20 | 1,000     | active         |
| `series:series`           | 2002  | live:3, vod:4, series:15   | 30        | active         |
| `minimal:minimal`         | 3003  | 2 each                     | 5         | active         |
| `epg:epg`                 | 6006  | live:2, vod:1, series:1    | 3         | active         |
| `tzoffset:tzoffset`       | 6006  | live:2, vod:1, series:1    | 3         | active         |
| `emptyvod:emptyvod`       | 7007  | 2 each                     | 5         | active         |
| `marketing:marketing`     | 8020  | live:4, vod:4, series:4    | curated   | active         |
| `expired:expired`         | 4004  | 4 each                     | 10        | Expired        |
| `inactive:inactive`       | 5005  | 4 each                     | 10        | Disabled       |
| `<any other>`             | hash  | 6 each                     | 30        | active         |

### `epg:epg` fixture details

This scenario is reserved for Xtream EPG tests:

- live category `EPG Focus` contains deterministic channels such as `Timezone News`
- `Timezone News` serves a fixed `get_short_epg` window and a full `get_simple_data_table` schedule
- the full schedule includes a program that spans a UTC midnight boundary and another program after midnight
- raw `start` / `end` strings are intentionally offset from `start_timestamp` / `stop_timestamp`

That deliberate mismatch lets Electron tests verify the renderer uses timestamp
fields for sorting, current-program selection, progress bars, and local clock
labels instead of trusting provider-local strings.

### `marketing:marketing` fixture details

This scenario is reserved for release screenshots and marketing materials:

- VOD and series data use 65 curated fictional titles instead of faker-generated
  titles or real media metadata
- the core 30-title generated artwork pack keeps matched posters and backdrops;
  35 additional movie-poster showcase titles use approved local poster PNGs and
  the deterministic SVG fallback for their missing backdrops; the newest 20
  appear first in the VOD catalog
- showcase metadata comes from the provider-neutral
  `@iptvnator/shared/marketing-fixtures` catalog shared with the Stalker mock
- posters and backdrops are served from committed PNG files in
  `apps/xtream-mock-server/public/marketing/{poster,backdrop}/`
- `tools/release/generate-marketing-artwork.ts` generates the PNGs with
  `gpt-image-2` only when `OPENAI_API_KEY` is present; it also writes the
  prompt/asset manifest at `apps/xtream-mock-server/public/marketing/manifest.json`
- the manifest assigns distinct genre and visual-medium profiles per title,
  including documentary, noir, animated family, retro rescue drama, cyberpunk,
  anime-inspired space school, and workplace dramedy styles
- screenshot capture remains deterministic and offline because
  `tools/release/capture-release-screenshots.ts` consumes the local mock server
  assets and never calls OpenAI; its guards additionally verify that the
  service answering on the mock port really is this fixture server
- the SVG renderer in `marketing.generator.ts` remains the fallback for missing
  assets, live logos, season covers, and episode thumbnails

### `performance:performance` fixture details

This scenario is reserved for local performance captures:

- exactly 60 live categories/60,000 channels, 20 VOD categories/20,000 movies,
  and 20 series categories/20,000 series
- exactly 1,000 catalog items in every category
- fixed IDs, timestamps, ratings, names, and one lazy season/episode generated
  from indexes rather than Faker, `Date.now()`, or `Math.random()`
- empty/local-only artwork and direct-source fields
- VOD and series detail records are materialized only on request
- preparation and manifest hashing happen before the timed application request

### Electron Xtream performance benchmark

Run a formal benchmark from a clean worktree with the standard CDP endpoint
available at `127.0.0.1:9222`:

```bash
perf_output="$PWD/dist/performance/$(date -u +%Y%m%dT%H%M%SZ)-xtream"
IPTVNATOR_PERF_OUTPUT_DIR="$perf_output" \
IPTVNATOR_PERF_VARIANT=baseline \
NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
pnpm nx run electron-backend-e2e:benchmark-xtream --skip-nx-cache
```

The target starts an isolated control-enabled mock server on
`127.0.0.1:3221` and uses only the synthetic `performance:performance`
credentials and fixture. It covers initial import, refresh, deletion,
cancellation during import, and navigation/search/UI interaction during a
background operation. Every scenario has one warm-up, five measured
iterations, and one diagnostic iteration. Only the five measured iterations
of a clean formal run can have `validForComparison: true`.

Capture setup and operation measurement are separate boundaries. The harness
first installs and arms the main, renderer, and worker capture infrastructure;
it then starts the main measurement and renderer operation window immediately
before triggering the user operation. Profiler attachment, fixture preparation,
and other setup outside that operation window are not application work. Because
`database.worker` is persistent but created lazily, the harness awaits the
read-only `window.electron.dbGetAppPlaylists()` preload call immediately after
installing main capture. Its result is discarded: this pre-arm only guarantees
that the exact worker can be profiled and happens before seed or measured
capture.

The renderer heartbeat is sampled on a fixed 50 ms deadline grid. One CDP
delivery records every elapsed grid point, and successful capture shutdown
waits for an in-flight delivery before performing one terminal-clipped drain.
The iteration fails closed if the resulting sample count does not cover the
complete operation window; this avoids coordinated omission when renderer work
delays multiple heartbeat deadlines.

Diagnostic profiles are evidence envelopes, not comparison totals. Starting
Chromium tracing and the CPU profilers can add a short pre-trigger setup segment
that contains no application workload; the raw boundary timestamps preserve
that segment explicitly. Formal summaries compare only the five measured runs,
never warm-up or diagnostic totals.

CPU scopes in the summary are intentionally not interchangeable. Electron main
CPU uses `process.threadCpuUsage()` and is labeled
`electron-main-thread`. Database-worker CPU is the sum of thread CPU from valid,
non-overlapping request work and is labeled
`sum-valid-request-thread-cpu`; it is neither process-wide CPU nor a whole-worker
sample.

Scenarios that need an existing portal seed it outside the measured iteration.
Seed completion is authoritative only after a successful
`store.xtream-import-terminal` renderer phase marker, the matching terminal DOM
gate, and two consecutive painted `requestAnimationFrame` frames. The harness
then verifies main-process settlement before rolling over to the measured
capture; merely seeing the catalog or loading overlay disappear is not a seed
terminal.

For an end-to-end wiring check, run smoke mode with one comparison-ineligible
measured iteration per scenario. An unused loopback CDP port may be selected
when the formal port is occupied:

```bash
perf_output="$PWD/dist/performance/$(date -u +%Y%m%dT%H%M%SZ)-xtream-smoke"
IPTVNATOR_PERF_OUTPUT_DIR="$perf_output" \
IPTVNATOR_PERF_VARIANT=smoke \
IPTVNATOR_PERF_SMOKE=1 \
IPTVNATOR_PERF_CDP_PORT=9322 \
NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
pnpm nx run electron-backend-e2e:benchmark-xtream --skip-nx-cache
```

The manifest, summary, per-iteration JSON, traces, CPU profiles, and heap
snapshots stay under the git-ignored `dist/performance/` tree. Never commit
those artifacts, and never substitute real credentials, portal URLs, or
provider data.

---

## Playwright Integration

### Configuration (`apps/web-e2e/playwright.config.ts`)

The mock server is listed as a third `webServer` entry:

```typescript
{
  command: 'pnpm nx run xtream-mock-server:serve',
  url: 'http://localhost:3211/health',
  reuseExistingServer: !process.env['CI'],
  cwd: workspaceRoot,
}
```

### Request Interception

The Angular PWA calls `localhost:3000/xtream?...`. Playwright intercepts these:

```typescript
await page.route('**/localhost:3000/xtream**', async (route) => {
    const originalUrl = new URL(route.request().url());
    const mockUrl = new URL('http://localhost:3211/xtream');
    originalUrl.searchParams.forEach((v, k) => mockUrl.searchParams.set(k, v));
    await route.continue({ url: mockUrl.toString() });
});
```

---

## Extension Points

- **Add new actions**: Implement a handler function and add a `case` in `routes/dispatch.ts`
- **Add new scenarios**: Add an entry to `SCENARIOS` in `scenarios.ts`
- **Add deterministic EPG fixtures**: Extend `ScenarioConfig.epgFixture` and populate `epgListingsByStreamId` in `data-store.ts`
- **Refresh release artwork**: Run `pnpm release:artwork:dry-run`, then
  `OPENAI_API_KEY=... pnpm release:artwork:generate`, inspect the generated PNGs,
  and finish with `pnpm release:artwork:validate`
- **Adjust data volume**: Change `itemsPerCategory`, `seasonsPerSeries`, or `episodesPerSeason` per scenario
- **Custom stream URLs**: Edit the normal-mode HLS stub redirect in
  `app/server.ts`; never enable it for the performance fixture
