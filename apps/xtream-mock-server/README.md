# Xtream Codes Mock Server

A lightweight Express server that simulates the Xtream Codes API for local
development and end-to-end testing. Uses `@faker-js/faker` with deterministic
seeding so every credential pair always produces the same data.

---

## Quick Start

```bash
# Start on port 3211
pnpm nx run xtream-mock-server:serve

# Start with file-watch (auto-restart on code changes)
pnpm nx run xtream-mock-server:serve-with-watch
```

---

## Available Scenarios (credential pairs)

| Username | Password | Scenario | Live cats | VOD cats | Series cats | Items/cat | Status |
|----------|----------|----------|-----------|----------|-------------|-----------|--------|
| `user1` | `pass1` | default | 8 | 8 | 8 | 40 | active |
| `large` | `large` | large catalog | 20 | 20 | 20 | 200 | active |
| `series` | `series` | series-heavy | 3 | 4 | 15 | 30 | active |
| `minimal` | `minimal` | minimal (edge cases) | 2 | 2 | 2 | 5 | active |
| `expired` | `expired` | expired account | 4 | 4 | 4 | 10 | Expired |
| `inactive` | `inactive` | disabled account | 4 | 4 | 4 | 10 | Disabled |

Any other credential pair is auto-generated using a hash of `username:password` as the faker seed (6 categories, 30 items each, active account).

---

## API Endpoints

### Direct Xtream Protocol

`GET /player_api.php?action=<action>&username=<u>&password=<p>[&...]`

| Action | Description |
|--------|-------------|
| (none) / `get_account_info` | User info + server info |
| `get_live_categories` | Live TV categories |
| `get_vod_categories` | VOD (movie) categories |
| `get_series_categories` | Series categories |
| `get_live_streams` | Live streams (optionally filtered by `category_id`) |
| `get_vod_streams` | VOD streams (optionally filtered by `category_id`) |
| `get_series` | Series list (optionally filtered by `category_id`) |
| `get_vod_info?vod_id=<id>` | Full movie details |
| `get_series_info?series_id=<id>` | Full series info (seasons + episodes) |
| `get_short_epg?stream_id=<id>[&limit=N]` | EPG listings for a live channel |

### PWA CORS Proxy Endpoint

IPTVnator's PWA routes Xtream calls through a backend proxy:
```
GET /xtream?url=<serverUrl>&action=<action>&username=<u>&password=<p>
```
Response: `{ payload: <data>, action: <action> }`

### Stream URLs (stub redirects)

```
GET /live/<username>/<password>/<streamId>.m3u8  → HLS test stream
GET /movie/<username>/<password>/<streamId>.<ext> → HLS test stream
GET /series/<username>/<password>/<streamId>.<ext> → HLS test stream
```

### Utility Endpoints

```
GET  /health   → { status: "ok", server: "xtream-mock-server", port: 3211 }
POST /reset    → clears all in-memory caches; data regenerates on next request
```

---

## Example Requests

```bash
# Account info (direct)
curl "http://localhost:3211/player_api.php?username=user1&password=pass1"

# Live categories (direct)
curl "http://localhost:3211/player_api.php?username=user1&password=pass1&action=get_live_categories"

# VOD details (direct)
curl "http://localhost:3211/player_api.php?username=user1&password=pass1&action=get_vod_info&vod_id=20000"

# Series info (direct)
curl "http://localhost:3211/player_api.php?username=user1&password=pass1&action=get_series_info&series_id=30000"

# EPG for stream (direct)
curl "http://localhost:3211/player_api.php?username=user1&password=pass1&action=get_short_epg&stream_id=10000"

# Via PWA proxy
curl "http://localhost:3211/xtream?url=http://localhost:3211&username=user1&password=pass1&action=get_live_categories"
```

---

## Playwright Integration

The mock server starts automatically with `nx e2e web-e2e`. Run only Xtream
tests using the `@xtream` tag:

```bash
nx e2e web-e2e --grep "@xtream"
```

Test files: `apps/web-e2e/src/xtream.e2e.ts`

The Playwright tests use `page.route()` to redirect the app's backend proxy
calls (`localhost:3000/xtream**`) to the mock server without modifying any
application code.

---

## Data Characteristics

- **Deterministic**: Same credentials → same data every time (seeded faker)
- **Cached per session**: Data generated once on first request, reused until `/reset`
- **EPG**: Titles and descriptions are base64-encoded (matches real Xtream API)
- **Stream IDs**: Live 10,000+, VOD 20,000+, Series 30,000+
- **Category IDs**: Live 101+, VOD 201+, Series 301+

---

## Architecture

See `docs/architecture/xtream-mock-server.md` for a full description of the
data pipeline, response shapes, and extension points.
