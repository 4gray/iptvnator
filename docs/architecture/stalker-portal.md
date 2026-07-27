# Stalker Portal Architecture

This document describes the Stalker portal implementation in IPTVnator and where each feature is integrated.

## Related Docs

- [Stalker Portal EPG Architecture](./stalker-epg.md)
- [Playlist Backup/Restore Architecture](./playlist-backup-restore.md)
- [Portal Detail Navigation](./portal-detail-navigation.md)
- [Embedded Inline Playback](./embedded-inline-playback.md)
- [Remote Control Architecture](./remote-control.md)
- [Download Manager](./download-manager.md)
- [Category Management](./category-management.md)
- [Stalker Store API Baseline](./stalker-store-api-baseline.md)
- [Stalker Authentication and Client Compatibility Audit](./stalker-authentication-compatibility-audit.md)

## Scope

Stalker support covers:

- Live TV (`itv`)
- Radio (`radio`)
- VOD (`vod`)
- Series (`series`)
- VOD-as-series flows (`is_series=1` and embedded `series[]`)
- Favorites and recently viewed collections
- Search
- External player playback (shared Xtream player infrastructure)
- Remote control for live ITV navigation

## Routing Structure

Primary route tree lives in
`libs/portal/stalker/feature/src/lib/stalker-feature.routes.ts`.

- `/stalker/:id/vod` (plus `vod/:categoryId` child)
- `/stalker/:id/series` (plus `series/:categoryId` child)
- `/stalker/:id/itv`
- `/stalker/:id/radio`
- `/stalker/:id/favorites`
- `/stalker/:id/recent`
- `/stalker/:id/search`
- `/stalker/:id/actor/:personId`
- `/stalker/:id/downloads` (shared `DownloadsComponent` from `@iptvnator/portal/downloads/feature`)

## Runtime Architecture

Stalker has two deliberately separate request paths:

1. Electron full portals use `StalkerSessionService`, which exposes only typed
   application operations and opaque lease/challenge references.
2. Electron main handles `STALKER_SESSION_OPEN`, `CONTINUE`, `REQUEST`, and
   `CONTROL` in `stalker-session.events.ts`. `StalkerSessionManager` owns
   endpoint discovery, the RFC cookie jar, handshake/profile state, credentials,
   token generations, serialized refresh, watchdogs, and playback contexts.
3. `stalker-operation-adapter.ts` maps the allowlisted catalog, EPG, search,
   detail, and `create_link` operations to portal wire parameters. Renderer
   callers cannot submit raw auth actions or managed auth parameters.
4. A successful `create_link` returns the stream URL plus a one-use,
   sender-bound `playbackContextRef`. Embedded MPV and external MPV/VLC IPC
   consume that reference to obtain main-owned authorization and cookie
   headers. Built-in web players currently carry but do not consume the
   reference.
5. Explicitly simple Electron portals and the PWA keep the legacy
   `STALKER_REQUEST`/HTTP adapter. They do not acquire a main-owned full
   session.

The primary ownership points are:

- pure URL, response, identity, state-machine, and request-policy rules:
  `libs/portal/stalker/protocol/`
- renderer facade and playlist descriptor mapping:
  `libs/portal/stalker/data-access/src/lib/stalker-session*.ts`
- route connection orchestration:
  `libs/portal/stalker/feature/src/lib/stalker-connection-flow/` and
  `stalker-workspace-route-session.service.ts`
- Electron runtime:
  `apps/electron-backend/src/app/services/stalker-session/`
- typed IPC registration:
  `apps/electron-backend/src/app/events/stalker-session.events.ts`

Bearer tokens, handshake randoms, server cookies, credentials, internal session
keys, and player headers must never be returned through preload, diagnostics,
or persisted playlist metadata.

## Connection Classification and Persistence

Endpoint discovery starts from a source that may be a root URL, landing
directory, `portal.php`, `server/load.php`, or a custom prefix. The landing
request is anonymous. Derived candidates are bounded, de-duplicated, and
probed sequentially with an isolated jar. A validated handshake plus first
profile selects `full-session`; only an explicitly unsupported auth shape plus
a recognized read-only catalog response may select `stateless-mac`.

