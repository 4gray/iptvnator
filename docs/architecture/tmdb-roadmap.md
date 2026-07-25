# TMDB Capability Roadmap

Follow-up backlog for the TMDB metadata subsystem: what the API still
offers that we do not use, what it would cost, and what we deliberately
will not build. Companion to
[TMDB Metadata Enrichment](./tmdb-metadata-enrichment.md), which
documents what already ships.

Produced by a multi-agent audit (2026-07-24) that cross-checked our code
against the official TMDB API reference and against how Plex, Jellyfin,
Emby, Stremio and Kodi present metadata. Line numbers reference the state
of the repo at that date and will drift — treat them as pointers, not
addresses.

> Three items in here are **defects in shipped code**, not features:
> A1 (broken provider `tmdb_id` suppresses enrichment), A2 (series cast is
> latest-season-only) and F1 (cache retention exceeds the TMDB ToS limit).
> They come first.

## 0. The one decision that gates everything

`buildDetailsLookupKey` (`libs/services/src/lib/tmdb/tmdb-matcher.ts:79-83`) is `id:{tmdbId}|v2`. Six separate ideas below each "need a v3 bump", and a bump invalidates **every cached details row for every user**. Make this decision **once**:

**One consolidated append PR** — add `images,release_dates,content_ratings,alternative_titles,aggregate_credits` to the two detail calls (`tmdb-api.service.ts:62,74`), trim `images` down to the chosen logo + top posters _before_ `TmdbCacheService.set`, and bump the key to `v3` — scoped by `mediaType` so movie rows aren't invalidated by the TV-only `aggregate_credits` addition. Everything downstream then ships as pure presentation PRs with no further refetch events.

