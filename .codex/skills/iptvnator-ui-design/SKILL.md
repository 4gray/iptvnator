---
name: iptvnator-ui-design
description: Use when changing user-visible Angular UI in IPTVnator, especially channel rows or lists, EPG views, settings and playlist surfaces, selection states, shared portal components, or light/dark styling.
---

# IPTVnator UI Design

## Inspect First

- Policy: `docs/architecture/iptvnator-ui-guidelines.md`
- Theme and navigation: `apps/web/src/m3-theme.scss`,
  `apps/web/src/nav-list.scss`
- Channel row: `libs/ui/components/src/lib/channel-list-container/channel-list-item/`
- Shared EPG timeline/list: `libs/ui/epg/src/lib/epg-timeline/`,
  `libs/ui/epg/src/lib/epg-list-view/`

Before adding local markup, inspect `@iptvnator/ui/components`,
`@iptvnator/ui/epg`, `@iptvnator/ui/playback`,
`@iptvnator/ui/shared-portals`, `@iptvnator/portal/shared/ui`, and
`@iptvnator/playlist/shared/ui`. Stateful collection loading, persistence, and
cross-provider orchestration belong in `@iptvnator/portal/shared/data-access`,
not UI or util.

## Design Contract

- Prefer dense, scannable application UI. Behavior-only work must not include
  an opportunistic visual rewrite.
- App chrome uses app-owned selection, surface, and text tokens in both themes.
  Do not extend the known hard-coded EPG/surface styling debt.
- Dense rows use minimum dimensions rather than a fixed width: the text column
  needs `min-width: 0` plus ellipsis, while logos and trailing actions use
  `flex-shrink: 0`.
- Assign one scroll owner per pane. Preserve sticky controls, keyboard/focus
  feedback, and loading, empty, error, disabled, hover, and selected states.
- Providers supply controlled data to shared EPG timeline/list/panel components
  instead of rebuilding those views.
- Shared changes require checking every affected M3U, Xtream, Stalker,
  workspace, and collection consumer in light and dark themes.

## Validation

Run the focused component/unit target and the closest Playwright workflow for a
visible change. Electron CDP is a fallback for Electron-only gaps, not a
replacement for an available E2E flow. Record any uncovered visual state.
