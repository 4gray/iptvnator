# IPTVnator UI Guidelines

This document captures the current UI language used across IPTVnator, with emphasis on channel lists, EPG views, settings surfaces, and shared selection patterns.

Use it when changing existing views or introducing new list-based UI in the workspace, Xtream, or Stalker flows.

## Core Principles

1. Prefer shared components over duplicated markup.
   The canonical channel row is `app-channel-list-item`.

2. Drive emphasis through selection state, not through constant decoration.
   Neutral rows should stay quiet. Only active or current items should pick up strong color.

3. Use the same selection language everywhere.
   Selected nav items, channels, and current EPG cards should feel like the same system.

4. Keep dark and light themes intentionally different.
   Dark theme can carry more density and tinted surfaces.
   Light theme should be flatter and cleaner, with white or near-white cards.

5. Scroll ownership must be explicit.
   Headers stay visible. Lists scroll. Do not let nested panes compete for scroll.

## Canonical References

- Channel row:
  `libs/ui/components/src/lib/channel-list-container/channel-list-item/channel-list-item.component.html`
- Channel row styles:
  `libs/ui/components/src/lib/channel-list-container/channel-list-item/channel-list-item.component.scss`
- Shared EPG pane:
  `libs/ui/shared-portals/src/lib/epg-view/epg-view.component.html`
- Shared EPG pane styles:
  `libs/ui/shared-portals/src/lib/epg-view/epg-view.component.scss`
- Shared list selection style:
  `apps/web/src/nav-list.scss`
- Theme tokens:
  `apps/web/src/m3-theme.scss`
- Settings surfaces:
  `apps/web/src/app/settings/settings.component.scss`
- Detail view shell styles:
  `libs/ui/styles/_detail-view.scss`

## Shared Tokens

These tokens are the base for interactive emphasis:

- `--app-selection-color`
- `--app-selection-surface`
- `--app-selection-surface-strong`
- `--app-selection-border`
- `--app-selection-glow`

Use Material surface tokens for neutral surfaces:

- `--mat-sys-surface`
- `--mat-sys-surface-container-low`
- `--mat-sys-surface-container`
- `--mat-sys-surface-container-high`
- `--mat-sys-outline-variant`
- `--mat-sys-on-surface`
- `--mat-sys-on-surface-variant`

Do not hardcode unrelated accent colors for selected state when these tokens already exist.

## Selection Pattern

Apply the same visual recipe to selected list items, active channels, and current EPG items:

- Background:
  `linear-gradient(135deg, var(--app-selection-surface-strong), var(--app-selection-surface))`
- Border:
  `var(--app-selection-border)`
- Glow:
  outer shadow using `var(--app-selection-glow)`
- Lift:
  `transform: translateY(-1px)` for selected list items only
- Text:
  selected text should inherit `var(--app-selection-color)`

Use this pattern for:

- `.nav-item.selected` / `.nav-item.active`
- `.channel-list-item.active`
- `.epg-item.current-program`

Do not add extra badges, left rails, or second selection systems unless there is a strong reason.

## Detail Views

VOD and series detail screens share the `detail-view` Sass mixin from
`libs/ui/styles/_detail-view.scss`. Feature-local `styles/detail-view.scss`
files should only import that mixin and pass small typography overrides when a
provider needs them.

Do not copy the full detail-view stylesheet into feature libraries. Add shared
layout changes to the mixin, and keep provider-specific differences explicit in
the wrapper file that includes it.

## Channel List Item

The shared row should be reused instead of rebuilding channel markup per view.

### Structure

- Min height:
  `68px`
- Horizontal gap:
  `12px`
- Padding:
  `8px 10px 8px 12px`
- Radius:
  `12px`
- Logo shell:
  `44x44`, rounded, subtle inset treatment
- Compact variant:
  `52px` min height with slightly tighter padding

### Content Layout

- Title is one line, medium-bold, slightly condensed
- Program title is a secondary line with lower emphasis
- Timeline uses three columns:
  start time, progress bar, end time
- Action buttons sit on the trailing edge and inherit row color

### Logo Rules

- Show fallback icon only when no image is available or image loading fails
- Do not render placeholder and real logo at the same time
- Keep logos contained with `object-fit: contain`

## EPG Views

### Shared EPG Pane

- Header title stays sticky
- Program list is the only scrolling region
- Add bottom padding so the last program is not clipped
- Current program card uses the same selection treatment as selected channels

### Collapsible Live EPG

- Live TV layouts with an internal player use `app-live-epg-panel` around the
  EPG content, including playlist-specific live pages and the global
  favorites/recent live tabs.
- The live panel toolbar owns the current-program summary and live date
  navigation together, so `app-epg-list` hides its internal date navigator when
  projected inside that panel.
- Collapsed state is shared across M3U, Xtream, and Stalker with
  `live-epg-panel-state`; missing or invalid values restore to expanded.
- The collapsed panel is a slim current-program strip with a trailing progress
  line and an expand button. Date controls stay out of the collapsed strip.
- Do not render the collapsed strip for external MPV/VLC playback; those
  layouts keep the full EPG-only panel.
- Keep the EPG content mounted while collapsed so current-program state can
  continue updating.

### Collapsible Live Sidebar