Ship the **cache retention sweep first** (§4, #8) so the bump's orphaned rows have a reaper.

---

## 1. Zero-extra-call wins — data already on disk today

These read fields already sitting in `tmdb_metadata.payload` (stored verbatim per `tmdb.types.ts:1-5`). **No new HTTP, no cache-key bump, no schema change.** This is the cheapest tier in the entire roadmap.

| Feature                                                            | Field already cached                                                                                                                                             | Cost                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Extras shelf** (Featurette / BTS / Bloopers / Clips)             | `videos.results[]` — `pickTrailerKey` (`tmdb-merge.ts:110-119`) keeps 1 of ~15                                                                                   | L/M                          |
| **Series structure** (status chip, season posters, episode counts) | `/tv/{id}` base: `seasons[]`, `status`, `in_production`, `next_episode_to_air`, `number_of_seasons` — **none typed** in `TmdbTvDetails` (`tmdb.types.ts:99-107`) | L/M                          |
| **Franchise strip**                                                | `belongs_to_collection` on every enriched movie — untyped, discarded                                                                                             | (needs 1 call for `parts[]`) |
| **Tagline** on detail hero                                         | `tagline` on both detail responses                                                                                                                               | S                            |
| **Full cast beyond 10 / whole crew**                               | `credits.cast[]` (30-100 entries, `MAX_CAST_NAMES=10`), `credits.crew[]` (writers, composers, DoP — filtered to `job==='Director'`)                              | M                            |
| **Recommendations 13-20 + their overviews/backdrops/ratings**      | `recommendations.results[]` (20 cached, 12 kept, 4 of 15 fields kept)                                                                                            | S                            |
| **`deathday` on actor pages**                                      | Already parsed into `ActorProfile` (`tmdb-person.ts:51`), never rendered                                                                                         | **XS — one template line**   |
| **Episode runtimes, "Season Finale" badges**                       | Season payload `runtime`, `episode_type`, `vote_count` (typed, unused)                                                                                           | S                            |
| **"Because you watched X"**                                        | `recommendations` on any opened title                                                                                                                            | M                            |

⚠️ **Caveat on all of them:** the `merge*WithTmdb` functions write a _fixed projection_. Reading a new field means extending the merge (three interfaces + `NormalizedVodMeta` + both normalizers in `vod-details-adapters.ts`) **or** a lazy cache read via `TmdbCacheService.get(mediaType, buildDetailsLookupKey(id), lang)` — the pattern `TmdbSeasonService.originalShowLanguage` already uses (`tmdb-season.service.ts:77-92`).

⚠️ **Second caveat, non-English locales:** TMDB language-filters `videos`, so the extras shelf is frequently empty for ru/ar/ja users. Reuse the existing original-language fallback payload (`tmdb-language-fallback.ts`) rather than adding `include_video_language` — that param would force the shelf into the v3 bump.

---

## 2. Themes, ordered by value-to-effort within each

### Theme A — Match accuracy (HIGH LEVERAGE: fixes the existing integration)

These add **no surface area**. They make what already ships correct. High leverage: every one of them multiplies the value of every other TMDB feature, because nothing renders when the match fails.

| #   | Idea                                                                                                                                                                                                                                                                                                             | Effort  | Note                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | **Distrust broken provider `tmdb_id`** — a garbage-but-integer id short-circuits title search; `getDetails` 404s, outer catch swallows, **zero enrichment on an item title search would have handled**. Worse: a _stale-but-valid_ id returns a confidently-wrong payload with **no title sanity check at all**. | **S/M** | Confirmed bug. Xtream movies only (`xtream-tmdb-enrichment.ts:56` is the sole path passing `tmdbId`), but that's the highest-traffic detail view.                              |
| A2  | **`aggregate_credits` for TV** — `/tv/{id}/credits` is documented as "the latest season credits". **Our series cast chips are quietly wrong for long-running shows.** Closer to a bug fix than a feature.                                                                                                        | **M**   | Append `credits,aggregate_credits` together and union — TMDB's own docs say aggregate "does not return the newest season".                                                     |
| A3  | **`alternative_titles` synonym index** — write one cache row per normalized alternate title pointing at the resolved `tmdb_id`, using the existing search-lookup-key shape so lookups stay point-shaped.                                                                                                         | M       | Chicken-and-egg: only helps titles we already matched. Real payoff arrives after a warm pass.                                                                                  |
| A4  | **`/search/multi` for ambiguous media type only** (Stalker `is_series`, Ministra VOD)                                                                                                                                                                                                                            | M       | ⚠️ Do **not** frame as "halves search calls" — we search one type, not two. It's a _typing_ fix. And multi's single mixed 20-result page can _lower_ recall as a primary path. |
| A5  | **Network resilience** — typed `TmdbApiError`, in-flight coalescing, 429/5xx backoff, a visible bad-key signal                                                                                                                                                                                                   | M       | 401 currently indistinguishable from "TMDB doesn't have this title".                                                                                                           |

**Dropped from this theme:** `/find/{external_id}`. Verified — **no provider interface in this repo carries an IMDb or TVDB id**, only `rating_imdb` (a score). M3U `tvg-id` is an XMLTV _channel_ id, and M3U has no TMDB enrichment at all. It has no inbound caller.

**Before shipping A3/A4: add match/miss instrumentation.** There is no measurement today, so "fixes the 33% miss" is currently unfalsifiable.

### Theme B — Artwork & cinematic polish

| #   | Idea                                                     | Effort | Note                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **Title logos (clearlogo) on detail + dashboard heroes** | M/H    | Plex, Emby, Kodi and Jellyfin all independently converged on the same `clearlogo` asset. Biggest perceived-quality delta available. **Zero new i18n keys.**                                                                 |
| B2  | **Localized poster / textless backdrop selection**       | M      | Same `images` append. Pure merge-output change, both environments.                                                                                                                                                          |
| B3  | **Extras shelf**                                         | L/M    | See §1.                                                                                                                                                                                                                     |
| B4  | **Editorial meta rail** (tagline + certification plate)  | M      | Tagline is free today; certification joins the v3 append.                                                                                                                                                                   |
| B5  | Poster-derived ambient palette                           | M/H    | `image.tmdb.org` returns `access-control-allow-origin: *`, so the canvas is untainted. But it must **not** animate over the Embedded MPV transparency hole, and needs an owning service with teardown-on-navigation. Defer. |

⚠️ B1 gotcha: `include_image_language` takes **ISO 639-1** codes, but `TmdbRuntimeService.language()` returns region-suffixed (`ru-RU`). A `.split('-')[0]` helper doesn't exist yet. And the param is **mandatory** — without it, appended images inherit `language=ru-RU` and return near-empty logos for all 17 non-English locales.

⚠️ B1 honesty: logo coverage is thin for the regional/older fare that dominates IPTV catalogs. A fixed-height title box changes layout for 100% of titles to serve maybe half. That's a deliberate design call, not a free win.

### Theme C — Series / anime handling

| #   | Idea                                                                         | Effort   |
| --- | ---------------------------------------------------------------------------- | -------- |
| C1  | **Series structure**: status chip, season posters, per-season episode counts | L/M      |
| C2  | **Next-episode line**, gated on `TmdbCacheService.isFresh(entry, ~2 days)`   | S        |
| C3  | Season completeness ("portal has 6 of 8 seasons")                            | S, gated |

⚠️ C1: TMDB returns `status` as an **English string** (`"Ended"`, `"Returning Series"`) even under `language=ru-RU`. Map to i18n keys — never render raw into 18 locales.
⚠️ C2: the details TTL is 30 days, so `next_episode_to_air` will routinely be a date **weeks in the past**. Suppress when stale; never refetch.
⚠️ C3: compare season **numbers** present against `seasons[]` filtered to `season_number > 0`, not counts. A provider dumping every episode under season 1 would otherwise produce a false "missing 7 seasons" claim. Suppress entirely on any misalignment, and phrase strictly as an observation about the portal.

**Anime absolute-vs-aired ordering (`episode_groups`): deprioritized.** IPTV providers name episodes arbitrarily; there's no stable key to map onto a TMDB group order. High risk of playing the wrong episode. If ever built: display-only toggle, never mutating stored identity or playback positions (the Sonarr #6547 lesson — upstream numbering changes physically reshuffled users' libraries).

