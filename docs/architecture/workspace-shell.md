# Workspace Shell

This document records the current workspace-first shell contract. It is the
stable replacement for the older UI refactor summary.

Related:

- [Workspace Dashboard](./workspace-dashboard.md)

## Summary

- `/workspace` is the primary app surface.
- `WorkspaceShellComponent` owns the persistent frame: rail, header, optional
  context panel, content outlet, and external playback footer.
- Descendant workspace pages inherit `layout = 'workspace'` from the
  `/workspace` root route.
- Provider route trees now bootstrap through route-scoped session providers
  instead of nested provider shell components.

Core implementation:

1. `apps/web/src/app/app.routes.ts`
2. `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.ts`
3. `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.html`
4. `libs/portal/shared/util/src/lib/navigation/portal-route.utils.ts`
5. `libs/portal/shared/util/src/lib/navigation/portal-rail-links.ts`
6. `libs/portal/shared/ui/src/lib/navigation/portal-rail-links.component.ts`

## Route Contract

Current workspace routes:

1. `/` -> `/workspace`
2. `/workspace` -> `/workspace/dashboard`
3. `/workspace/dashboard`
4. `/workspace/sources`
5. `/workspace/playlists/:id/:view`
6. `/workspace/global-favorites`
7. `/workspace/downloads`
8. `/workspace/settings`
9. `/workspace/xtreams/:id/...`
10. `/workspace/stalker/:id/...`

Compatibility redirect:

1. `/settings` -> `/workspace/settings`

Provider route integration:

1. `apps/web/src/app/app.routes.ts` marks the `/workspace` root route with
   `data.layout = 'workspace'`.
2. `isWorkspaceLayoutRoute(...)` treats that layout marker as inherited route
   state for all descendants.
3. Xtream and Stalker parent routes attach route-scoped session providers that
   bootstrap the active playlist, sync provider section state, and clean up
   provider-local state when the route is destroyed.
4. Workspace routes no longer rely on nested provider shell components for
   hidden local chrome.

## Shell Structure

The shell is intentionally split into four persistent regions:

1. Left rail:
   1. Static workspace links for dashboard and sources.
   2. Provider-aware context links derived from the active or current playlist.
2. Top header:
   1. Playlist switcher.
   2. Route-aware search input and command palette trigger.
   3. Add source action.
   4. Global favorites shortcut.
   5. Downloads shortcut in Electron.
   6. Context actions menu for playlist/account or section-level actions.
3. Main body:
   1. Optional left context panel.
   2. Main router outlet content.
4. Optional footer:
   1. External playback session bar when a docked session is visible.

## Context Panel Rules

The shell decides which secondary panel to show from the current route:

1. `/workspace/sources`
   1. `WorkspaceSourcesFiltersPanelComponent`
2. Xtream category sections (`live`, `vod`, `series`)
   1. `WorkspaceContextPanelComponent`
3. Stalker category sections (`itv`, `vod`, `series`)
   1. `WorkspaceContextPanelComponent`
4. `/workspace/settings`
   1. `WorkspaceSettingsContextPanelComponent`
5. Downloads sections
   1. `WorkspaceCollectionContextPanelComponent`

The context panel is part of the shell contract. New workspace-level routes
should explicitly decide whether they need one rather than adding local
sidebars inside feature pages.

## Search And Navigation Rules

Search is shell-owned and route-aware:

1. Disabled on settings routes.
2. Enabled on sources routes.
3. Enabled for supported Xtream and Stalker content/search views.
4. Placeholder text and search handling vary by provider and section.
5. Input changes are debounced before route/store updates are applied.

Rail navigation is also shell-owned:

1. Workspace-global entries are static.
2. Provider entries come from `buildPortalRailLinks(...)`.
3. On dashboard, sources, settings, and global favorites, the shell falls back
   to the currently selected playlist so provider navigation remains available
   even outside a provider route.

## Maintenance Guidance

Use this document as the source of truth when changing workspace shell behavior.

1. New top-level user destinations should default to child routes under
   `/workspace`.
2. Shared provider navigation logic belongs in portal-shared util/UI libraries,
   not duplicated inside the shell.
3. If a provider route changes how playlist/session bootstrap works, update the
   route-session provider and shell-facing route contract together.
4. Historical migration notes, cleanup lists, and one-off refactor steps should
   stay out of this file; track them in issues or PR notes instead.
