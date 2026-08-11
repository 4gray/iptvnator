# TMDB Metadata Enrichment

This document describes the opt-in TMDB (The Movie Database) metadata
enrichment subsystem introduced in phase 1: settings opt-in, the TMDB
service layer, the SQLite cache, and the Xtream detail-view integration.

Related:

- [TMDB Capability Roadmap](./tmdb-roadmap.md) — follow-up backlog: unused
  API surface, known defects, and what we deliberately will not build
- [SQLite DB Worker](./sqlite-db-worker.md)
- [Nx Workspace Boundaries](./nx-workspace-boundaries.md)

## Summary

- Xtream VOD and series detail views can be enriched with TMDB data (plot,
  cast, director, genres, rating, artwork) via a **field-level merge** — the
  provider stays authoritative for stream-related data and for any field
  TMDB cannot fill.
- Enrichment is **opt-in** via `Settings > Metadata (TMDB)` because it sends
  movie/series titles to a third-party API. Default: disabled.
- The detail view renders provider data **immediately**; enrichment runs
  asynchronously and patches the selected item once TMDB responds. A
  staleness guard drops responses that arrive after the user navigated away.
- All TMDB lookups are cached: SQLite (`tmdb_metadata` table) in Electron,
  session-scoped in-memory map in the PWA.