### Theme D — Browse & discovery

| #   | Idea                                                 | Effort          |
| --- | ---------------------------------------------------- | --------------- |
| D1  | **"Because you watched X" rail**                     | M               |
| D2  | **Franchise strip** (owned/unowned)                  | M               |
| D3  | Genre / decade / rating facets over your own catalog | **H — blocked** |
| D4  | Mood shelves from keywords (pill row only)           | M               |

⚠️ **The recurring architectural trap:** every catalog-first rail surfaces content the user cannot play. The Trending rail already solves this with batched `DB_MATCH_TITLES`. **Hide the rail on zero matches** — an empty shelf is worse than no shelf.

⚠️ D3 is hard-blocked. `content` (`schema.ts:92-127`) has no `year`, `genre`, `runtime` or `tmdb_id`, and there is **no joinable key to `tmdb_metadata`**. Filtering isn't even SQL — `filteredAndSortedContent()` (`with-selection.feature.ts:339-444`) is in-memory over the loaded array. This needs the metadata index below.

⚠️ D4's dashboard-shelf half is not currently possible: `TmdbCacheService` is **point-lookup only**, there is no scan op over `tmdb_metadata`, and cache rows carry no back-reference to a content row. Ship the pill row alone. Also: TMDB keywords are an **English-only controlled vocabulary** — they'll render as English lowercase strings next to fully localized genres in 18 locales.

### Theme E — Library index (the prerequisite everything blocked is blocked on)

Canonical titles in grids, rating/year badges on cards, genre/decade browse, family mode, cross-surface artwork overrides — **all five reduce to the same missing primitive.** They cannot ship without it and should not be scheduled separately.

**The right shape** (correcting the obvious approach): a **side table `content_tmdb` keyed on `(playlist_id, content_type, xtream_id)`** — _not_ columns on `content`. `clearXtreamImportCache` (`content.operations.ts:1063-1100`) deletes content rows, and `content.id` is an autoincrement surrogate that isn't stable across re-import; denormalized columns would be wiped on every catalog refresh.

**Blockers, all hard:**

