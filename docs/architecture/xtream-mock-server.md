# Xtream Mock Server — Architecture

## Purpose

`apps/xtream-mock-server` is a self-contained Express server that emulates the
Xtream Codes API protocol. It is used for:

- **Local development** — run a full portal without a real Xtream subscription
- **E2E testing** — Playwright spins it up alongside the Angular dev server

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
        ▼
  generateCategories()     ←── live / vod / series categories
        │
  generateLiveStreams()     ←── live TV stream list
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
├── project.json                  ← Nx targets: serve (port 3211), serve-with-watch
├── tsconfig.json
└── src/
    ├── main.ts                   ← Express app bootstrap, all routes wired up
    └── app/
        ├── scenarios.ts          ← Credential → ScenarioConfig mapping
        ├── data-store.ts         ← Lazy cache, per-credentials generation
        ├── generators/
        │   ├── categories.generator.ts
        │   ├── live.generator.ts   ← Live streams + EPG listings
        │   ├── vod.generator.ts    ← VOD streams + VodDetails
        │   └── series.generator.ts ← Series items + SeriesInfo
        ├── handlers/
        │   ├── get-account-info.handler.ts
        │   ├── get-categories.handler.ts   ← live/vod/series categories
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

### Stream stub endpoints

```
GET /live/<username>/<password>/<streamId>.m3u8
GET /movie/<username>/<password>/<streamId>.<ext>
GET /series/<username>/<password>/<streamId>.<ext>
```

All redirect to a publicly available HLS test stream
(`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`).

---

## Key Response Shapes

### `get_account_info`

```json
{
  "user_info": {
    "username": "user1", "password": "pass1",
    "status": "active", "exp_date": "4102444799",
    "is_trial": "0", "active_cons": "1", "max_connections": "2",
    "allowed_output_formats": ["m3u8", "ts", "rtmp"]
  },
  "server_info": {
    "url": "http://localhost:3211", "port": "3211",
    "timezone": "UTC", "timestamp_now": 1234567890
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
  "num": 1, "name": "Acme Corp TV",
  "stream_type": "live", "stream_id": 10000,
  "stream_icon": "https://picsum.photos/seed/live-10000/100/100",
  "epg_channel_id": "channel-10000.mock",
  "category_id": "101", "tv_archive": 0, "tv_archive_duration": 0
}
```

### `get_short_epg` (sample item)

```json
{
  "epg_listings": [
    {
      "id": "1000000", "epg_id": "channel-10000.mock",
      "title": "base64encodedTitle",
      "description": "base64encodedDescription",
      "start": "2024-01-01 12:00:00", "end": "2024-01-01 12:30:00",
      "start_timestamp": "1704110400", "stop_timestamp": "1704112200"
    }
  ]
}
```

Note: `title` and `description` are **base64-encoded**, matching the real Xtream API.

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

| Key (`username:password`) | Seed | Categories | Items/cat | Account status |
|---------------------------|------|------------|-----------|----------------|
| `user1:pass1` | 1001 | 8 each | 40 | active |
| `large:large` | 9999 | 20 each | 200 | active |
| `series:series` | 2002 | live:3, vod:4, series:15 | 30 | active |
| `minimal:minimal` | 3003 | 2 each | 5 | active |
| `expired:expired` | 4004 | 4 each | 10 | Expired |
| `inactive:inactive` | 5005 | 4 each | 10 | Disabled |
| `<any other>` | hash | 6 each | 30 | active |

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
- **Adjust data volume**: Change `itemsPerCategory`, `seasonsPerSeries`, or `episodesPerSeason` per scenario
- **Custom stream URLs**: Edit the HLS stub redirect in `main.ts`