- Attribution (TMDB logo + "This product uses the TMDB API but is not
  endorsed or certified by TMDB.") is shown in the settings TMDB section and
  in Settings > About, as required by TMDB's terms.

## Module Layout

The service layer lives in `libs/services/src/lib/tmdb/` (scope:shared) so
both portal libs and — in later phases — the M3U player can consume it
without creating dependency cycles (`portal/shared/data-access` already
depends on `portal/xtream/data-access`, so it cannot host code the Xtream
store imports):

| File                         | Responsibility                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmdb-config.ts`             | API/image base URLs, embedded default API key, cache TTLs, app-language → TMDB-language mapping                                              |
| `tmdb.types.ts`              | TMDB v3 response shapes (search, details with credits)                                                                                       |
| `tmdb-api.service.ts`        | Thin `fetch`-based client (TMDB supports CORS; works in Electron renderer and PWA). Accepts v3 keys (`api_key` param) and v4 tokens (Bearer) |
| `tmdb-matcher.ts`            | Title normalization, year extraction, and the match-confidence gate (pure functions)                                                         |
| `tmdb-cache.service.ts`      | Environment-aware cache (Electron IPC bridge vs in-memory LRU capped at 300 entries) with caller-supplied TTLs                               |
| `tmdb-merge.ts`              | Field-level merge into `XtreamVodInfo` / `XtreamSerieInfo` (pure functions, no mutation)                                                     |
| `tmdb-credits.ts`            | People out of credit payloads: display cast, person chips, and the two-shape union a series cast needs                                       |
| `tmdb-cache-payload.ts`      | Trims a details payload before caching (aggregate roles/crew) without changing what a merge over it produces                                 |
| `tmdb-runtime.service.ts`    | Shared runtime context: opt-in gate, effective API key, language resolution                                                                  |
| `tmdb-enrichment.service.ts` | Movie/TV orchestrator and facade: id resolution → details fetch → cache; delegates person/season lookups                                     |
| `tmdb-person.service.ts`     | Cached person details + combined filmography (`person:<id>` rows)                                                                            |
| `tmdb-season.service.ts`     | Cached lazy per-season payloads — overview + episode list (`id:<id>\|season:<n>` rows)                                                       |
| `tmdb-trending.service.ts`   | Weekly trending (movie + tv merged by popularity, `trending:week` rows, 1-day TTL)                                                           |

Integration glue per portal:

- **Xtream**: `libs/portal/xtream/data-access/src/lib/stores/xtream-tmdb-enrichment.ts`;
  `XtreamStore.fetchVodDetailsWithMetadata` / `fetchSerialDetailsWithMetadata`
  fire it after `setSelectedItem(...)`.
- **Stalker**: `libs/portal/stalker/data-access/src/lib/stores/stalker-tmdb-enrichment.ts`;
  hooked inside `withStalkerSelection().setSelectedItem` so every detail flow
  (catalog, search, favorites/recent) is covered. The enriched item is
  applied via direct `patchState` — never `setSelectedItem` — so the hook
  cannot recurse. Live/radio selections are skipped. Movies and series share
  the `StalkerVodInfo` shape, so one merge function
  (`mergeStalkerInfoWithTmdb`) covers both; Stalker has no TMDB id, so
  resolution always goes through the title search. TMDB also supplies a
  backdrop (`tmdb_backdrop`) — Stalker portals never provide one.

Components read the selection through signals and re-render when the merged
item lands. Enriched cast (`tmdb_cast` with profile photos) renders as
avatar chips in the detail views, and so do directors/creators
(`tmdb_directors`: movie directors from `credits.crew` with
`job === 'Director'`, series creators from `created_by`) — both chip kinds
carry `tmdbPersonId` and open the same person page. Series detail views
also show a production-status chip (`tmdb_status`): TMDB returns `status`
as an ENGLISH string regardless of the request language, so it is
normalized to a token (`normalizeSeriesStatus`) and rendered through
translated labels (`seriesStatusLabelKey`) — the raw value never reaches
the UI. Unknown values are dropped rather than displayed. A "check key"
button in the settings section validates the API key against
`/configuration`, and a cache panel beside it shows the stored row count
plus payload size and can drop the lot (`DB_GET_TMDB_CACHE_STATS` /
`DB_CLEAR_TMDB_METADATA`, in-memory map in the PWA). Sizing is a full
scan, so it only runs once the TMDB section is the active one. Clearing
costs nothing but the next few requests — enrichment refetches on demand
— and it is also the escape hatch when a lookup-key version bump orphans
rows, since a bump makes them unreachable rather than deleting them.

## Match Confidence

Wrong metadata is worse than no metadata, so id resolution is conservative:

1. If the provider returns a usable `tmdb_id` (Xtream VOD info often does),
   its details are fetched directly and normally used as-is. Series have no
   show-level `tmdb_id`, so they always go through search. The id is a
   strong hint rather than gospel — panels ship dead and stale ones — so
   the payload it returns is weighed against the provider item
   (`assessProviderId`):
    - a matching title **or** a compatible release year (±1; for series,
      any earlier premiere) → **corroborated**, use it;
    - both years known and incompatible → **contradicted**, the stale-id
      signature ("Blade Runner 2049" carrying the 1982 film's id): the
      title search may take over, and does so only if it finds a confident
      match of its own;
    - title differs with no year to arbitrate → **inconclusive**, keep the
      details. TMDB returns titles in the request language and
      normalization strips stylized prefixes ("IT - Chapter Two" →
      "chapter two"), so a name mismatch alone says more about our inputs
      than about the id.

   A 404 is the one hard verdict: the id is recorded as dead
   (`badProviderId:<id>` row), skipped next time, and the title search
   takes over. Transient failures (auth, rate limit, 5xx, offline) neither
   disable the id nor trigger a search — that request would hit the same
   outage, and a title match that did come back would be weaker evidence
   than the id already in hand.
2. Otherwise `/search/movie` (or `/search/tv`) runs with the normalized
   title. Normalization strips bracketed tags, quality markers (`4K`,
   `1080p`, `MULTI`, …), leading language prefixes (`EN - `), diacritics,
   punctuation, trailing release years, and trailing season markers
   (`The Boys s05`, `Season 2`, `сезон 3`, `Staffel 2`, `Temporada 2`).
   `buildSearchTitleVariants` produces ordered candidates — original
   title, display title, then fallbacks with a leading language token
   stripped (`DE Batman`, `English The Godfather`; ALL-CAPS short codes
   only, so articles like "The"/"De Lift" survive) — tried sequentially
   until a confident match.
3. A result is accepted only when its normalized `title`/`original_title`
   (or `name`/`original_name`) is **exactly equal** to the normalized query
   AND the release year matches within ±1 (year comes from the provider's
   release date, falling back to a year tag in the raw title). For series
   the year gate additionally accepts shows that premiered **before** the
   provider year — portals report the current season's year while TMDB's
   `first_air_date` is the premiere. Without a year, the exact-title match
   must be unambiguous (single hit).
4. No confident match → the provider data stays untouched, and the negative
   verdict is cached (shorter TTL) so browsing back doesn't re-search.

The year filter is applied client-side rather than via TMDB's strict
`year`/`first_air_date_year` search params, which would drop correct results
when the provider's year is off by one.

**Non-Latin titles**: TMDB matches translated titles but returns `title` in
the _request_ language, so a Cyrillic query issued with `en-US` would come
back with an English title and fail the exact-match gate.
`tmdbSearchLanguageForTitle` detects Cyrillic queries and issues the search
with `ru-RU` (unless the app language is already Cyrillic-based); details
are still fetched in the app language afterwards.

## Details Fetch and Localization

Details are fetched with
`/movie/{id}?append_to_response=credits,videos,recommendations` (`/tv/{id}`
for series). Credits provide cast/director — for series the request also
appends `aggregate_credits`, because TMDB documents a TV id's `credits` as
the **latest season's** credits. What `aggregate_credits` covers is
described in one self-contradicting sentence — "it does not return the
newest season. Instead, it is a view of all the entire cast & crew for all
episodes belonging to a TV show" — so it is either the whole run minus the
newest season or the whole run. `unifiedTvCast` is written not to care:
it unions the two by set difference (whole-run billing order first, then
anyone `credits` has that the aggregate lacks), which under the second
reading appends nothing. Either way, long-running shows neither lose
departed regulars nor miss new ones. Payloads cached
before this landed have no `aggregate_credits` and fall back to the old
behaviour until they are refetched; videos supply the best YouTube
trailer (official trailer > trailer > teaser, merged into
`youtube_trailer` / `tmdb_trailer`); recommendations power the "Similar"
rail. In Xtream detail views the rail shows only recommendations that
match the provider catalog by normalized title
(`libs/portal/xtream/feature/src/lib/tmdb-similar.util.ts`). Matching is
two-tier (`normalizeTitleKeys`): exact normalized titles compare first
(a trailing year in a TMDB title is part of the title — "Blade Runner
2049"); the provider's year-stripped form only counts when its stripped
year tag is compatible (±1) with the TMDB year, so "Blade Runner" (1982)
never claims a catalog "Blade Runner 2049". The rail navigates
to the matched item — the detail components re-initialize on route param
changes (reactive `routeParams` signal) because the router reuses the
component for detail→detail navigation.

`CrossPortalSimilarService` (`libs/services`) extends the rail across
portals: recommendations are matched against ALL imported Xtream
playlists with one batched `DB_MATCH_TITLES` request (Electron only,
same two-tier + year rule). Stalker detail views — where the local
catalog is server-paginated and unmatchable — get their "Similar" rail
purely from these cross-portal matches (shared `VodDetailsComponent` for
movies, `stalker-series-view` for series); Xtream detail views append
them after the local-catalog matches, deduplicated by normalized title,
with the source playlist name on each card.
The `language` param derives from the app language setting
(`Language` enum → TMDB code, e.g. `de` → `de-DE`); cache rows are keyed per
language, so switching the app language re-fetches localized metadata.

TMDB language-filters both text AND videos — a Russian-only title returns
an empty overview and no trailer for `en-US` (its trailer is tagged
`iso_639_1=ru`). When the app-language payload is missing either, the
enrichment refetches once in the content's `original_language` and fills
only the missing fields (`tmdb-language-fallback.ts`): the details
overview and/or trailer (each independently, so a present app-language
overview is kept while the trailer is filled), and — via the same rule in
`TmdbSeasonService` when a season payload carries no usable text — the
season overview and per-episode names/overviews. Genres, credits and
artwork stay in the app language; both language rows land in the cache.

Trailers embed via `https://www.youtube-nocookie.com/embed/…`. YouTube
requires a Referer on the embed request ("Error 153 — Video player
configuration error" without one); the packaged Electron app loads from
`file://`, which never sends one, so the Electron main process injects the
project site as Referer for YouTube embed hosts
(`request-header-overrides.service.ts`, registered at startup via
`registerStaticHeaderShims`). Dev builds (localhost origin) are unaffected.

## Season/Episode Enrichment

Show-level merges store the matched id as `tmdb_id` on the enriched info
(`XtreamSerieInfo` / `StalkerVodInfo`). When the user opens a season, the
detail views lazily fetch `/tv/{tmdbId}/season/{n}` via
`TmdbEnrichmentService.getSeason` (cached per language under
`id:{tmdbId}|season:{n}`) and overlay its episodes with
`mergeEpisodesWithTmdb`:

- generic provider titles ("Episode 4", "Серия 4", "S01E04", bare numbers)
  are replaced with real episode names; meaningful provider titles are kept
- overviews and stills are TMDB-preferred; air date and rating only fill
  empty provider fields; durations stay provider-owned
- episodes without a TMDB counterpart (by episode number) pass through
  untouched

Season enrichment re-fires from the serial detail view after every
selection write, so its own write is convergent: a repeat cache-served run
that would change nothing (episodes already merged, overview already
stored) writes nothing, ending the re-fire chain.

The same payload's season `overview` is stored on the Xtream selection as
`tmdb_season_overviews[seasonKey]`. The serial detail view renders season
descriptions provider-first (`buildSeasonDescriptions` in
`libs/portal/xtream/feature/src/lib/serial-details/season-descriptions.util.ts`):
a `get_series_info` season overview wins when it is real prose, but panels
routinely fill it with a bare cover-image URL —
`sanitizeProviderOverview` (`@iptvnator/shared/interfaces`) treats a
URL-only value as absent, and the stored TMDB overview fills the gap.

The season number `{n}` is the provider's episode season number, with one
correction (`resolveEnrichmentSeasonNumber` in
`libs/shared/interfaces/src/lib/season-marker.util.ts`): providers often
slice a show into per-season catalog items ("The Mandalorian (2 season)",
"Пацаны 2 сезон", "The Boys S05") and renumber the single contained season
to 1. When the item contains exactly ONE season and the raw title carries
an explicit season marker (`extractSeasonFromTitle`: `s02`, `season 2`,
`2 season`, `2nd season`, `сезон 2`, `2-й сезон`, `staffel`/`temporada`/
`saison` forms, bracketed or not) that differs from the provider's number,
the marker wins and that TMDB season is fetched. Multi-season items always
keep provider numbering. `normalizeTitleKeys` strips the same markers
(including number-first forms like "2 сезон") from search titles, so the
show-level match is unaffected by them.

Wiring: Xtream — `XtreamStore.enrichSelectedSerialSeason(seasonKey)` fired
from the serial detail's `(seasonSelected)`; Stalker — the series view
keeps a `${tmdbId}|${seasonKey}`-keyed map and overlays it inside its
`mappedSeasons` computed. Each Stalker entry records the RESOLVED season
it was fetched for: per-season slices of one show share
(tmdbId, provider key "1") but resolve to different seasons, and a fetch
made with stale detail-to-detail navigation context is overwritten once
the real context re-resolves. The fetch effect gates on coherence rather
than timing: it waits while the season resource reloads and requires the
selected key to exist in the map with episodes. The retained season
selection deliberately survives navigation — the season container
deduplicates `seasonSelected` emissions, so items sharing one season-key
set would otherwise never re-trigger enrichment. Without a show-level match or with enrichment
disabled everything is a no-op — the `SeasonContainer` UI already renders
every episode field conditionally.

## Actor Pages

Cast chips carry the TMDB person id (`tmdbPersonId` on
`TmdbEnrichedCastMember`) and navigate to `actor/:personId` inside the
current portal. The page loads `/person/{id}?append_to_response=
combined_credits` via `TmdbEnrichmentService.getPersonDetails` (cached
under `person:{id}` with media_type `person`) and renders the shared
`ActorViewComponent` (`libs/ui/shared-portals`). The filmography merges
acting credits (`combined_credits.cast`) with directing/creating credits
(`combined_credits.crew`, jobs `Director`/`Creator`) into one list —
acting wins the per-title dedup, directing-only titles show the job in
the character slot — so the page serves actors and directors alike.

Filmography has two scopes:

- **This portal** (default): the Xtream route component matches every
  credit against the loaded catalog via `buildCatalogTitleIndex`
  (movies → vodStreams, tv → serialStreams) — matched titles get an
  "In your library" badge and navigate straight to their detail view; the
  rest open the portal search prefilled with the title (`?q=`). Stalker
  has no local catalog, so every title goes through the portal search.
- **All portals** (Electron only, toggle hidden in the PWA): one batched
  `DB_MATCH_TITLES` worker request runs a trigram-FTS lookup per title
  over ALL imported Xtream playlists
  (`operations/title-match.operations.ts`), confirming candidates with
  the same two-tier normalized-title matching the renderer uses
  (`normalizeTitle` now lives in `@iptvnator/shared/interfaces` so the
  worker and the renderer share it). Matches carry the playlist name
  (shown in the badge) and navigate into that playlist's detail view.
  This also works from Stalker actor pages — the one place the Stalker
  catalog limitation is lifted.

## Cache

Single table with several row kinds discriminated by the `lookup_key`
prefix:

```
tmdb_metadata (
  media_type  'movie' | 'tv' | 'person',
  lookup_key  'id:<tmdbId>|v2'               -- details payload row
              'id:<tmdbId>|season:<n>'       -- season payload row
              'title:<normalized>|year:<y>|v2' -- search resolution row
              'person:<personId>'            -- person payload row
              'trending:week'                -- trending list row
              'badProviderId:<tmdbId>'       -- id confirmed 404 by TMDB
  language    TEXT,       -- TMDB language code
  tmdb_id     INTEGER,    -- NULL on a search row = negative cache
  payload     TEXT,       -- raw JSON details, NULL for search rows
  fetched_at  TEXT,
  UNIQUE(media_type, lookup_key, language)
)
```

TTLs (enforced at read time in `TmdbCacheService.isFresh`): details and
positive matches 30 days, negative matches 7 days.

Search and details keys carry a `|v2` version suffix (`buildDetailsLookupKey`
in `tmdb-matcher.ts`): for search rows so normalization changes cannot reuse
stale positive or negative resolutions, for details rows because payloads now
include videos via `append_to_response` and pre-videos cache rows had to be
invalidated. Database startup deletes the obsolete
unversioned search rows once and records
`migration:tmdb-search-lookup-v2-cache-cleanup:v1` in `app_state`; details and
person cache rows are unaffected.

Electron IPC path (follows the standard DB worker contract, see
[SQLite DB Worker](./sqlite-db-worker.md)):

- Worker ops: `DB_GET_TMDB_METADATA`, `DB_SET_TMDB_METADATA`, plus the two
  maintenance ops behind the settings cache panel,
  `DB_GET_TMDB_CACHE_STATS` and `DB_CLEAR_TMDB_METADATA`
  (`database-worker.types.ts`, `database.worker.ts`,
  `operations/tmdb.operations.ts`)
- IPC registration: `events/database/tmdb.events.ts`
- Preload bridge: `dbGetTmdbMetadata` / `dbSetTmdbMetadata` /
  `dbGetTmdbCacheStats` / `dbClearTmdbMetadata` on `window.electron` (typed
  in `ElectronBridgeApi`)

`TmdbCacheService` treats the maintenance pair as optional on the bridge: an
Electron shell that predates them reports `null` (unsupported) rather than
falling back to the renderer map, which is always empty in Electron and
would claim the SQLite cache is empty. A `clear()` first awaits the writes
already in flight so they land and are deleted with everything else, and
holds the clear promise for its duration so a write starting meanwhile
queues behind the delete instead of racing it. Rows written after the user
cleared are deliberately kept.

The panel's full path — settings button, preload bridge, DB worker, real
SQLite — is covered by `@settings @electron @persistence sizes and clears
the TMDB metadata cache` in `apps/electron-backend-e2e/src/settings.e2e.ts`.
It seeds a row through `dbSetTmdbMetadata` rather than through enrichment,
which needs an API key that builds outside the release pipeline do not
carry.

The PWA uses a session-scoped in-memory map (acceptable for phase 1; TMDB
supports CORS so the PWA calls the API directly).

## Settings and API Key

`Settings.tmdb?: { enabled: boolean; apiKey?: string }`
(`libs/shared/interfaces/src/lib/tmdb.interface.ts`). The settings page has
a "Metadata (TMDB)" section: enable toggle, optional API key override with a
"check key" button (validates against `/configuration`), and a cache panel
showing the stored row count plus payload size with a button that drops the
lot. Sizing is a full table scan, so it runs only once that section is the
active one, and a failed read or clear says so instead of showing an empty
cache.

The embedded default key lives in `DEFAULT_TMDB_API_KEY`
(`libs/services/src/lib/tmdb/tmdb-config.ts`) and is an **empty placeholder
in the repository by design**: the real key is stored in the `TMDB_API_KEY`
GitHub Actions secret and injected at CI build time by
`tools/tmdb/inject-tmdb-key.mjs` (step "Inject TMDB API key" in
`build-and-make.yaml`, before the frontend build). Rationale: TMDB keys are
free and extractable from any client binary regardless, but keeping the key
out of the public repo prevents trivial scraping and fork propagation. Never
commit a real key; never reuse keys found in other repositories.

With no key available (empty default and no user override in settings),
enrichment stays inactive even when the toggle is on — fork PRs and local
dev builds fall into this mode automatically.

## Failure Behavior

Enrichment is strictly best-effort: any API/cache/parse failure logs a
warning and returns `null`, leaving the provider data untouched. Enrichment
never blocks or delays rendering of the detail view.

## Out of Scope (later phases)

Artwork upgrade for M3U VOD, persistent PWA cache (IndexedDB). (The
similar rails, actor cross-catalog search, and the trending and
recommendations dashboard rails from earlier versions of this list have
since shipped.)

## Dashboard Integration

- **Trending rail** ("Trending this week", `dashboardRails.tmdbTrending`
  toggle): `DashboardTrendingService`
  (`libs/workspace/dashboard/data-access`) pulls the weekly TMDB trending
  lists (cached one day per language) and runs ONE batched
  `CatalogTitleMatchService.matchTitles` request against the imported
  Xtream playlists — matched cards navigate straight to their detail view
  and show the playlist name; unmatched cards open the global search
  prefilled. Requires both the TMDB opt-in and the Electron DB worker
  (the rail is hidden in the PWA). The load fires only after the
  dashboard's own recent/favorites data is in, so it never competes for
  the worker at startup, and runs once per app session.
- **Recommendations rail** ("Because you watched",
  `dashboardRails.tmdbRecommendations` toggle): TMDB has no account-free
  "recommendations for you" endpoint, so `DashboardRecommendationsService`
  (`libs/workspace/dashboard/data-access`) seeds from the user's most
  recently watched movies/series (up to 3 distinct seeds). Each seed
  resolves through the enrichment facade using the shared
  `dashboard-tmdb-lookup.util.ts` attempt builder (the same one the hero
  uses, including the Stalker hints and the movie→tv retry), and the
  `recommendations` list rides along in every cached details payload —
  seeds whose detail view was opened cost zero network. Per-seed lists are
  interleaved round-robin, deduplicated by id AND normalized title,
  stripped of anything already watched or favorited, and matched against
  the imported libraries with ONE batched
  `CatalogTitleMatchService.matchTitles` request. The watched/favorited
  exclusion index is built through the same lookup-attempt builder the
  seeds use, so an activity row is indexed under more than its display
  title: under the media type the detail view enriched with (a Stalker
  embedded-VOD series routes as `'movie'` but is a `tv` show to TMDB, and
  a `series:` recommendation would sail past a `movie:`-only entry) and
  under its stored original-language title (`info.o_name`). Only the
  builder's PRIMARY attempt is indexed — its second attempt is a fallback
  guess, and indexing it would let a watched film exclude the same-named
  show. On top of that the exclusion runs on two title tiers, because a
  provider stores whatever the panel named the file: the exact normalized
  title, plus a year-gated base tier for the common `"Inception 2010"`
  shape whose exact key can never equal TMDB's `"Inception"`. The year gate is what keeps a stored
  `"Blade Runner 2049"` from swallowing the 1982 film; an unknown year on
  either side counts as agreeing, since re-recommending something already
  watched is the worse failure. Matching and exclusion
  work through BOTH the localized title and the TMDB original-title alias
  (cards always display the localized form) — catalogs frequently name
  items in their original language while the app language localizes the
  TMDB titles; a year-incompatible first-alias match does not veto a
  year-compatible match under the other alias. Only matched,
  year-compatible titles render (each card navigates to its detail view).
  The rail groups the worker's rows per key itself instead of reusing
  `buildTitleMatchIndex`, which collapses to one row per key before the
  candidate's year is known — with both `"Dune 1984"` and `"Dune 2021"`
  in the catalog the wrong one can win that collapse, and the card is
  then dropped by the year check with the right row already discarded.
  Among year-compatible rows an exact-title match still wins over a
  year-stripped one, mirroring the shared helper's precedence. Fewer than
  `MIN_RECOMMENDATION_MATCHES` (5) hides the rail — and resets
  the latch entirely, because an empty match result is indistinguishable
  from a transient worker failure (`matchTitles` maps failures to `[]`),
  re-running is cheap (mirrors trending's retry-on-empty), and a
  previously successful input set must be reloadable after a hidden
  interlude. The rail header names the seed ("Because you watched X")
  when exactly one seed contributed, else falls back to the generic
  "Recommended for you". Successful loads are keyed by the TMDB language
  (payloads are localized; the facade exposes `language()` for this), the
  seed set, the watched/favorited exclusion set AND the imported-playlist
  id set — watching something new re-seeds on the next dashboard visit,
  favoriting a recommended title re-filters it out, a language change
  re-localizes the cards, and importing/deleting a playlist re-runs the
  matching (a refresh keeps its id and is not detected, parity with
  trending); a cleared watch history
  clears the rail (the service is root-provided and outlives the
  dashboard); a load requested while one is in flight is queued and
  re-run afterwards; a load where no seed resolved (TMDB unreachable)
  does not latch and retries instead. Same gating as trending: TMDB
  opt-in + Electron DB worker, deferred behind the dashboard's own data.
- **Hero extras**: `DashboardHeroTmdbService`
  (`libs/workspace/dashboard/feature`) patches the hero card with a TMDB
  backdrop (when the activity row has none), a rating badge and up to two
  genre chips — resolved through the enrichment facade, so items already
  opened in a detail view come from the SQLite cache without network.
  Results are memoized per lookup identity for the session. The hero renders
  immediately from provider data; extras appear when resolved. Series
  heroes additionally show the tracked "S{n}·E{n}" badge from the playback
  position (no TMDB involved); the watch-progress bar is limited to
  movie/series heroes.

  The query is built to **match what the detail view searched with**, not
  just what the card displays. A title alone is weaker identity than the
  detail page had: without a year `pickConfidentMatch` requires a single
  exact title match, which common titles never satisfy, and the miss lands
  in the negative cache under a lookup key the detail view's hit can never
  be found at. Stalker rows carry those facts —
  `extractStalkerItemTmdbHints` (`libs/shared/interfaces`) reads
  `info.name`, `info.o_name`, `info.releasedate` and `info.tmdb_id` off the
  stored entry, mirroring `enrichStalkerSelectionWithTmdb` field for field.
  A `'movie'` verdict gets a second attempt under `'tv'` — `'movie'` is what
  every row falls back to when nothing says otherwise, and an embedded-VOD
  series is a `'movie'` activity row but a show on TMDB. That retry **drops
  the id**, which is only ever valid for the media type it was resolved
  under: `/movie/<tv id>` resolves to an unrelated film. A `'tv'` verdict
  gets no retry — it is reached only on positive evidence (series category,
  `is_series`, or a non-empty episode array), and the gate cannot tell an
  adaptation sharing its show's name and year from the show itself.

  Note the id in a stored Stalker entry is not a provider claim. Stalker
  portals never send one; its only source is a match this app already made
  and gated.

### Stalker backdrops on activity rows

Xtream detail views back-fill `content.backdrop_url`, which the dashboard
reads directly. Stalker items never reach the `content` table, so their
backdrop travels inside the stored playlist entry instead
(`info.tmdb_backdrop`, written by the same merge that enriched the detail
view) and the activity mappers surface it as `backdrop_url` —
`mapStalkerPlaylistRecentItems` in `playlist-recently-viewed.utils.ts` and
`buildStalkerFavoriteItems` in `dashboard-mappers.ts`. Entries saved before
enrichment (or with TMDB off) simply have none, and the dashboard falls back
to a blurred poster.

### `badProviderId:` rows

Providers ship `tmdb_id` values that do not exist. A failed details fetch
caches nothing, so without a marker the same 404 is re-issued on every
detail open, forever. These rows record that verdict: `tmdb_id` NULL,
language `any` (a dead id is dead in every language), read with the
negative-match TTL.

Only a **confirmed 404** is recorded. Transient failures (401, 429, 5xx,
offline) leave no marker — they say nothing about the id. Neither does a
title mismatch: that id exists and may be correct for a *different* item,
and since the row is keyed by id alone and shared across playlists,
recording per-item mismatches here would deny the direct lookup to every
other item that legitimately uses the same id.
