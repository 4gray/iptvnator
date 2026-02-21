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

## Key Design Decisions

### Seeded Determinism (Not Per-Request Random)

Per-request random data would break navigation: if category IDs change between calls, content fetched under a category ID won't match the category list. Instead:

- Data is generated **once per MAC address** on first request, then cached in memory.
- `@faker-js/faker` is seeded with a numeric value derived from the MAC address before generation.
- Same MAC → identical data on every server restart.
- Restart the server to reshuffle all data.

### MAC Address as Identity

Stalker portals use MAC address as the primary credential. The mock server follows the same model:

- Each unique MAC gets its own isolated dataset.
- Predefined MACs map to specific `ScenarioConfig` shapes (see `src/app/scenarios.ts`).
- Unknown MACs use the sum of their byte values as a seed, producing unique but deterministic data.

### In-Memory Only

No files or databases are written. All state (generated content + favorites) lives in process memory and resets on server restart. This is intentional — tests should not share state across runs.

## Data Generation Pipeline

```
faker.seed(macToNumber(mac))
│
├── generateCategories('itv', N)  → itvCategories[]
│     └── generateChannels()      → channels Map<categoryId, channel[]>
│           └── generateEpg()     → epg Map<channelId, program[]>
│
├── generateCategories('vod', N)  → vodCategories[]
│     └── generateVodItems()      → vod Map<categoryId, item[]>
│           ├── normal VOD items
│           ├── is_series=1 items (fraction, Ministra flow)
│           └── embedded series[] items (fraction)
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

### `get_ordered_list` (seasons — when `movie_id` is present)

```json
{
  "js": [
    {
      "id": "30001-s1",
      "name": "Season 1",
      "cmd": "ffrt4://series/30001/season/1",
      "series": ["30001-s1-e1", "30001-s1-e2", ...],
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
    "error": ""
  }
}
```

The stream URL is selected from a pool of 4 real public HLS test streams. The choice is deterministic based on the `cmd` field's character sum, so the same item always returns the same stream.

### `get_short_epg`

```json
{
  "js": {
    "data": [
      {
        "id": "1",
        "name": "Channel Name: Program Title",
        "start": "2026-02-21T10:00:00.000Z",
        "stop": "2026-02-21T10:30:00.000Z",
        "start_timestamp": 1740128400,
        "stop_timestamp": 1740130200,
        "descr": "...",
        "category": "News"
      }
    ]
  }
}
```

EPG programs are generated as 30-minute slots spanning 3 hours past to 3 hours future relative to the time of generation.

## Scenarios

Scenarios are defined in `src/app/scenarios.ts`. Each scenario is a `ScenarioConfig`:

```typescript
interface ScenarioConfig {
  name: string;
  description: string;
  seed: number;
  categoryCount: { itv: number; vod: number; series: number };
  itemsPerCategory: number;
  seasonsPerSeries: number;
  episodesPerSeason: number;
  isSeriesFraction: number;      // 0–1: fraction of VOD with is_series=1
  embeddedSeriesFraction: number; // 0–1: fraction of VOD with embedded series[]
}
```

### Adding a New Scenario

1. Add an entry to the `SCENARIOS` map in `src/app/scenarios.ts`.
2. Use any unique MAC address as the key (lowercase, colon-separated).
3. Document it in `README.md` and this file.

## Favorites

Favorites are stored in a `Map<mac, Set<itemId>>` in `src/app/data-store.ts`. They persist for the lifetime of the server process and are shared across all requests for the same MAC.

Call `POST /reset` to clear all favorites (and regenerated data) between test runs.

## Playwright Integration

`apps/web-e2e/playwright.config.ts` registers the mock server as a second `webServer` entry:

```typescript
webServer: [
  {
    command: 'pnpm nx run web:serve',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
  },
  {
    command: 'pnpm nx run stalker-mock-server:serve',
    url: 'http://localhost:3210/health',
    reuseExistingServer: !process.env['CI'],
  },
]
```

Playwright waits for both servers to be healthy before starting tests. If either is already running (e.g. in local dev), it reuses the existing instance.

### Test Isolation

Each stalker e2e test calls `POST http://localhost:3210/reset` in `beforeEach` to clear in-memory state. This ensures tests don't bleed favorites or other mutable state into each other.

The generated content (categories, items) is **not** cleared on reset — it's deterministic and doesn't need to be. Only in-memory favorites are cleared.

### Recommended Test Structure

```typescript
import { test, expect } from '@playwright/test';

const MOCK_URL = 'http://localhost:3210/portal.php';
const MOCK_MAC = '00:1A:79:00:00:01'; // default scenario

test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:3210/reset');
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
- **Stateful session tokens**: `handshake.handler.ts` generates a token from the MAC — extend this to track token expiry for testing re-auth flows.
- **Error simulation**: Add a special MAC or query param to trigger error responses (e.g. 401, 500) for testing error handling in the Stalker store.
- **Slow responses**: Add a `MOCK_DELAY_MS` env var and apply it in middleware for testing loading states.
