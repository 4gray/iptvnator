---
name: iptvnator-theme-style
description: Theme architecture, design tokens, shared SCSS library, portal header/sidebar patterns, Electron drag regions, and cross-portal style consistency.
---

# IPTVnator Theme Style

Use this skill when changing SCSS tokens, shared layout mixins, portal headers, sidebars, detail views, or Electron draggable regions.

## Shared Style Sources

- `libs/ui/styles/_index.scss`
- `libs/ui/styles/_portal-layout.scss`
- `libs/ui/styles/_content-grid.scss`
- `libs/ui/styles/_portal-sidebar.scss`
- `libs/ui/styles/_panel-header.scss`
- `libs/ui/styles/_detail-view-actions.scss`
- `docs/architecture/iptvnator-ui-guidelines.md`

## Rules

- Prefer shared SCSS mixins and Material system tokens over local hard-coded colors.
- Keep Electron drag behavior explicit: interactive controls need `app-region: no-drag`.
- Do not duplicate large SCSS files across feature libraries; extract a shared partial or mixin.
- Use relative SCSS imports only when no stable shared entrypoint exists.
- Check Xtream, Stalker, M3U, and workspace views for cross-portal style drift when editing shared patterns.

## Validation

- Run lint/tests for the affected UI project.
- Manually inspect the changed screen in light and dark themes for layout, selection, and drag-region regressions.
