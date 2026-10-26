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

The TV-only `00:1a:79:00:00:0b` fixture supplies lazy Ministra VOD series
with paged `is_season` and `is_episode` records (two rows per provider page).
An episode-coordinate request returns an owned `is_file` row with a distinct
file ID; clients must resolve this row before `create_link`.
It exercises season/file resolution through the actual backend without changing
the existing regular/embedded fixtures. TV media tests use a local WebM clip;
they do not establish LG codec or protocol compatibility.

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
    command: 'node --import tsx apps/stalker-mock-server/src/main.ts',
    env: {
      NODE_ENV: 'development',
      TSX_TSCONFIG_PATH: 'tsconfig.base.json',
    },
    url: `http://localhost:${process.env['MOCK_PORT'] ?? '3210'}/health`,
    reuseExistingServer: !process.env['CI'],
  },
  // plus the xtream mock (3211) and web-backend (3333) entries
]
```

Playwright waits for every server to be healthy before starting tests. If one is already running (e.g. in local dev), it reuses the existing instance.

The mock runs as a single `node` process instead of `pnpm nx run
stalker-mock-server:serve`, because Nx starts its command in a detached
process group that Playwright's process-group kill never reached, so the server
outlived the run. The
[Xtream mock's Playwright section](xtream-mock-server.md#playwright-integration)
has the details.

**`MOCK_PORT` relocates the whole run.** Playwright's health-check URL and the
`MOCK_SERVER` constants in the specs read it, and `main.ts` resolves the
server's port as `PORT`, then `MOCK_PORT`, then `3210` — so
`MOCK_PORT=3310 pnpm exec playwright test …` starts the mock on
3310 and points every spec at it, which is how two worktrees run E2E side by
side when one already holds 3210. A hand-started Nx mock honours the same
knobs because the `serve` and
`serve-with-watch` targets no longer pin `PORT` in `project.json`: an `env`
entry in `nx:run-commands` overrides the shell (`{...process.env, ...env}`),
so a pinned value silently discarded every override. `PORT=3310 pnpm nx run
stalker-mock-server:serve` relocates the server alone. The Xtream mock has the
same shape with `XTREAM_MOCK_PORT`.

### Test Isolation

Mock state is keyed by MAC and one mock-server process is shared by every spec
file running in parallel workers, so isolation is per-MAC rather than global:

- `POST /reset` accepts one or more `?macAddress=` params and clears only those
  MACs. A bare `POST /reset` clears everything and is only safe when nothing
  else is talking to the server — a spec that used it would wipe a sibling
  spec's session mid-test.
- `apps/web-e2e/src/stalker.e2e.ts` declares its shared scenario MACs in
  `OWNED_MACS` (the constants live in `stalker-portal.fixture.ts`) and clears
  them in one batched request. The sibling specs that
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

## Issue #1844 research fixture (2026-10-14)

Historical results below describe the unfixed revisions. The original test
source is preserved as `apps/electron-backend-e2e/src/issue1844.characterization.ts`
and in snapshot `ee6d38098b7bb52a72d0924c195c80142ff79cd5`; it is excluded from
normal `*.e2e.ts` discovery because it asserts the old wrong behavior. The
command below applies to that original snapshot. Use the correctness suite at
the end of this section for the fixed implementation.

The isolated research branch adds `00:1A:79:18:44:01`, handled by
`handlers/issue1844.fixture.ts`. This is a characterization of the existing
playback defect, not its production fix. Run with separate local ports:

```bash
MOCK_PORT=3384 XTREAM_MOCK_PORT=3385 pnpm nx run electron-backend-e2e:e2e --grep='research #1844'
```

The fixture models the four-level VOD protocol from the readable Stalker
implementation at `iptvhakr/stalker_portal` revision
`72deceee1e32ea00cf33ecf2376b80902ab11134`:

- [`c/vclub.js`](https://github.com/iptvhakr/stalker_portal/blob/72deceee1e32ea00cf33ecf2376b80902ab11134/c/vclub.js#L833): selecting an episode sets `episode_id` and loads another list; only an `is_file` row is played.
- [`server/lib/vod.class.php`](https://github.com/iptvhakr/stalker_portal/blob/72deceee1e32ea00cf33ecf2376b80902ab11134/server/lib/vod.class.php#L926): movie → seasons → episodes → files. Episode IDs come from `video_season_series`; file IDs come from `video_series_files`.
- The same server's `createLink()` (line 32) treats `/media/file_<id>.mpg` as a FILE id. Its optional `series` parameter can select another episode inside the season belonging to that file; it cannot recover the intended parent from an unrelated file.

Alpha (movie 10, season 11) has episodes 101/102 backed by files 201/202.
Beta (movie 20, season 21) has episodes 201/202 backed by files 101/102.
These are separate primary-key namespaces, with legitimate overlap. There is
no handler that deliberately swaps shows: resolution follows the file table.
The control traversal with `movie_id`, `season_id`, `episode_id` returns the
correct file and media URL. The app instead constructs a file command directly
from the episode ID, so both Alpha episodes load Beta URLs and vice versa.

The Electron test observes media requests and `HTMLVideoElement.currentSrc`
with `readyState === 4`. Media routes encode the selected file's true show and
episode (`/stream/issue1844/20/1.mp4`, for example). They serve the same local
clear MP4 bytes; the assertion proves URL selection and loading, not visual
recognition of different filmed content. These research tests intentionally
assert the current wrong selection; convert them to correct-selection
regressions when implementing the fix.

The stock `is-series` scenario cannot validate this workflow: its lazy-season
request returns regular-series rows without `is_season: true`, and its season
handler ignores `season_id`. The baseline characterization pins this coverage
gap. Its ordinary `create_link` also hashes only `cmd` to choose a public demo
stream, so a playing video alone is not evidence of correct episode identity.

The reproduction uses fresh isolated Electron profiles, one portal and serial
clicks; portal handoff and response races are not required. Production files
are unchanged. For the real issue author's portal, matching anonymized
responses are still needed before claiming this is their exact cause. Search
must be investigated separately: the fixture returns Alpha/Beta through both
wildcard and category search, and current master also passes dedicated portal
search. This does not establish that the provider supports the same queries.

Validation: both `v0.24.0` (`0ecfc06494c4aeb6df52a3e3ac0d3b227a582e90`)
and current remote master (`37210ead25d526c0780feca9d4c856bf5792efa2`)
reproduced all four wrong URL selections in actual macOS arm64 Electron with
Video.js and temporary per-test profiles. Each revision passed three research
checks (two shows plus the baseline coverage-gap check). The tag test uses its
older `.episode-card` selector; current master uses `.episode-item`. An initial
tag retry timed out starting the old nested-Nx mock server; starting its mock
directly with `node --import tsx` resolved the harness issue. Neither Fedora
nor an actual VLC process was tested. The shared resolver is reached before
the inline/external handoff. PR #1825 is included in tested master and cannot
fix this reproduced single-portal protocol error.

Current-master targeted validation also passed 592 Stalker data-access tests,
496 Stalker feature tests, the Electron spec type-check and mock/E2E-file lint
(the mock has two pre-existing non-null assertion warnings). The full E2E and
coverage gates were not run for this diagnostic-only branch. No release note
is required because only research fixtures/tests and this documentation change.


### Existing-fix audit (2026-10-25)

Audited remote default branch `origin/master` at
`2b5e9648604c8abbc13031df8c28071cb317c1ba` in the managed worktree
`issue-1844-fix-audit`, branch `codex/issue-1844-fix-audit`.
The original investigation worktrees had been archived. The master fixture,
E2E and documentation were recovered from preserved snapshot
`ee6d38098b7bb52a72d0924c195c80142ff79cd5`; the older tag fixture remains in
`7fb67bc6b5d4059f57e6471cba90456e0b965a66`. The source snapshots were not
modified. Fixture and E2E files were copied byte-for-byte, including their
characterization assertions that expect the wrong URL.

Issue #1844 is still open, with two author comments and no linked PR in its
GitHub timeline. The October 18 explanation is consistent with this fixture,
but contains no provider payload proving the author's exact failure mode.
Searches included issue number, Stalker/Ministra, lazy/is_series, episode/file,
wrong series, downloads, get_ordered_list, create_link and episode_id, across
open, merged and closed-unmerged PRs. Relevant existing changes:

| PR | Merge commit | What it covers; why it is not this fix |
| --- | --- | --- |
| [#1218](https://github.com/4gray/iptvnator/pull/1218) | `d308749e2` | Inline/external season/episode metadata, labels and saved progress; does not resolve episode media files. |
| [#1253](https://github.com/4gray/iptvnator/pull/1253) | `9885178f3` | Refreshes embedded VOD `series[]` and parent commands from collection snapshots; explicitly excludes lazy Ministra. |
| [#1364](https://github.com/4gray/iptvnator/pull/1364) | `e197409b1` | Static vs temporary-link decisions and authentication; episode requests still use create_link with the supplied command. |
| [#1545](https://github.com/4gray/iptvnator/pull/1545) | `249cd38a6` | Title-derived season display, stable tracking/provider coordinates and rejection of stale episode replies across series modes; does not traverse episode files. |
| [#1825](https://github.com/4gray/iptvnator/pull/1825) | `93c5f1a05` | Playlist ownership and stale handoffs; the reproduction uses one portal and sequential clicks. |
| [#1984](https://github.com/4gray/iptvnator/pull/1984) | `2e80a0153` | Xtream hidden-category filtering; no Stalker resolver change. |

All these merge commits are ancestors of the audited master. No unfinished
fix candidate was found that warrants a duplicate PR or a separate branch
retest. Git history and 600 local/remote/snapshot refs were inspected; the four
core series/store/playback/download files had 58 distinct blobs and none used
`episode_id`. Relevant uncommitted Stalker/episode paths in active worktrees
and available Codex session records yielded no additional implementation.
This is a bounded search of available evidence, not proof that no unpublished
work exists elsewhere.

Current behavior and evidence:

- **Lazy VOD inline:** both Alpha and Beta tests pass unchanged: four episode
  clicks load four other-show URLs, verified by media requests, currentSrc and
  readyState 4 in macOS arm64 Electron/Video.js with temporary profiles.
- **Control traversal:** querying files with movie_id + season_id + episode_id
  and using the returned cmd selects the correct show for each fixture.
- **External playback:** code inspection shows the same resolveVodPlayback
  runs before the inline/external split. No real VLC/MPV process was tested.
- **Downloads:** playbackCommand in stalker-series-download.adapter.ts still
  builds `/media/file_<originalId>.mpg` for lazy VOD. Its originalId is the
  provider episode ID; a physical download was not executed in this audit.
- **ID/cmd:** the lazy mapper preserves provider episode ID separately from
  generated tracking ID, but drops a possible episode cmd. The movie-file
  lookup skips commands already containing `/media/file_`, so it cannot repair
  the synthetic command. Changing tracking IDs cannot fix this case.
- **Regular/embedded series:** these continue to use originalCmd plus episode
  number, not the lazy synthetic command. Their existing unit coverage passed;
  this audit did not independently replay all regular/embedded user flows.
- **Search:** global Movies search, explicit-category search and Advanced
  search all find the two shows. The author's search symptom remains unproven.

Local checks: fresh frozen-lockfile install on Node 22.23.2 / pnpm 10.33.0,
lockfile comparison and Nx discovery; Electron E2E build; 3/3 research E2E;
592 data-access and 497 feature unit tests; Electron E2E spec type-check,
changed-file ESLint, agent-guidance validation, release-note validation and
`git diff --check`. Native embedded MPV was skipped by
the build because its optional vendored runtime is absent; Video.js was used.
Full workspace/E2E coverage, packaged applications, Linux/Fedora and actual
provider accounts were not tested for this diagnostic-only task.
Logs and Playwright JSON are saved locally in `dist/issue1844-audit-evidence/`.

Next step: a narrow shared lazy-VOD file resolver, preserving provider parent,
season and episode coordinates separately from progress IDs, used by inline,
external and download paths. Preserve regular/embedded modes. Cover distinct
file/episode IDs, usable episode commands, missing/empty/multiple files,
quality/language selection and stale selection replies. Keep this original
characterization and add a separate correctness regression; do not change its
expectations just to make a proposed fix pass. Alternatively, obtain redacted
provider payloads first to confirm this is also the author's exact failure.
The issue should not be closed on the current evidence. No production fix,
release note, push, PR, merge or public comment was made in this audit.


### Lazy VOD file-resolution fix (2026-10-25)

The implementation on `codex/issue-1844-fix-audit` adds a shared
`StalkerEpisodeResolver` before playback and fresh download preparation.
Provider movie/season/episode coordinates and an optional episode command are
retained separately from unchanged tracking IDs. File lookup rejects empty or
unusable replies rather than synthesizing a file command from an episode ID.
For multiple video variants, provider order determines the first usable
command; subtitle and explicitly foreign-owner rows are excluded. Pending
playback rechecks ownership after the added request.

`apps/electron-backend-e2e/src/stalker-lazy-vod.e2e.ts` is the separate
correctness regression. Its first two tests failed on the unfixed baseline
with the expected wrong-show URLs. Two additional tests seed old favorites
and recently-viewed snapshots, including an old synthesized `cmd`, directly
into persistent storage and restart Electron. They verify that startup
preserves those snapshots and opening them loads the correct episode file.
No migration or resaving of those entries is needed. Existing progress IDs
and the legacy compatibility path are unchanged; the fix cannot infer and
repair progress already recorded against an incorrectly played video.

```bash
MOCK_PORT=3394 XTREAM_MOCK_PORT=3395 pnpm nx run electron-backend-e2e:e2e --grep='regression #1844'
```

The mock still serves identical media bytes through distinct identity-bearing
URLs. This verifies protocol selection and actual playback loading on the
local fixture; it does not confirm the issue author's provider payloads,
search symptom, Fedora behavior, or a real VLC launch. Existing stored
download URLs/files are not migrated; affected entries must be removed and
prepared anew from the series. See [Stalker contracts](./stalker-portal.md)
and [Download Manager](./download-manager.md).

Local validation of the working-tree implementation based on
`2b5e9648604c8abbc13031df8c28071cb317c1ba`: 605 Stalker data-access, 500
Stalker feature, and 645 shared-interface tests passed. The focused Electron
suite passed 4/4 after the unfixed baseline failed the two correctness tests.
The web/Electron E2E build, web type-check, all three affected spec-program
type-checks, project/changed-E2E lint, agent-guidance and release-note
validation passed. A release note was added under
`.changes/stalker-lazy-vod-episode-files.md`. Logs, the final Playwright JSON,
source patch and file hashes are retained in `dist/issue1844-fix-evidence/`.
Full workspace coverage, full E2E, packaged applications, a physical download,
and real external players were not run; download command/link preparation
and the shared handoff path have focused unit coverage. At this local
validation stage, no push, PR, merge, issue closure or public comment had been
performed.

The first local Codex review identified a custom-protocol compatibility case:
Ministra returns a raw URL for those file rows, but `create_link` expects the
actual file ID. The resolver now builds the file command from that returned
ID for `protocol: custom`, following the reference player's `is_file` branch.
Regression tests cover string/numeric IDs, invalid/missing IDs and the full
download preparation path; they failed before this correction.
