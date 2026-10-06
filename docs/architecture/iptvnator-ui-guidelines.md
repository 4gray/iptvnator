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
app-owned tokens above.

Both themes are built with the legacy `mat.define-theme` config, whose
component mixins never declare the `--mat-sys-*` system variables. The theme
therefore adds the `mat.system-level-*` mixins for the light (`html`) and dark
(`.dark-theme`) contexts, and `apps/electron-backend-e2e/src/theme-tokens.e2e.ts`
asserts they resolve in both. Use a `--mat-sys-*` token for Material-derived
roles that have no app token (error, outline, surface containers); keep app
chrome on `--app-*`.

Set Material component tokens through the component's `mat.*-overrides()`
mixin: it rejects unknown names at build time, where a hand-written `--mat-*`
declaration with a typo fails silently. Material 22 reads only `--mat-*`
tokens, so the retired `--mdc-*` names compile but do nothing;
`pnpm run styles:material-tokens:validate` (CI) rejects them. A stylesheet that
a spec loads as raw CSS cannot use Sass modules; it declares the `--mat-*`
token directly and says why.

Existing hard-coded layout and selection colors are migration debt, not
patterns to copy.

Do not hardcode unrelated accent colors for selected state when these tokens already exist.

## Player And EPG Theme Boundaries

The native-view Embedded MPV dock is app chrome: its solid widget background,
text, separators, sliders and interaction states resolve app tokens together.
Material icon buttons override their component tokens, including disabled
icons. The dock must never pair a dark fallback surface with inherited light
app text. Loader/stall and transient feedback overlays own a light foreground
and dark scrim because they cover video. Video viewports remain black in both
themes and fullscreen; frame-copy and built-in shared controls keep their
light-on-dark overlay palette — the fixed `--pc-*` token set of the shared
dock (accent blue, cyan, violet, the `--pc-live` / `--pc-danger` reds and a
light text ramp), never the app theme. The overlay styles in
`player-controls/` never read a `--mat-sys-*` token, and their keyboard focus
is a 2px `--pc-text` outline rather than Material's theme-coloured focus layer
(`player-controls-keyboard.e2e.ts` checks it in both themes).

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

VOD and series detail screens share `app-portal-detail-shell` and
`app-content-hero` (`libs/ui/components`). The hero orders its column as
kind label ("Movie · playlist") → title → chips → description (three lines,
"More") → resume bar → action row → credits, with the poster bottom-aligned
on the left and the backdrop filling the hero behind a two-layer scrim built
from `--app-content-bg`. The hero keeps `min(480px, 60vh)` of stage for a
16:9 backdrop. Without one, or when the provider sends the poster as the
backdrop, the hero is compact (`hero--compact`, sized by its content) over
the blurred poster. The layout is decided once per title, so a backdrop that
TMDB enrichment adds a moment later fills the compact hero instead of
growing it. The pane is a size container (`detail`); the poster hides below
760px of pane width.

The pieces are shared and provider-neutral (`libs/ui/components/src/lib/detail-ui/`):
`app-meta-chip` (pill; `rating` and `status` variants; facets as projected
`.meta-chip__facet` buttons), `app-detail-action-button` (the light primary
with a two-line label, or the ghost `secondary` text button),
`app-detail-icon-button` (44px ghost with tooltip and `aria-label`),
`app-vod-more-menu` (the "…" dropdown: right-aligned, flips upward, arrow
keys, Escape, hosts the alternative-sources panel), `app-detail-credits`
("Starring" + three names + "and more", "Director"), `app-cast-crew-row`,
`app-detail-rail`/`app-similar-rail` (hidden scrollbar, prev/next arrows,
title + year) and `TrailerDialogService`. The dashboard hero reuses the same
light primary (`light-primary-button` in `libs/ui/styles/_detail-view-actions.scss`)
and chip. Series titles drop their season marker (`splitSeasonSuffix`) into a
"Season N" chip. Rows a provider cannot serve are left out of the menu, never
disabled. The page-level Sass mixin (`libs/ui/styles/_detail-view.scss`)
only carries the page shell, meta items and the episodes section.

