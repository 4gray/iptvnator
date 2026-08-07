# Stalker Mock Server Architecture

This document describes the design decisions, data flow, and extension points of the `stalker-mock-server` development tool.

## Related Docs

- [Stalker Portal Architecture](./stalker-portal.md)
- [Stalker EPG Architecture](./stalker-epg.md)

## Purpose

The mock server enables:

1. **Local development** without access to a real Stalker portal
2. **Playwright E2E testing** with predictable, deterministic data
3. **Scenario-based testing** via predefined MAC addresses that map to specific data shapes
4. **Screenshot-safe marketing capture** with committed fictional posters shared with the Xtream mock

## Key Design Decisions

### Seeded Determinism (Not Per-Request Random)

Per-request random data would break navigation: if category IDs change between calls, content fetched under a category ID won't match the category list. Instead:

- Data is generated **once per MAC address** on first request, then cached in memory.
- `@faker-js/faker` is seeded with the scenario's `seed` value before generation: predefined scenario MACs use fixed seeds from `scenarios.ts`; unknown MACs derive the seed from the MAC via `macToSeed()`.
- Same MAC → identical data on every server restart.
- Restart the server to reshuffle all data.

### MAC Address as Identity

Stalker portals use MAC address as the primary credential. The mock server follows the same model:

- Each unique MAC gets its own isolated dataset.
- Predefined MACs map to specific `ScenarioConfig` shapes (see `src/app/scenarios.ts`).
- Unknown MACs use the sum of their byte values as a seed, producing unique but deterministic data.

### In-Memory Only

No files or databases are written. All state (generated content + favorites + portal sessions) lives in process memory and resets on server restart. This is intentional — tests should not share state across runs.

### Endpoints With Different Strictness

