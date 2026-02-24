# Workspace Dashboard Plan

## Context

The workspace shell is now the primary app entrypoint. The dashboard should evolve from a placeholder into an operational home page that helps users:

1. Quickly continue playback/work.
2. Switch context across M3U, Xtream, and Stalker sources.
3. Monitor relevant content (recent items, EPG, status) in one place.

This document defines the implementation plan before Phase 1 work starts.

## Status Snapshot (February 22, 2026)

### Delivered

1. Dashboard route is active in workspace shell with persisted widget layout.
2. Widget host and configurable widget model are implemented.
3. `Customize` mode supports:
   1. Enable/disable widgets
   2. Reorder widgets (up/down)
   3. Widget scope (provider + playlist selection)
4. Active widgets in production:
   1. Continue Watching
   2. Recent Sources
   3. Source Statistics
   4. Recently Watched (global)
   5. Global Favorites
5. Recently Watched and Global Favorites support:
   1. Content-kind chips (channels/vod/series)
   2. List/grid toggle
   3. Direct deep linking from widget item to target view/detail
6. Xtream live deep links now auto-start playback when opened from dashboard widgets.
7. Dashboard now uses a shared Material-based widget shell for consistent visual structure.
8. Customize mode now supports drag-and-drop ordering and widget size presets (`1/3`, `1/2`, `2/3`, `full`).

### Partially Delivered / Deviation From Initial Phase 1 List

1. EPG Radar was intentionally removed from the current dashboard scope and is postponed.
2. Recent Activity / Recently Added widget was intentionally removed from current scope.

### Not Started

1. Phase 4 external widgets (RSS/scores/news adapters).

### Immediate Next Widget Tasks (Recommended)

1. Expand widget settings UX (scope presets, bulk provider toggles).

## Product Direction

The dashboard should be a configurable widget system, but introduced in stages:

1. Start with useful, stable widgets and a constrained layout.
2. Add edit/customization workflows after widget value is proven.
3. Add advanced drag/resize and external integrations later.

This avoids building heavy layout mechanics before core data widgets are solid.

## UX Direction

Design style: professional operator console (dense, calm, high-signal).

Target layout:

1. Top row: continue actions, recent sources, health/status.
2. Middle row: discovery widgets (recently viewed, recently added, favorites).
3. Edit mode: add/remove/reorder widgets and configure source scope.

## Architecture

## Core Components

1. `DashboardPageComponent` (container/layout/edit mode orchestration)
2. `DashboardWidgetHostComponent` (widget factory/renderer by type)
3. `DashboardLayoutStore` (signal-based state for layout, settings, edit mode)
4. `DashboardPersistenceService` (save/load layout, version migration)
5. `DashboardDataFacade` (aggregate provider data for widgets)

## Widget Contract

```ts
type WidgetSize = 'one-third' | 'half' | 'two-thirds' | 'full';

interface WidgetScope {
  providers: Array<'m3u' | 'xtream' | 'stalker'>;
  playlistIds?: string[];
}

interface DashboardWidget {
  id: string;
  type: string;
  title: string;
  size: WidgetSize;
  order: number;
  enabled: boolean;
  scope: WidgetScope;
  settings: Record<string, unknown>;
}

interface DashboardLayout {
  version: number;
  widgets: DashboardWidget[];
}
```

## Capability Rules

Widgets must degrade gracefully per provider:

1. If a source/provider does not support required data (for example EPG), show a clear empty/unsupported state.
2. Widgets never hard fail the page; each widget owns loading/error states.
3. Scope defaults to "all supported providers" unless user config overrides it.

## Phased Delivery

## Phase 1 (Now): Production Dashboard V1

Scope:

1. Replace placeholder dashboard with real widget host + predefined layout.
2. Fixed grid slots (no free drag/resize yet).
3. Initial widgets:
   1. Recent Sources
   2. Continue Watching
   3. Source Statistics
   4. Recently Added / Recently Viewed (provider-aware)
4. Persist enabled/disabled and order (simple list reorder if needed).

Out of scope:

1. Freeform drag-and-drop grid resizing.
2. External data providers (RSS/sports/news).
3. Full widget marketplace.

Acceptance criteria:

1. Dashboard loads with useful content for at least one active source type.
2. Empty states are clear and actionable (links to Sources/settings).
3. No route regressions for existing workspace sections.
4. Layout/settings survive app restart.

## Phase 2: Edit Mode and Configuration

Scope:

1. "Customize dashboard" mode.
2. Enable/disable widgets.
3. Widget-level source scoping (providers + selected playlists).
4. Order management (move up/down or drag reorder within constrained grid).

## Phase 3: Advanced Layout (Drag/Resize)

Scope:

1. True grid layout manager with size presets and drag repositioning.
2. Collision handling and responsive breakpoint behavior.
3. Optional "reset layout" and preset templates.

## Phase 4: External Widgets

Scope:

1. Adapter interface for non-playlist data widgets (RSS, scores, news).
2. Polling/cache strategy with rate limits.
3. User opt-in and failure isolation per external source.

## Data and Performance Notes

1. Use memoized/computed selectors for widget inputs.
2. Avoid redundant provider fetches; reuse existing stores/services where possible.
3. Update widgets incrementally and isolate heavy computations in facade/store utilities.

## File/Module Placement (Proposed)

1. `libs/workspace/dashboard/feature/` (page + edit mode orchestration)
2. `libs/workspace/dashboard/ui/` (widget host + widget components)
3. `libs/workspace/dashboard/data-access/` (state model + persistence + data facade/service)
4. Route integration remains in `apps/web/src/app/app.routes.ts` and workspace shell.

## Open Questions

1. Should dashboard layout be global per app profile, or per active workspace/provider mix?
2. Which widgets are enabled by default for new users vs migrated users?

## Next Step

Start Phase 1 implementation using this document as the source of truth and track deviations explicitly in follow-up updates.
