# Consistent Live Panel Toggles

## Context

IPTVnator's Live TV surfaces can contain three independently useful regions:
Groups or Categories, Channels, and Guide. Their current collapse controls do
not consistently describe or control those regions:

- Xtream and Stalker use one persisted `live-sidebar-state` value for both the
  Groups and Channels regions. The Channels-header action therefore hides two
  panels even though its location and label imply one.
- The workspace shell also consumes that state for the Groups region, so a
  single action crosses component and layout ownership boundaries.
- M3U keeps a separate local signal but writes the same storage key. Views can
  disagree in memory while overwriting one another's next-session preference.
- M3U Groups exposes the action from the selected Channels header, but the
  action hides Groups as well. Some loading, empty, and mobile states have no
  usable restore path.
- Favorites and Recent already use a stable collection-header action because
  their Channels panel has no separate Groups sibling.
- Guide uses a leading disclosure in its own toolbar, which matches the panel's
  structure. External-player layouts can still expose that action even when
  collapsing Guide is ineffective.
- Width-zero panels can leave focusable descendants in the tab order, and
  hidden-panel actions do not consistently transfer focus to their restore
  controls.

This is the second increment of issue #1118. It makes panel ownership explicit
without changing how the external-player region consumes space. Content-aware
right-region behavior remains a separate PR.

## Product Decision

Use a hybrid placement rule:

1. A panel owns its toggle by default.
2. In an expanded panel, the toggle sits in that panel's header or toolbar.
3. When a panel is collapsed, exactly one restore control remains at its former
   boundary.
4. Favorites and Recent deliberately keep their current collection-header
   Channels toggle because that header is the stable owner for the single list
   region. Do not add a duplicate control inside the list.
5. Guide keeps its current leading disclosure because it is a vertical
   expand/collapse affordance rather than another left-sidebar action.

This preserves spatial predictability without forcing unlike views into a
global toolbar. A user should be able to infer what will disappear from the
control's location, icon, accessible name, and tooltip.

## Panel Model

Treat Groups, Channels, and Guide as separate persisted user intents:

| Intent   | New storage key                 | Default    |
| -------- | ------------------------------- | ---------- |
| Groups   | `live-groups-panel-state`       | `expanded` |
| Channels | `live-channels-panel-state`     | `expanded` |
| Guide    | Existing `live-epg-panel-state` | `expanded` |

A root-provided `LiveLayoutPanelStateService` in
`@iptvnator/portal/shared/data-access` owns the two left-panel signals, their
persistence, and temporary master suppression. This placement follows the
current Nx rule that stateful cross-provider orchestration belongs in
data-access rather than the legacy shared util library. M3U, the workspace
shell, Xtream, Stalker, Favorites, and Recent consume the same service instead
of maintaining local copies. The legacy storage parser remains a pure,
read-only compatibility helper in `@iptvnator/portal/shared/util`. Guide may
continue using its existing state helper in this increment; its
control-availability rules must still be consistent across consumers.

The service distinguishes:

- **Intent state:** the user's persisted choice for a panel.
- **Effective state:** whether the persisted intent is expanded and neither
  master nor responsive suppression applies for a panel that is structurally
  present on the current route.

Consumers own route/content applicability and their local responsive
breakpoint. They pass that context to the service's effective-state resolver;
the root service does not register route components or keep route-specific
availability. This prevents a stale or concurrently mounted consumer from
changing another surface's state.

Route absence, responsive auto-collapse, radio mode, and player capability must
never overwrite intent. Returning to a compatible layout restores the user's
choice.

### Legacy migration

On the first read of the new left-panel keys:

1. If a new key is valid, keep it.
2. Otherwise, if legacy `live-sidebar-state` is valid, seed the missing Groups
   and Channels intents from it.
3. Otherwise, use `expanded`.
4. Persist both resolved new values so migration is idempotent.
5. Keep the legacy key read-only for compatibility during this PR. New actions
   never write it.