The app classifies a portal by observed behavior, not by URL shape: endpoint
discovery (see `docs/architecture/stalker-portal.md`, "Portal Mode and
Endpoint Discovery") probes candidates at import and on lazy repair, treating
a token-less content request that returns data as a token-free panel and the
middleware's plain-text auth failure as a token-enforcing full portal. The
mock serves the same action set at several paths so every classification
branch is exercisable:

| Path | Router | Behaviour |
|---|---|---|
| `/portal.php` | `createPortalRouter(false)` | Tolerant: ignores the token and the MAC format, like most reseller panels |
| `/stalker_portal/server/load.php` | `createPortalRouter(true)` | Strict: enforces both, like the real middleware |
| `/server/load.php` | `createPortalRouter(true)` | Strict: the bare canonical Ministra shape, enforced identically |
| `/ministra/server/load.php` | `createPortalRouter(true)` | Strict; the `/ministra/*` prefix has **no portal.php** (404s like genuine Ministra), so `/ministra/c` proves the probe's 404 fallthrough |

The `/stalker` proxy route applies the same rule through
`isFullPortalUrlShape()` — every URL the client would authenticate against is
enforced, so tests cannot silently fall into the tolerant branch.

Keeping the tolerant path is what lets the pre-existing e2e suite (which imports
`portal.php`) stay meaningful — it covers the simple-portal branch — while the
strict path finally covers the authenticated branch that had no coverage at all.

The strict behaviours mirror the plaintext Stalker 4.9.35 middleware
(`server/lib/stb.class.php`), the last openly readable ancestor of the encoded
5.x core:

- **Plain-text auth failures.** `Authorization failed.` / `Unauthorized request.`
  are returned with **HTTP 200** and a `text/html` body, because the real server
  `exit`s before the JSON envelope is built. A client checking only status codes
  sees "success" and renders nothing. The `/stalker` proxy route still wraps the
  body in the `{ payload }` envelope, matching what `apps/web-backend` does.
- **A handshake is not a session.** The token only authorizes requests once
  `get_profile` has adopted it for that MAC. Adoption is deliberately
  *stricter* than the stock server: 4.9.35 issues handshake tokens statelessly
  and pins whatever Bearer `get_profile` presents, so a forged token would
  become a session on a real portal — the mock only adopts tokens it actually
  issued, so a client with a broken token pipeline fails loudly in tests.
- **Idempotent handshake.** Presenting the MAC's current token returns that same
  token, which is what allows real clients to persist tokens across restarts.
- **Device-id pinning.** `device_id`/`device_id2` are stored on first non-empty
  value; any later change — including reverting to empty — is a permanent
  `device conflict` carrying the "Your STB is damaged." block message. This is
  the only identity check the stock server actually enforces.
- **`signature`, `metrics`, `prehash` are ignored**, exactly as upstream ignores
  them; they exist for portals with a custom `access_filter.php`.
- **MAC format validation.** Non-Infomir MACs (`00:1A:79:XX:XX:XX`) get a bare
  `{ status: 1 }` from `get_profile`.

- **`do_auth` is a boolean login step.** Non-empty credentials answer
  `{js:true}` and are recorded; the `login-required` scenario's `get_profile`
  keeps answering `status: 2` until that record exists, because the app sends
  `auth_second_step=1` on its very first profile request and a parameter check
  alone would be trivially bypassed.

Session state lives in `src/app/auth-store.ts` and is cleared by `/reset`.
`POST /invalidate-session?macAddress=<mac>` drops a single MAC's tokens so
tests can assert the client re-handshakes and retries instead of surfacing an
error; pinned device identity survives invalidation, as it does on a real
portal.

Beside the portal endpoints, `main.ts` mounts a handful of non-portal routes:
`GET /stalker` (the PWA CORS-proxy mirror), `GET /stream/gated/:file` (the
credential-gated media fixtures for the `gated-stream` scenario),
`GET /assets/marketing/poster/*` (the committed screenshot-safe posters) and
the `/health` + `/reset` + `/invalidate-session` utilities. The full list with
request shapes is in `apps/stalker-mock-server/README.md`.

## Data Generation Pipeline

```
faker.seed(config.seed)   // scenario seed; unknown MACs: macToSeed(mac)
│
├── generateCategories('itv', N)  → itvCategories[]
│     └── generateChannels()      → channels Map<categoryId, channel[]>
│           └── generateEpg()     → epg Map<channelId, program[]>
│
├── generateCategories('radio', N) → radioCategories[]
│     └── generateRadioStations()  → radio Map<categoryId, station[]>
│
├── generateCategories('vod', N)  → vodCategories[]
│     └── generateVodItems()      → vod Map<categoryId, item[]>
│           ├── normal VOD items
│           ├── is_series=1 items (fraction, Ministra flow)
│           └── embedded series[] items (fraction)
│
├── marketingFixture?             → shared curated VOD catalog
│     ├── @iptvnator/shared/marketing-fixtures
│     ├── vod Map<categoryId, item[]>
│     └── vodOrder[] preserves screenshot catalog order
│
└── generateCategories('series', N) → seriesCategories[]
      └── generateSeriesItems()    → series Map<categoryId, item[]>
            └── generateSeasons()  → seasons Map<seriesItemId, season[]>
```

## Response Shapes

All responses follow the Stalker `portal.php` envelope:

```json
{ "js": <action-specific payload> }
```

### `get_categories`

```json
{
  "js": [
    { "id": "2001", "title": "Action", "alias": "action" },
    ...
  ]
}
```

### `get_ordered_list` (content)

```json
{
  "js": {
    "data": [
      {
        "id": "20001",
        "name": "...",
        "cmd": "ffrt4://vod/20001/index.m3u8",
        "screenshot_uri": "https://picsum.photos/seed/vod-20001/300/200",
        "cover": "https://picsum.photos/seed/vod-cover-20001/300/450",
        "description": "...",
        "actors": "...",
        "director": "...",
        "year": "2019",
        "rating_imdb": "7.3",
        "category_id": "2001",
        "is_series": 0,
        "has_files": 1
      }
    ],
    "total_items": 40,
    "max_page_items": 14,
    "cur_page": 1,
    "total_pages": 3
  }
}
```

For `type=radio`, items use the same paginated response envelope as live TV
channels, but each item is generated as a radio station with a `radio: true`
marker and an `ffrt4://radio/...` command.

### `get_ordered_list` (seasons — when `movie_id` is present)

```json
{
  "js": [
    {
      "id": "30001-s1",
      "name": "Season 1",
      "cmd": "ffrt4://series/30001/season/1",
      "series": ["1", "2", "3", ...],
      "screenshot_uri": "https://picsum.photos/seed/30001-s1/300/200",
      "director": "...",
      "actors": "...",
      "year": "2021",
      "rating_imdb": "8.1"
    }
  ]
}
```

### `create_link`

```json
{
  "js": {
    "cmd": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    "streamer_id": "1",
    "load": "",
    "error": "",
    "cmd_received": "ffrt4://ch/live/1001/index.m3u8",
    "query_keys_received": ["JsHttpRequest", "action", "cmd", "type"]
  }
}
```

The stream URL is selected from a pool of 4 real public HLS test streams. The choice is deterministic based on the `cmd` field's character sum, so the same item always returns the same stream.

`cmd_received` and `query_keys_received` are mock-only diagnostics (a real
portal does not send them): they echo the request's `cmd` after Express' single
query decode — the same view a PHP portal gets from `$_GET` — plus the sorted
set of query keys. E2E uses them to pin the client's `cmd` wire contract: no
double-encoding, and no query-parameter injection through `cmd`.

### `get_short_epg`

```json
{
  "js": {
    "data": [
      {
        "id": "1",
        "name": "Channel Name: Program Title",
        "start": "2026-02-21T10:00:00.000Z",
        "stop": "2026-02-21T12:00:00.000Z",
        "start_timestamp": 1740128400,
        "stop_timestamp": 1740135600,
        "descr": "...",
        "category": "News"
      }
    ]
  }
}
```

`get_short_epg` returns the current program and upcoming items from the
generated schedule, limited by the requested `size`.

### `get_epg_info`

```json
{
  "js": {
    "data": {
      "10000": [
        {
          "id": "1",
          "name": "Channel Name: Program Title",
          "start": "2026-02-21T10:00:00.000Z",
          "stop": "2026-02-21T12:00:00.000Z",
          "start_timestamp": 1740128400,
          "stop_timestamp": 1740135600,
          "descr": "...",
          "category": "News"
        }
      ]
    }
  }
}
```

`get_epg_info` returns bulk EPG keyed by channel id and filters the generated
7-day schedule from the current UTC day start through `now + period`.

EPG programs are generated as 2-hour slots across 7 days for each channel,
starting at the current UTC day boundary.

## Scenarios

Scenarios are defined in `src/app/scenarios.ts`. Each scenario is a `ScenarioConfig`:

```typescript
interface ScenarioConfig {
  name: string;
  description: string;
  seed: number;
  categoryCount: { itv: number; radio: number; vod: number; series: number };
  itemsPerCategory: number;
  seasonsPerSeries: number;
  episodesPerSeason: number;
  isSeriesFraction: number;      // 0–1: fraction of VOD with is_series=1
  embeddedSeriesFraction: number; // 0–1: fraction of VOD with embedded series[]
  supportsGetAllChannels?: boolean; // default true; false mimics legacy portals
                                    // without the ITV get_all_channels action
  marketingFixture?: true;          // replace generated VOD with shared posters
  requiresLogin?: true;             // get_profile answers status 2 until do_auth
  gatedStream?: true;               // create_link returns a credential-gated URL
  staticChannelCmd?: true;          // ITV rows need no temporary link
}
```

The `legacy-pagination` scenario (`00:1A:79:00:00:06`) sets
`supportsGetAllChannels: false`: `get_all_channels` then answers with an error
payload so clients fall back to the paginated `get_ordered_list` crawl. For
supporting scenarios, `get_all_channels` (`get-all-channels.handler.ts`,
`type=itv` only) returns the complete ITV channel list in one
`{ js: { data, total_items } }` response, excluding channels from censored
(adult) genres.

The login-required scenario also recognizes
`00:1A:79:AE:<slot>:02`. This test-only alias range preserves the same
`status: 2`/`do_auth` contract while giving concurrent Playwright parallel
slots independent per-MAC auth state.

The `marketing-demo` scenario (`00:1A:79:00:00:07`) replaces faker-generated
VOD with the 35-movie provider-neutral showcase catalog from
`@iptvnator/shared/marketing-fixtures`. Its newest 20 movies are returned first
for the wildcard VOD listing. Fixtures keep deployment-neutral poster paths,
then the JSON middleware resolves them against the request origin (including
forwarded host/protocol) as
`<portal-origin>/assets/marketing/poster/<slug>.png`. `main.ts` serves the
committed PNG directory directly, so the Xtream server does not need to run.

Every generated ITV channel and radio station carries `use_http_tmp_link` and
`use_load_balancing`, the flags a real portal uses to tell a client whether the
row needs `create_link`. They are `'1'`/`'0'` for the default generators —
honest, because those rows carry `ffrt4://…` pseudo-URLs. The
`static-channel-cmd` scenario (`00:1A:79:00:00:0A`) sets `staticChannelCmd`,
which gives ITV rows both flags at `'0'` and a real
`ffrt3 https://…m3u8` command, so `apps/web-e2e/src/stalker.e2e.ts` can assert
that no `create_link` request reaches the portal. See
`docs/architecture/stalker-portal.md`, "Playback Link Resolution".

### Adding a New Scenario

1. Add an entry to the `SCENARIOS` map in `src/app/scenarios.ts`.
2. Use any unique MAC address as the key (lowercase, colon-separated).
3. Document it in `README.md` and this file.

## Favorites

Favorites are stored in a `Map<mac, Set<itemId>>` in `src/app/data-store.ts`. They persist for the lifetime of the server process and are shared across all requests for the same MAC.

Call `POST /reset?macAddress=<mac>` to clear a MAC's favorites (and its cached
generated data) between test runs — see "Test Isolation" for why the scoped
form is the one specs should use.

