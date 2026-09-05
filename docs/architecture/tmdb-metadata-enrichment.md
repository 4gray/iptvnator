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
- The M3U player is a consumer too: an entry recognized as a movie file opens
  in the VOD detail shell fed purely by an `enrichMovie` lookup (there is no
  provider payload to merge into). Gated by the additional
  `Settings.m3uVodDetails` toggle (default on) below the master switch; see
  "Movie Recognition (VOD Detail View)" in
  `docs/architecture/m3u-playlist-module.md`.
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

Stalker applies the same correction before rendering: single-season regular,
embedded VOD and lazy `is_series` items use the resolved season for tabs,
quick-start labels, episode metadata and TMDB lookups. Lazy VOD corrects the
season VM before episodes load, retaining `providerSeasonKey` and
`providerSeasonNumber` for stable tracking IDs and legacy-position matching.
Portal requests still use the original `video_id` and season `id`. The marker
parser is independent of the UI language and accepts Russian and English
markers in either title field (`name` or `o_name`).

Lazy VOD season resources depend on provider item identity and mode rather
than the full selected metadata object, so a TMDB patch cannot reload the
season resource and discard loaded episodes. Episode replies apply only to
the exact loading season VM; a response from a previous selection or refresh
cannot populate a replacement season that happens to reuse its provider id.

Wiring: Xtream — `XtreamStore.enrichSelectedSerialSeason(seasonKey)` fired
from the serial detail's `(seasonSelected)`; Stalker — the series view
keeps a `${tmdbId}|${seasonKey}`-keyed map and overlays it inside its
`mappedSeasons` computed using the corrected display keys. Each Stalker entry
also records the resolved season it was fetched for, so a fetch made with
stale detail-to-detail navigation context can be replaced once the real
context resolves. The fetch effect gates on coherence rather
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

### Resolving a batched match

Every `DB_MATCH_TITLES` consumer — the Trending rail, the "Because you
watched" recommendations rail, the cross-portal "Similar" rail, and the
actor and Discover pages' "All portals" scope — turns the worker's flat result list
into one row through the same pair of helpers in
`libs/services/src/lib/catalog-title-match.service.ts`:

```ts
const grouped = groupTitleMatchesByKey(matches);
const match = pickTitleMatch({ type, titles: [title], year }, grouped);
```

`groupTitleMatchesByKey` keeps **every** row per
`type:exactNormalizedTitle`. Collapsing to one row per key is the trap
this replaced: the year that separates same-titled rows belongs to the
LOOKUP, which the grouping cannot see, so a catalog holding both
"Dune 1984" and "Dune 2021" kept whichever the worker returned first and
the other lookup then failed its own year check with the right row
already discarded — rendering a movie the user owns as unavailable.

`pickTitleMatch` ranks the year-compatible rows by evidence: a row whose
stripped year IS the lookup's year wins, then an untagged row (the only
tier reachable when the lookup year is unknown), then anything else
compatible. `titles` accepts aliases most-trusted-first; ranking spans all
aliases at once, so a weak hit under the first alias cannot veto a strong
one under the second, and alias order only breaks ties inside a tier. The
recommendations rail is the one caller that passes two — TMDB's localized
title plus `original_title` — via `candidateLookup()`; the rest pass one.

Multi-source VOD discovery deliberately does NOT use these
(`operations/title-sources.operations.ts`): there every copy in every
playlist is a distinct selectable source, not a single best answer.

## Discover Pages (clickable metadata chips)