With `detailTrailerBackdrop` on (Settings → Playback → "Play trailers in
details background", default off) the hosts hand the trailer embed URL to the
shell and `app-hero-trailer-backdrop` plays it muted and looping under the
scrim after three idle seconds, with a 32px mute toggle in the corner. It
never starts under `prefers-reduced-motion` or with `saveData`, and stops
while the hero is off screen or the window is unfocused.

## Back Navigation

Page-level Back lives only in the workspace header's leading slot (see
[Header Back](./workspace-shell.md#header-back)). A routed page, or the shell
it renders in, registers it with `registerWorkspaceBack()` instead of drawing
an arrow, so Back keeps one position and one look on every page and never
floats over a scroll owner. A page whose Back is history Back calls
`WorkspaceBackNavigationService.back()` with its parent route rather than
`Location.back()`, so Back still leads somewhere when the page opened the
session. Without a registration the header falls back to
browser history while an in-app previous page exists, and shows nothing
otherwise. An arrow that returns within a menu, dialog or player panel is not
page navigation and stays in that surface; an error state may repeat the
header's Back as a labelled recovery button beside its other actions.

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
the normal DOM order; Safari's default keyboard preference skips buttons on
plain Tab, so there the row button is reached with Option+Tab (WebKit E2E
runs press it through `pressTab` in `apps/web-e2e/src/e2e-helpers.ts`).
Scrolling from a virtual row moves focus to its viewport
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

## Cover Grids

Movie and series covers render in three surfaces: the catalog grid
(`app-grid-list`, `libs/portal/shared/ui/.../grid-list/`), the favorites /
recent card (`app-content-card`, same lib) and the dashboard rails. All of
them size from the `--cover-grid-min-width` / `--cover-rail-width` /
`--cover-gap` tokens that `Settings.coverSize` writes onto `<html>` as
`data-cover-size` (`apps/web/src/_cover-size.scss`). The same file carries
`--season-cover-width` (96 / 120 / 144px) for the season cover beside the
season tabs on series detail pages; medium equals the About block's 120px
poster so browse and watch share one secondary-poster size.

### Posters-only wall

`Settings.showCoverTitles` (Settings > General, default on, only an explicit
`false` opts out — coerced like `webPlayerSharedControls`) removes the title
row under VOD and series covers so the grid shows more rows per screen.

- **Resolution.** `CoverTitlesService.postersOnly` (`libs/portal/shared/ui`)
  is the single source: the opt-out AND a hover-capable pointer
  (`(any-hover: hover)` media query, tracked live). On touch-only devices the
  preference is ignored and titles stay under the covers, because a tap
  already opens the item and there is no gesture left to peek at a hidden
  name.
- **Scope.** Catalog grids (Xtream/Stalker VOD and series), unified
  favorites/recent grids and the portal favorites tab. Exempt, regardless of
  the setting: live channel grids (`type` `live`/`itv`/`radio` or the
  `logo` variant — logos are too often missing to identify a channel),
  search results and "recently added" rails (they answer by name; hosts
  pass `[allowPostersOnly]="false"` to `app-content-card`; `app-grid-list`
  and `app-unified-grid-tab` drop the wall themselves while their
  `searchTerm` input is non-blank, i.e. an in-section search is filtering
  the list), and
  the dashboard rails (their meta rows do not fit an overlay).
- **Reveal.** The title is a `.cover-title-overlay` inside the poster
  wrapper: bottom gradient scrim, two clamped lines, 150 ms ease-out
  opacity, shown on `:hover` and `:focus-visible` of the card, none under
  `prefers-reduced-motion`. It is `aria-hidden`; the card itself carries the
  accessible name.
- **Pinned caption.** When the item has no cover to identify it — no
  poster URL, or the image failed and the default poster / placeholder is
  showing — the overlay is pinned open (`--pinned`). Both components track
  failed URLs so the fallback branch re-renders instead of swapping `src`
  in place.
- **Layout hints.** The grid's `contain-intrinsic-size` drops from 270 px to
  222 px (bare 2/3 poster) under `.grid-list--posters-only`, and the skeleton
  hides its text lines so loading matches the cards it precedes.
- **Keyboard.** Both cards expose a `role="button"`, `tabindex="0"` surface
  labelled by the title, activated by Enter and Space (Space prevents the
  page scroll) and carrying a `:focus-visible` ring (`card-focus-ring`
  mixin in `libs/ui/styles/_content-grid.scss`). On `app-content-card` that
  surface is the inner `.content-card__activation` element, and the Remove
  control (labelled by `removeTooltip`) is a SIBLING positioned over the
  poster corner — an interactive control nested inside a `role="button"`
  is an invalid accessibility structure. Its ring is drawn on the OUTER
  `.content-card` via `:has(> .content-card__activation:focus-visible)`,
  because the card's `overflow: hidden` would clip an outline on the inner
  surface on every edge. Poster `alt` is the title, not a literal.

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
      "Show categories panel" → level 1, through the shell's
      `LiveCategoriesPopover.showCategoriesPanel()`: it sets
      `showCategories('portal')` and, at phone widths where the rail is the
      off-canvas context drawer whose open state the level does not drive,
      also opens that drawer (`WorkspaceShellContextDrawerService.open()`).
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

### Watch progress colour

A title's watch progress (its resume share, `progressPercent`) has exactly one
colour per context, and never a literal of its own:

- **App chrome** — dashboard rail cards and the hero, catalog grids and season
  episodes (`app-progress-capsule`, and the season list rows' own fill):
  `--app-progress-color`, declared per theme in `apps/web/src/m3-theme.scss`
  as that theme's `--app-selection-color`, and declared again inside
  `.dark-theme` because a derived custom property resolves where it is
  declared. The capsule's green from 90 % marks a finished title; it is a
  status, not progress.
- **Over video** — the dock timeline, the Up next card, the Up Next rail and
  the fullscreen episode panel: the player's fixed `--pc-progress` (accent
  blue `#4f8eff`), never an app token, because the player palette is
  theme-independent (see Player And EPG Theme Boundaries). An episode
  therefore reads the same in every player surface. The rail and the episode
  panel render beside the controls host, outside its `--pc-*` scope, so they
  declare the token on their own `:host` with the `progress-token` mixin of
  `libs/ui/playback/src/lib/player-controls/_player-palette.scss`.
- ArtPlayer's legacy skin takes a colour string, not a custom property, so it
  gets `PLAYER_PROGRESS_COLOR` (`player-palette.ts`), which a spec pins to the
  Sass value.
- Live programme progress next to a LIVE marker (the dashboard's live rail and
  live hero slides) keeps `--app-live-color`; EPG programme progress keeps the
  fill described below.

Specs hold the rule in each owning project: `m3-theme.spec.ts` (web: the token
in both theme contexts), `player-progress.palette.spec.ts` (ui-playback),
`progress-capsule.component.spec.ts` and
`season-container.progress-colour.spec.ts` (components) and
`dashboard-progress-colour.spec.ts` (workspace-dashboard-feature).

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

## Loading States

Two loading states exist, chosen by whether content is already on screen.

### First load: skeleton

Nothing is rendered yet, so the skeleton replaces the whole content area and
mirrors the row/card geometry it precedes (see Channel List Item and Cover
Grids). The unified Favorites/Recent page gates this on `isLoading`, set only
while its item list is empty.

### Pages of independently loading blocks: delayed skeletons

The dashboard renders each rail as soon as its own data arrives, and several
rails resolve empty on a normal profile. A per-rail skeleton shown
immediately therefore flashed for a few tens of milliseconds and collapsed,
pulling every rail below it upwards (a layout shift of about 0.23 on each
launch with sources). Rail skeletons are gated per rail
(`createRailSkeletonGates` in
`libs/workspace/dashboard/feature/src/lib/rails/dashboard-skeleton-grace.ts`):

- a skeleton waits out a grace period (`DASHBOARD_RAIL_SKELETON_GRACE_MS`,
  300 ms) counted from when *that* rail started loading, since Xtream and
  TMDB rails start after the local ones;
- it never appears above a rail that already shows cards: the placeholder
  would push visible content down, and back up if the rail resolves empty,
  while the real rail inserts at most once;
- once shown, it stays until its own rail finishes, so skeletons do not
  vanish in a cascade when the first real rail arrives.

The top block (the dashboard hero) keeps its immediate skeleton: it reserves
the space above everything else, where a late insertion would push the whole
page down. For the same reason it stays until every source that can fill it
has loaded, not only the first one. Use the same rules for any page that
stacks independently loading blocks.

### Reload with content on screen: non-destructive indicator

A reload of a list that is already rendered (the collection page's
"This playlist ↔ All playlists" scope switch, a favorites reload) must never
swap back to the skeleton: that unmounts a playing channel, drops focus from
the toggle the user just clicked, and flashes on fast IndexedDB/SQLite answers.
Instead keep everything mounted and layer feedback on top:

- an indeterminate `mat-progress-bar` (2 px track, `--app-selection-color`
  fill) absolutely positioned over the header's bottom separator, so its
  appearance never shifts content;
- `aria-busy="true"` on the content region for the whole reload;
- the list or grid dims to opacity `0.6` with a 160 ms transition (`0ms` under
  `prefers-reduced-motion: reduce`). The player is never dimmed — the live tab
  dims only its channel rail.

**Grace period.** The bar and dimming render only once the reload has run for
`COLLECTION_RELOAD_INDICATOR_DELAY_MS` (180 ms); a reload that settles sooner
shows nothing. `aria-busy` is set immediately, since it does not paint. A
superseded reload keeps the earliest deadline and never clears the indicator;
only the latest request's completion does. Reference implementation:
`createCollectionReloadIndicator` in
`libs/portal/shared/data-access/src/lib/collection/collection-reload-indicator.ts`.
Controls that triggered the reload stay enabled and reflect the requested
value at once (`scope.set()` runs synchronously before the load starts).
Because the rows on screen then belong to the PREVIOUS request, actions on
them (Clear, drag reorder) must bind to the request that loaded those rows,
never to the toggle's current value — "This playlist" applied to still-mounted
global rows would delete other playlists' favorites or write foreign URLs
into this playlist (`loadedRequest` on `UnifiedCollectionDataService`, which
the collection page reads through its own `mutationRequest`).

## Navigation Lists

Use the shared `nav-list.scss` treatment for sidebar and context-panel list items.

### Rules

- Keep labels one line with ellipsis
- Keep icon area clear from the selection border and any decorative rail
- Hover is neutral surface, not the selected color
- Selected state uses the shared selection recipe

If the label is too long for the rail, shorten the label key instead of shrinking the component until it becomes inconsistent.

## Detail Actions And Episode Surfaces

The action row never wraps on a desktop window: the primary, the Trailer
button, then the 44px icon buttons and the "…" menu. Season and series
actions (mark watched, download season, reset progress) live in that menu
and drive the season container's presenters; the container's header is
"Episodes" with the season pills and the episode count, plus the grid/list
toggle. The checked toggle uses `--app-selection-surface` and
`--app-selection-color`; hover uses the app's neutral surface treatment.

Episode cards are flat: a 16:9 thumbnail (with a light hairline so its edge
survives the light theme) and a 3px watched bar at its bottom edge, "N. Title", the plot clamped to two lines and a "42 min ·
18m left / watched" line. List rows keep a subtle neutral fill. The selected
season's cover and synopsis sit in a compact strip under the header only
when present. Keep these treatments in the shared season components so
Xtream and Stalker share the same behavior.

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

## Dialogs

- **Name.** Every dialog has a `mat-dialog-title`; Material points the
  container's `aria-labelledby` at it. A custom-styled title keeps the
  directive and overrides Material's headline padding and 40px `::before`
  strut, as the programme dialog does.
- **Order.** Dismiss first, primary last. With end alignment the primary sits
  on the inline end: the right in LTR, the left in RTL.
- **One dismiss.** Offer one visible dismiss: a footer "Cancel"/"Close" or a
  header close icon, not both. Escape and the backdrop still close.
- **One row.** Action labels are short verbs ("Cancel", "Discard", "Save"),
  not phrases, so the row fits one line in every locale at the dialog width.
  Secondary actions tied to one part of the content stay with that content
  (the programme dialog's archive tools sit under their notice), so the
  footer is only the dismiss and the primary.
- **Phone.** At the phone breakpoint an action row may stack: one full-width
  button per row, in DOM order (dismiss on top, primary at the bottom). The
  settings unsaved-changes dialog is the reference;
  `settings-unsaved-dialog-layout.e2e.ts` in `web-e2e` measures it in six
  locales. The programme dialog stacks its archive tools and footer the same
  way, letting a long label wrap inside its button; the Electron
  `epg-timeline-interaction.e2e.ts` measures it in French at 360px.
- **Width.** A dialog with several openers is opened through one helper that
  owns its `MatDialogConfig`, so its width never depends on the entry point.
  `EpgProgrammeDialogService` opens the programme dialog at 540px from the
  timeline, list, guide and channel rows, with a panel class that scopes its
  surface overrides.
- **Destructive actions.** Material only emits `warn` button colors for M2
  themes, so the `color` input is a no-op here. A button that removes or
  discards user data uses the global `.app-destructive-button` class from
  `m3-theme.scss` (error/on-error tokens per theme, for filled, text,
  outlined and icon buttons), as the unsaved-changes dialog's Discard does.
  Confirmations go through `DialogService.openConfirmDialog` with a
  translated verb as the required `confirmLabel` ("Remove playlist",
  "Clear") and `tone: 'destructive'` when the action loses data; the dismiss
  defaults to "Cancel". Never confirm with "Yes"/"No". When the verb itself
  is "Cancel …", pass `cancelLabel` "Close" so the two buttons do not read
  alike. `theme-tokens.e2e.ts` checks the label and the error fill in both
  themes.

## Forms

The add-source forms (M3U URL, Xtream, Stalker) and the edit dialog share one
vocabulary, so a field reads the same wherever it appears:

- **Name.** The source name is labelled "Playlist title"
  (`HOME.XTREAM_PLAYLIST.TITLE`) in every add form. Every add form submits
  with "Add playlist" (`HOME.URL_UPLOAD.ADD_PLAYLIST`).
- **Passwords.** A password input is masked and has a `mat-icon-button`
  suffix with `PasswordVisibilityToggleDirective`
  (`@iptvnator/ui/components/password-visibility-toggle`). The input binds
  `[type]="toggle.inputType()"`; the button keeps one translated label
  ("Show password", `HOME.SHOW_PASSWORD`) and exposes its state through
  `aria-pressed`, as an ARIA toggle button does.
- **URLs.** A URL field has a neutral `mat-hint` where the format is not
  obvious, and its own `mat-error`. Never borrow another field's message.
- **Feedback.** While the dialog stays open, a check or refusal is shown
  inline under the URL field in a `role="status"` paragraph. The message is
  translated in the template and cleared by any edit. Use a snackbar only for
  outcomes that close the dialog. `add-source-forms.e2e.ts` in `web-e2e`
  covers the shared labels, the toggle and the URL errors.

## Source Type Icons

`SOURCE_TYPE_ICONS` in `@iptvnator/shared/interfaces` is the only source of
provider icons: Xtream `cloud`, Stalker `cast`, the M3U family
`playlist_play`, and per playlist `link` (URL), `description` (local file or
text) and `subject` (pasted text in the add flow). Use
`getPlaylistSourceIcon()` for a stored playlist. An icon never stands for two
providers, and the Dashboard rail icon is never a provider icon.

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
reachable by touch needs its restore affordance to be reachable too. For the
same reason the header's history Back yields to the context drawer toggle,
and Settings keeps the toggle beside its Back; only a detail page's Back,
whose list shows the toggle again, takes the toggle's slot.

## Typography

The app stack is DM Sans with Roboto behind it (`$app-font-stack` in
`apps/web/src/m3-theme.scss`). DM Sans covers Latin only, so Cyrillic and Greek
UI text (ru, by, el) renders in Roboto. `apps/web/src/styles.scss` bundles both
families in 400, 500, 600 and 700, and JetBrains Mono in 400 and 500 (its
heavier faces would exceed the initial-bytes ratchet).

- Use only those four weights: in `font-weight`, in the `font` shorthand, and in
  any custom property, Sass variable or token map that feeds one. A weight
  between faces snaps to a neighbour (650 renders as 700), and 600 or more with
  no face of at least 600 gets Chromium's synthetic bold. CI runs
  `pnpm run styles:font-weights:validate`, which rejects any other value.
- JetBrains Mono text stays at 500 or lighter, also where it is a fallback
  behind `ui-monospace` (only macOS resolves that). The check enforces this in
  any rule that sets the family, directly or through a variable, or inherits
  it from an enclosing rule. A mixin's family and weights count where it is
  included, from its own stylesheet module or another one. It cannot see what
  a mono modifier class inherits from its base rule; set `font-weight: 500`
  there.
- Import whole `@fontsource/<family>/<weight>.css` files. The single-script
  files such as `cyrillic-600.css` have no `unicode-range`, so a Cyrillic-only
  face wins the weight match for Latin text in `Roboto, …` stacks and sends it
  to the next family.
- `<html lang>` follows the UI language (`syncDocumentLanguage()` maps `by` to
  `be` and `zhtw` to `zh-TW`), so `hyphens`, `text-transform` (Turkish İ) and
  Han glyph fallback use the right locale.

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

### Network source indicators (Electron)

The switcher and source rows use `SourceHealthIndicatorComponent`: green means
available, orange expired, red disabled/access refused, and neutral means
checking or unverified. Accessible tooltip text distinguishes refusal from a
confirmed disabled account and includes the check time. M3U indicators describe
the source URL only. Check again is a separate action, not a playlist refresh.

### Inactive-source cleanup dialog

Electron Sources offers a library-wide cleanup action even when page filters
hide all rows. The confirmation dialog groups confirmed inactive accounts,
uncertain candidates, skipped sources and deletion outcomes. It preserves
checkbox choices on recheck, labels destructive consequences, and announces
progress. During deletion Escape/backdrop closing is disabled; Stop after
current source finishes the current operation. Healthy sources appear only in
the summary. Source titles wrap; credential-bearing URLs are not displayed.
