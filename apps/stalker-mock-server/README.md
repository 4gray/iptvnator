# Stalker Mock Server

A local mock implementation of the Stalker/Ministra portal API for development and end-to-end testing of IPTVnator.

## Overview

The mock server speaks the same `portal.php` HTTP protocol as a real Stalker portal, generating deterministic fake data using `@faker-js/faker` seeded from the connecting MAC address. This means:

- The **same MAC address always returns the same data** (consistent across page refreshes and test runs).
- **Different MAC addresses produce different datasets** — use predefined scenario MACs for specific test conditions.
- Data is generated once per MAC on first request and cached in memory for the server's lifetime. **Restart to regenerate.**

## Quick Start

```bash
# Start the mock server (port 3210)
nx serve stalker-mock-server

# Or with file watching (auto-restarts on source changes)
nx run stalker-mock-server:serve-with-watch

# Or run both the mock server + Angular dev server in parallel
nx run-many --targets=serve --projects=stalker-mock-server,web
```

Then in IPTVnator, add a new Stalker portal:

- **Portal URL**: `http://localhost:3210/portal.php`
- **MAC Address**: one of the predefined scenarios below (or any MAC for auto-generated data)

## Predefined Scenario MAC Addresses

| MAC Address | Scenario | Description |
|---|---|---|
| `00:1A:79:00:00:01` | **default** | 8 categories per type, 40 items each — the balanced go-to for daily dev |
| `00:1A:79:FF:FF:FF` | **large** | 20 categories, 200 items each — stress-test pagination and virtual scroll |
| `00:1A:79:00:00:02` | **series-heavy** | 15 series categories with 6 seasons × 10 episodes — test deep series navigation |
| `00:1A:79:00:00:03` | **minimal** | 2 categories, 5 items — edge case testing (empty states, single items) |
| `00:1A:79:00:00:04` | **is-series** | 60% of VOD items have `is_series=1` — tests the Ministra lazy-season flow |
| `00:1A:79:00:00:05` | **embedded-series** | 50% of VOD items have embedded `series[]` arrays — tests the embedded series flow |
| `<any other MAC>` | **auto** | MAC bytes used as seed → deterministic unique dataset |

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3210` | HTTP port the server listens on |
| `NODE_ENV` | `development` | Node environment |

## Utility Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | `GET` | Health check — returns `{ status: "ok" }` |
| `/reset` | `POST` | Clear all in-memory data and favorites (useful between test runs) |

## API Coverage

All endpoints are served at `GET /portal.php?action=<action>&...` matching the real Stalker protocol:

| Action | Description |
|---|---|
| `handshake` | Returns a mock Bearer token |
| `do_auth` | Returns a mock user profile |
| `get_categories` | Category list filtered by `type` (itv/vod/series) |
| `get_genres` | Genre list (mirrors categories) |
| `get_ordered_list` | Paginated content list; if `movie_id` is present → returns seasons |
| `create_link` | Returns a real public HLS stream URL for playback |
| `favorites` | Add / remove / get favorites (in-memory, resets on restart) |
| `get_short_epg` | EPG program list for a channel (`ch_id`) |
| `get_epg_info` | Alias for `get_short_epg` |

## Cover Images

Cover images and logos use [Picsum Photos](https://picsum.photos) (e.g. `https://picsum.photos/seed/{id}/300/200`). These are real images served from a CDN — no local setup required, but an internet connection is needed for images to display.

## Stream URLs

`create_link` returns real public HLS test streams so video actually plays:

- `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
- `https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8`
- `https://playertest.longtailvideo.com/adaptive/oceans/oceans.m3u8`
- `https://playertest.longtailvideo.com/adaptive/bbbfull/bbbfull.m3u8`

The stream chosen for a given item is deterministic based on the item's `cmd` string.

## Using with Playwright E2E Tests

The Playwright config in `apps/web-e2e/playwright.config.ts` starts the mock server automatically alongside the Angular dev server when running e2e tests. See `apps/web-e2e/src/stalker.e2e.ts` for example stalker tests.

```bash
# Run all e2e tests (starts mock server automatically)
nx e2e web-e2e

# Or run only stalker-specific e2e tests
nx e2e web-e2e --grep "@stalker"
```

The test suite uses `00:1A:79:00:00:01` (default scenario) for most tests, and calls `POST /reset` in `beforeEach` to ensure a clean state between tests.

## Architecture

See [`docs/architecture/stalker-mock-server.md`](../../docs/architecture/stalker-mock-server.md) for full implementation details.

## Project Structure

```
apps/stalker-mock-server/
├── src/
│   ├── main.ts                            # Express bootstrap
│   └── app/
│       ├── scenarios.ts                   # MAC → scenario config mapping
│       ├── data-generator.ts              # Seeded faker data generation
│       ├── data-store.ts                  # Lazy per-MAC in-memory cache
│       └── routes/
│           ├── portal.route.ts            # /portal.php dispatcher
│           └── handlers/
│               ├── handshake.handler.ts
│               ├── do-auth.handler.ts
│               ├── get-categories.handler.ts
│               ├── get-ordered-list.handler.ts
│               ├── get-seasons.handler.ts
│               ├── create-link.handler.ts
│               ├── favorites.handler.ts
│               ├── get-short-epg.handler.ts
│               └── get-genres.handler.ts
├── project.json
├── tsconfig.json
└── README.md
```