## Playwright Integration

`apps/web-e2e/playwright.config.ts` registers the mock server as a second `webServer` entry:

```typescript
webServer: [
  { command: webServerCommand /* web:serve */, url: baseURL },
  {
    command: 'pnpm nx run stalker-mock-server:serve',
    url: `http://localhost:${process.env['MOCK_PORT'] ?? '3210'}/health`,
    reuseExistingServer: !process.env['CI'],
  },
  // plus the xtream mock (3211) and web-backend (3333) entries
]
```

Playwright waits for every server to be healthy before starting tests. If one is already running (e.g. in local dev), it reuses the existing instance.

**`MOCK_PORT` moves the CLIENT side only** — Playwright's health-check URL and
the `MOCK_SERVER` constants in the specs. The server's own port comes from
`PORT` (`main.ts`), which the `serve` and `serve-with-watch` targets pin to
`3210` in `project.json`, and nothing maps one variable to the other. Setting
`MOCK_PORT` alone therefore points Playwright at a port nothing is listening
on and the run times out waiting for `/health`. It is only useful against a
mock you started yourself on that port (`reuseExistingServer` is on outside
CI); relocating the Nx-managed one would need `MOCK_PORT` passed through as
`PORT`.

### Test Isolation

Mock state is keyed by MAC and one mock-server process is shared by every spec
file running in parallel workers, so isolation is per-MAC rather than global:

- `POST /reset` accepts one or more `?macAddress=` params and clears only those
  MACs. A bare `POST /reset` clears everything and is only safe when nothing
  else is talking to the server — a spec that used it would wipe a sibling
  spec's session mid-test.
- `apps/web-e2e/src/stalker.e2e.ts` declares its shared scenario MACs in
  `OWNED_MACS` and clears them in one batched request. The sibling specs that
  reach this server (`self-hosted.e2e.ts`, the `sources-pwa` helpers) own a
  disjoint `00:1A:79:5F:*` range, so neither file can clear the other's state.
- Within each browser project, tests deliberately share content-scenario MACs
  (their fixture shapes are what the assertions are written against), so the
  file uses `test.describe.configure({ mode: 'serial' })`.
- Authentication tests whose assertions span multiple requests derive a
  disjoint `00:1A:79:AE:<slot>:*` range from Playwright's bounded
  `parallelIndex`. Their `beforeEach` adds only the current parallel slot's
  range to the batched reset, so browser projects cannot clear one another's
  token, login completion, invalidated session or pinned device identity; a
  restarted worker retains the same slot instead of consuming a wider MAC
  value.

A reset drops the generated content cache, favorites (`data-store.ts`), the
auth/session record (`auth-store.ts`, including any pinned device identity) and
the watchdog ping counters. Because generation is seed-deterministic, the next
request regenerates identical content, so the observable data does not change
across resets.

### Recommended Test Structure

```typescript
import { test, expect } from '@playwright/test';