This preserves an existing user's compact or expanded layout while making
future changes independent.

## Placement and Coverage

Expanded left-panel toggles use the same compact icon-button treatment and are
the final trailing action in their header:

- **Groups/Categories:** after search, sort, or manage actions.
- **Channels:** after sort, refresh, or other channel-list actions.
- **Guide:** keep the leading disclosure in the Guide toolbar.

The following matrix defines which controls exist, including loading, empty,
and zero-search-result states:

| Surface                                          |    Groups     |   Channels    | Guide |
| ------------------------------------------------ | :-----------: | :-----------: | :---: |
| Portal root / All Items                          |      Yes      |      No       |  No   |
| Xtream or Stalker Live category                  |      Yes      |      Yes      | Yes¹  |
| M3U All Channels                                 |      No       |      Yes      | Yes¹  |
| M3U Groups                                       |      Yes      |      Yes      | Yes¹  |
| Unified Favorites or Recent, Live tab            |      No       |     Yes²      | Yes¹  |
| Movie, series, search result, or detail surfaces |      No       |      No       |  No   |
| Radio playback                                   | As applicable | As applicable |  No   |

¹ Show Guide disclosure only when Guide is present and the current playback
host can actually collapse it. An external MPV/VLC host must not expose a
no-op disclosure.

² Keep the existing collection-header action as the sole Channels toggle.
Playlist-scoped and global Favorites/Recent all use this unified collection
surface; legacy M3U `favorites`/`recent` view values do not define a second
placement.

“Portal root / All Items” means the root catalog grid before a category is
selected. It has the workspace Groups/Categories rail but no independent
Channels rail, even though selecting an item can enter the categorized live
layout.

Loading, empty, and zero-search-result states retain the controls for any
Groups or Channels panel structurally present in that surface. Guide is the
exception: no Guide control is rendered until the Guide region itself exists
for a selected playable item.

Collapsed restore controls occupy a compact boundary rail instead of floating
over player or list content. When both Groups and Channels are collapsed,
boundary controls appear in stable left-to-right order: Groups, then Channels.
A collapsed panel retains no second hidden or duplicate action.

## Control Semantics

Each panel has a distinct visual and accessible identity:

- Groups: category/group-list icon; “Hide groups” / “Show groups”.
- Channels: channel/list icon; “Hide channels” / “Show channels”.
- Guide: existing vertical disclosure; “Collapse guide” / “Expand guide”.

Expanded and restore controls:

- reference the owned panel with `aria-controls`;
- report the effective visibility with `aria-expanded`;
- have a translated, action-oriented accessible name and tooltip;
- expose at least a `40px` interactive target;
- retain a stable test identifier based on the panel, not the provider;
- do not use `aria-pressed`, because these are disclosure actions rather than
  toggle buttons representing an on/off setting.

When an action hides the panel containing keyboard focus, focus moves to that
panel's restore control after the layout settles. Restoring moves focus to the
expanded panel's header toggle. Hidden panels are removed from interaction
with `inert` and `aria-hidden="true"` while their collapsed DOM is retained.

The resize handle is not a replacement for a disclosure action and is not
changed in this PR.

## Keyboard and Responsive Behavior

`Cmd/Ctrl+B` remains a master left-panel visibility command on Live surfaces.
It changes effective visibility without destroying the independent Groups and
Channels intents:

- If any applicable left panel is effectively visible, the command
  temporarily suppresses all applicable left panels.
- Invoking it again restores each panel to its previously persisted intent.
- A panel-local action while master suppression is active first exits
  suppression, then applies the requested panel intent.
- Views with only Channels apply the command to Channels. Views with only
  Groups apply it to Groups.

Guide receives no new shortcut in this increment.