- M3U, Xtream, and Stalker live layouts share a single sidebar collapse toggle
  that hides the channels rail to give the player and EPG full width.
- In Xtream and Stalker live TV, the same toggle also collapses the workspace
  shell context sidebar (the "Live Categories" rail rendered by
  `WorkspaceShellContextSidebarComponent`), matching M3U's "everything quiets"
  behaviour. The shell categories rail only collapses when the active section
  is `live` (Xtream) or `itv`/`radio` (Stalker); movies, series, favorites,
  and recent routes leave it untouched.
- Collapsed state is owned by `LiveLayoutSidebarStateService`
  (`providedIn: 'root'`) in `@iptvnator/portal/shared/util`. Every surface that
  participates injects the service and reads `isCollapsed`; any toggle calls
  `service.toggle()`. Persistence delegates to the existing
  `live-sidebar-state` helpers, so the localStorage key stays unchanged and
  missing/invalid values restore to expanded.
- A `mat-icon-button` with `chevron_left` lives in the sidebar header and
  toggles state. While collapsed, a floating `chevron_right` mini-fab appears
  at the left edge of `.content-container` to restore the rail (and the
  categories rail, in Xtream/Stalker live).
- Keyboard shortcut: `Cmd/Ctrl+B`. The handler ignores events that originate
  inside `<input>`, `<textarea>`, `<select>`, or content-editable elements via
  the shared `isTypingInInput` helper.
- The CSS class `.sidebar-collapsed` (channels rail) and
  `.context-panel--collapsed` (workspace shell categories rail) both override
  the inline width set by the `appResizable` directive with
  `width: 0 !important; min-width: 0 !important`. The directive's persisted
  width is preserved so uncollapsing restores the user's previous resized
  width. Both rails share the same 180 ms width transition so motion stays in
  lockstep.
- Below 600 px viewport, the M3U layout's mobile bottom-drawer rule overrides
  the desktop collapse to `height: 0` instead of `width: 0`, and the floating
  restore handle is hidden.

### EPG Card

- Radius:
  `14px`
- Neutral cards use low-contrast surface treatment
- Current card uses selection surface and selection border
- Description should clamp rather than overflow

### Sticky Header

- Keep the title readable above content
- Use a solid or near-solid backing surface
- Do not let it overlap or cover player controls

## Progress Bars

Channel preview progress and EPG current-program progress should stay visually aligned.

### Track

- Height:
  `6px`
- Shape:
  full pill radius
- Neutral background:
  medium gray or neutral surface tint
- Include a slight inset edge so the remaining duration is visible

### Fill

- Use `--app-selection-color`
- Add a subtle sheen, not a heavy gradient
- Add a restrained glow, not a neon effect

The progress bar should clearly communicate:

- completed duration
- remaining duration

Avoid making the track too faint, especially in dark theme.

## Navigation Lists

Use the shared `nav-list.scss` treatment for sidebar and context-panel list items.

### Rules

- Keep labels one line with ellipsis
- Keep icon area clear from the selection border and any decorative rail
- Hover is neutral surface, not the selected color
- Selected state uses the shared selection recipe

If the label is too long for the rail, shorten the label key instead of shrinking the component until it becomes inconsistent.

## Settings Surfaces

Settings use the same system but are flatter than content-heavy views.

### Light Theme

- Prefer white or near-white cards
- Use neutral borders from `--mat-sys-outline-variant`
- Keep active sections mostly defined by outline and subtle tint
- Avoid dark translucent backgrounds

### Dark Theme

- Denser tinted surfaces are acceptable
- Neutral rows can use low-opacity dark overlays
- Keep strong blue tint reserved for active sections and selected items

## Theme Guidance

### Light Theme

- Flat beats glossy
- White and surface-container layers should separate content
- Selection should read as a blue outline plus soft tint, not a solid slab

### Dark Theme

- Slight translucency is acceptable
- Background layers can be deeper and more cinematic
- Keep contrast readable without going pure white everywhere

## Reuse Strategy

Before creating new markup or CSS:

1. Check whether `app-channel-list-item` can be reused.
2. Check whether `app-epg-view` already provides the correct structure.
3. Check whether `nav-list.scss` already solves the list-selection problem.
4. Extend tokens first, duplicate styles last.

## Implementation Workflow

When updating IPTVnator UI:

1. Inspect the current shared component first.
2. Reuse the shared structure where possible.
3. Keep selection, progress, and spacing in sync across Xtream, Stalker, and shared portal views.
4. Verify in both light and dark themes.
5. Verify in the running Electron app when the change is visual or layout-sensitive.

## Anti-Patterns

Avoid these:

- introducing a new selected-state color unrelated to the theme tokens
- duplicating channel row markup in portal-specific views
- showing placeholder logos behind real logos
- making entire panes scroll when only the list should scroll
- using dark translucent fills unchanged in light theme
- solving cramped sidebars with smaller fonts instead of shorter labels

## Definition Of Done For UI Changes

A visual change is not done until:

1. Shared component reuse was considered first.
2. Light theme and dark theme both look intentional.
3. Selection and progress states match existing IPTVnator patterns.
4. Scroll behavior is correct.
5. The result was checked in the running app for layout-sensitive work.