An origin-changing redirect pauses before identity-bearing traffic and requires
confirmation showing the exact source and target origins. An explicitly
entered private or loopback source remains supported. Anonymous discovery
rejects a public-to-private redirect before the target hop is contacted;
identity-bearing cross-origin redirects pause before target preparation or
contact and require explicit approval. Profile status `2` opens the
username/password challenge; `do_auth` is sent only then, and
`auth_second_step=1` is sent only after canonical `do_auth` success. Blank
credentials are never submitted. The three-submission credential budget
belongs to the whole connection attempt and survives auth-session replacement
or coordinator epoch changes.

Imports, explicit re-detection, and lazy migration use provisional attempts:

1. resolve and authenticate without mutating the stored playlist;
2. build a non-secret persistence draft;
3. atomically save the playlist row;
4. commit the provisional main-process session;
5. report Connected and initialize the Stalker store.

Cancel or route navigation discards the provisional attempt. A failed local
write retains the bounded ready attempt and draft so Save Again can retry
persistence without repeating discovery or authentication; abandoning the
retry discards it. Existing route content is not initialized before the
connection flow is ready. Terminal open, recovery, and lease-activation
failures keep their stable reason visible in an actionable snackbar; Retry
performs one explicit re-detection instead of silently exposing the playlist
or looping in the background.

Response handling is fail-closed. Unknown profile statuses, malformed JSONP,
valid JSON with an incompatible MIME type, invalid handshake/catalog shapes,
and ambiguous auth bodies stop as `incompatible-response`; they cannot silently
downgrade a full portal to stateless mode. Only explicit unsupported endpoint
statuses (`404`, `405`, and `501`) or a narrowly classified, non-auth,
plain-HTML endpoint-shape miss with the known Stalker/Ministra landing-shell
markers advances discovery. Generic HTML/XML, account denials, gateway pages,
and unknown protection pages remain terminal. An HTML `404` remains eligible
for the next bounded candidate. A valid API envelope with an incompatible MIME
type remains fail-closed for ordinary candidates; only a persisted learned
endpoint may treat a body rejected solely by media type as a stale-hint miss
and continue bounded discovery.

Persisted compatibility fields are:

- `stalkerSourceUrl`
- verified `portalUrl` and `stalkerLandingUrl`
- `stalkerRequestRecipe` and `stalkerRecipeClassifierVersion`
- `stalkerProfilePreset`
- explicit `stalkerIdentityOverrides`
- explicit `stalkerTransportConfiguration`
- `stalkerLastVerifiedAt`
- `isFullStalkerPortal` for legacy compatibility

`stalkerToken`, cookies, random values, leases, challenges, and playback
contexts are never persisted. Saved credentials are loaded through the non-EPG
database worker as an attempt-scoped candidate only when source, MAC, profile
preset, effective identity, and effective transport configuration match. They
become session credentials only after canonical authentication succeeds;
stateless reclassification clears the stored pair.

Deleting one playlist waits for the database delete and then cleans all
main-owned attempts, leases, watchdogs, and playback contexts for that playlist.
Delete-all destroys the complete Stalker session runtime. Failed database
deletes do not tear down sessions.

A current `stalkerRequestRecipe` plus classifier version is authoritative and
overrides the legacy `isFullStalkerPortal` hint. Missing or stale recipes are
classified provisionally. If a current stateless recipe receives `404`, `405`,
`501`, or an incompatible endpoint envelope, the original operation performs
one single-flight provisional re-detection, persists and commits the updated
recipe, then reissues itself once.

## Session Watchdog

Each active full-session principal has one main-process watchdog. Its interval
prefers a positive profile `timeslot`, then `watchdog_timeout`, defaults to 25
seconds, clamps to 10 seconds–5 minutes, and applies ±10% jitter. A token
rejection joins the session's single-flight refresh. Other classified failures
remain attached to the session and are surfaced on the next request until a
later successful profile check clears them. Removing the last active lease
stops the watchdog.

## Main UI Components

- `CategoryContentViewComponent` from `@iptvnator/portal/catalog/feature` (`libs/portal/catalog/feature`)
    - Shared category + content layout used by the `vod` and `series` routes (wired in `stalker-feature.routes.ts` via `loadCategoryContentViewComponent`)
- `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`
    - ITV live playback, radio playback, channel/station navigation, EPG panel integration
