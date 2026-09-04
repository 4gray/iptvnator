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
  endpoint — see [Endpoints](#endpoints-tolerant-strict-and-the-ministra-host) below)
- **MAC Address**: one of the predefined scenarios below (or any MAC for auto-generated data)

## Endpoints: tolerant, strict, and the /ministra host

The same actions are served at several paths with deliberately different
strictness. Since endpoint discovery landed, the app no longer guesses the
portal mode from the URL shape: at import it probes `portal.php` →
`server/load.php` → `stalker_portal/server/load.php` and classifies each
endpoint by observed behavior (token-less `get_genres` answering data ⇒
token-free panel; the plain-text auth failure ⇒ full portal, confirmed by a
real handshake + `get_profile`). The mock's split makes every branch of that
classification exercisable:

| Path | Behaviour |
|---|---|
| `/portal.php` | Tolerant. Ignores the Bearer token and the MAC format, like most reseller panels in the wild — discovery classifies it as a token-free simple portal. |
| `/stalker_portal/server/load.php` | Strict. Enforces the token and the MAC format exactly like the real middleware — discovery classifies it as a full portal. |
| `/server/load.php` | Strict, enforced identically. Importing this bare canonical URL now authenticates (the historical import/runtime predicate divergence that skipped the handshake here is fixed). |
| `/ministra/server/load.php` | Strict. The `/ministra/*` prefix simulates a **genuine Ministra host**: `/ministra/portal.php` 404s like a real installation (portal.php is a reseller alias official Stalker never ships), so `http://localhost:3210/ministra/c` exercises the probe's 404 fallthrough end to end. |

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
  that only check status codes will silently render nothing. The stock server
  has a third body, `Access denied.` (blocked account), which the mock does not
  produce — the app classifies all three
  (`libs/shared/interfaces/src/lib/stalker-auth-failure.util.ts`).
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
| `00:1A:79:00:00:07` | **marketing-demo** | 35 original poster movies with the newest 20 first, plus the fictional live channels shared with the Xtream mock (logos served from `/assets/marketing/logo/<slug>.svg`, no censored category) — safe for screenshots and marketing |
| `00:1A:79:00:00:08` | **login-required** | `get_profile` answers `status: 2` until the client completes `do_auth` with non-empty credentials. The app drives this end to end: enter a username and password in the Stalker import dialog and it runs `do_auth`, then retries `get_profile` with `auth_second_step=1`. Covered by `stalker.e2e.ts` (`@stalker full portal authentication`) |
| `00:1A:79:AE:<slot>:02` | **login-required** | Parallel-slot-scoped alias range used by concurrent auth E2E runs; it has the same login contract as `00:1A:79:00:00:08` but independent per-MAC state |
| `00:1A:79:00:00:09` | **gated-stream** | `create_link` returns a local `/stream/gated/…` URL that answers 403 without the mac cookie and the MAC's current Bearer token — proves a player's media requests really carry the portal credentials |
| `00:1A:79:00:00:0A` | **static-channel-cmd** | ITV rows carry a directly playable `cmd` with `use_http_tmp_link`/`use_load_balancing` both `'0'` — a client honouring the flags must play them without calling `create_link` |
| `<any other MAC>` | **auto** | MAC bytes used as seed → deterministic unique dataset |

Every generated ITV channel and radio station carries the two temporary-link
flags a real portal sends. Outside the `static-channel-cmd` scenario they are
`use_http_tmp_link: '1'`, which is the honest annotation of their
`ffrt4://…` commands: those are portal-internal pseudo-URLs that only
`create_link` can resolve.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3210` | HTTP port the server listens on |
| `HOST` | `127.0.0.1` | Bind address. Loopback by default — the fixture serves fabricated, unauthenticated content, so set `HOST=0.0.0.0` only to deliberately point a phone or STB at it |
| `NODE_ENV` | `development` | Node environment |

## Non-Portal Endpoints

Besides the portal paths above, `src/main.ts` mounts:

| Endpoint | Method | Description |
|---|---|---|
| `/stalker?url=<portal_url>&macAddress=<mac>&action=<action>&…` | `GET` | CORS-proxy mirror of the IPTVnator web-backend `/stalker` endpoint, used by PWA/Playwright runs. `macAddress`, `token` and `serialNumber` are control params turned into headers and stripped from the portal query (except `handshake`'s candidate token); the response is wrapped as `{ payload }`. Strictness follows the proxied `url`'s shape |
| `/stream/gated/:file` | `GET` | `video.mp4` / `audio.mp4` fixtures for the `gated-stream` scenario — 403 without the mac cookie **and** the MAC's current Bearer token |
| `/assets/marketing/poster/<slug>.png` | `GET` | The committed screenshot-safe poster catalog shared with the Xtream mock, served from this process so `marketing-demo` needs no second server |
| `/assets/marketing/logo/<slug>.svg[?size=WxH]` | `GET` | Generated channel logo (initials on a gradient) for the `marketing-demo` live channels and radio stations, rendered by `@iptvnator/shared/marketing-fixtures` |
| `/health` | `GET` | Health check — returns `{ status: "ok" }` |
| `/reset[?macAddress=<mac>&macAddress=…]` | `POST` | Clear generated data, favorites, session/auth state (including pinned device IDs) and watchdog counters. **Pass the MACs you own**: state is per-MAC and parallel spec files share this process, so a bare `/reset` wipes their state mid-test. Repeated params clear several MACs in one request |
| `/invalidate-session?macAddress=<mac>` | `POST` | Drop that MAC's tokens so the next portal call fails with `Authorization failed.` — lets tests assert the client re-handshakes and retries. Pinned device identity survives, as on a real portal |

## API Coverage

Every action is served by the same dispatcher (`src/app/routes/dispatch.ts`) at
every portal path — `GET /portal.php?action=<action>&...` and the strict
`server/load.php` shapes alike — matching the real Stalker protocol:

| Action | Description |
|---|---|
| `handshake` | Issues the access token (idempotent) plus the 5.x `random` nonce and `not_valid` flag |
| `get_profile` | Turns the handshake token into a session; enforces device-id pinning, and on the strict endpoint the MAC format |
| `get_events` | Watchdog ping; records the call and returns an empty event set (never affects authorization, as on a real portal) |
| `do_auth` | Boolean login step: `{js:true}` for non-empty credentials (recorded for the login-required scenario), `{js:false}` otherwise |
| `get_main_info` | `account_info/get_main_info` — simple-mode subscription facts for the Stalker account-info dialog, in the nested `js.account_info` envelope |
| `get_categories` | Category list filtered by `type` (itv/vod/series); `get_genres_itv` / `get_genres_vod` are handled by the same handler |
| `get_genres` | Genre list (mirrors categories) |
| `get_ordered_list` | Paginated content list; if `movie_id` is present → returns seasons |
| `get_all_channels` | Complete ITV channel list in one response (`type=itv` only); excludes censored (adult) genres; disabled in the `legacy-pagination` scenario |
| `create_link` | Returns a playable stream URL — a real public HLS stream, or the credential-gated local URL in the `gated-stream` scenario. Also echoes the mock-only `cmd_received` / `query_keys_received` diagnostics that pin the client's `cmd` wire format |
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

The test suite uses `00:1A:79:00:00:01` (default scenario) for most tests. State
is per-MAC and several spec files share this one server process, so `beforeEach`
resets **only the MACs the file owns** (`OWNED_MACS` in `stalker.e2e.ts`, sent as
repeated `macAddress` params in a single request) rather than clearing
everything. The sibling specs that talk to this server (`self-hosted.e2e.ts`,
the `sources-pwa` helpers) own a disjoint `00:1A:79:5F:*` range for the same
reason, and `stalker.e2e.ts` runs `mode: 'serial'` because its tests
deliberately share scenario MACs. Its stateful authentication tests derive a
separate `00:1A:79:AE:<slot>:*` range from Playwright's bounded
`parallelIndex` and add only that range to the scoped reset, so concurrent
browser projects do not clear one another's sessions or pinned device
identity; restarted workers retain their slot. Full contract:
[`docs/architecture/stalker-mock-server.md`](../../docs/architecture/stalker-mock-server.md#test-isolation).

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
│   ├── main.ts                            # Express bootstrap + non-portal routes
│   └── app/
│       ├── scenarios.ts                   # MAC → scenario config mapping
│       ├── data-generator.ts              # Seeded faker data generation
│       ├── data-store.ts                  # Lazy per-MAC in-memory cache
│       ├── auth-store.ts                  # Tokens, device pinning, do_auth state
│       ├── request-mac.ts                 # MAC read from the `mac=` cookie
│       ├── marketing-poster-url.ts        # Origin-resolved poster paths
│       ├── routes/
│       │   ├── portal.route.ts            # Portal router (tolerant + strict)
│       │   └── dispatch.ts                # Shared Stalker action dispatcher
│       └── handlers/
│           ├── handshake.handler.ts
│           ├── get-profile.handler.ts
│           ├── get-events.handler.ts
│           ├── do-auth.handler.ts
│           ├── get-main-info.handler.ts
│           ├── get-categories.handler.ts
│           ├── get-genres.handler.ts
│           ├── get-ordered-list.handler.ts
│           ├── get-all-channels.handler.ts
│           ├── get-seasons.handler.ts
│           ├── create-link.handler.ts
│           ├── favorites.handler.ts
│           ├── get-epg-info.handler.ts
│           └── get-short-epg.handler.ts
├── project.json
├── tsconfig.json
└── README.md
```
