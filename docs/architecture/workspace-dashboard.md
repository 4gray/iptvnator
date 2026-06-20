# Workspace Dashboard

This document records the current dashboard implementation inside the workspace
shell.

Related:

- [Workspace Shell](./workspace-shell.md)

## Summary

- The dashboard is the default `/workspace` landing page.
- It is a **rail-based** content surface (Netflix / Apple TV pattern), not a
  customizable widget grid.
- Layout is static and curated — there is no edit mode, drag-drop, size
  stepper, show/hide toggle, or persisted layout. Rails auto-hide when empty.
- First-run users see the shared welcome empty-state with a single primary
  CTA to add their first playlist.

Core implementation:

1. `libs/workspace/dashboard/feature/src/lib/rails/workspace-dashboard-rails.component.ts`
   — the page-level facade.
2. `libs/workspace/dashboard/feature/src/lib/rails/dashboard-rail.component.ts`
   — the reusable horizontal rail.
3. `libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.ts`
   — data aggregation (recent items, favorites, playlist stats). Shared across
   rails.
4. `libs/playlist/shared/ui/src/lib/recent-playlists/empty-state/empty-state.component.ts`
   — reused welcome state with the primary "Add your first playlist" CTA.

## Page Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  Hero — Continue Watching (most recent item)                        │
├─────────────────────────────────────────────────────────────────────┤
│  Continue Watching · See all →                                      │
│  [poster][poster][poster][poster] →→                                │
├─────────────────────────────────────────────────────────────────────┤
│  Live now on your favorites / Continue with live TV · See all →     │
│  [channel][channel][channel][channel] →→                            │
├─────────────────────────────────────────────────────────────────────┤
│  Recently Used Sources · See all →                                  │
│  [tile][tile][tile][tile] →→                                        │
├─────────────────────────────────────────────────────────────────────┤
│  Recently Added on Xtream (aggregated across providers)             │
│  [poster][poster][poster] →→                                        │
└─────────────────────────────────────────────────────────────────────┘
```

Render rules:

1. Dashboard rails render independently as their data sources resolve. The
   page no longer uses `dashboardReady()` as a page-wide skeleton gate.
   Initial hero/recent/favorites loading states render scoped skeletons so one
   slow rail does not hide already available content.
2. `hasPlaylists() === false` → render `<app-empty-state type="welcome">`
   full-bleed. All rails and the hero are skipped.
3. `hero()` = `globalRecentItems()[0]`. If present, render the hero panel.
4. Each rail is emitted via `@if (cards.length > 0)`. Empty rails are hidden
   — there is no "empty widget" placeholder.
5. The continue-watching hero prefers a stored Xtream `backdrop_url`; when it
   is missing the UI falls back to a blurred poster treatment instead of
   showing a flat panel.
6. The mixed global favorites rail is not rendered on the dashboard. Live
   favorites are promoted into the live rail, while mixed favorites stay on
   `/workspace/global-favorites`.
7. The live favorites rail keeps its scoped skeleton until the initial global
   favorites load has completed for both Xtream-backed and playlist-backed
   favorites. This avoids first-paint partial counts such as a single Stalker
   favorite appearing before M3U favorites finish resolving.

## Rail Contract

`DashboardRailComponent` is purely presentational:

1. Inputs: `label`, `items: DashboardRailCard[]`, optional `seeAllLink`,
   optional `aspectRatio` (default `'2 / 3'`), optional `testId`.
2. Behavior: horizontal flex track with `scroll-snap-type: x mandatory`.
3. Chevron buttons fade in on hover (desktop only via `@media (hover: none)`).
4. Cards are keyboard-focusable router links; `scroll-snap-align: start`
   means arrow-key nav lands on card boundaries.
5. Image handling: `loading="lazy"`, `decoding="async"`, fallback icon tile
   when `imageUrl` is missing or `error` fires.
6. Dashboard hero, rail containers, rail cards, and "Manage all" links expose
   stable `data-test-id` hooks. Treat these as the supported Electron E2E
   selector surface; do not target internal CSS class names.

## Data Flow

1. `WorkspaceDashboardRailsComponent` injects `DashboardDataService`.
2. It derives the dashboard surface via `computed()`:
    1. `hero` — first item of `globalRecentItems()`.
    2. `continueWatchingCards` — maps `globalRecentVodItems()` to movie/series
       cover cards. Xtream playback positions are bulk-loaded per playlist so
       hero and cards can show progress, remaining time, and series season/
       episode badges. Series lookup uses keyed maps for both direct episode ids
       and series ids; card renders must not scan the full playback-position map.
    3. `liveOnFavoritesCardsEnriched` — maps favorited live channels first,
       falling back to recently watched live channels when no live favorites
       exist. M3U cards carry an `epg_lookup_key` using the app-wide XMLTV
       fallback order (`tvg-id` -> `tvg-name` -> channel name); EPG enrichment
       must use that key before falling back to the card title.
    4. `xtreamRecentlyAddedCards` — maps `xtreamRecentlyAddedItems()` to rail
       cards. Aggregates newly added VOD and series across *all* Xtream
       playlists via `DashboardDataService.reloadXtreamRecentlyAddedItems()`,
       which calls `getGlobalRecentlyAdded('all', limit, 'xtream')` with the
       DB-level `playlists.type = 'xtream'` filter. The rail is Electron-only
       (PWA returns `[]`) and auto-hides when empty, so users without Xtream
       playlists never see it. Cards carry a `playlist_name · type` subtitle
       so users can tell which provider each item came from. Driven by an
       effect that re-runs whenever the Xtream playlist count changes, but the
       first run waits for `globalFavoritesLoaded()` so the slower
       recently-added DB query does not block the live favorites rail on
       startup.
    5. `sourceCards` — maps `recentPlaylists()` to rail cards. `recentPlaylists()`
       ranks M3U, Xtream, and Stalker sources by their latest recent activity
       from `globalRecentItems()`, then falls back to playlist
       `updateDate` / `importDate` for sources that have never been used.
3. `DashboardDataService` is passive on construction. The dashboard feature
   owns the initial reloads for recent items, favorites, and Xtream recently
   added rows on page entry.
4. No `Layout` state, no localStorage keys, no migrations.
5. Navigation state + deep-link targets come from the existing
   `getRecentItemLink()` / `getGlobalFavoriteLink()` / `getPlaylistLink()`
   helpers on `DashboardDataService` and reuse the workspace navigation
   helpers in `@iptvnator/portal/shared/util`.
6. Xtream VOD and series detail pages opportunistically backfill
   `content.backdrop_url` when metadata exposes a backdrop, but that write
   must not refresh recently viewed ordering by itself.
7. The dashboard feature triggers a fresh reload of DB-backed recent/favorite
   rows on dashboard entry so newly backfilled backdrop data is visible as soon
   as the user returns from a detail page.
8. Playback-position reloads are keyed by the VOD/series recent set and should
   call `reloadPlaybackPositions()` through `untracked()` so live-only recent
   changes do not trigger unnecessary IPC round-trips.
9. Electron M3U dashboard favorites should use
   `PlaylistsService.getM3uFavoriteChannels()` first. That method checks the
   SQLite playlist migration flag and then calls
   `dbGetAppPlaylistFavoriteChannels(playlistId)`, letting the DB worker return
   only matched favorite channels instead of sending the full playlist payload
   back to the renderer. If the bridge method is missing or migration is
   incomplete, the dashboard falls back to the full playlist read.
10. Electron playlist summary loads should use
    `dbGetAppPlaylistMetas()` through `PlaylistsService.getAllPlaylists()`.
    This keeps dashboard/source/sidebar startup on a metadata-only SQLite path
    and avoids parsing full M3U `payload` blobs for surfaces that only need
    playlist title, type, counts, favorites, recent activity, and source
    connection fields. Workflows that need channel payloads still call
    `getPlaylistById()`.

## Empty State

The welcome state is rendered via the existing
`EmptyStateComponent` (`type="welcome"`) from
`libs/playlist/shared/ui`:

1. Illustration + headline + description from the existing M3U welcome
   strings (`HOME.PLAYLISTS.WELCOME_*`).
2. Primary button emits `addPlaylistClicked`. The dashboard page wires this
   to `WORKSPACE_SHELL_ACTIONS.openAddPlaylistDialog()`.
3. Feature chips (M3U / Xtream / Stalker) are provided by the component.

## UX Rules

1. Rails represent content the user is likely to resume, not provider
   internals. Never surface raw API objects.
2. Each rail must auto-hide when its data source is empty.
3. Image assets must degrade to a typed icon fallback — never show broken
   images or empty tiles.
4. The page must never show "No widgets" style text. If there is no content
   and no playlists, render the welcome state; otherwise render whatever
   rails have data.
5. Navigation from a rail card must deep-link into the appropriate workspace
   route without switching the active playlist in the header switcher.
6. `Recently Used Sources` reflects recent source usage across all provider
   types, not just recent imports.
7. The live rail title key must match the rendered source: favorites use
   `WORKSPACE.DASHBOARD.LIVE_FAVORITES`; recently watched fallback uses
   `WORKSPACE.DASHBOARD.LIVE_RECENT`.

## Adding Or Changing Rails

Current workflow:

1. Add a new `computed()` signal for the card list in
   `WorkspaceDashboardRailsComponent`, mapping your source data to
   `DashboardRailCard`.
2. Drop a `<lib-dashboard-rail>` in the template, gated by
   `@if (cards.length > 0)`.
3. If the data source is new, extend `DashboardDataService` rather than
   reaching into DB services directly from the component.
4. Provide a `seeAllLink` only if there is a dedicated "manage all" route
   for that content type.

## Deferred Work

Intentionally out of scope:

1. Customizable layout (drag/drop, resize, show/hide toggles, layout
   persistence). Removed in favor of a curated, opinionated order.
2. Freeform widget grid with collision management.
3. External data rails such as RSS, sports, or news adapters.
4. Per-user A/B variants of rail ordering.
