---
name: iptvnator-theme-style
description: Use when changing IPTVnator SCSS tokens, shared layout mixins, portal headers, sidebars, detail views, Electron drag regions, or cross-portal visual consistency.
---

# IPTVnator Theme Style

## Canonical Sources

- Theme contexts and app tokens: `apps/web/src/m3-theme.scss`
- Shared forwarding inventory: `libs/ui/styles/_index.scss`
- Shared partials: `libs/ui/styles/_portal-layout.scss`,
  `libs/ui/styles/_content-grid.scss`, `libs/ui/styles/_portal-sidebar.scss`,
  `libs/ui/styles/_panel-header.scss`, `libs/ui/styles/_detail-view.scss`, and
  `libs/ui/styles/_detail-view-actions.scss`
- UI policy and migration debt: `docs/architecture/iptvnator-ui-guidelines.md`

The index is a barrel, not a configured Sass include path. Production
consumers currently use relative `@use` paths to the needed partial.

## Token Boundary

- App-owned surfaces, text, separators, hover states, selections, and provider
  accents use `--app-*` tokens from `m3-theme.scss`.
- Use `--app-selection-on-color` for foregrounds placed on the selection
  accent; do not assume white has enough contrast in both themes.
- Angular Material mixins and Material-component overrides may use Material
  tokens. Outside Material-owned components, use a `--mat-sys-*` token only
  after proving it is emitted in both light and dark contexts and supplying a
  real app-token or literal fallback.
- Local semantic status colors are acceptable. Existing hard-coded layout,
  selection, and EPG surface colors are migration debt, not precedent.

## Shared Layout Rules

- Extend the matching partial instead of copying a large provider stylesheet.
  Provider-neutral services and UI use the existing shared data-access/UI
  libraries; repeated visual structure belongs in a shared Sass partial.
  Portal-shared consumers use their existing forwarding style modules instead
  of copied SCSS.
- In an Electron drag region, every interactive descendant—buttons, links,
  inputs, overlays, and resize handles—must explicitly use
  `app-region: no-drag`. The shared directive-generated `.resize-handle` sets
  this centrally. Shared live sidebars reserve 8 px between their scroll
  content and the edge so scrollbar and resize hit areas stay independent.
- A shared change must be checked across M3U, Xtream, Stalker, workspace,
  portal catalog/shared UI, and unified collections where relevant.

## Validation

Run the affected consumer's Nx lint/test/build target. Inspect light and dark
themes, selected/hover states, and Electron title-bar drag/no-drag behavior.