- **The shared release key.** `.github/workflows/build-and-make.yaml:402-406` injects one `TMDB_API_KEY` into every installed copy. Bulk backfill on that key is exactly the traffic shape TMDB throttles ("upper limits to help mitigate needlessly high bulk scraping"). Must be **hard-gated to a user-supplied personal key**, not merely "explicit consent".
- **No 429/backoff machinery exists** (Theme A5 is a prerequisite).
- **Per-item IPC.** 40k warm writes = 40k+ worker round-trips. Batched cache ops are a prerequisite, not an optimization.
- **6-month retention** must ship _with_ it, not after — bulk warming is precisely a mechanism for maximizing held TMDB data.
- **Coverage:** Xtream + Electron only. Stalker, M3U and every PWA user get zero. Cannot be sold as "my library".

Realistic: **H, multi-PR.** Worth doing eventually; not worth doing next.

### Theme F — Correctness & compliance hygiene

| #   | Idea                                       | Effort |
| --- | ------------------------------------------ | ------ |
| F1  | **6-month cache TTL sweep + purge button** | L+     |
| F2  | **"Wrong movie?" manual match override**   | M      |

F1 is a **live compliance gap in shipped code**, not a feature. `tmdb.operations.ts` has only `get`/`set`; `setTmdbMetadata` uses `onConflictDoUpdate`, so untouched rows persist forever. The ToS caps retention at 6 months. `fetched_at` already exists (`schema.ts:376`).

### Theme G — Cross-device / accounts

**Deliberately empty.** See §5.

---

## 3. Top-8 ranked shortlist

| #     | What it is                                                                                                                            | Endpoint                                                     | Why it matters for IPTV specifically                                                                                                                                                                                                                                  | Effort  | Type                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------- |
| **1** | **Distrust broken provider `tmdb_id`** — try details, fall back to title search on 404 _or_ title mismatch; negative-cache the bad id | none (uses existing `/movie\|tv/{id}` + `/search/*`)         | IPTV providers ship _garbage_ `tmdb_id` values. Every bad id is a detail page with **no plot, no cast, no poster** — for an item title search would have matched. Zero i18n.                                                                                          | **S/M** | **Quick win** ⚡ **high leverage** |
| **2** | **6-month TTL sweep + purge button**                                                                                                  | none                                                         | Live ToS violation in shipped code. Also the escape hatch for the v3 bump's orphaned rows.                                                                                                                                                                            | **L+**  | Quick win (risk removal)           |
| **3** | **Extras shelf** (Featurette/BTS/Bloopers)                                                                                            | `videos` — **already appended**                              | Plex _pays a licensing fee_ for extras; Emby/Infuse need local files. IPTVnator can't have either — YouTube-hosted extras are the only possible implementation, and the nocookie embed + Electron Referer shim already ship.                                          | **L/M** | **Quick win** ⚡                   |
| **4** | **`aggregate_credits` for TV**                                                                                                        | `append_to_response=credits,aggregate_credits` on `/tv/{id}` | `/tv/{id}/credits` returns **only the latest season**. Our series cast chips are wrong today for every long-running show. Bug fix wearing a feature costume.                                                                                                          | **M**   | **Quick win** ⚡ **high leverage** |
| **5** | **Series structure** (status chip, season posters, episode counts)                                                                    | `/tv/{id}` base fields — **already cached**                  | IPTV series come as an undifferentiated pile of season folders with no art and no signal. Season posters + "Ended / Returning" + episode counts turn that into something navigable. Zero calls, zero bump.                                                            | **L/M** | **Quick win** ⚡                   |
| **6** | **Title logos on heroes**                                                                                                             | `append_to_response=images` + `include_image_language`       | The single largest perceived-quality upgrade available, and the pattern all five incumbents converged on independently. Zero new i18n keys across 18 locales.                                                                                                         | **M/H** | **Strategic bet**                  |
| **7** | **"Because you watched X" rail**                                                                                                      | `recommendations` — **already appended & cached**            | >80% of Netflix viewing comes from rails, not search. IPTVnator's dashboard is _all history rails_ — a user with three playlists and no watch history gets no discovery at all. This is the first rail that answers "what should I watch".                            | **M**   | **Strategic bet**                  |
| **8** | **"Wrong movie?" manual match override**                                                                                              | `/search/multi` (one call per dialog open, user-typed)       | The honest complement to #1: automated matching will still fail on polluted catalogs, and today there is **no recovery path** — the user sees the wrong film's plot forever. Precedent exists: `epg-mapping-dialog` binds a dirty provider entity to a canonical one. | **M**   | **Strategic bet**                  |

