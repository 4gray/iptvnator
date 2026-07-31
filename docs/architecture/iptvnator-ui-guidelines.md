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
- Shared EPG timeline:
  `libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.html`
- Shared EPG timeline styles:
  `libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.scss`
- Shared EPG list:
  `libs/ui/epg/src/lib/epg-list-view/epg-list-view.component.ts`
- Shared EPG list styles:
  `libs/ui/epg/src/lib/epg-list-view/epg-list-view.component.scss`
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
- `--app-selection-on-color`
- `--app-selection-surface`
- `--app-selection-surface-strong`
- `--app-selection-border`
- `--app-selection-glow`

Use the app's own surface tokens for neutral surfaces (defined for both themes
in `apps/web/src/m3-theme.scss`):

- `--app-shell-bg` / `--app-rail-bg` / `--app-header-bg` / `--app-content-bg`
- `--app-widget-bg` / `--app-widget-header-bg` — panels and popovers
- `--app-card-hover-bg` — raised or hovered rows
- `--app-widget-border` / `--app-rail-border` — hairlines
- `--app-on-surface` — primary text
- `--app-eyebrow-color` — secondary/muted text

Angular Material mixins and Material-component overrides may use the tokens
owned by that component. Outside a Material-owned component, prefer the
app-owned tokens above. A `--mat-sys-*` reference is acceptable there only
after the built light and dark theme contexts both prove that it is emitted,
and it must still have a real app-token or literal fallback, for example:
`var(--mat-sys-surface-container, var(--app-widget-bg))`.

Several existing app surfaces still reference Material system tokens without
that proof or use hard-coded layout/selection colors. Treat those references
as migration debt, not patterns to copy.

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

Use `var(--app-selection-on-color)` when text or an icon sits directly on a
solid `var(--app-selection-color)` fill.

Use this pattern for:

- `.nav-item.selected` / `.nav-item.active`
- `.channel-list-item.active`
- `.epg-item.current-program`

Do not add extra badges, left rails, or second selection systems unless there is a strong reason.

## Detail Views

VOD and series detail screens share the detail-view Sass mixin (`@mixin base`)
from `libs/ui/styles/_detail-view.scss`. Feature-local `styles/detail-view.scss`
files should only `@use` that module and `@include detail-view.base(...)` with
small typography overrides when a provider needs them.

Do not copy the full detail-view stylesheet into feature libraries. Add shared
layout changes to the mixin, and keep provider-specific differences explicit in
the wrapper file that includes it.

## Electron Drag Regions

Every interactive descendant of a drag region—including buttons, links,
inputs, overlays, and resize handles—requires `app-region: no-drag`. The shared
directive-generated `.resize-handle` does not set this centrally yet. Until
that debt is fixed, consumers in drag regions must cover the handle themselves
and must not assume it already opts out.

## Channel List Item

The shared row should be reused instead of rebuilding channel markup per view.

### Current Reference Values

- Current minimum height:
  `68px`
- Horizontal gap:
  `12px`
- Padding:
  `8px 10px 8px 12px`
- Radius:
  `12px`
- Current logo shell:
  `44x44`, rounded, subtle inset treatment
- Compact variant:
  `52px` min height with slightly tighter padding

These values describe the current shared row, not a fixed-width contract. Keep
the row responsive: the text column uses `min-width: 0` and ellipsis, while
logos, drag affordances, and trailing actions use `flex-shrink: 0`. Prefer
minimum dimensions and flexible columns over fixed row widths.

### Content Layout

- Title is one line, medium-bold, slightly condensed
- Program title is a secondary line with lower emphasis
- Timeline uses three columns:
  start time, progress bar, end time
- Action buttons sit on the trailing edge and inherit row color

### Responsive Information Priority

- EPG-enabled, noncompact rows keep a fixed `68px` height that matches the
  virtual-scroll stride. EPG-disabled, compact rows use a matching fixed `52px`
  row and virtual-scroll size.
- At `310px` and below, hide the end time while keeping the start time and
  progress bar.
- At `270px` and below, hide the decorative logo while retaining program
  context and actions, and tighten horizontal padding to preserve the remaining
  content.
- At `220px` and below, hide the start time while keeping the progress bar.
- In EPG-preview rows, narrow width alone must not remove the channel name,
  program title or no-program placeholder, progress bar, drag affordance when
  applicable, or enabled actions.
- Radio consumers without EPG render the row as compact instead of showing a
  false no-program placeholder. Compact rows keep the logo at `270px`, then
  hide the logo and actions at `220px`.
- `isRadio` alone must not change row height inside a fixed-size mixed virtual
  list; the consumer's `showEpg` state and virtual-scroll item size own density.
- Loading skeletons mirror the same responsive hierarchy and row geometry.

### Logo Rules

- Show fallback icon only when no image is available or image loading fails
- Do not render placeholder and real logo at the same time
- Keep logos contained with `object-fit: contain`

## EPG Views

The shared timeline and list still contain local dark surfaces, blue selection
accents, and white foregrounds. These non-semantic hard-coded colors are
migration debt. New work should use app surface/selection/text tokens and must
not spread those local fallbacks. Semantic live, error, and status colors may
remain local when the meaning is explicit.

### Shared EPG Pane

- Header title stays sticky
- Program list is the only scrolling region
- Add bottom padding so the last program is not clipped
- Current program card uses the same selection treatment as selected channels

### Collapsible Live EPG

- Live TV layouts with an internal player render `app-epg-timeline` as the
  EPG content, including playlist-specific live pages and the global
  favorites/recent live tabs.
- The timeline's own panel bar owns the current-program summary and live date
  navigation together; there is no separate wrapper component around it.
