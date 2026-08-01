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

- **Portal URL**: `http://localhost:3210/portal.php` (tolerant panel-style endpoint)
  or `http://localhost:3210/stalker_portal/server/load.php` (canonical Ministra
  endpoint — see [Two endpoints](#two-endpoints-tolerant-vs-strict) below)
- **MAC Address**: one of the predefined scenarios below (or any MAC for auto-generated data)

## Two endpoints: tolerant vs strict

The same actions are served at two paths with deliberately different strictness,
because the app treats them differently: a URL containing `/stalker_portal` is
imported as a **full portal** (handshake + token + watchdog), anything else as a
**simple portal** (no authentication at all).

| Path | Behaviour |
|---|---|
| `/portal.php` | Tolerant. Ignores the Bearer token and the MAC format, like most reseller panels in the wild. |
| `/stalker_portal/server/load.php` | Strict. Enforces the token and the MAC format exactly like the real middleware. |
| `/server/load.php` | Strict. The second full-portal URL shape the app recognizes; enforced identically. |

> **Known app inconsistency:** `StalkerSessionService.isFullStalkerPortal`
> classifies `/server/load.php` as a full portal, but the import dialog's
> `isFullStalkerPortalUrl` checks only for `/stalker_portal`, so importing a bare
> `…/server/load.php` URL persists `isFullStalkerPortal: false` and the app skips
> the handshake. The mock is deliberately faithful to a **real** portal here
> (that path enforces auth), which makes it the right fixture to drive the
> upcoming fix that unifies those two predicates. Until then, import full
> portals through a `/stalker_portal/...` URL.

The strict endpoint reproduces the parts of Stalker 4.9.35 that a client can
actually get wrong:

- Every action except `handshake`, `get_profile`, `get_localization` and
  `do_auth` requires `Authorization: Bearer <token>`.
- A token only counts once `get_profile` has adopted it — a handshake alone is
  not a session. Adoption is deliberately stricter than the stock server:
  only tokens the mock actually issued (or the already-bound one) are
  accepted, so a client with a broken token pipeline fails loudly.
- Auth failures come back as **HTTP 200 with a plain-text body**
  (`Authorization failed.`, `Unauthorized request.`), never a 401/403. Clients
  that only check status codes will silently render nothing.
- The handshake is **idempotent**: presenting the MAC's current token returns
  that same token instead of rotating it.
- `device_id`/`device_id2` are pinned to the MAC on first non-empty value; any
  later change — including sending them empty again — is a permanent
  `device conflict` with the "Your STB is damaged." block message.
- `signature`, `metrics` and `prehash` are accepted and ignored, exactly as the
  stock server does.
- The MAC must match the Infomir OUI format (`00:1A:79:XX:XX:XX`) or
  `get_profile` answers with a bare `{ status: 1 }`.

## Predefined Scenario MAC Addresses

| MAC Address | Scenario | Description |
|---|---|---|
| `00:1A:79:00:00:01` | **default** | 8 categories per type, 40 items each — the balanced go-to for daily dev |
| `00:1A:79:FF:FF:FF` | **large** | 20 categories, 200 items each — stress-test pagination and virtual scroll |
| `00:1A:79:00:00:02` | **series-heavy** | 15 series categories with 6 seasons × 10 episodes — test deep series navigation |
| `00:1A:79:00:00:03` | **minimal** | 2 categories, 5 items — edge case testing (empty states, single items) |
| `00:1A:79:00:00:04` | **is-series** | 60% of VOD items have `is_series=1` — tests the Ministra lazy-season flow |
| `00:1A:79:00:00:05` | **embedded-series** | 50% of VOD items have embedded `series[]` arrays — tests the embedded series flow |
| `00:1A:79:00:00:06` | **legacy-pagination** | No `get_all_channels` support — tests the paginated `get_ordered_list` crawl fallback for the full ITV channel list |
| `00:1A:79:00:00:07` | **marketing-demo** | 35 original poster movies with the newest 20 first — safe for screenshots and marketing |
| `00:1A:79:00:00:08` | **login-required** | `get_profile` answers `status: 2` until the client completes `do_auth` with non-empty credentials. The app cannot finish this flow yet (its `do_auth` path is dormant and sends empty credentials), so the scenario is exercised at the HTTP level only — it exists to receive the upcoming client-side `do_auth` work |
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
| `/reset` | `POST` | Clear all in-memory data, favorites, sessions and watchdog counters (useful between test runs) |
| `/invalidate-session?macAddress=<mac>` | `POST` | Drop that MAC's tokens so the next portal call fails with `Authorization failed.` — lets tests assert the client re-handshakes and retries. Pinned device identity survives, as on a real portal |

## API Coverage

All endpoints are served at `GET /portal.php?action=<action>&...` matching the real Stalker protocol:

| Action | Description |
|---|---|
| `handshake` | Issues the access token (idempotent) plus the 5.x `random` nonce and `not_valid` flag |
| `get_profile` | Turns the handshake token into a session; enforces device-id pinning, and on the strict endpoint the MAC format |
| `get_events` | Watchdog ping; records the call and returns an empty event set (never affects authorization, as on a real portal) |
| `do_auth` | Boolean login step: `{js:true}` for non-empty credentials (recorded for the login-required scenario), `{js:false}` otherwise |
| `get_categories` | Category list filtered by `type` (itv/vod/series) |
| `get_genres` | Genre list (mirrors categories) |
| `get_ordered_list` | Paginated content list; if `movie_id` is present → returns seasons |
| `get_all_channels` | Complete ITV channel list in one response (`type=itv` only); excludes censored (adult) genres; disabled in the `legacy-pagination` scenario |
| `create_link` | Returns a real public HLS stream URL for playback |
| `favorites` | Add / remove / get favorites (in-memory, resets on restart) |
| `get_short_epg` | Current-and-upcoming EPG window for a channel (`ch_id`, `size`) |
| `get_epg_info` | Bulk EPG keyed by channel id for a requested `period` window |

## Cover Images

Generated scenarios use [Picsum Photos](https://picsum.photos) for cover images
and logos, so they need an internet connection to display artwork. The
`marketing-demo` scenario instead uses the committed, screenshot-safe poster
catalog shared with the Xtream mock. Stalker serves those PNGs itself from
`/assets/marketing/poster/<slug>.png`, so screenshots remain deterministic and
offline once the repository is checked out.

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

## EPG Behavior

The mock server generates a 7-day EPG schedule for every ITV channel using
2-hour slots starting at the current UTC day boundary.

- `get_short_epg` returns the current program and upcoming items from that
  schedule, limited by `size`
- `get_epg_info` returns bulk data in the shape
  `{ js: { data: Record<channelId, program[]> } }`
- `get_epg_info` filters the bulk response from the current UTC day start through
  `now + period`

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
│       ├── routes/
│       │   ├── portal.route.ts            # /portal.php route
│       │   └── dispatch.ts                # Shared Stalker action dispatcher
│       └── handlers/
│           ├── handshake.handler.ts
│           ├── do-auth.handler.ts
│           ├── get-categories.handler.ts
│           ├── get-ordered-list.handler.ts
│           ├── get-seasons.handler.ts
│           ├── create-link.handler.ts
│           ├── favorites.handler.ts
│           ├── get-epg-info.handler.ts
│           ├── get-short-epg.handler.ts
│           └── get-genres.handler.ts
├── project.json
├── tsconfig.json
└── README.md
```