**Just outside:** franchise strip (M, but `belongs_to_collection` is null for most catalog titles — rare payoff); network resilience A5 (M, prerequisite for anything bulk); `alternative_titles` synonym index (M, but low standalone gain until a warm pass exists).

---

## 4. Deliberately NOT building

| Idea                                                   | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Family mode / certification gate + PIN**             | Enrichment is lazy and per-open, so a gate **fails open on every unmatched title** (passes everything) or **fails closed** (empty app on day one). Structurally impossible for PWA (no catalog DB), Stalker (server-paginated) and M3U (no enrichment at all) — and TMDB covers **no live channels**, which is where IPTV family risk actually concentrates. An age gate that silently passes unmatched titles is worse than none, because parents will trust it. **Ship instead:** adult-category keyword blocklist + Stalker's existing `censored` flag + PIN, with TMDB certification as a per-title **badge only**. Never describe the badge as a safety feature, in UI copy or release notes. |
| **`/find/{external_id}`**                              | Verified: no provider interface in this repo exposes an IMDb or TVDB **id** — only `rating_imdb` (a score). M3U `tvg-id` is an XMLTV _channel_ id, and M3U has no TMDB path. The only `imdb_id` obtainable comes from TMDB itself, which is circular. No inbound caller exists.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`watch/providers`**                                  | Tells the user a title is on Netflix. In a player whose premise is the user's _own_ streams, this reads as an ad for a competitor and drags in a mandatory JustWatch attribution obligation on top of ours. Direct conflict with the product stance.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **TMDB / Trakt account sync (v3 session or v4 OAuth)** | Requires every user to hold a TMDB account and complete a browser OAuth flow, to sync data we already store _better_ — our favorites are playlist-scoped and playlist-aware; TMDB's are not. High friction, new credential surface, low payoff. Guest sessions expire in 60 min with no reattachment — a dead end.                                                                                                                                                                                                                                                                                                                                                                                 |
| **Quality/rating badges on grid cards**                | No join key from `content` to `tmdb_metadata`, no batched cache-read IPC op, and near-zero coverage without a bulk warm pass. Blocked behind Theme E. _Salvage now:_ the subtitle-consistency fix + a **provider**-rating badge on `app-content-card`.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Canonical titles in grids**                          | Same missing join key — plus a sharper unnamed regression: search runs trigram FTS over `content_title_fts`, which holds **provider** titles. Show "The Matrix", the user types "The Matrix", the indexed `"EN - Matrix, The 1080p 2019"` doesn't match. Cleaning display titles without indexing canonical titles **actively makes search worse**. _Ship the cheap subset:_ canonical title on the **detail hero only**, provider string demoted into the About block.                                                                                                                                                                                                                            |
| **Empty-state artwork mosaic**                         | Wrong reuse target (`portal-empty-state` is live-TV-only), and it cannot render in the first-run case it's designed for — TMDB is default-off and the library is empty. _Salvage:_ the `/search/multi` teaching message on a genuine zero-result search ("_Dune: Part Two_ exists, but it isn't in this playlist") — points at the user's own playlist, never outward.                                                                                                                                                                                                                                                                                                                             |
| **User-facing smart-collection rule builder**          | Kometa's 3.4k stars represent real but self-selecting power-user demand. Large UI surface, and IPTV catalogs churn — saved rules rot silently between refreshes. Ship a handful of curated dynamic rails instead: ~90% of the value, ~10% of the surface.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Audio/subtitle language badges from TMDB**           | TMDB has **no subtitle data at all**; `spoken_languages` describes the _work_, not the _stream_. A wrong badge is worse than no badge. Correct sources are Xtream `get_vod_info` codec fields and HLS `#EXT-X-MEDIA` at playback time. Explicitly out of scope for TMDB work.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Anime absolute-vs-aired episode ordering**           | Provider episode labels are arbitrary — no stable key to map onto a TMDB group order. High risk of playing the wrong episode. `episode_groups` `type` integers aren't even in the official spec.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Poster-derived ambient palette (for now)**           | Technically viable (CORS verified), but it's a global mutable style channel needing an owning service with navigation teardown, dual-theme WCAG clamping, and — critically — it must not animate over the Embedded MPV transparency hole, the exact class of change that broke native-view before. Not worth it yet.                                                                                                                                                                                                                                                                                                                                                                               |

