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

Primary route tree lives in `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-feature.routes.ts`.

- `/stalker/:id/vod`
- `/stalker/:id/series`
- `/stalker/:id/itv`
- `/stalker/:id/radio`
- `/stalker/:id/favorites`
- `/stalker/:id/recent`
- `/stalker/:id/search`
- `/stalker/:id/downloads` (shared downloads module from Xtream UI)

## Runtime Architecture

1. Angular Stalker screens call methods/resources in `StalkerStore`.
2. `StalkerStore` builds request params based on selected content type and current view state.
3. Requests go through `DataService.sendIpcEvent(STALKER_REQUEST, ...)` or `StalkerSessionService` (full portal auth).
4. Electron main process handles `STALKER_REQUEST` in `/Users/4gray/Code/iptvnator/apps/electron-backend/src/app/events/stalker.events.ts`.
5. Axios calls Stalker `load.php` API with required headers/cookies and returns normalized payloads to renderer.

## Main UI Components

- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-main-container.component.ts`
    - Category + content layout for `vod` and `series`
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`
    - ITV live playback, radio playback, channel/station navigation, EPG panel integration
- `/Users/4gray/Code/iptvnator/libs/ui/playback/src/lib/audio-player/audio-player.component.ts`
    - Shared inline audio player used by M3U radio channels and Stalker radio stations
- `/Users/4gray/Code/iptvnator/libs/ui/components/src/lib/stalker-series-view/stalker-series-view.component.ts`
    - Season/episode UI for all Stalker series modes
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-favorites/stalker-favorites.component.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/recently-viewed/recently-viewed.component.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`

## Store and Data Flow

Stalker store is now feature-composed:

- Facade: `/Users/4gray/Code/iptvnator/libs/portal/stalker/data-access/src/lib/stalker.store.ts`
- Feature slices: `/Users/4gray/Code/iptvnator/libs/portal/stalker/data-access/src/lib/stores/features/*`
- Shared helpers: `/Users/4gray/Code/iptvnator/libs/portal/stalker/data-access/src/lib/*`

Important store responsibilities:

- Selected content/category/item state
- Category and paginated content resources
- ITV channel list + pagination
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

## Live TV and Radio

The Stalker live route and radio route intentionally share
`StalkerLiveStreamLayoutComponent`:

- `itv` uses `type=itv&action=get_ordered_list`, stores results in
  `itvChannels`, resolves playback through `resolveItvPlayback(...)`, and keeps
  the EPG panel visible.
- `radio` uses `type=radio&action=get_ordered_list`, stores results in
  `radioChannels`, resolves playback through `resolveRadioPlayback(...)`, and
  renders `AudioPlayerComponent` instead of a video player.
- Radio hides the EPG panel and must not call Stalker EPG endpoints because
  radio stations do not have EPG data.
- Radio always uses the inline audio player. External player settings are
  ignored for Stalker radio, matching M3U radio behavior.
- Some Stalker portals do not expose radio categories. Radio category loading
  falls back to a synthetic `PORTALS.ALL_RADIO` category with
  `category_id: '*'` so the station list can still be loaded.

## VOD/Series Modes

Stalker has multiple real-world data shapes. The current implementation supports all three:

1. Regular Series (`/series`):

- Seasons come from API resource (`serialSeasonsResource`).
- Episodes are derived from season payload.

2. VOD with Embedded `series[]`:

- Item is opened under VOD, but already contains episodes.
- `StalkerSeriesViewComponent` creates a pseudo-season and renders episodes directly.

3. VOD with `is_series=1` (Ministra plugin behavior):

- Treated as series flow from VOD context.
- Seasons are fetched lazily.
- Episodes are fetched on season select.
- The series quick-start CTA can load the first unloaded VOD-series season
  before playback, then starts its first episode. If all currently loaded
  episodes are watched and more season metadata exists, quick start loads the
  next unloaded season instead of showing the completed state.
- For unloaded VOD-series seasons, the CTA target label is derived from season
  metadata and rendered as `SxxE01` until episode details are loaded.
- Uses unique generated tracking IDs for episode playback position compatibility.

Core decision logic and normalization are centralized in:

- `/Users/4gray/Code/iptvnator/libs/portal/stalker/data-access/src/lib/stalker-vod.utils.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/data-access/src/lib/models/*.ts`

## Favorites and Recently Viewed

Current implementation is shared via Stalker-specific helpers:

- `createPortalCollectionResource(...)` generic collection loader
- `createPortalFavoritesResource(...)` favorites wrapper
- `createStalkerDetailViewState(...)` unified "open detail" decision
- `toggleStalkerVodFavorite(...)` shared add/remove behavior
- `normalizeStalkerEntityId(...)` and `normalizeStalkerEntityIdAsNumber(...)` for stable ID matching
- `matchesFavoriteById(...)` for cross-shape favorite matching

Where this is used:

- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-favorites/stalker-favorites.component.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/recently-viewed/recently-viewed.component.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`
- `/Users/4gray/Code/iptvnator/libs/ui/components/src/lib/stalker-favorites-button/stalker-favorites-button.component.ts`

Navigation rule to preserve:

- Stalker favorites, recently viewed, and search stay in their current screen and open inline detail state.
- They should not redirect into a canonical content/category/item route because Stalker detail rendering is currently store-state/inline driven, not route driven.
- VOD-backed series favorites can be displayed in series collections, but detail
  opening must preserve their VOD origin: `is_series=1` favorites set the
  selected content type to `vod` so the lazy Ministra season/episode resources
  run, and embedded `series[]` favorites render through the embedded VOD-series
  branch.
- See [Portal Detail Navigation](./portal-detail-navigation.md).

## Backup and Restore

Versioned playlist backups include Stalker connection metadata plus playlist-
scoped favorites/recent snapshots.

Exported fields:

- `portalUrl`
- `macAddress`
- `isFullStalkerPortal`
- optional `username` / `password`
- optional request headers (`userAgent`, `referrer`, `origin`)
- full-portal serial/device/signature fields when present
- favorites and recently viewed collections

Excluded fields:

- `stalkerToken`
- `stalkerAccountInfo`
- playback positions in backup v1

Import rule:

- backups restore the saved portal definition and replace the stored
  favorites/recent state for the matched playlist
- a fresh handshake must happen after import for full-portal sessions; imported
  backups never trust a serialized token

## Remote Control Integration

Stalker live remote control is implemented in:

- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`

Supported today:

- Channel up/down
- Numeric channel selection (list-position based)
- Status publish for remote UI (portal/channel/current program)

See full backend and web-remote flow in [Remote Control Architecture](./remote-control.md).

## EPG Integration

Stalker ITV now splits EPG usage:

- active channel panel: bulk `get_epg_info` cached once per playlist and rendered
  through shared `app-epg-list`
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

## Regression Coverage

Focused regression tests for Stalker VOD mode branching live in:

- `/Users/4gray/Code/iptvnator/libs/portal/stalker/data-access/src/lib/stalker-vod.utils.spec.ts`

Covered scenarios include:

- Embedded `series[]` opens series view state
- `is_series=1` opens lazy series state
- VOD-backed series favorites keep VOD-series loading semantics when opened from
  favorites/global favorites
- Favorite toggle helper path invokes the expected add/remove flow