- Collapsed state is shared across M3U, Xtream, and Stalker with
  `live-epg-panel-state`; missing or invalid values restore to expanded.
- The collapsed panel is a slim current-program strip with a trailing progress
  line and an expand button. Date controls stay out of the collapsed strip.
- Do not render the collapsed strip for external MPV/VLC playback; those
  layouts keep the full EPG-only panel.
- Keep the EPG content mounted while collapsed so current-program state can
  continue updating.

### Live Panel Disclosures

Live layouts treat Groups, Channels, and Guide as separate capabilities. Never
derive one panel's visibility from another panel's state, and never render a
disclosure control for an action the current layout cannot perform.

| Panel    | Applicable surfaces                                                                     | UI owner                                         |
| -------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Groups   | M3U Groups; Xtream Live TV; Stalker TV/Radio                                            | M3U groups view or the workspace context sidebar |
| Channels | M3U All/Groups; selected Xtream/Stalker live category; Favorites/Recent live collection | The route's channel-list or collection header    |
| Guide    | EPG timeline/list beside a working inline player                                        | `app-epg-timeline` or `app-epg-list-view`        |

`LiveLayoutPanelStateService` in
`@iptvnator/portal/shared/data-access` owns only persisted user intent for the
two left panels:

- `live-groups-panel-state`
- `live-channels-panel-state`

Both values are independently `expanded` or `collapsed`. On first use, each
missing or invalid new value is seeded from a valid legacy
`live-sidebar-state`; otherwise it defaults to expanded. Migration writes the
new keys and never rewrites or removes the legacy key.

Routes resolve effective visibility from intent plus local applicability,
responsive suppression, and the service's non-persisted master suppression.
That distinction is intentional: hiding a panel updates its own persisted
intent, while `Cmd/Ctrl+B` temporarily suppresses all applicable left panels
without overwriting either choice. Pressing the shortcut again restores the
saved combination. A direct panel action clears master suppression and then
applies the requested intent. Shortcut handlers ignore input, textarea,
select, and content-editable targets.

Disclosure controls follow one placement and accessibility contract:

- Expanded panels put a labelled Hide action in their own header.
- Collapsed panels put a labelled Show action on the boundary where the panel
  will return. If Groups and Channels are both collapsed, the restore rails
  stay in spatial panel order.
- Favorites and Recently Viewed keep their single Channels action in the
  collection header; do not duplicate it inside loading, empty, or zero-result
  content.
- The controlled panel stays mounted with `aria-hidden="true"` and `inert`
  while effectively hidden. The control uses `aria-controls`,
  `aria-expanded`, an action-oriented translated label, and a minimum 40px
  target. Move focus to the corresponding restore/hide control after a direct
  state change.
- Loading, empty-category, and zero-search-results states keep every applicable
  control operable. Applicability, not item count, decides whether a panel can
  be disclosed.

Responsive suppression must not manufacture no-op controls. The workspace
Groups panel is suppressed at 1023px and below; the M3U Groups panel is
suppressed below 600px. In both cases its persisted intent remains unchanged
and no Groups restore control appears. The M3U Channels bottom drawer remains
independently restorable on mobile.

Guide disclosure is a separate EPG capability. It is interactive only beside a
working inline player. External MPV/VLC layouts keep their full static EPG
heading without a Guide toggle, and radio layouts render no Guide panel. This
contract does not make the external-player right area content-aware; that is a
separate layout concern.

### EPG Card

- Radius:
  `11px` (`.epg-timeline__block` in
  `libs/ui/epg/src/lib/epg-timeline/epg-timeline-track.component.scss`)
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
- Use app-owned neutral borders, or a proven Material token with a real
  fallback such as
  `var(--mat-sys-outline-variant, var(--app-widget-border))`
- Keep active sections mostly defined by outline and subtle tint
- Avoid dark translucent backgrounds

### Dark Theme

- Denser tinted surfaces are acceptable
- Neutral rows can use low-opacity dark overlays
- Keep strong blue tint reserved for active sections and selected items

## Theme Guidance

### Light Theme

- Flat beats glossy
- White and app-owned widget/content surface layers should separate content
- Selection should read as a blue outline plus soft tint, not a solid slab

### Dark Theme

- Slight translucency is acceptable
- Background layers can be deeper and more cinematic
- Keep contrast readable without going pure white everywhere

## Reuse Strategy

Before creating new markup or CSS:

1. Check whether `app-channel-list-item` can be reused.
2. Check whether `app-epg-timeline` already provides the correct structure.
3. Check whether `nav-list.scss` already solves the list-selection problem.
4. Inspect the public APIs of `@iptvnator/ui/components`,
   `@iptvnator/ui/epg`, `@iptvnator/ui/playback`,
   `@iptvnator/ui/shared-portals`, `@iptvnator/portal/shared/ui`, and
   `@iptvnator/playlist/shared/ui`.
5. Put provider-neutral collection loading, persistence, and cross-provider
   orchestration in `@iptvnator/portal/shared/data-access`, not a UI library or
   the shared util library.
6. Extend tokens first, duplicate styles last.

## Implementation Workflow

When updating IPTVnator UI:

1. Inspect the current shared component first.
2. Reuse the shared structure where possible.
3. Keep selection, progress, and spacing in sync across Xtream, Stalker, and shared portal views.
4. Verify in both light and dark themes.
5. Run the focused component/unit target and the closest Playwright workflow.
6. Use the running Electron app through CDP only for Electron-only gaps or
   additional layout inspection; it does not replace available E2E coverage.

## Anti-Patterns

Avoid these:

- introducing a new selected-state color unrelated to the theme tokens
- copying the shared EPG's hard-coded dark/blue fallbacks into new surfaces
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
