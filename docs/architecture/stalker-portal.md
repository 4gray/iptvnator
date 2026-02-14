# Stalker Portal Architecture

This document describes the Stalker portal implementation in IPTVnator and where each feature is integrated.

## Related Docs

- [Stalker Portal EPG Architecture](./stalker-epg.md)
- [Remote Control Architecture](./remote-control.md)
- [Download Manager](./download-manager.md)
- [Category Management](./category-management.md)
- [Stalker Store API Baseline](./stalker-store-api-baseline.md)

## Scope

Stalker support covers:

- Live TV (`itv`)
- VOD (`vod`)
- Series (`series`)
- VOD-as-series flows (`is_series=1` and embedded `series[]`)
- Favorites and recently viewed collections
- Search
- External player playback (shared Xtream player infrastructure)
- Remote control for live ITV navigation

## Routing Structure

Primary route tree lives in `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker.routes.ts`.

- `/stalker/:id/vod`
- `/stalker/:id/series`
- `/stalker/:id/itv`
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

- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-main-container.component.ts`
  - Category + content layout for `vod` and `series`
- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`
  - ITV live playback, channel navigation, EPG panel integration
- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-series-view/stalker-series-view.component.ts`
  - Season/episode UI for all Stalker series modes
- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-favorites/stalker-favorites.component.ts`
- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/recently-viewed/recently-viewed.component.ts`
- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-search/stalker-search.component.ts`

## Store and Data Flow

Stalker store is now feature-composed:

- Facade: `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker.store.ts`
- Feature slices: `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stores/features/*`
- Shared store utils: `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stores/utils/*`

Important store responsibilities:

- Selected content/category/item state
- Category and paginated content resources
- ITV channel list + pagination
- Regular series seasons resource
- VOD-series (`is_series=1`) seasons + episodes resources
- Playback link creation (`create_link` flow)
- Favorites and recently viewed persistence helpers

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
- Uses unique generated tracking IDs for episode playback position compatibility.

Core decision logic and normalization are centralized in:

- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-vod.utils.ts`
- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/models/*.ts`

## Favorites and Recently Viewed

Current implementation is shared via Stalker-specific helpers:

- `createPortalCollectionResource(...)` generic collection loader
- `createPortalFavoritesResource(...)` favorites wrapper
- `createStalkerDetailViewState(...)` unified "open detail" decision
- `toggleStalkerVodFavorite(...)` shared add/remove behavior
- `normalizeStalkerEntityId(...)` and `normalizeStalkerEntityIdAsNumber(...)` for stable ID matching
- `matchesFavoriteById(...)` for cross-shape favorite matching

Where this is used:

- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-favorites/stalker-favorites.component.ts`
- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/recently-viewed/recently-viewed.component.ts`
- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-search/stalker-search.component.ts`
- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/favorites-button/favorites-button.component.ts`

## Remote Control Integration

Stalker live remote control is implemented in:

- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`

Supported today:

- Channel up/down
- Numeric channel selection (list-position based)
- Status publish for remote UI (portal/channel/current program)

See full backend and web-remote flow in [Remote Control Architecture](./remote-control.md).

## EPG Integration

EPG in Stalker ITV uses `get_short_epg` and shared `EpgViewComponent`. Full details are documented in [Stalker Portal EPG Architecture](./stalker-epg.md).

## Shared/Reusable Infrastructure

Stalker reuses some Xtream UI infrastructure deliberately:

- Category content rendering route uses Xtream category content component
- Season container for episodes uses shared Xtream season UI component
- Playback position handling for series episodes reuses Xtream store position mechanisms
- Downloads route reuses shared downloads feature

This reduces duplicate UI logic across portal types and keeps compatibility behavior aligned.

## Regression Coverage

Focused regression tests for Stalker VOD mode branching live in:

- `/Users/4gray/Code/iptvnator/apps/web/src/app/stalker/stalker-vod.utils.spec.ts`

Covered scenarios include:

- Embedded `series[]` opens series view state
- `is_series=1` opens lazy series state
- Favorite toggle helper path invokes the expected add/remove flow
