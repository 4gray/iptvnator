# TMDB Metadata Enrichment

This document describes the opt-in TMDB (The Movie Database) metadata
enrichment subsystem introduced in phase 1: settings opt-in, the TMDB
service layer, the SQLite cache, and the Xtream detail-view integration.

Related:

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

| File | Responsibility |
| --- | --- |
| `tmdb-config.ts` | API/image base URLs, embedded default API key, cache TTLs, app-language → TMDB-language mapping |
| `tmdb.types.ts` | TMDB v3 response shapes (search, details with credits) |
| `tmdb-api.service.ts` | Thin `fetch`-based client (TMDB supports CORS; works in Electron renderer and PWA). Accepts v3 keys (`api_key` param) and v4 tokens (Bearer) |
| `tmdb-matcher.ts` | Title normalization, year extraction, and the match-confidence gate (pure functions) |
| `tmdb-cache.service.ts` | Environment-aware cache (Electron IPC bridge vs in-memory LRU capped at 300 entries) with caller-supplied TTLs |
| `tmdb-merge.ts` | Field-level merge into `XtreamVodInfo` / `XtreamSerieInfo` (pure functions, no mutation) |
| `tmdb-runtime.service.ts` | Shared runtime context: opt-in gate, effective API key, language resolution |
| `tmdb-enrichment.service.ts` | Movie/TV orchestrator and facade: id resolution → details fetch → cache; delegates person/season lookups |
| `tmdb-person.service.ts` | Cached person details + combined filmography (`person:<id>` rows) |
| `tmdb-season.service.ts` | Cached lazy per-season episode lists (`id:<id>\|season:<n>` rows) |
| `tmdb-trending.service.ts` | Weekly trending (movie + tv merged by popularity, `trending:week` rows, 1-day TTL) |

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
carry `tmdbPersonId` and open the same person page. A "check key" button
in the settings section validates the API key against `/configuration`.

## Match Confidence

Wrong metadata is worse than no metadata, so id resolution is conservative:

1. If the provider returns a usable `tmdb_id` (Xtream VOD info often does),
   it is trusted fully and no search runs. Series have no show-level
   `tmdb_id`, so they always go through search.
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
the *request* language, so a Cyrillic query issued with `en-US` would come
back with an English title and fail the exact-match gate.
`tmdbSearchLanguageForTitle` detects Cyrillic queries and issues the search
with `ru-RU` (unless the app language is already Cyrillic-based); details
are still fetched in the app language afterwards.

## Details Fetch and Localization

Details are fetched with
`/movie/{id}?append_to_response=credits,videos,recommendations` (`/tv/{id}`
for series). Credits provide cast/director; videos supply the best YouTube
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
`TmdbEnrichmentService.getSeasonEpisodes` (cached per language under
`id:{tmdbId}|season:{n}`) and overlay it with `mergeEpisodesWithTmdb`:

- generic provider titles ("Episode 4", "Серия 4", "S01E04", bare numbers)
  are replaced with real episode names; meaningful provider titles are kept
- overviews and stills are TMDB-preferred; air date and rating only fill
  empty provider fields; durations stay provider-owned
- episodes without a TMDB counterpart (by episode number) pass through
  untouched

Wiring: Xtream — `XtreamStore.enrichSelectedSerialSeason(seasonKey)` fired
from the serial detail's `(seasonSelected)`; Stalker — the series view
keeps a `${tmdbId}|${seasonKey}`-keyed map and overlays it inside its
`mappedSeasons` computed. Without a show-level match or with enrichment
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

Single table with two row kinds discriminated by `lookup_key` prefix:

```
tmdb_metadata (
  media_type  'movie' | 'tv' | 'person',
  lookup_key  'id:<tmdbId>'                  -- details payload row
              'title:<normalized>|year:<y>'  -- search resolution row
              'person:<personId>'            -- person payload row
  language    TEXT,       -- TMDB language code
  tmdb_id     INTEGER,    -- NULL on a search row = negative cache
  payload     TEXT,       -- raw JSON details, NULL for search rows
  fetched_at  TEXT,
  UNIQUE(media_type, lookup_key, language)
)
```

TTLs (enforced at read time in `TmdbCacheService.isFresh`): details and
positive matches 30 days, negative matches 7 days.

Electron IPC path (follows the standard DB worker contract, see
[SQLite DB Worker](./sqlite-db-worker.md)):

- Worker ops: `DB_GET_TMDB_METADATA`, `DB_SET_TMDB_METADATA`
  (`database-worker.types.ts`, `database.worker.ts`,
  `operations/tmdb.operations.ts`)
- IPC registration: `events/database/tmdb.events.ts`
- Preload bridge: `dbGetTmdbMetadata` / `dbSetTmdbMetadata` on
  `window.electron` (typed in `ElectronBridgeApi`)

The PWA uses a session-scoped in-memory map (acceptable for phase 1; TMDB
supports CORS so the PWA calls the API directly).

## Settings and API Key

`Settings.tmdb?: { enabled: boolean; apiKey?: string }`
(`libs/shared/interfaces/src/lib/tmdb.interface.ts`). The settings page has
a "Metadata (TMDB)" section (enable toggle + optional API key override).

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

Similar/recommendations rails, actor cross-catalog search, trending
dashboard rail, artwork upgrade for M3U VOD, persistent PWA cache
(IndexedDB).

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
- **Hero extras**: `DashboardHeroTmdbService`
  (`libs/workspace/dashboard/feature`) patches the hero card with a TMDB
  backdrop (when the provider item has none), a rating badge and up to two
  genre chips — resolved through the enrichment facade, so items already
  opened in a detail view come from the SQLite cache without network.
  Results are memoized per title for the session. The hero renders
  immediately from provider data; extras appear when resolved. Series
  heroes additionally show the tracked "S{n}·E{n}" badge from the playback
  position (no TMDB involved); the watch-progress bar is limited to
  movie/series heroes.