- `libs/ui/playback/src/lib/audio-player/audio-player.component.ts`
    - Shared inline audio player used by M3U radio channels and Stalker radio stations
- `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
    - Season/episode UI for all Stalker series modes
- `libs/portal/stalker/feature/src/lib/stalker-collection-route.component.ts`
    - Favorites and recently-viewed collection views (`mode = 'favorites' | 'recent'` route data), rendering `stalker-collection-detail.component.ts`
- `libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`

## Store and Data Flow

Stalker store is now feature-composed:

- Facade: `libs/portal/stalker/data-access/src/lib/stalker.store.ts`
- Feature slices: `libs/portal/stalker/data-access/src/lib/stores/features/*`
- Shared helpers: `libs/portal/stalker/data-access/src/lib/*`

Important store responsibilities:

- Selected content/category/item state
- Category and paginated content resources
- ITV channel list + pagination (full-list session cache when the portal
  supports it, legacy 14-per-page lazy loading otherwise)
- Radio category/station list + pagination
- Regular series seasons resource
- VOD-series (`is_series=1`) seasons + episodes resources
- Playback link creation (`create_link` flow)
- Favorites and recently viewed persistence helpers

Internal structure to preserve:

- `stalker.store.ts` stays as the thin facade that composes feature slices.
- Cross-slice contracts live in `stores/stalker-store.contracts.ts` so
  feature dependencies are declared instead of repeated `unknown` casts.
- Request execution is centralized in `stores/utils/stalker-request.utils.ts`
  for both authenticated full-portal calls and simple IPC-backed requests.
- Playback link resolution and Stalker collection persistence live in
  dedicated `stores/utils/` helpers so player/favorites/recent slices stay
  focused on orchestration.
- Category/content resources stay internal to the store slices. Feature
  consumers should read `getCategoryResource()` and `getPaginatedContent()`,
  which now always return arrays, and pair them with
  `isCategoryResourceFailed()` / `isPaginatedContentFailed()` for explicit
  error handling.

Failure-handling rule:

- Failed category or content requests must degrade into empty/error UI state,
  not `undefined` collections or renderer exceptions. The workspace Stalker
  context panel and live layout rely on this guarantee.

## Stalker Identity Policy

Full Stalker/Ministra portal authentication defaults to MAC-only identity. The
import UI can capture optional serial number, device IDs, and signatures, but
blank fields are not generated or forwarded to `get_profile`.

- User-provided `sn`, `device_id`, `device_id2`, `signature`, and `signature2`
  values are trimmed, persisted under the canonical `stalker*` playlist fields,
  and reused for the `get_profile` / `do_auth` steps of initial auth, token
  refresh, and retry auth. Full-session catalog requests and same-origin
  playback receive the session-owned Bearer token and cookies, not these
  optional identity fields.
- Empty optional identity fields remain absent. IPTVnator must not generate a
  device ID from the MAC address or duplicate `device_id2` from `device_id1`.
- The legacy default serial value `BEDACD4569BAF` is treated as absent at
  runtime so older blank imports do not keep sending a synthetic serial number.
- Playback headers use the same serial normalization, so the legacy default is
  not sent as `SN` or as a serial-derived `__cfduid`. The main-owned
  full-session path never synthesizes `__cfduid`; it retains real
  portal-issued cookies instead. The stateless/simple compatibility path still
  derives the 32-character value when an explicit serial is present, so it
  remains a legacy quirk rather than a canonical identity mechanism. The
  [compatibility audit](./stalker-authentication-compatibility-audit.md)
  records why it must not be reintroduced into the full-session profile.
- Generated MAG-like identity remains a future explicit setting. It must not be
  the default because strict portals can bind accounts to the first device
  fingerprint they receive.
- Stalker workspace routes may initialize `StalkerStore` directly from active
  route metadata only when it contains a request recipe produced by the current
  classifier version. A legacy `isFullStalkerPortal` boolean, even when
  present, is not enough: the route session must load the full playlist by id
  and finish any lazy connection migration before category/content resources
  run. Stalker auth
  metadata is independent from M3U playlist EPG metadata and must not depend on
  M3U-specific EPG fields.

## Live TV and Radio

The Stalker live route and radio route intentionally share
`StalkerLiveStreamLayoutComponent`:

- `itv` uses `type=itv&action=get_ordered_list`, stores results in
  `itvChannels`, resolves playback through `resolveItvPlayback(...)`, and keeps
  the EPG panel visible.
- ITV additionally loads the COMPLETE channel list once per portal session (see
  "Full ITV channel list cache" below), so category views and search are not
  limited to the lazily loaded 14-item pages.
- `radio` uses `type=radio&action=get_ordered_list`, stores results in
  `radioChannels`, resolves playback through `resolveRadioPlayback(...)`, and
  renders `AudioPlayerComponent` instead of a video player.
- Radio hides the EPG panel and must not call Stalker EPG endpoints because
  radio stations do not have EPG data.
- Radio always uses the inline audio player. External player settings are
  ignored for Stalker radio, matching M3U radio behavior.
- Radio stations opened from favorites or recently viewed remain live
  collection items with `radio: 'true'`; the shared collection resolver uses
  `create_link` with `type=radio`, skips EPG loading, and renders the same
  `AudioPlayerComponent` layout instead of the Stalker VOD detail layout.
- Some Stalker portals do not expose radio categories. Radio category loading
  falls back to a synthetic `PORTALS.ALL_RADIO` category with
  `category_id: '*'` so the station list can still be loaded.

## Full ITV Channel List Cache

Stalker portals paginate `get_ordered_list` with a server-side page size
(typically 14 items), so lazy loading alone can never power a complete local
search — this used to limit ITV search to whatever pages the user had scrolled
through. `StalkerItvCacheService`
(`libs/portal/stalker/data-access/src/lib/stalker-itv-cache.service.ts`) fixes
this with a per-portal, in-memory session cache of the complete live channel
list:

- Load strategy: first try the Ministra `get_all_channels` action (`type=itv`,
  returns ALL channels in one response — the same call STB clients use); if
  the portal does not implement it, crawl `get_ordered_list` pages
  (`category=*`, `genre=*`, concurrency 4, one retry per page, early stop on
  an empty page **or a page that adds no new channel ids** — some portals
  ignore `p` and repeat — 30k-channel hard cap) with progress reporting. The
  assembled list is de-duplicated by channel id (both strategies) so it never
  collides with the template's `track item.id`. The loading strategy itself is
  a stateless helper (`stalker-itv-channel-loader.ts`); the service owns state.
- Outcomes: a well-formed but unusable response marks the portal
  `unsupported` for the session (legacy paged flow stays in charge); a
  transient failure (network, or a page that failed both attempts) is retried
  later but throttled by a per-portal cooldown (`ERROR_COOLDOWN_MS`, 30s) so a
  deterministically-failing page can't trigger an unbounded re-crawl loop.
- Per-portal reactivity: the "cache ready / refreshed" trigger is a
  **per-portal** version signal (`versionFor(playlist)`), not one global
  counter, and the content resource reads it **only for ITV**. This is
  load-bearing: a global counter re-fired the resource for whatever was on
  screen (radio, another portal), and the legacy paged branch appends at
  `pageIndex > 1`, so an unrelated load completing duplicated the visible page
  (colliding `track item.id` → NG0955). The `isCurrentRequest` guard is scoped
  the same way.
- Integration: the `getContentResource` loader in
  `with-stalker-content.feature.ts` serves ITV categories from the cache when
  ready (local `tv_genre_id` filtering via `filterItvChannelsByGenre`,
  `hasMoreChannels=false`), and otherwise runs the legacy paged fetch while
  `ensureLoaded()` fills the cache in the background; the resource re-fires
  via the `cacheVersion` signal once the full list arrives.
- UI: `StalkerLiveStreamLayoutComponent` windows the rendered list
  (100-item chunks extended by the existing scroll handler) so multi-thousand
  channel lists do not blow up the DOM; the header count and search cover the
  whole category; a refresh button re-loads the list in place; a progress line
  shows crawl status.
- Loading state contract (important — regressions here strand the sidebar on a
  skeleton): in full-list mode the content loader serves the filtered list
  **synchronously** from the cache. The category-change reset effect therefore
  must NOT `setItvChannels([])` while `itvFullListActive()` is true — it runs
  after the store resource and would clobber the freshly served list, leaving
  every category after the first stuck on a skeleton. The initial-loading
  skeleton (`isInitialChannelsLoading`) must key off an actual in-flight load
  (`itvFullListLoading()` or `isPaginatedContentLoading()`), not merely an empty
  channel list; an empty result once loading has settled is an empty category
  and renders `PORTALS.NO_CHANNELS_IN_CATEGORY`, not a spinner.
- Search: with the cache active, the header search spans the ENTIRE portal
  (all genres) — filtering the store's `itvFullChannelList`, not just the
  selected category — so searching "CNN" while a "Sports" genre is selected
  still finds it; clearing the term returns to the selected category. The
  workspace shell drops the `degraded-loaded-only` / "loaded only" status for
  Stalker ITV once `itvFullListActive`; radio (no full-list cache) always keeps
  the loaded-only hint (`workspace-shell-search.service.ts`).
- Windowed selection: remote channel-up/down and numeric select operate over
  the full filtered category, so the render window (`renderLimit`) grows to
  include a selection beyond it (`ensureChannelWithinRenderWindow`) instead of
  drifting off-screen.
- Category count badges: the context panel shows per-genre channel counts on
  Stalker **Live TV** categories (like Xtream/M3U), fed by the store computed
  `itvCategoryItemCounts` (the full list grouped by numeric `tv_genre_id`; the
  `'*'` "All" row's total is stored under the `NaN` key that
  `Number('*')` produces). Badges are ITV-only — VOD/series/radio still page
  lazily so their per-category totals are unknown — and show a loading shimmer
  while the full list is still loading (`workspace-context-panel` →
  `stalkerShowCounts` / `stalkerCountDisplayMode`).
- Censored (adult) genres: portals typically EXCLUDE these channels from
  `get_all_channels` (sometimes without even flagging the genre `censored` in
  `get_genres`), so the cache legitimately has zero channels for them. The
  content loader therefore serves a genre from the cache only when the
  genre-filtered result is non-empty; otherwise it falls back to the legacy
  paged `get_ordered_list` fetch, which still returns those channels. The
  store computed `itvSelectedCategoryFromCache` is the single source of truth
  for this mode — the live layout keys windowing/infinite-scroll/`loadMore`
  and the category-change reset off it, NOT off `itvFullListActive`. Count
  badges: genres with no cached channels get NO map entry and the category
  view omits their badge (`omitMissingCounts`) instead of showing a
  misleading "0". The mock server ships a censored `For adults` ITV category
  (id 1099) to exercise this path.
- Eager preload + all-channels view (Xtream parity): entering the Live TV
  section immediately starts the full-list load (`preloadItvChannels()`, fired
  from an effect in `StalkerLiveStreamLayoutComponent` — not from the first
  category click), so the count badges and the all-channels view are available
  right away. Before a category is selected, the main area shows
  `StalkerItvAllItemsComponent` — a paginated card grid of every channel in
  the portal (client-side pagination only; it must never touch the store's
  legacy `page` state, which would re-fire portal requests). Clicking a card
  runs the same `playChannel` flow as the sidebar. Portals without a usable
  full list keep the "select a category" placeholder.
- Scope: ITV only. VOD/series keep server-side search; radio keeps legacy
  paging (station lists are small).
- The stalker-mock-server implements `get_all_channels` and provides the
  `legacy-pagination` scenario MAC (`00:1A:79:00:00:06`) to exercise the
  crawl fallback.

## VOD/Series Modes

Stalker has multiple real-world data shapes. The current implementation supports all three:

1. Regular Series (`/series`):

- Seasons come from API resource (`serialSeasonsResource`).
- Episodes are derived from season payload.
- This is the only mode that sets `selectedSerialId`, which is what drives
  `serialSeasonsResource`. It is set purely from `selectedContentType ===
'series'` — the `series` detail branch renders `<app-stalker-series-view />`
  with no `vodWithSeries` input, so the API resource is its only episode
  source and the fetch must never be gated on item shape.
- Modes 2 and 3 below are always opened under the `vod` content type, which
  leaves the id unset — otherwise every VOD detail open would fire a
  `get_ordered_list&type=series` request whose result is discarded.

2. VOD with Embedded `series[]`:

- Item is opened under VOD, but already contains episodes.
- `StalkerSeriesViewComponent` creates a pseudo-season and renders episodes directly.

3. VOD with `is_series=1` (Ministra plugin behavior):

- Treated as series flow from VOD context.
- Seasons are fetched lazily.
- Episodes are fetched on season select.
- The series quick-start CTA can load the first unloaded VOD-series season
  before playback. Unloaded seasons are considered unplayed in full season
  order, so an earlier unloaded season is not skipped just because a later
  season was loaded manually. If all currently loaded episodes are watched and
  more season metadata exists, quick start loads the next unloaded season
  instead of showing the completed state. After a lazy load, quick start is
  recomputed from the mapped episodes before playback so provider episode
  ordering cannot start the wrong episode.
- For unloaded VOD-series seasons, the CTA target label is derived from season
  metadata and rendered as `SxxE01` until episode details are loaded.
- Uses unique generated tracking IDs for episode playback position compatibility.
- Quick-start actions preserve both their translation key and interpolation
  parameters when adapted for the Stalker CTA. Dropping `labelParams` exposes
  the raw `{{episode}}` placeholder.

Series inline playback behavior is shared across all three modes:

- `StalkerSeriesViewComponent` maps every mode into `mappedSeasons()` and derives the currently playing episode from `inlinePlayback.contentInfo.contentXtreamId`.
- The inline player header shows the current episode metadata below the title, for example `S01E03 - Episode title`.
- Embedded players receive previous/next episode state for the current season only.
- Inline series autoplay is enabled by default. On player EOF (`ended`), Stalker starts the next episode only when it already exists in the current season's mapped episode list.
- Autoplay and Next stop at the last episode of the current season. They do not jump to the next season and do not lazy-load an unloaded `is_series=1` season. Quick start remains the only flow that may load another VOD-series season before playback.
- Previous is disabled on the first episode of the current season and otherwise switches directly to the previous episode.
- Before either inline or external playback starts, the resolved content info
  includes the parent `seriesXtreamId` and the mapped `seasonNumber` /
  `episodeNumber`. Future playback-position rows therefore carry enough
  metadata for workspace surfaces to render an episode badge. Existing rows
  without those fields are intentionally not migrated and remain badge-less
  until the episode is played again.
- Ministra payloads may omit `season_number`. Episode mapping and lazy
  quick-start labels share the same naturally ordered season fallback so later
  seasons are not persisted as season 1.

The VOD-series contract is cross-surface:

- Favorites and recently viewed records preserve the raw `is_series` flag and
  VOD origin so reopening still uses the lazy Ministra resources.
- `extractStalkerItemType()` normalizes those activity records to dashboard
  type `series`.
- The dashboard resolves episode progress by the parent `seriesXtreamId` and
  renders the saved season/episode metadata. It does not infer episode numbers
  from provider payloads.

Core decision logic and normalization are centralized in:

- `libs/portal/stalker/data-access/src/lib/stalker-vod.utils.ts`
- `libs/portal/stalker/data-access/src/lib/models/*.ts`

## Favorites and Recently Viewed

Current implementation is shared via Stalker-specific helpers:

- `createPortalCollectionResource(...)` generic collection loader
- `createPortalFavoritesResource(...)` favorites wrapper
- `createStalkerDetailViewState(...)` unified "open detail" decision
- `toggleStalkerVodFavorite(...)` shared add/remove behavior
- `normalizeStalkerEntityId(...)` and `normalizeStalkerEntityIdAsNumber(...)` for stable ID matching
- `matchesFavoriteById(...)` for cross-shape favorite matching

Where this is used:

- `libs/portal/stalker/feature/src/lib/stalker-collection-detail.component.ts` (favorites + recently viewed)
- `libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`
- `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.ts`
- `libs/portal/stalker/feature/src/lib/stalker-favorites-button/stalker-favorites-button.component.ts`

Navigation rule to preserve:

- Stalker favorites, recently viewed, and search stay in their current screen and open inline detail state.
- They should not redirect into a canonical content/category/item route because Stalker detail rendering is currently store-state/inline driven, not route driven.
- Stalker radio favorites/recent items are the exception to VOD/series inline
  detail opening: they are normalized as live items and must open through the
  shared live collection audio-player path.
- Global live/radio collection playback loads the stored playlist and follows
  its current request recipe. Eligible legacy or stale Electron records
  classify single-flight and persist before commit; explicitly simple legacy
  records remain on the simple adapter. Migrated `create_link` results retain
  their opaque playback context.
- VOD-backed series favorites can be displayed in series collections, but detail
  opening must preserve their VOD origin: `is_series=1` favorites set the
  selected content type to `vod` so the lazy Ministra season/episode resources
  run, and embedded `series[]` favorites render through the embedded VOD-series
  branch.
- See [Portal Detail Navigation](./portal-detail-navigation.md).

### Embedded-series snapshot refresh

Favorites and recently-viewed rows store the whole Stalker item as a JSON
snapshot, so an embedded `series[]` episode list (and its playback `cmd`)
freezes at the moment the row was written — newly released episodes would
never appear when the item is reopened from favorites, recents, or the
dashboard rails. `withStalkerSnapshotRefresh()`
(`stores/features/with-stalker-snapshot-refresh.feature.ts`) fixes this with a
snapshot-first + background re-fetch contract:

- The stored snapshot renders immediately; the store method
  `refreshEmbeddedSeriesSelection()` then re-fetches the item via a portal
  title search (`get_ordered_list&type=vod&search=<title>`, item matched by
  id, paginated up to 5 pages, wildcard-category retry) in the background.
- When the episode list or `cmd` changed, the selection is patched in place.
  The guard requires both the item id **and** the active playlist id to be
  unchanged, because Stalker ids are only unique per portal.
- Only the in-memory selection is patched — the stored snapshot row is
  deliberately left alone. Every entry path into the detail view runs this
  refresh, so a stale stored episode list is never rendered for longer than
  one background request, and writing it back would add an uncontrolled
  background writer to the whole-playlist read-modify-write that every
  favorite/recent mutation performs (lost-update risk).
- Triggers: `stalker-collection-detail.component.ts` (favorites/recent tabs,
  global collections, dashboard handoffs) and the optional catalog-facade hook
  `refreshSnapshotSelection()` for snapshot-injected browse detail
  (`openStalkerItem` navigation state).
- Regular `type=series` and Ministra `is_series` favorites are unaffected —
  their seasons/episodes are always fetched fresh on open.

## Backup and Restore

Versioned playlist backups include Stalker connection metadata plus playlist-
scoped favorites/recent snapshots. Secret export is off by default.

Required exported connection fields:

- `portalUrl`
- `macAddress`
- favorites and recently viewed collections

Optional non-secret connection fields are exported when present:

- original `sourceUrl`
- `isFullStalkerPortal`
- profile preset and transport configuration
- legacy request headers (`userAgent`, `referrer`, `origin`)

Exported only after the user explicitly enables credential and explicit
identity-override export:

- `username` and `password`
- explicit serial, device IDs, signatures, prehash, API signature, and custom
  firmware/hardware tuple

Always excluded:

- `stalkerToken`
- `stalkerAccountInfo`
- `stalkerLandingUrl`, `stalkerRequestRecipe`,
  `stalkerRecipeClassifierVersion`, and `stalkerLastVerifiedAt`
- cookies, handshake randoms, leases, challenges, and playback contexts
- playback positions in backup v1

Compatibility `portalUrl` remains exported as connection metadata, but restore
re-resolves from `sourceUrl` when it is present.

Import rule:

- backups restore the saved portal definition and replace the stored
  favorites/recent state for the matched playlist
- redacted Stalker backups preserve local credentials only for an exact
  exported-id/source/MAC/profile match; otherwise they create a credential-less
  row that follows the normal status-2 connection flow
- secret-bearing Stalker matches normalize source, MAC, profile, and effective
  identity/transport. A matching exported ID is preferred; otherwise exactly
  one exact username/principal match is required. Password is never part of
  the fingerprint, so an exported-ID match may patch it. Structured
  identity/transport takes precedence, with equivalent legacy
  serial/device/signature and UA/Referer/Origin fields as fallback
- every Stalker restore clears learned landing/recipe/classifier/verification
  fields, including on matched merges
- a fresh handshake must happen after import for full-portal sessions; imported
  backups never trust a serialized token

## Remote Control Integration

Stalker live remote control is implemented in:

- `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`

Supported today:

- Channel up/down
- Numeric channel selection (list-position based)
- Status publish for remote UI (portal/channel/current program)

See full backend and web-remote flow in [Remote Control Architecture](./remote-control.md).

## EPG Integration

Stalker ITV now splits EPG usage:

- active channel panel: bulk `get_epg_info` cached once per playlist and rendered
  through the shared EPG panel (`app-epg-timeline`, or `app-epg-list-view` in list mode)
- channel row preview: no pre-playback network requests; previews are derived
  from cached bulk EPG only after the first active-channel fetch succeeds
- active panel fallback: `get_short_epg` when bulk EPG is missing or unsupported

Full details are documented in [Stalker Portal EPG Architecture](./stalker-epg.md).

## Shared/Reusable Infrastructure

Stalker reuses some Xtream UI infrastructure deliberately:

- Category content rendering route uses Xtream category content component
- Season container for episodes uses shared Xtream season UI component
- Playback position handling for series episodes reuses Xtream store position mechanisms
- Downloads route reuses shared downloads feature

This reduces duplicate UI logic across portal types and keeps compatibility behavior aligned.

The main-owned authenticated playback consumer currently covers Embedded MPV
and external MPV/VLC. Built-in HTML5, Video.js, and ArtPlayer playback can
carry the opaque `playbackContextRef` but does not consume it, so streams that
require header/cookie authorization beyond their URL remain unsupported there.
The shared download flow likewise uses its older stream-URL contract.
Authenticated Stalker web playback and downloads remain explicitly deferred
until those surfaces can consume a main-owned context without exposing or
persisting headers and cookies.

## Authentication Replay Fixtures

Stateful authentication fixtures live under
`apps/stalker-mock-server/fixtures/replay/`. A fixture declares named
loopback origins, ordered or unordered phases, exact request expectations,
typed generated symbols, cardinality, barriers, and a terminal state. Every
run is isolated and must be finalized and disposed; the ledger contains only
sanitized operation and mismatch counts.

The Electron E2E harness starts the replay control plane with a process-local
capability, requests only repository-allowlisted fixtures, and gives the app
only synthetic portal inputs. Real portal URLs, credentials, catalogs, stream
links, and artwork must never be committed as fixtures.

Use:

```bash
pnpm run stalker:fixtures:validate
pnpm nx test stalker-mock-server
pnpm nx test stalker-fixture-tools
pnpm nx run electron-backend-e2e:e2e-ci--src/stalker-auth.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/stalker-route-auth.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/backup-security.e2e.ts
```

The HAR converter is a local draft aid, not a sanitizer of last resort. It
rejects unsafe paths, oversized/deep inputs, unrecognized origins, and
secret-like evidence before atomically writing output outside the repository.
Review and validate every draft before moving it into the fixture tree.

## Regression Coverage

Focused regression tests for Stalker VOD mode branching and the cross-surface
series contract live in:

- `libs/portal/stalker/data-access/src/lib/stalker-vod.utils.spec.ts`
- `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`
- `libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.spec.ts`

Covered scenarios include:

- Embedded `series[]` opens series view state
- `is_series=1` opens lazy series state
- VOD-backed series favorites keep VOD-series loading semantics when opened from
  favorites/global favorites
- Favorite toggle helper path invokes the expected add/remove flow
- Quick-start episode labels interpolate their episode number
- Inline and external episode handoffs carry resolved season/episode metadata
- Dashboard activity classifies `is_series` VOD as series and resolves its
  saved episode position

Session compatibility coverage additionally lives in:

- `portal-stalker-protocol`: URL recipes, response classifiers, auth state,
  identity revision, and reserved request policy
- `stalker-mock-server` and `stalker-fixture-tools`: stateful replay,
  schema/cardinality enforcement, control-plane security, and secret scanning
- `electron-backend`: redirects/SSRF, cookie ownership, resolver, auth,
  coordinator, manager, watchdog, playback context, IPC validation, and saved
  credential lookup
- `portal-stalker-data-access`, `portal-stalker-feature`, and
  `playlist-import-feature`: opaque facade, recovery, challenges, lazy route
  migration, and save-before-commit behavior
- `services` and `web`: backup exclusion, safe restore matching, and explicit
  secret-export UX
