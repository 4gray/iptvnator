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
  `libs/ui/styles/_nav-list.scss`
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

## Player And EPG Theme Boundaries

The native-view Embedded MPV dock is app chrome: its solid widget background,
text, separators, sliders and interaction states resolve app tokens together.
Material icon buttons override their component tokens, including disabled
icons. The dock must never pair a dark fallback surface with inherited light
app text. Loader/stall and transient feedback overlays own a light foreground
and dark scrim because they cover video. Video viewports remain black in both
themes and fullscreen; frame-copy and built-in shared controls keep their
existing light-on-dark overlay palette.

EPG timeline, list, empty states and programme details use the library-local
`libs/ui/epg/src/lib/_epg-theme.scss` palette, based on app surfaces, separators,
selection and live accents. Text pairs with the actual surface in both themes;
current/playing titles must not force white onto a light selection tint.
Past programme text remains readable without reducing opacity on the whole
card. List loading shimmer uses translucent primary text stops so placeholders
remain visible on either theme’s content surface. Theme changes resolve through
CSS on the mounted components immediately.

Electron E2E measures app-panel foreground/background contrast (including
translucency, ancestor opacity and the timeline’s sibling progress fill),
surface brightness and control geometry.
Shared overlay icons are separately rasterized over a white test frame to
include gradient scrims and Material hover/focus layers in their contrast check.
Synthetic media is used for visual artifacts. Native-view video is composited
outside Chromium screenshots, so playback is also verified from session
position; a black screenshot viewport alone is not proof of failed decoding.

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
directive-generated `.resize-handle` sets this centrally in `resizable.scss`.
The shared live-layout sidebar reserves 8 px at its right edge so the inward
half of the 12 px resize handle cannot cover the channel scrollbar.

## Keyboard Scrolling and Channel Focus

`ChannelScrollFocusDirective` belongs on the actual channel scroll owner,
including virtual viewports and nonvirtual Favorites/Recent/Stalker lists.
Pointer selection focuses that owner without moving its scroll position.
ArrowUp/Down, PageUp/Down, Home/End and Space retain native scrolling there;
scroll keys do not bubble into document-level player shortcuts. A row's main
button remains separate from favorite/info actions, supports native Enter and
Space activation, and retains keyboard focus on activation. Tab/Shift+Tab use
the normal DOM order. Scrolling from a virtual row moves focus to its viewport
before CDK can recycle the row; asynchronous data updates never move focus.
Xtream aligns a newly selected channel only when it is outside the viewport;
updates to the same selected ID never re-align it. A smooth scroll to an
already visible row would otherwise cancel an immediate keyboard scroll.

In portal Live TV, ArrowRight on the selected category enters the visible
`live-channels` region; ArrowLeft from that region or a channel's main button
returns to the selected category in `portal-categories`. These IDs identify the
single mounted main pane, not fullscreen or overlay lists. Navigation does not
select a channel or start playback. Modified shortcuts, input fields, menus,
dialogs, player controls and hidden/inert panes keep their own behavior.

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

### Collapsible Live Sidebar

- Live-TV panels fold from the outside in, in three nested levels owned by
  `LiveSidebarState` (`@iptvnator/portal/shared/util`):
    1. `expanded` — categories rail + channels rail + player.
    2. `categories-hidden` — channels rail + player. The shell's categories
       rail (`WorkspaceShellContextSidebarComponent`, live sections only:
       Xtream `live`, Stalker `itv`/`radio`) folds; the channels header turns
       its category title into a dropdown that opens the same rail as a
       popover, so switching categories stays one click away.
    3. `collapsed` — player + EPG only ("theater").
