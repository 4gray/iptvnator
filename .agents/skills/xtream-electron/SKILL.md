---
name: xtream-electron
description: Use when changing Xtream routes, Signal Store or data sources, content identity, SQLite-backed import, search or delete, sparse VOD playback, or Electron and PWA behavior.
---

# Xtream Electron

## Read First

- `docs/architecture/xtream-portal-compatibility.md`
- `docs/architecture/portal-detail-navigation.md`
- `docs/architecture/sqlite-db-worker.md`
- `docs/architecture/vod-multi-source.md`

## Ownership And Runtime

Routed screens live in `libs/portal/xtream/feature`; API, cache, Signal Store,
and data sources in `libs/portal/xtream/data-access`; collection services and
reusable multi-source discovery/resolution in
`libs/portal/shared/data-access`; reusable views in
`libs/portal/shared/ui`; pure contracts/helpers only in
`libs/portal/shared/util`. Screen-session multi-source orchestration stays in
the Xtream feature.

Select `ElectronXtreamDataSource` only through
`RuntimeCapabilitiesService.supportsXtreamSqliteDataSource`; otherwise use the
PWA data source. A generic `window.electron` check is not the capability
contract; existing favorites/recent branches that still use one are migration
debt, not precedent.

## Data And Navigation Contracts

- Xtream identity is playlist + normalized content type + provider
  `xtream_id`; collection keys include type and ID. Never resolve colliding
  live/movie/series IDs by number alone. Distinguish SQLite row IDs from
  provider `xtream_id` / `stream_id` / `series_id`.
- Browse and search use canonical item routes. Favorites/recent use
  collection-owned inline detail. Preserve enough provider/route identity to
  recover hidden categories without sending a local database ID to the API.
- Sparse VOD publishes the fallback selection first and recovers its provider
  category in the background. A playable source is one complete positive
  stream-ID + extension pair; never combine fields from incomplete candidates.
- VOD multi-source is capability-gated, owner-scoped, Electron-only
  Xtream-to-Xtream movie behavior. Its reusable core belongs in portal shared
  data access; the screen session/host belongs in the Xtream feature.

`XtreamStore` composes portal, content, selection, search, EPG, player,
favorites, recent items, and playback positions.

On the SQLite path, large import/search/delete/restore work remains
worker-backed. Renderer-visible DB progress and cancellation use
`operationId`. Xtream API requests use `requestId`, import sessions use
`sessionId`, and the DB worker also has an internal transport request ID; never
conflate any of them.

## Validation

Run both data-source specs plus affected Xtream store/feature tests. Use the
closest atomized flow:

- `web-e2e:e2e-ci--src/xtream.e2e.ts`
- `electron-backend-e2e:e2e-ci--src/xtream-responsiveness.e2e.ts`
- `electron-backend-e2e:e2e-ci--src/xtream-vod-details.e2e.ts`
- `electron-backend-e2e:e2e-ci--src/vod-multi-source.e2e.ts`