On workspace portal layouts at `1023px` and below, automatic pressure relief
suppresses Groups before Channels, matching issue #1118. On the M3U Groups
mobile layout below `600px`, the nested Groups rail is likewise
suppressed before Channels. Responsive suppression is effective-only and does
not persist. A responsive-suppressed Groups panel does not offer an
unfulfillable restore control until the viewport is wide enough; once the
breakpoint clears, its persisted intent becomes effective again or its restore
control returns. An explicitly collapsed Channels panel always retains a
pointer and keyboard restore path, including M3U mobile.

## Visual Behavior

The controls should read as structural chrome rather than primary actions:

- use the existing panel-header neutral icon-button style;
- keep spacing aligned with neighboring header actions;
- avoid a new global toolbar, floating pill, or persistent overlay;
- avoid edge chevrons as the sole expanded-state action;
- reserve layout space only for restore controls that are currently needed.

Collapsing one left panel must allow its adjacent content to reclaim the freed
width. Collapsing Groups must not implicitly collapse Channels, and collapsing
Channels must not change Groups. This PR does not redistribute the right-side
external-player region.

## Implementation Boundaries

The implementation should:

1. Replace `LiveLayoutSidebarStateService` with the explicit left-panel state
   service and migration in `@iptvnator/portal/shared/data-access`.
2. Move M3U from its local same-key signal to that shared service.
3. Add the missing Groups-header control in the workspace shell and the
   independent Channels controls in applicable live layouts.
4. Preserve the collection-header exception for Favorites and Recent.
5. Normalize collapsed restore controls, focus transfer, `inert`, and
   accessible disclosure semantics.
6. Give the shared EPG timeline/list an explicit `collapsible` contract and
   hide Guide disclosure when the current player host cannot collapse Guide.
7. Keep controls present through loading, empty, and search-zero states.

The implementation must not:

- change the channel-row responsive EPG behavior from PR1;
- make the external-player right region content-aware;
- add Guide/search discovery or a global Guide route;
- redesign movie, series, or detail layouts;
- make resize separators keyboard-operable as part of this scope.

## Testing

### Unit and component coverage

- Test valid, invalid, partial, and idempotent legacy-state migration.
- Test independent Groups and Channels persistence and master suppression.
- Test each applicable surface's expanded control, collapsed restore control,
  stable accessible name, `aria-controls`, and `aria-expanded`.
- Test focus transfer in both directions and ensure collapsed descendants
  cannot remain keyboard-focusable.
- Test loading, empty, and search-zero states.
- Test that M3U shares the service and keeps a mobile restore path.
- Test that external MPV/VLC and radio layouts do not expose a no-op Guide
  disclosure.
- Test that Favorites and Recent render exactly one Channels control in their
  collection header.

### Electron E2E and manual verification

Add an atomized Electron flow for panel toggles using mock M3U, Xtream, and
Stalker data. Verify independent hide/restore behavior, persistence across
navigation, the legacy migration fixture, `Cmd/Ctrl+B`, keyboard focus, and the
view matrix above.

Use `agent-browser` over Electron CDP to inspect representative desktop and
narrow/mobile layouts. Verify:

- header alignment and target size;
- no duplicate or missing controls;
- reclaimed content width after each independent collapse;
- Groups-then-Channels restore ordering;
- no clipping, overlap, dead space introduced on the left, or invisible tab
  stops;
- no Guide disclosure for external-player and radio modes.

Run affected unit, lint, build, Electron E2E, and release-note validation
targets before completion.

## Documentation and Release Notes

Update the canonical UI guideline with the panel ownership, placement, and
responsive rules. Update any architecture documentation that still describes
one shared sidebar state. Add one user-facing release note covering independent
and consistent Live panel controls.

## Follow-up

The next PR should make the right region content-aware. With an external
player:

- keep Guide when useful EPG content exists;
- remove the empty player/Guide region when no useful content exists;
- let Channels reclaim a bounded amount of the freed width rather than
  stretching unbounded across the window.

That decision requires its own layout prototypes and playback-mode matrix; it
is intentionally not hidden inside this state and accessibility refactor.
