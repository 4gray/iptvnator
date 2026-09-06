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

# Start the mock server plus the Electron app
pnpm run serve:marketing-demo

# Start the mock server plus the browser web app
pnpm run serve:marketing-demo:web
```

---

## Local Performance Mode

The benchmark control plane is opt-in and binds only to an explicit loopback
address. Use a dedicated port; do not reuse the normal E2E server on `3211`.

```bash
HOST=127.0.0.1 \
PORT=3221 \
IPTVNATOR_XTREAM_MOCK_CONTROL=1 \
IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN=local-benchmark-token \
pnpm nx run xtream-mock-server:serve
```

When enabled, every `/__control/*` request requires the exact
`x-iptvnator-performance-token` header, including `OPTIONS` preflight
requests. The server refuses non-loopback binds and an empty token. The control
routes do not exist when the flag is absent or is any value other than `1`.
The Nx serve targets preserve an explicit shell `PORT`; when it is omitted, the
server parser still defaults to `3211`.

Prepare the fixed synthetic fixture before starting a capture:

```bash
curl -X POST http://127.0.0.1:3221/__control/prepare \
  -H 'content-type: application/json' \
  -H 'x-iptvnator-performance-token: local-benchmark-token' \
  -d '{"scenario":"performance-100k"}'
```

The response contains only `epoch`, `scenario`, `seed`, `counts`, `bytes`, and
`catalogSha256`. `counts.categories` is `60/20/20` live/VOD/series (100 total)
and `counts.items` is `60000/20000/20000` (100,000 total). `bytes` and the
SHA-256 cover fixed-order UTF-8 JSON containing, in order, the live, VOD, and
series category arrays followed by the live, VOD, and series catalogs. The hash
input contains no credentials or server origin.

Control endpoints:

| Method | Path                              | Purpose                                                                |
| ------ | --------------------------------- | ---------------------------------------------------------------------- |
| POST   | `/__control/prepare`              | Materialize `performance-100k` and return its safe manifest            |
| POST   | `/__control/reset`                | Reset `observations` or `all` state                                    |
| POST   | `/__control/barriers`             | Add a one-shot, abort-aware request barrier                            |
| POST   | `/__control/barriers/:id/release` | Release a request that reached a barrier                               |
| POST   | `/__control/delays`               | Add a one-shot delay of `0..5000` ms for control/smoke tests only      |
| GET    | `/__control/state`                | Read bounded rules, held IDs, occurrences, lifecycle ledger, and epoch |

Rules match the exact tuple
`(epoch, scenario, transport, action, categoryId, occurrence)`. Occurrences are
counted independently per tuple without `occurrence`, so parallel category
arrival order cannot change which rule matches. Empty Xtream actions are
recorded as `get_account_info`; unknown actions are recorded only as `unknown`.
Numeric category IDs use canonical decimal spelling: signs, whitespace,
leading zeroes, non-decimal notation, and unsafe integers are rejected. The
state never includes the token, credentials, raw URL/query, response payloads,
titles, or catalog arrays.

`reset` with mode `observations` clears rules, occurrences, held requests, and
the ledger while preserving the prepared manifest and epoch. Mode `all` also
clears fixture caches and the prepared manifest, then increments the epoch.
Held clients are settled during either reset. The legacy unauthenticated
`POST /reset` returns `410` in performance mode so it cannot invalidate fixture
caches without also invalidating the prepared control manifest; use the
token-authenticated control reset instead.

JSON bodies are strict and limited to 16 KiB. A state epoch accepts at most 32
rules; the ledger retains 128 entries, and occurrence state has 512 slots for
the complete allowlisted identity domain without eviction or counter restart.
Duplicate IDs/matches, past occurrences, arbitrary scenarios/actions/category
IDs, unknown fields, and invalid delays are rejected.

Performance mode is local-only: `/playlist.m3u` and every performance-fixture
stream/timeshift URL return `410` without redirecting or contacting external
media. Barriers and delays are coordination tools, not timing inputs.
**Formal benchmark captures must start with zero barrier and delay rules.**

---

## Available Scenarios (credential pairs)

| Username      | Password      | Scenario               | Live cats | VOD cats | Series cats | Items/cat | Status   |
| ------------- | ------------- | ---------------------- | --------- | -------- | ----------- | --------- | -------- |
| `user1`       | `pass1`       | default                | 8         | 8        | 8           | 40        | active   |
| `large`       | `large`       | large catalog          | 20        | 20       | 20          | 200       | active   |
| `stress`      | `stress`      | stress catalog         | 16        | 16       | 16          | 120       | active   |
| `performance` | `performance` | performance-100k       | 60        | 20       | 20          | 1,000     | active   |
| `series`      | `series`      | series-heavy           | 3         | 4        | 15          | 30        | active   |
| `minimal`     | `minimal`     | minimal (edge cases)   | 2         | 2        | 2           | 5         | active   |
| `epg`         | `epg`         | EPG fixture            | 2         | 1        | 1           | 3         | active   |
| `emptyvod`    | `emptyvod`    | empty VOD metadata     | 2         | 2        | 2           | 5         | active   |
| `marketing`   | `marketing`   | fictional release demo | 4         | 4        | 4           | curated   | active   |
| `marketing2`  | `marketing2`  | same catalog, 2nd copy | 4         | 4        | 4           | curated   | active   |
| `multisrc1`   | `multisrc1`   | multi-source portal A  | 1         | 2        | 1           | 5         | active   |
| `multisrc2`   | `multisrc2`   | multi-source portal B  | 1         | 2        | 1           | 5         | active   |
| `expired`     | `expired`     | expired account        | 4         | 4        | 4           | 10        | Expired  |
| `inactive`    | `inactive`    | disabled account       | 4         | 4        | 4           | 10        | Disabled |

Any other credential pair is auto-generated using a hash of `username:password` as the faker seed (6 categories, 30 items each, active account).

`multisrc1` and `multisrc2` deliberately share one faker seed, so both portals
generate an identical catalog. That overlap is what the VOD multi-source E2E
needs — the same movie present in two different playlists.

---

## API Endpoints

### Direct Xtream Protocol

`GET /player_api.php?action=<action>&username=<u>&password=<p>[&...]`

| Action                                   | Description                                         |
| ---------------------------------------- | --------------------------------------------------- |
| (none) / `get_account_info`              | User info + server info                             |
| `get_live_categories`                    | Live TV categories                                  |
| `get_vod_categories`                     | VOD (movie) categories                              |
| `get_series_categories`                  | Series categories                                   |
| `get_live_streams`                       | Live streams (optionally filtered by `category_id`) |
| `get_vod_streams`                        | VOD streams (optionally filtered by `category_id`)  |
| `get_series`                             | Series list (optionally filtered by `category_id`)  |
| `get_vod_info?vod_id=<id>`               | Full movie details                                  |
| `get_series_info?series_id=<id>`         | Full series info (seasons + episodes)               |
| `get_short_epg?stream_id=<id>[&limit=N]` | EPG listings for a live channel                     |
| `get_simple_data_table?stream_id=<id>`   | Full per-channel EPG schedule                       |
| `get_simple_date_table?stream_id=<id>`   | Legacy typo alias for full per-channel EPG schedule |

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

# Full EPG schedule (direct)
curl "http://localhost:3211/player_api.php?username=epg&password=epg&action=get_simple_data_table&stream_id=10000"

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

Electron Xtream EPG coverage lives in
`apps/electron-backend-e2e/src/xtream-epg.e2e.ts`.

The Playwright tests use `page.route()` to redirect the app's backend proxy
calls (`localhost:3000/xtream**`) to the mock server without modifying any
application code.

---

## Data Characteristics

- **Deterministic**: Same credentials → same data every time (seeded faker)
- **Cached per session**: Data generated once on first request, reused until `/reset`
- **EPG**: Titles and descriptions are base64-encoded (matches real Xtream API)
- **Dedicated EPG fixture**: `epg:epg` returns stable live channels plus deterministic `get_short_epg` and `get_simple_data_table` payloads for timezone-focused tests
- **Release screenshot fixture**: `marketing:marketing` returns fictional live, VOD, and series data with local generated artwork under `apps/xtream-mock-server/public/marketing`
- **Alternative-source fixture**: `marketing2:marketing2` returns the identical marketing catalog under a second credential pair, so a movie added from both looks like the same film in two playlists (the premise of the VOD multi-source chip); guide screenshots seed it as a "backup subscription"
- **Local download media**: `marketing:marketing` also serves `/movie/...`, `/series/...` and `/live/...` stream URLs from generated bytes (`downloadStreamFixture: 'local-media'`; movies finish in under a second, episodes trickle for about 20 s) so release and guide screenshots of the download manager complete without any request leaving the machine. Other scenarios keep redirecting streams to the public HLS stub.
- **Performance fixture**: `performance:performance` returns exactly 100,000
  local-only catalog items from index-derived values; it does not use Faker,
  `Date.now()`, `Math.random()`, external artwork, or external media URLs
- **Timestamp precedence coverage**: The `epg:epg` scenario intentionally shifts raw `start` / `end` strings away from `start_timestamp` / `stop_timestamp` so UI tests can prove timestamps drive rendering
- **Stream IDs**: Live 10,000+, VOD 20,000+, Series 30,000+
- **Category IDs**: Live 101+, VOD 201+, Series 301+

---

## Release Demo Artwork

The `marketing:marketing` fixture uses 65 original fictional titles for release
screenshots. Its core 30-title artwork pack includes matched posters and
backdrops; 35 additional movie-poster showcase titles use approved local poster
PNGs and the deterministic SVG fallback for missing backdrops. The newest 20
showcase movies are ordered first so they appear immediately in screenshot
catalog grids. Assets are served from:

```text
apps/xtream-mock-server/public/marketing/{poster,backdrop}/
```

Generate or validate those assets with:

```bash
pnpm release:artwork:dry-run
pnpm release:artwork:generate
pnpm release:artwork:validate
```

`release:artwork:generate` uses `gpt-image-2` through the OpenAI Image API and
requires `OPENAI_API_KEY`. The screenshot capture workflow only reads committed
local assets; it does not call OpenAI. If a local PNG is missing, the mock
server falls back to its deterministic SVG renderer for development continuity.
The prompt manifest deliberately varies genres and visual media across titles
so the catalog does not collapse into one superhero/poster style.

---

## Architecture

See `docs/architecture/xtream-mock-server.md` for a full description of the
data pipeline, response shapes, and extension points.