The year, genre, and country chips on VOD/series detail pages are the
Discover entry points — the same "TMDB list → what's in my library →
else search" pattern as actor pages, generalized to metadata facets
(issue #1449).

**Structured facets from the merge.** All three merge functions in
`tmdb-merge.ts` additionally emit `tmdb_genres: {id, name}[]` (from
`details.genres`) and `tmdb_countries: {code, name}[]`. Countries come
from `details.origin_country`, NOT the fuller `production_countries`:
Discover filters by `with_origin_country`, so offering a co-production's
other partners would promise "titles from here" and return a different
set. Names are read out of `production_countries` (the only place TMDB
states them) and a code it does not name is dropped rather than rendered
as a bare `FR`;
`mergeStalkerInfoWithTmdb` also emits `tmdb_media_type`, because Stalker
embedded-VOD series route as movies structurally and the shared detail
view needs the real media type for the Discover link. Cached details
payloads already carry `genres`/`production_countries`
(`trimDetailsForCache` only trims `aggregate_credits`), so existing cache
rows produce facets without a refetch. Like person chips, facet chips are
clickable ONLY with TMDB backing: genre/country chips render per-entry
from the structured arrays (falling back to today's static joined-string
chip without them), while the year chip renders from provider data and
so needs a gate of its own. That gate is the navigation TARGET, not the
item's identity: `createDiscoverFacetNavigation()` offers a facet only
when its click can land somewhere, and the four hosts return `null` from
their target unless a playlist resolves AND
`TmdbEnrichmentService.isEnabled()` — Discover reads its results from
TMDB, so a chip must never promise a page enrichment cannot fill. An
earlier version gated on `typeof tmdb_id === 'number'` instead; that is
wrong, because `XtreamVodInfo.tmdb_id` is `number | string` and a
provider sending a JSON number satisfied it with enrichment never having
run. Discover-by-year does not use the item's TMDB id at all.

**Navigation.** Chip clicks navigate (via
`createDiscoverFacetNavigation()`, shared by all four render sites) to
the portal-scoped
`discover` route: `/workspace/{xtreams|stalker}/:id/discover?type=
movie|tv&year=&genre=<id>&genreLabel=&country=<iso>&countryLabel=`. The
query-param assembly is centralized in `discoverLink()`
(`libs/portal/shared/util/.../navigation/discover-link.util.ts`); parsing
lives in `parseDiscoverParams()` (`libs/ui/shared-portals/.../
discover-view/discover-params.ts`) — labels are dropped without their
filter values, and `type`+`genre` are an atomic pair (movie and TV genre
id spaces differ, so a genre never survives a type flip).

**Data.** `TmdbDiscoverService` (facade via
`TmdbEnrichmentService.discoverTitles`) fetches `/discover/{movie,tv}`
sorted by popularity, up to 5 pages (early stop at `total_pages`),
mapped/deduped by `mapDiscoverResults` (`tmdb-discover.ts`). Results are
deliberately session-cached in memory only (FIFO-bounded Map keyed by
mediaType|facets|language) and never persisted to `tmdb_metadata` —
popularity rankings are volatile. Any failure returns `null` (not
cached); the page shows its empty state, which also covers deep links
with enrichment disabled.

**Route containers.** `XtreamDiscoverRouteComponent`
(`libs/portal/xtream/feature/src/lib/discover/`) and
`StalkerDiscoverRouteComponent` clone the actor route containers: same
scope toggle, same portal/global matching (Xtream in-memory index by the
facet's media type; Stalker search-prefill only, global scope matching
Xtream playlists), same navigation on click.

Facets change via query params on the SAME route instance, so staleness
cannot be decided by instance — and, for the discover load, not by facet
either: A→B→A leaves two in-flight requests whose `discoverFacetKey()`
is identical, so an older one failing after the newer succeeded would
replace valid results with an empty page. Recency decides instead, via
`createLatestRequestGuard()` (`libs/portal/shared/util`). The catalog
match keeps both: the guard owns the in-flight INDICATOR (a request whose
subject changed must not clear a spinner its replacement now owns, and a
request with no replacement must still clear it) while the facet key
decides whether the RESULT is still wanted. The actor pages use the same
guard for the same reason.

Availability also waits for the catalog, not just for TMDB: the content
gate renders the route while a cold import runs, and TMDB usually answers
first, so publishing then would state that owned titles are missing.
Readiness is keyed on the in-flight flags rather than
`isContentInitialized`, so a failed import settles the page instead of
spinning forever. Both
render the shared `DiscoverViewComponent`, whose grid is the
`TitleResultsComponent` extracted from `ActorViewComponent`
(`libs/ui/shared-portals/src/lib/title-results/`) — one grid, filter
chips, and badge set shared by actor and Discover pages.

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
"check key" button (validates against `/configuration`), the M3U
movie-recognition toggle (root-level `Settings.m3uVodDetails`, shown only
while TMDB is enabled and bound via `[formControl]` because it is not part of
the `tmdb` form group), and a cache panel
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
  interleaved round-robin, deduplicated by TMDB id, stripped of anything
  already watched or favorited, and matched against
  the imported libraries with ONE batched
  `CatalogTitleMatchService.matchTitles` request. The watched/favorited
  exclusion index is built through the same lookup-attempt builder the
  seeds use, so an activity row is indexed under more than its display
  title: under the media type the detail view enriched with (a Stalker
  embedded-VOD series routes as `'movie'` but is a `tv` show to TMDB, and
  a `series:` recommendation would sail past a `movie:`-only entry) and
  under its stored original-language title (`info.o_name`). That resolved
  media type REPLACES the routing one rather than joining it — keeping
  both would make the watched show exclude an unrelated film of the same
  name; a row the builder cannot classify keeps its routing type, the
  only thing then known. Only the builder's PRIMARY attempt is indexed —
  its second attempt is a fallback guess, and indexing it would let a
  watched film exclude the same-named show. On top of that the exclusion runs on two title tiers, because a
  provider stores whatever the panel named the file: the exact normalized
  title, plus a year-gated base tier for the common `"Inception 2010"`
  shape whose exact key can never equal TMDB's `"Inception"`. Both tiers
  are year-gated, but from different sources. The exact tier uses only a
  year the row STATES in a metadata field (Stalker's `info.releasedate`),
  so a watched 1954 `"Godzilla"` cannot exclude the 2014 one — while
  `"Blade Runner 2049"`, whose year belongs to the NAME, still excludes
  itself. That follows `releaseTagYear`'s rule: on a whole-title match a
  trailing number is part of the name and nothing can settle it, so an
  inferred year must not veto the match. The base tier keeps using the
  trailing year it stripped, which is a year suffix by construction, and
  that gate is what keeps a stored `"Blade Runner 2049"` from swallowing
  the 1982 `"Blade Runner"`. A row that states no year records `null` and
  keeps excluding unconditionally; an unknown year on either side counts
  as agreeing, since re-recommending something already watched is the
  worse failure. Exclusion works through BOTH the localized title and
  the TMDB original-title alias (cards always display the localized
  form) — catalogs frequently name items in their original language
  while the app language localizes the TMDB titles.

  Catalog matching itself is the shared pair described under
  "Resolving a batched match": this rail is the caller that passes two
  aliases, via `candidateLookup()`. Only matched, year-compatible titles
  render, each card navigating to its detail view. What stays local to
  the rail is what happens AFTER a row is picked — title collisions are
  resolved by the catalog row a candidate resolved to, since same-titled
  remakes ("Dune" 1984 and 2021) are different films that must both
  reach the matcher, while two candidates landing on one row would
  render as duplicate cards opening the same item. Fewer than
  `MIN_RECOMMENDATION_MATCHES` (5) hides the rail — and resets
  the latch entirely, because an empty match result is indistinguishable
  from a transient worker failure (`matchTitles` maps failures to `[]`),
  re-running is cheap (mirrors trending's retry-on-empty), and a
  previously successful input set must be reloadable after a hidden
  interlude. The rail header names the seed ("Because you watched X")
  when exactly one seed contributed, else falls back to the generic
  "Recommended for you". A load latches only once EVERY seed answered —
  a seed that did not resolve may have failed transiently, and latching
  on its behalf would drop its recommendations for the session; a seed
  that has no TMDB match never resolves either, so that user's rail
  re-runs each visit, which is bounded work (cached enrichment misses
  plus one batched worker call). Latched loads are keyed by the TMDB language
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
    Xtream rows carry them on the `content` row instead — see
    [Identity on Xtream content rows](#identity-on-xtream-content-rows).
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

### Identity on Xtream content rows

An Xtream activity row (recently viewed, favorites) is built from its
`content` row, and the catalog endpoints that create those rows carry only a
title and a poster. So a dashboard lookup used to be rebuilt from the display
title alone, while the detail view had searched with the original title, the
release date and often a TMDB id.

Three `content` columns close that gap — `tmdb_id`, `release_year`,
`original_title`, alongside the existing `backdrop_url`. The detail views
back-fill them from what is on screen
(`xtreamDetailContentMetadata` in `libs/portal/xtream/data-access`) through
`XtreamStore.backfillContentMetadata` →
`DB_SET_CONTENT_METADATA_IF_MISSING` →
`persistContentMetadataIfMissing`. The activity SELECTs project them,
`dashboard-mappers.ts` puts them on `PortalActivityItem`, and
`buildDashboardTmdbAttempts` reads them back.

Contracts worth keeping:

- **Per-column, never overwrite.** Enrichment supplies the pieces at
  different times — the release date and original title arrive with the
  provider's detail response, the id only once enrichment resolves one (and
  never, with enrichment off). A row-level "already populated" guard would
  let whichever piece landed first block all the others forever.
- **`release_year` is the year the PROVIDER stated**, never one read out of
  the title. Readers already apply that fallback themselves, so an absent
  column means "the provider gave no date" rather than "nobody looked" — and
  a title year like "2001: A Space Odyssey" can never be frozen into the row
  as that film's release year.

  Keeping that true needs one thing from the merge. `xtreamDetailContentMetadata`
  runs against the object the detail view is RENDERING, and
  `mergeVodInfoWithTmdb`/`mergeSerieInfoWithTmdb` fill `releasedate`/
  `releaseDate` from `details.release_date`/`first_air_date` whenever the
  provider left them empty — silently, so afterwards the field alone cannot
  say who stated the date. The merge therefore marks its own substitution
  with `tmdb_supplied_release_date`, and the extractor skips the year when it
  is set. Sniffing for enrichment instead would not work: the `tmdb_*` fields
  the merge adds are all conditional on having content, so a film with no
  credits and no recommendations carries none of them and reads as
  un-enriched. Since the column is never overwritten, getting this wrong is
  unfixable after the fact — a real provider date arriving later cannot
  correct it. The same marker is what `trustedReleaseYear` (the
  recommendations exclusion index) must consult if it ever reads this column.
- **The id is stored unvetted.** Every consumer reaches TMDB through
  `TmdbEnrichmentService`, whose `detailsForProviderId` runs
  `assessProviderId` and lets the title search take over when the years
  contradict. Vetting on write would record one verdict permanently where
  the shared gate re-decides per lookup.
- **No media-type column.** For Xtream the catalog files movies and series
  apart, so `content.type` already is the media type. Stalker needs one
  because its embedded-VOD series are stored as movies — hence the field on
  `StalkerItemTmdbHints` and not here.
- **Both sides validate through `normalizeContentMetadataPatch`**
  (`libs/shared/interfaces`), so a legacy row, a row whose detail page has
  never been opened, and a provider's `"0"` all collapse to the same thing:
  no identity, and the title-only fallback.

Not covered: rows whose detail page has never been opened, playlists
refreshed after this landed (the columns are re-learned on the next detail
open, same as `backdrop_url`), and the PWA — its catalog is a session-scoped
cache rebuilt from the API on every load, so a stored id would never outlive
the detail view that resolved it. All of them keep the title-only path.

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
title mismatch: that id exists and may be correct for a _different_ item,
and since the row is keyed by id alone and shared across playlists,
recording per-item mismatches here would deny the direct lookup to every
other item that legitimately uses the same id.
