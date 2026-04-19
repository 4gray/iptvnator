# Workspace Dashboard

This document records the current dashboard implementation inside the workspace
shell. It replaces the earlier dashboard plan document.

Related:

- [Workspace Shell](./workspace-shell.md)

## Summary

- The dashboard is the default `/workspace` landing page.
- It is a widget-based surface with persisted layout and widget settings.
- The current implementation favors a constrained, stable layout over a full
  freeform grid system.

Core implementation:

1. `libs/workspace/dashboard/feature/src/lib/workspace-dashboard.component.ts`
2. `libs/workspace/dashboard/feature/src/lib/workspace-dashboard.component.html`
3. `libs/workspace/dashboard/ui/src/lib/dashboard-widget-host.component.ts`
4. `libs/workspace/dashboard/data-access/src/lib/dashboard-widget.model.ts`
5. `libs/workspace/dashboard/data-access/src/lib/dashboard-layout.service.ts`
6. `libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.ts`

## Current Widget Set

Registered widget types:

1. `source-stats`
2. `continue-watching`
3. `recently-watched`
4. `global-favorites`

Default layout:

1. `continue-watching`
    1. Enabled by default
    2. Size `full`
2. `recently-watched`
    1. Enabled by default
    2. Size `two-thirds`
    3. Scope-aware
3. `global-favorites`
    1. Enabled by default
    2. Size `one-third`
    3. Scope-aware
4. `source-stats`
    1. Present in the registry
    2. Disabled by default
    3. Size `one-third`

The old refactor summary mentioned `Recent Sources`, but that widget is not in
the current registry and should not be documented as shipped behavior.

## Layout And Persistence Contract

The dashboard persists a versioned layout object in local storage.

Current storage details:

1. Storage key: `workspace-dashboard-layout-v3`
2. Schema version: `12`
3. Size presets:
    1. `one-third`
    2. `half`
    3. `two-thirds`
    4. `full`
4. Scope settings:
    1. `providers: Array<'m3u' | 'xtream' | 'stalker'>`
    2. `playlistIds: string[]`

Normalization rules in `DashboardLayoutService`:

1. Stored widgets are merged against `DEFAULT_DASHBOARD_WIDGETS`.
2. Missing widgets are restored from defaults.
3. Removed or invalid settings fall back to normalized defaults.
4. Titles and descriptions come from the current code-defined defaults, not
   stale stored values.
5. Widget order is reindexed after normalization.

## Rendering Flow

1. `WorkspaceDashboardComponent` reads `DashboardLayoutService.state()`.
2. Enabled widgets are filtered and rendered in layout order.
3. `DashboardWidgetHostComponent` maps `widget.type` to a concrete widget
   component.
4. Widgets receive the normalized config, including size and optional scope.
5. Data comes from `DashboardDataService` and existing provider/state services.
6. Widget actions deep-link back into workspace/provider routes.

Dashboard detail handoff contract:

1. Live items continue to activate their existing playback/provider route flows.
2. Xtream and Stalker movies/series from `global-favorites` or
   `recently-watched` should route into `/workspace/global-favorites` or
   `/workspace/global-recent` with collection detail pre-opened from navigation
   state.
3. Those collection detail opens must not switch the active playlist in the
   header playlist switcher.
4. Those collection detail opens must not show the workspace category sidebar.
5. The detail close/back action should return to the dashboard-origin view
   rather than reopening provider/category navigation.

## Customize Mode

Customize mode is part of the current product, not future work.

Supported actions:

1. Toggle widget visibility.
2. Drag-and-drop reorder for visible widgets.
3. Change widget size within the fixed preset list.
4. Configure provider scope for scoped widgets.
5. Configure playlist scope for scoped widgets.
6. Reset the layout to defaults.

Scope-aware widgets currently rely on a provider/playlist filter model rather
than per-widget custom query systems.

## UX Rules

1. Widgets should represent user tasks, not provider internals.
2. Each widget must own its loading, empty, and error states.
3. Dashboard failures must stay isolated to the widget that failed.
4. Widget navigation should resolve directly into the relevant content context.
5. Dashboard favorites/recent movie/series activations should preserve the
   current playlist context and use the collection-owned detail host instead of
   forcing provider/category side-navigation.
6. New widgets should fit the existing constrained layout model unless the
   dashboard architecture is explicitly being expanded.

## Adding Or Changing Widgets

Current workflow:

1. Add or update the widget type in `dashboard-widget.model.ts`.
2. Implement the widget UI under `libs/workspace/dashboard/ui/src/lib/widgets/`.
3. Register the widget in `dashboard-widget-host.component.ts`.
4. Add default state and migration-safe behavior in
   `dashboard-layout.service.ts`.
5. Extend `dashboard-data.service.ts` or reuse an existing feature service.
6. Ensure the widget has explicit empty/error/loading states and valid
   workspace deep links.

## Deferred Work

These items are intentionally not part of the current contract:

1. Freeform drag/resize grid with collision management.
2. External data widgets such as RSS, sports, or news adapters.
3. A widget marketplace or plugin system.
