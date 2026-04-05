# Portal Detail Navigation

This document records the current navigation contract for Xtream and Stalker detail flows, especially for favorites, recently viewed, search, and category content.

Related:

- [Embedded Inline Playback](./embedded-inline-playback.md)

## Summary

- Xtream uses a route-first detail model.
- Stalker uses an inline/store-state detail model.
- Keep favorites/recent/search behavior aligned with the canonical detail model of the same portal.
- Do not force both portals into the same behavior unless the full portal detail architecture is being changed.

## Xtream

Xtream details are represented by canonical routes.

Examples:
- `/xtreams/:id/vod/:categoryId/:vodId`
- `/xtreams/:id/series/:categoryId/:serialId`

Implication:
- Favorites, recently viewed, and search should redirect to the original Xtream content route and item route.
- This keeps the URL, browser history, and detail rendering model aligned with normal Xtream browsing.

Current code paths:
- `libs/portal/xtream/feature/src/lib/favorites/favorites.component.ts`
- `libs/portal/xtream/feature/src/lib/search-results/search-results.component.ts`
- `libs/portal/catalog/feature/src/lib/category-content-view/category-content-view.component.ts`

Behavior to preserve:
- Selecting an Xtream item from favorites/recent/search should navigate to the Xtream content type/category/item route when the item is not a live stream.
- Live streams can still open through the player path rather than a detail route.

## Stalker

Stalker details are represented by store state and inline detail rendering on the current screen.

Examples:
- Category content sets `selectedItem` and renders details inline.
- Search sets `selectedItem` and stays on the search view.
- Favorites and recently viewed stay on their current collection screen and open inline detail.

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
- ITV/live items can still trigger playback immediately.

## Decision Rule For Future Changes

When deciding how a favorites/recent/search click should behave:

1. Follow the portal's canonical detail model.
2. Prefer local consistency within the portal over cross-portal sameness.
3. Only unify Xtream and Stalker behavior if the full detail architecture is being unified as well.

That means:
- Xtream: navigate to the canonical route.
- Stalker: stay in the current screen and open inline detail.

## Refactor Guidance

If a future change proposes that Stalker favorites/recent should deep-link into category routes:
- also update Stalker category-content and search behavior
- define a canonical Stalker detail route model first
- update architecture docs and portal skills together

If a future change proposes that Xtream favorites/recent should stay inline:
- also replace Xtream route-based detail pages with a portal-local inline detail model
- verify history/back behavior and deep links still make sense
