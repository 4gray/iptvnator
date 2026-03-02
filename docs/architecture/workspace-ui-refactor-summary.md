# Workspace UI Refactor Summary

Date: 2026-02-22

## 1) What Was Refactored

The app moved from a setup-first flow (playlist management first, then provider-specific UI) to a **workspace shell** flow with a persistent app frame:

1. Fixed left navigation rail (global + context links).
2. Persistent top header (playlist switcher, search, actions, favorites shortcut, sorting where relevant).
3. Secondary left panel for:
   1. Sources filters on `/workspace/sources`.
   2. Provider category context for Xtream/Stalker content sections.
4. Unified workspace routing with dashboard and sources as first-class views.

Core entrypoint:

1. `apps/web/src/app/workspace/workspace-shell.component.ts`
2. `apps/web/src/app/workspace/workspace-shell.component.html`

Shared rail link model:

1. `apps/web/src/app/shared/navigation/portal-rail-links.ts`
2. `apps/web/src/app/shared/navigation/portal-rail-links.component.ts`

## 2) New Dashboard (Current State)

The dashboard is now a real widget host with persisted layout and customization.

Key parts:

1. Widget model and defaults:
   1. `libs/workspace/dashboard/data-access/src/lib/dashboard-widget.model.ts`
2. Persisted layout store with migration support:
   1. `libs/workspace/dashboard/data-access/src/lib/dashboard-layout.service.ts`
3. Widget host:
   1. `libs/workspace/dashboard/ui/src/lib/dashboard-widget-host.component.ts`
   2. `libs/workspace/dashboard/ui/src/lib/dashboard-widget-host.component.html`
4. Dashboard page (view + customize mode):
   1. `libs/workspace/dashboard/feature/src/lib/workspace-dashboard.component.ts`
   2. `libs/workspace/dashboard/feature/src/lib/workspace-dashboard.component.html`

Active widget set:

1. Recent Sources
2. Source Statistics
3. Continue Watching
4. Recently Watched (global, scope-aware)
5. Global Favorites (global, scope-aware)

Notes:

1. Widget scope settings (provider + playlist filtering) are implemented for scoped widgets.

## 2.1) Dashboard Idea and Widget Implementation

### Product idea

The dashboard is designed as a content-first operational home, not a source setup page.

Goals:

1. Show high-value content immediately after app start.
2. Reduce context switching between Xtream, Stalker, and M3U flows.
3. Keep widgets independent so one data failure does not break the page.
4. Allow gradual customization without introducing heavy layout complexity too early.

Design principles:

1. Widgets are about user tasks (continue watching, favorites, recent activity), not provider internals.
2. Each widget must have explicit loading/empty/error states.
3. Widget settings should be persistent and reversible.
4. Navigation from widget cards should deep-link directly to the right route and content context.

### Implementation shape

Core implementation files:

1. Dashboard page and orchestration:
   1. `libs/workspace/dashboard/feature/src/lib/workspace-dashboard.component.ts`
   2. `libs/workspace/dashboard/feature/src/lib/workspace-dashboard.component.html`
2. Widget metadata contract:
   1. `libs/workspace/dashboard/data-access/src/lib/dashboard-widget.model.ts`
3. Layout + settings persistence:
   1. `libs/workspace/dashboard/data-access/src/lib/dashboard-layout.service.ts`
4. Widget rendering host:
   1. `libs/workspace/dashboard/ui/src/lib/dashboard-widget-host.component.ts`
5. Data aggregation and widget inputs:
   1. `libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.ts`
6. Shared activity item renderer (used by multiple widgets):
   1. `libs/workspace/dashboard/ui/src/lib/widgets/dashboard-activity-items.component.ts`

### How widget rendering works

1. `workspace-dashboard` reads layout state (widget list, order, enabled state, settings).
2. For each enabled widget, `dashboard-widget-host` maps `widget.type` to a concrete widget component.
3. The host passes widget config (`scope`, `settings`, mode flags) into the widget.
4. Widget requests data through `dashboard-data.service` and/or existing provider services/stores.
5. Widget emits navigation actions, which are translated into direct route deep-links.

### How persistence works

Layout is stored as a versioned dashboard configuration:

1. Widget identity and type
2. Visibility (`enabled`)
3. Order
4. Scope (`providers`, optional `playlistIds`)
5. Widget-specific `settings`

On load:

1. Stored layout is validated against current widget registry/defaults.
2. Missing or removed widgets are migrated safely.
3. Invalid settings fall back to defaults, preventing dashboard hard-fail.

### Widget UX behavior implemented

1. `Recently Watched` and `Global Favorites`:
   1. Content-kind chips (channels/vod/series)
   2. List/grid toggle
   3. Shared item styles
   4. Deep-link navigation into details/views
2. `Continue Watching`:
   1. Resume-oriented content block
3. `Recent Sources`:
   1. Source activity with truncation-safe titles
4. `Source Statistics`:
   1. Aggregated per-provider/source counters
5. `Recent Activity` was intentionally removed from scope.

### How to add a new widget (current workflow)