const MOCK_URL = 'http://localhost:3210/portal.php';
const MOCK_MAC = '00:1A:79:00:00:01'; // default scenario
const OWNED_MACS = [MOCK_MAC];

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
  // Scoped reset: only the MACs this file owns.
  const query = OWNED_MACS.map(
    (mac) => `macAddress=${encodeURIComponent(mac)}`
  ).join('&');
  await request.post(`http://localhost:3210/reset?${query}`);
});

test('browse VOD categories', async ({ page }) => {
  // Add portal via UI or programmatically via IndexedDB
  // Navigate to portal
  // Assert category list matches expected count (8 for default scenario)
});
```

## Extension Points

- **New content types**: Add a new generator function in `data-generator.ts` and a new handler in `handlers/`.
- **New scenarios**: Add to `SCENARIOS` in `scenarios.ts`.
- **Session behaviour**: `auth-store.ts` owns tokens and device pinning. Add TTLs or a "token replaced by another device" mode there rather than in the handlers.
- **Error simulation**: Add a special MAC or query param to trigger error responses for testing error handling in the Stalker store. Note that portal-level auth errors are *not* HTTP errors — see [Endpoints With Different Strictness](#endpoints-with-different-strictness).
- **Slow responses**: Add a `MOCK_DELAY_MS` env var and apply it in middleware for testing loading states.