- There is deliberately no "channels hidden, categories visible" state: a
  category click has to bring the channels back anyway. Surfaces without a
  categories rail (M3U, the unified-collection live tab) treat level 2 like
  level 1 — and so does the live ROOT (no selected category, Xtream `/live`
  "All Items", Stalker's all-items grid): there is no channels rail to host
  the way back, so the shell folds the categories rail at level 2 only while
  the portal store has a selected category (`hasLiveCategorySelection`), and
  the rail's hide chevron is withheld there too. Level 3 folds it regardless,
  since the floating restore handle lives in the content area.
- Xtream Live TV's root view (`/live` with no selected category) follows the
  same paginated `All Items` shell as VOD and Series: a widget header with the
  total channel count, page-size controls, and page navigation above the shared
  `app-grid-list`. Use the grid list's logo-oriented live variant so channel
  logos stay contained in 16:9 thumbnails instead of being cropped like
  VOD/series posters. Selecting a channel from that root grid starts playback,
  selects the channel's category, highlights the active category and channel,
  and scrolls the category rail plus virtual channels list to the selected rows
  when those rails are visible.
- Affordances, each in the panel it acts on:
    - A `chevron_left` in the categories rail header
      (`WorkspaceContextPanelComponent`, `presentation="sidebar"`, live
      sections only) → level 2 (`hideCategories('portal')`).
    - A `chevron_right` at the start of the channels header
      (`data-test-id="live-show-categories"`) and the popover footer's
      "Show categories panel" → level 1 (`showCategories('portal')`).
    - The category dropdown (`data-test-id="live-category-dropdown"`) opens
      `LIVE_CATEGORIES_POPOVER` anchored below itself. The token lives in
      `@iptvnator/portal/shared/util`; the workspace shell provides it
      (`WorkspaceLiveCategoriesPopoverService`, CDK overlay hosting
      `WorkspaceLiveCategoriesPopoverComponent`, which stamps the context
      panel with `presentation="popover"`) and the live layouts reach it
      through their `LivePanelsController` (`createLivePanelsController()`
      in a field initializer: level flags, the popover bridge and the focus
      handoff in one shared object, so the layout components carry none of
      it; without a provider the header keeps its plain title). The stamped
      panel opts out of the live-TV column keyboard contract
      (`columnHandoff=false`: no `#portal-categories` id, no ArrowRight
      handoff to `#live-channels`), since the dialog's focus trap would
      bounce that handoff back inside and a second id would shadow the
      folded rail's; the category sort preference is shared through
      `PortalCategorySortStateService`, so a sort picked in the popover
      survives into the restored rail. Backdrop, Escape, the footer, any
      category selection (`categorySelected` output), any router
      `NavigationStart` and any live-panel level change (`Cmd/Ctrl+B`
      reaches the layout through the dialog) close it; focus returns to the
      trigger. The popover host is a `role="dialog"` with `aria-modal` and a
      `CdkTrapFocus` host directive that captures focus on open, matching
      the trigger's `aria-haspopup="dialog"`.
    - The `chevron_left` in the channels header → level 3
      (`collapse('portal')`).
    - While collapsed, a floating `chevron_right` mini-fab at the left edge of
      `.content-container`, the workspace header toggle and `Cmd/Ctrl+B`
      (`toggle(surface)`) return to the level the user collapsed from, not
      always to level 1. The shortcut handler ignores events that originate
      inside `<input>`, `<textarea>`, `<select>`, or content-editable
      elements via the shared `isTypingInInput` helper. "Show playing
      channel" (`XtreamLiveChannelNavigationService`, `StalkerLiveNavigation`)
      uses `expand('portal')` for the same reason: revealing the row must not
      unfold a deliberately hidden categories rail.
- Collapsed state is owned by `LiveLayoutSidebarStateService`
  (`providedIn: 'root'`) in `@iptvnator/portal/shared/util` and kept **per
  surface** (`LiveSidebarSurface`): `m3u` (the M3U player), `portal` (Xtream
  and Stalker live layouts plus the shell categories rail) and `collection`
  (the unified favorites/recent live tab). Every participant injects the
  service and reads a derived, stable per-surface signal, never the raw
  state: the categories rail folds on `areCategoriesHiddenFor(surface)`, the
  channels rail on `isCollapsedFor(surface)`; actions are `toggle`,
  `collapse`, `expand`, `hideCategories`, `showCategories` and `setState`,
  all per surface. Nothing reads localStorage directly. Persistence lives
  under `live-sidebar-state:<surface>` and every level is restored as
  stored; the level `toggle()` comes back to is session-only. Hiding the
  list is a per-context choice: it must not follow the user from a portal to
  an M3U playlist, nor from the desktop rail to the phone bottom drawer of
  another surface. The pre-split shared key `live-sidebar-state` is forgotten
  on service construction and never read — a stored `collapsed` there hid
  every channel list in the app behind a 32px chevron and survived restart,
  "Remove all playlists" and re-import (issue #1458).
- The control never moves. Inside the rail a `mat-icon-button` with
  `chevron_left` hides it; while collapsed a floating `chevron_right` mini-fab
  sits at the left edge of `.content-container`. Because both of those live
  in the thing they hide, the workspace header additionally renders
  `view_sidebar` (`headerSidebarToggle`, `WorkspaceShellHeaderService`) on
  every route that renders its own rail — M3U `all`/`groups`, Xtream `live`,
  Stalker `itv`/`radio` (`resolveRouteLiveSidebarSurface`). It stays in place
  in both states, uses `aria-pressed` (pressed = rail visible) and tints
  primary only while the rail is hidden, since the hidden state is the
  exception that deserves the cue. Collection pages are deliberately excluded:
  only the page knows whether its live tab, and therefore the rail, is on
  screen, so its own header toggle beside the content switch stays the owner.
  At the phone breakpoint (≤640px) the header toggle is hidden: the rail is a
  bottom drawer there with its own toggle and the header has no spare width.
- While the rail is collapsed and nothing is playing, every live host renders
  `app-channel-list-hidden-state` (`@iptvnator/portal/shared/ui`) instead of
  the "select a channel" empty state: a title that says the list is hidden, a
  one-line hint naming the shortcut, and a full-size "Show channels list"
  stroked button wired to the same toggle. The generic
  `app-portal-empty-state` grew optional `hint`, `actionLabel`, `actionIcon`
  inputs and an `action` output for this; the action keeps full opacity while
  icon and copy stay muted, because it is the way out of the state.
- A folded rail is 0px wide but still rendered, so it also carries `inert`
  (`isContextPanelInert` on the shell rail, `isSidebarCollapsed` on the
  Xtream/Stalker channels rail) to leave the Tab order and the accessibility
  tree; the shell rail skips `inert` while it renders as the open phone
  drawer, whose stylesheet ignores the folded state — and the rail's hide
  chevron is withheld there for the same reason (`canHideCategories`).
  Every level change removes or inerts the very button the user activated,
  so focus drops to `<body>`; the side that gains the replacement affordance
  picks it up after its next render via `focusIfFocusLost()`
  (`@iptvnator/portal/shared/util`): the layouts' `LivePanelsController`
  installs `handoffFocusOnLiveSidebarChange()` over the EFFECTIVE level (on
  the live root the first category selection folds the rail with no state
  change) and focuses the floating restore handle at player-only or the
  show-categories button while the rail is folded, and the shell sidebar,
  watching the rail's ACTUAL fold state (on the live root the rail stays
  visible at level 2, so only player-only ↔ visible is a transition there),
  focuses the control the context panel names (`focusTarget()`: its hide
  chevron, or its first header action when the chevron is withheld) and,
  while none is rendered (categories loading, a failed load), the
  `tabindex="-1"` aside itself — only on transitions, and never when another
  control still owns focus.
- The CSS class `.sidebar-collapsed` (channels rail) and
  `.context-panel--collapsed` (workspace shell categories rail) both override
  the inline width set by the `appResizable` directive with
  `width: 0 !important; min-width: 0 !important`. The directive's persisted
  width is preserved so uncollapsing restores the user's previous resized
  width. Both rails share the same 180 ms width transition so motion stays in
  lockstep. The dropdown reuses the static heading's type so folding the rail
  does not move the title; the caret is the only added ink
  (`_portal-sidebar.scss`).
- At the phone breakpoint the M3U layout's bottom-drawer rule overrides the
  desktop collapse to `height: 0` instead of `width: 0`. The floating restore
  handle stays visible there: the collapse toggle is reachable by touch, so
  hiding the handle left a phone with no way to bring the list back short of
  `Cmd/Ctrl+B`. The phone context drawer ignores the folded state entirely
  (the user explicitly opened it).

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

## Workspace Xtream Sync Overlay

The import/refresh card pairs a near-opaque `--app-widget-bg` surface with
app-owned text colors in both themes. Blur belongs to the backdrop; card text
must not depend on an unprovided Material system surface token. Phase text uses
the primary foreground, and explanatory/progress copy uses a readable blend of
primary text and the widget surface instead of the decorative muted token.
Local and remote badges, and the outlined cancel button, resolve their text,
surfaces and interaction colors together. Electron provider E2E coverage holds
a cache read open and checks text contrast across live theme changes.

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

## Detail Actions And Episode Surfaces

Secondary detail buttons, episode cards and list rows, and the season view
toggle must keep visible edges in both themes before hover. Use app-owned
surface colors and neutral borders derived from `--app-on-surface`; fixed
white-alpha fills and borders disappear over the light detail background.
Grid cards keep the thumbnail and title on one continuous widget surface.
List rows use a subtle neutral fill, with the number on a slightly stronger
inset surface. The checked grid/list toggle uses `--app-selection-surface`
and `--app-selection-color`; hover uses the app's neutral surface treatment.
Keep these treatments in the shared season components and detail-action
partial so Xtream and Stalker share the same behavior.

Browser regression coverage measures the composited neutral edges and selected
toggle fill, in addition to capturing light/dark grid and list screenshots.
Hero action edges use matching pixels from rendered screenshots with the border
visible and transparent, retaining the artwork and gradient behind the button;
flat ancestor-color compositing is only appropriate outside that layered hero.

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

## Phone Layout

`640px` is the phone breakpoint. Use `@media (max-width: 640px)` rather than
inventing a nearby value: several surfaces cooperate at this width, and a
component that picks `599px` leaves a band where the shell has already stacked
but the component has not.

### Rails become rows, stacks, or drawers

- The workspace shell rail turns into a horizontal top bar. Everything inside
  it has to opt into the row direction — a nested list that keeps
  `flex-direction: column` stacks its links out of the bar and over the header.
  The bar scrolls sideways once a portal contributes its sections, and the
  settings link is `position: sticky` so it never scrolls out of reach.
- The shell context panel (categories, filters, settings sections) is an
  off-canvas drawer: hidden by default so the route content owns the full
  pane, opened from a toggle in the workspace header, closed by selection,
  backdrop tap, Escape, or any navigation. State lives in
  `WorkspaceShellContextDrawerService` (root-provided from
  `@iptvnator/workspace/shell/util` — see below for why); the
  panels call `close()` after selections that do not navigate — a
  NavigationEnd listener alone misses Stalker ITV/radio categories, settings
  sections, sources filters, and collection filters. The drawer positioning
  is `position: fixed` on the sidebar host, which also removes it from the
  shell grid, so the phone `workspace-body` stays single-pane. The drawer is
  modal for keyboard and screen-reader users: `CdkTrapFocus` captures and
  contains Tab focus while open, the shell marks the rail, header, content,
  and playback footer `inert` (a focus trap alone does not stop a screen
  reader's virtual cursor from activating obscured controls), the panel
  itself is the initial focus target (`tabindex="-1"` + `cdkFocusInitial`,
  so capture still works when a category list is loading or empty and
  renders no focusable rows), and the shell restores focus to the header
  toggle on close — deferred one tick, because the toggle is inside the
  inert header and `focus()` on a still-inert element is silently ignored.
  The service closes the drawer when the viewport leaves the phone
  breakpoint so the trap and inert state can never hold the in-flow desktop
  layout. While open, the shell consumes Escape (downstream consumers —
  the inline player's close handler, the shared controls shortcuts — check
  `defaultPrevented`, so one keypress cannot close both the drawer and the
  obscured player) and suppresses workspace-level shortcuts (Ctrl/Cmd+F
  global search, Ctrl/Cmd+K command palette, Ctrl/Cmd+R global recent, the
  `?` shortcuts dialog — dialogs must not stack a second focus trap on the
  modal drawer, and navigation must not act behind it), and document-level
  shortcuts owned by routed content (shared controls, Embedded MPV legacy
  dock, radio audio player, the live layouts' Ctrl/Cmd+B sidebar toggle,
  the M3U player's digit-key channel switching and sidebar toggle) opt out
  on their own by checking for an `inert` ancestor, since `inert` does not
  silence document-level listeners. Any NEW document-level key listener on
  routed content must apply the same `closest('[inert]')` guard. The service is root-provided
  from `@iptvnator/workspace/shell/util` so consumers outside the shell's
  element injector (AppComponent's Ctrl/Cmd+R handler) can observe it
  without pulling the lazy shell chunk into the eager bundle. The shell
  also registers the open drawer with
  `EmbeddedMpvOverlayVisibilityService.acquireExternalModalSurface()`:
  the native-view video surface is composited outside DOM stacking and
  would paint straight over the drawer regardless of z-index. The drawer carries its own phone-only close
  button: touch screen-reader users have no hardware Escape and cannot
  reach the inert header toggle or the aria-hidden backdrop, so the
  trapped surface itself must offer dismissal even when its list is
  loading or empty.
  The toggle's label is variant-aware — categories, filters, or settings
  sections — because a fixed label would misdescribe two of the three.
- Other side rails stack above the content instead of beside it: the
  live-layout channel sidebar and the M3U channel drawer.

### Resizable rails need `!important`

`ResizableDirective` writes the persisted desktop width as an inline style, so
a phone rule must be `width: 100% !important` to win. Hide `.resize-handle` in
the same rule — dragging is meaningless at full width. Since there is no global
`border-box` reset, a full-width rail with its own padding also needs
`box-sizing: border-box` or it overflows the viewport.

### State the content's floor, not the list's ceiling

On routes that stack two lists above the player (live TV shows the categories
panel and the channel list), capping both lists still leaves the video a
sliver. Give the player container a `min-height` instead and let the lists
shrink into what is left.

### What to drop

Prefer removing a control over shrinking everything around it:

- Keyboard-only affordances — the `⌘K` badge, the shortcuts button.
- Counts and subtitles that a neighbouring control already states.

Never drop the only way back to a hidden surface. A collapse toggle that is
reachable by touch needs its restore affordance to be reachable too.

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
- introducing independent dark-only EPG surface palettes
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