1. Add a new `type` in `dashboard-widget.model.ts`.
2. Implement widget component under `libs/workspace/dashboard/ui/src/lib/widgets/`.
3. Register it in `dashboard-widget-host.component.ts` type mapping.
4. Add default config in layout defaults/migration path (`dashboard-layout.service.ts`).
5. Extend `dashboard-data.service.ts` or reuse existing feature services for data.
6. Add explicit loading/empty/error UI states and deep-link behavior.

### Current boundaries

1. Advanced drag/resize grid and collision engine is not implemented yet.
2. External adapters (RSS/sports/news) are intentionally deferred.

## 3) Route Generalization (Current Routing Topology)

Primary app routing now starts in workspace:

1. `/` -> `/workspace`
2. `/workspace/dashboard`
3. `/workspace/sources`
4. `/workspace/playlists/:id` (M3U player in workspace frame)
5. `/workspace/xtreams/:id/...` (workspace layout applied)
6. `/workspace/stalker/:id/...` (workspace layout applied)

Defined in:

1. `apps/web/src/app/app.routes.ts`

Mechanism:

1. Existing provider route trees (`xtreamRoutes`, `stalkerRoutes`) are wrapped by `withWorkspaceLayout(...)` and receive `data.layout = 'workspace'`.
2. Provider shells/components use `isWorkspaceLayout` to hide legacy local sidebars/header pieces.

## 4) Generalized UX Behaviors Added

1. Playlist switcher integrated into persistent header and used as cross-context navigator:
   1. `libs/ui/components/src/lib/playlist-switcher/playlist-switcher.component.ts`
2. Header search unified, with debounced apply for route/store updates:
   1. `apps/web/src/app/workspace/workspace-shell.component.ts`
3. Sources filtering moved to dedicated panel:
   1. `apps/web/src/app/workspace/workspace-sources-filters-panel.component.ts`
4. Context categories moved to shared workspace panel:
   1. `apps/web/src/app/workspace/workspace-context-panel.component.ts`
5. Dashboard activity items deep-link directly to content context/details; Xtream live entries auto-play on open.

## 5) Legacy/Old Parts Still Present

### A) Legacy routes kept for compatibility

In `apps/web/src/app/app.routes.ts`:

1. `/home`
2. `/playlists`
3. `/iptv`
4. `/playlists/:id`
5. Non-workspace provider routes:
   1. `/xtreams/:id/...`
   2. `/stalker/:id/...`
6. Alias `/portals/:id` -> `StalkerMainContainerComponent`

### B) Legacy Xtream module tree kept as fallback

1. `apps/web/src/app/xtream/*`

This is still used by `legacyXtreamRouteFallback` when `!window.electron`.

### C) Dual-layout branching across provider components

Many provider components still have workspace/non-workspace conditional branches via `isWorkspaceLayout` (for sidebar/header/body behavior). This is intentional compatibility, but increases maintenance.

Examples:

1. `apps/web/src/app/xtream-electron/xtream-shell.component.html`
2. `apps/web/src/app/stalker/stalker-shell.component.html`
3. `apps/web/src/app/xtream-electron/xtream-main-container.component.html`
4. `apps/web/src/app/stalker/stalker-main-container.component.html`
5. `apps/web/src/app/home/video-player/video-player.component.html`

### D) Unused placeholder artifact

1. `apps/web/src/app/workspace/dashboard-placeholder.component.ts`
2. `apps/web/src/app/workspace/dashboard-placeholder.component.html`
3. `apps/web/src/app/workspace/dashboard-placeholder.component.scss`

These files are no longer routed.

## 6) Potential Removals (With Preconditions)

### Low risk (can remove soon)

1. Remove unused dashboard placeholder files (`dashboard-placeholder.*`).

### Medium risk (requires product decision)

1. Remove `/portals/:id` alias route if no external/deeplink dependency remains.
2. Remove legacy entry routes (`/home`, `/iptv`, `/playlists`, `/playlists/:id`) if workspace-only navigation is desired.

### High risk (requires platform/support policy decision)

1. Remove legacy fallback module `apps/web/src/app/xtream/*` and `legacyXtreamRouteFallback` only if non-Electron fallback is officially dropped.
2. Remove non-workspace provider routes (`/xtreams/:id/...`, `/stalker/:id/...`) only after verifying all deeplinks/bookmarks/integration paths have migrated to `/workspace/...`.

## 7) Recommended Cleanup Sequence

1. Remove unused placeholder files.
2. Decide whether non-workspace URLs must remain public and supported.
3. If workspace-only is approved:
   1. Deprecate legacy routes with redirects.
   2. Remove non-workspace route trees.
   3. Remove `isWorkspaceLayout` branches and simplify provider layouts.
4. If non-Electron fallback is not required:
   1. Remove `legacyXtreamRouteFallback`.
   2. Remove `apps/web/src/app/xtream/*`.

## 8) Current Plan Items Still Open

From current plan scope, remaining work is primarily:

1. Widget settings UX improvements (scope presets, bulk provider toggles).
2. Phase 3 dashboard advanced layout system (drag/resize/collision handling).
3. Phase 4 external widget framework (RSS/scores/news adapters + reliability controls).
