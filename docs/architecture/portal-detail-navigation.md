# Portal Detail Navigation

This document records the current navigation contract for Xtream and Stalker detail flows, especially for favorites, recently viewed, search, and category content.

Related:

- [Embedded Inline Playback](./embedded-inline-playback.md)

## Summary

- Xtream category browsing uses a route-first detail model.
- Stalker uses an inline/store-state detail model.
- Favorites and recently viewed collections now use collection-owned inline detail
  for non-live Xtream and Stalker items.
- Provider-scoped collection routes fall back to the matching global collection
  route when `All playlists` shows a non-live item from the other portal type,
  so the correct detail host still opens without switching playlist context.
- Dashboard `Global Favorites` and `Recently Watched` widgets hand off Xtream and
  Stalker movies/series into the matching global collection route with detail
  pre-opened.
- Do not force both portals into the same browse/detail behavior unless the full
  portal detail architecture is being changed.

## Xtream

Xtream category and search details are represented by canonical routes.

Examples:

- `/xtreams/:id/vod/:categoryId/:vodId`
- `/xtreams/:id/series/:categoryId/:serialId`

Implication:

- Category browsing and search can still redirect to the original Xtream content
  route and item route.
- This keeps the URL, browser history, and detail rendering model aligned with
  normal Xtream browsing.

Current code paths:

- `libs/portal/xtream/feature/src/lib/favorites/favorites.component.ts`
- `libs/portal/xtream/feature/src/lib/search-results/search-results.component.ts`
- `libs/portal/catalog/feature/src/lib/category-content-view/category-content-view.component.ts`

Collection behavior to preserve:

- Selecting a non-live Xtream item from favorites/recent should keep the current
  collection route and open inline detail inside the collection pane when the
  current collection host is already Xtream-aware.
- If a Stalker or M3U collection route is showing `All playlists` and the user
  selects an Xtream movie/series item, route into `/workspace/global-favorites`
  or `/workspace/global-recent` with detail pre-opened instead of trying to
  render Xtream detail inside the wrong host.
- The current playlist context must stay unchanged even when the selected item
  belongs to a different Xtream source playlist.
- The workspace/sidebar category panel should stay hidden for these collection
  detail opens.
- Back from a collection-owned detail should restore the previous collection
  view state, including the active content tab and playlist/all-playlists
  scope.
- Live streams can still open through the player path rather than a detail
  route.

Dashboard behavior to preserve:

- Dashboard `Global Favorites` and `Recently Watched` widgets should route
  Xtream movie/series items into `/workspace/global-favorites` or
  `/workspace/global-recent` with collection detail pre-opened from navigation
  state.
- Back from the collection detail should return to the dashboard handoff state,
  not switch the active playlist.

Search behavior to preserve:

- Selecting an Xtream item from search should still navigate to the canonical
  Xtream content type/category/item route when the item is not a live stream.

## Stalker

Stalker details are represented by store state and inline detail rendering on the current screen.

Examples:

- Category content sets `selectedItem` and renders details inline.
- Search sets `selectedItem` and stays on the search view.
- Favorites and recently viewed stay on their current collection screen and open
  inline detail when the current collection host is already Stalker-aware.

Implication:

- Favorites, recently viewed, and search should remain in the current Stalker view when opening VOD/series details.
- This keeps Stalker behavior aligned with its normal category-content and search flow.

Current code paths:

- `libs/portal/stalker/feature/src/lib/stalker-favorites/stalker-favorites.component.ts`
- `libs/portal/stalker/feature/src/lib/recently-viewed/recently-viewed.component.ts`
- `libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`
- `libs/portal/catalog/feature/src/lib/category-content-view/category-content-view.component.ts` (Stalker branch)

Behavior to preserve:

- Favorites/recent/search should not navigate away to a canonical Stalker detail route because Stalker does not currently use one.
- If an Xtream or M3U collection route is showing `All playlists` and the user
  selects a Stalker VOD/series item, route into `/workspace/global-favorites`
  or `/workspace/global-recent` with detail pre-opened so the Stalker inline
  detail host still renders on a compatible screen.
- ITV/live items can still trigger playback immediately.
- Dashboard `Global Favorites` and `Recently Watched` widgets should route
  Stalker movie/series items into `/workspace/global-favorites` or
  `/workspace/global-recent` with detail pre-opened inline, again without
  switching playlist context or showing the workspace category sidebar.
- Back from the collection-owned detail should restore the previous collection
  tab and scope instead of resetting the collection screen to its defaults.

## Decision Rule For Future Changes

When deciding how a favorites/recent/search click should behave:

1. Follow the portal's canonical detail model.
2. Prefer local consistency within the portal over cross-portal sameness.
3. Only unify Xtream and Stalker behavior if the full detail architecture is being unified as well.

That means:

- Xtream browse/search: navigate to the canonical route.
- Xtream favorites/recent/global collection widgets: open collection-owned
  detail without switching playlist context. Use the current route when it can
  host Xtream detail, otherwise fall back to the matching global collection
  route.
- Stalker non-live items: open collection-owned detail without switching
  playlist context. Use the current route when it can host Stalker detail,
  otherwise fall back to the matching global collection route.

## Refactor Guidance

If a future change proposes that Stalker favorites/recent should deep-link into category routes:

- also update Stalker category-content and search behavior
- define a canonical Stalker detail route model first
- update architecture docs and portal skills together

If a future change proposes that Xtream favorites/recent should stay inline:

- keep the existing route-based detail pages reusable from the collection-owned
  detail host
- verify history/back behavior, playlist preservation, and dashboard handoff
  behavior still make sense