---

## 5. Implementation sketches — top 3

### #1 — Distrust broken provider `tmdb_id`

**The bug**, in `libs/services/src/lib/tmdb/tmdb-enrichment.service.ts` `enrich()`:

```ts
const tmdbId = parseProviderTmdbId(query.tmdbId) ?? (await this.resolveIdBySearch(...));
if (tmdbId === null) return null;
return await this.getDetails(mediaType, tmdbId);
```

A garbage-but-integer provider id short-circuits the search entirely. `getDetails` → `fetchDetails` → `api.request()` throws on the 404, the outer catch logs and returns `null`. **Zero enrichment, permanently, for an item title search would have resolved.** The stale-but-_valid_ id case is worse — it never throws, and there is no title sanity check, so it silently renders another film's plot and cast.

**Files:**

- New `libs/services/src/lib/tmdb/tmdb-id-resolver.ts` — `resolveTmdbId(mediaType, query, {api, cache, runtime}) → number | null`. Extraction is needed regardless: `tmdb-enrichment.service.ts` is **290 lines, at the ceiling**, and idea #8 needs the same extraction.
- `tmdb-enrichment.service.ts` — inject the resolver; `enrich()` becomes try-details-then-fall-back-to-search.
- `tmdb-matcher.ts` (166 lines, room) — reuse `normalizeTitle` + `buildSearchTitleVariants` for the sanity check; add a `badProviderId:{id}` negative-cache key builder.

**Logic:** if `parseProviderTmdbId` yields an id, attempt `getDetails`. On throw **or** on a resolved title whose `normalizeTitle()` matches none of `buildSearchTitleVariants(query.title, query.originalTitle)` → write a negative row under `badProviderId:{id}` and fall through to `resolveIdBySearch`. **The negative cache is not optional** — a failed details fetch currently caches nothing, so every re-open retries the 404 forever; without it you trade one wasted request for two, permanently.

**Regression spec:** (a) a provider `tmdb_id` that 404s still produces enrichment via title search; (b) a provider `tmdb_id` resolving to a mismatched title is rejected; (c) the happy path issues exactly one details request and **no** search.

Zero i18n keys. Zero UI change.

---

### #2 — Cache retention sweep + purge button

**Files (the five DB-worker sync points, plus two fixtures):**

- `apps/electron-backend/src/app/database/operations/tmdb.operations.ts` — add `purgeTmdbMetadataOlderThan(db, cutoff)` and `getTmdbMetadataStats(db)` beside the existing `get`/`set`.
- `apps/electron-backend/src/app/workers/database-worker.types.ts:52-54`
- `apps/electron-backend/src/app/workers/database.worker.ts:596-620`
- `apps/electron-backend/src/app/events/database/tmdb.events.ts`
- `apps/electron-backend/src/app/api/main.preload.ts:784-792`
- `libs/shared/interfaces/src/lib/electron-api.interface.ts:816-823`
- Fixtures: `main.preload.spec-data.ts:364`, `worker-ipc-contract.spec-data.ts`
- UI: `apps/web/src/app/settings/settings-tmdb-section.component.{ts,html}` (87/113 lines, headroom)

**Two defects to design around:**

1. `setTmdbMetadata` writes `fetched_at` as an **ISO-8601 string**, but the column DEFAULT is `datetime('now')` (space-separated, no `Z`). A naive `WHERE fetched_at < ?` string compare is **wrong** — `'T'` sorts after `' '`. Use `julianday(fetched_at)`.
2. Do **not** reuse the `appState` one-off migration-guard pattern. A retention sweep is _recurring_; the key must store a **last-swept timestamp**, not a boolean, or it runs exactly once in the app's lifetime.

**Sweep:** fire from the DB worker **after first paint** (never on the startup critical path), ≥24h cadence, `DELETE WHERE julianday('now') - julianday(fetched_at) > 180`.

**Panel:** "Metadata cache: N entries, X MB" + Clear button. Compute size **only on section expand** — `SUM(...)` is a full scan. Use `LENGTH(CAST(payload AS BLOB))`; SQLite `LENGTH()` on TEXT counts _characters_, not bytes.

**Regression spec:** rows at 179 and 181 days survive / are deleted; both `fetched_at` formats handled.

**Doc note** in `docs/architecture/tmdb-metadata-enrichment.md`: the Clear button is also the escape hatch for the v3 key bump — a bump _orphans_ rows rather than deleting them, so without this they sit until the 180-day sweep reaches them.

**Out-of-scope note worth recording:** `downloads.poster_url` (`schema.ts:334`) can hold an `image.tmdb.org` URL when a download starts from an enriched detail page. The purge doesn't cover it.

---

### #3 — Extras shelf

**Prerequisite split.** `libs/services/src/lib/tmdb/tmdb-merge.ts` is **302 lines** — over the 300 target. Extract into `libs/services/src/lib/tmdb/tmdb-videos.ts`:

- `pickTrailerKey` — **unchanged**, so nothing downstream breaks
- `groupVideosByType(details, {limit: 6})` → `{key, type, name, language}[]`, filtered to `site === 'YouTube'`, deduped by key, **official-preferred rather than official-only** (plenty of genuine studio featurettes carry `official: false`; a hard filter empties the shelf on most catalog titles), excluding the key already used as the trailer

**Data path** (the merge writes a _fixed projection_ — this is not "read the payload in the component"):

- `tmdb_videos?: TmdbVideoRef[]` on `XtreamVodInfo`, `XtreamSerieInfo`, `StalkerVodInfo`
- populated in all three of `mergeVodInfoWithTmdb` (`:168`), `mergeSerieInfoWithTmdb` (`:215`), `mergeStalkerInfoWithTmdb` (`:257`)
- through `NormalizedVodMeta` (`libs/shared/interfaces/src/lib/vod-details-item.interface.ts`) + **both** normalizers in `vod-details-adapters.ts` — the single convergence point where Xtream and Stalker meet

**Component.** New standalone `app-tmdb-extras-shelf` in `libs/ui/shared-portals`. It must **not** go inline: `libs/ui/playback/src/lib/vod-details/vod-details.component.ts` is **388 lines and is NOT in `tools/eslint/max-lines-baseline.mjs`** — roughly 12 lines of headroom against the hard 400 lint cap.

**Render** into the `detail-extras` projection slot at **four** sites (`vod-details.component.html:225`, `serial-details.component.html:201`, `vod-details-route.component.html:247`, `stalker-series-view.component.html:202`) — note Xtream `serial-details` has no trailer block today, so it either gains one or the shelf lands inconsistently. Reuse the existing nocookie iframe + `| safe` pipe so the Electron Referer shim keeps working; clicking swaps the embed `src` rather than opening a new player. Cards use `https://img.youtube.com/vi/{key}/hqdefault.jpg` (CSP verified: `img-src` covers it, `frame-src https://www.youtube-nocookie.com` covers the embed). `@if (extras().length > 1)` … `@else` the existing single-trailer markup **verbatim**.

**Labels** come from translation keys on the TMDB type enum, **never** from `video.name` (5-6 keys × 18 locales via the `i18n-fill` skill).

**Coverage honesty:** ship the en-correct version first. For non-English locales the shelf is empty on most titles until either the original-language fallback payload is reused or `include_video_language` lands — and the latter forces the v3 bump, so it belongs in the consolidated append PR, not here.

---

## 6. Suggested sequence

1. **A1** (broken `tmdb_id`) + **F1** (retention sweep) — correctness and compliance, no new surface, no cache bump
2. **Extras shelf** + **series structure** — pure zero-call presentation wins off already-cached payloads
3. **Consolidated v3 append PR** — `images` + `release_dates`/`content_ratings` + `alternative_titles` + `aggregate_credits`, with payload trimming, mediaType-scoped key
4. **Title logos**, **certification plate**, **aggregate-credits cast fix** — all ride the bump landed in step 3
5. **"Because you watched X"** + **"Wrong movie?" override** — the two strategic bets
6. **Theme E** (library index) — only after A5 (backoff), batched cache ops, and a personal-key gate exist
