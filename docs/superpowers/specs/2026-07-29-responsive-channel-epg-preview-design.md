# Preserve EPG Preview in Narrow Channel Lists

## Context

Xtream and Stalker Live TV allow the Channels sidebar to be resized down to
`250px`. The list viewport then leaves roughly `228–234px` for each shared
`app-channel-list-item` after padding and the scrollbar.

The shared row currently hides the programme title, progress bar, no-program
placeholder, and programme-info action at a container width of `270px` or less.
The supported minimum sidebar width therefore removes the most useful browsing
context by design.

This is the first increment of issue #1118. It fixes the information hierarchy
inside the shared row without changing sidebar widths, persistence, panel
ownership, or playback layout.

## Product Decision

Keep the existing `250px` minimum sidebar width. A wider minimum would protect
the row by taking space away from the player or guide, which is the wrong
tradeoff for a three-region Live TV layout.

Instead, degrade the row in this order:

1. Reduce spacing and logo size.
2. Hide the programme end time.
3. Hide the decorative channel logo.
4. Hide the programme start time at the narrowest supported widths.

The channel name, current programme title, no-program placeholder, and progress
bar remain available at every supported width. Enabled favorite,
programme-info, remove, and drag actions also remain available; narrowing a
layout must not remove the only touch or keyboard path to an action.

## Responsive Contract

| Item container width | Required behavior                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Above `360px`        | Show the full row: logo, programme title, start/end times, progress, and enabled actions.                                                                                   |
| `360px` and below    | Tighten spacing and the logo while retaining all information.                                                                                                               |
| `310px` and below    | Hide the programme end time. Keep the start time and progress on one horizontal line.                                                                                       |
| `270px` and below    | Hide the channel logo and remove its inner gap. Keep channel name, programme title or placeholder, start time, progress, drag affordance, and all enabled trailing actions. |
| `220px` and below    | Hide the programme start time, leaving progress-only timing. Keep channel name, programme title or placeholder, drag affordance, and all enabled trailing actions.          |

EPG rows remain `68px` high at every breakpoint so their content and the virtual
scroll item size agree. The existing `52px` compact height remains limited to
rows where EPG is disabled. The skeleton row must follow the same geometry so
loading content does not jump between incompatible layouts.

## Shared-Consumer Scope

`app-channel-list-item` is shared by Xtream, Stalker, M3U, favorites, recent,
and global channel lists. The contract therefore applies consistently wherever
the host becomes narrow. This PR does not add provider-specific overrides.

Compact rows without EPG keep their existing behavior. Radio-only consumers
that do not expose EPG mark their rows compact; `isRadio` alone never changes
height inside a fixed-size mixed virtual list. The change does not add EPG data
where a consumer currently disables it.

## Alternatives Considered

### Increase the Live TV sidebar minimum

Rejected for this increment. It masks the row bug but reduces the remaining
player/guide area and does not help other narrow consumers of the shared row.

### Preserve every time label by increasing row height

Rejected. Start and end times are secondary to the programme identity and
progress signal. Stacking all metadata makes browsing materially less dense.

### Change the complete three-pane layout now

Deferred. Independent Groups/Channels collapse and content-aware external
player space require different state ownership and broader playback testing.
Bundling them with a shared-row CSS fix would make review and rollback harder.

## Accessibility and Interaction

No interaction or focus semantics change in this increment. Existing favorite,
programme-info, auxiliary, remove, and drag actions remain available at
supported widths. A context menu or full guide is not treated as an equivalent
replacement for an explicit row action.

Keyboard semantics for the clickable row and keyboard-accessible resizing are
separate follow-up work and must not be implied as fixed here.

## Testing

- Add a focused Electron E2E regression using the fictional Xtream EPG fixture.
  Set the shared row host to a deterministic `232px` (the typical item width
  inside the `250px` sidebar), then prove the programme title, no-program
  placeholder, start time, progress, and enabled favorite action remain visible
  while the end time and logo are hidden. Repeat at `200px` to prove the start
  time becomes hidden without removing the programme identity, progress, or
  action. This isolates the container-query contract from platform-specific
  scrollbar width and storage timing.
- Keep the existing component tests for content rendering and run the
  `components` test and lint targets.
- Run the focused Electron EPG E2E target.
- Use `agent-browser` over Electron CDP with the mock server to inspect the
  real persisted `250px` minimum-width sidebar in the running app, capture a
  screenshot, and check for clipping or overlap. Check at least one additional
  shared/provider surface when deterministic fixture data is available.
- Run the web build and release-note validation.

## Documentation and Release Notes

Update `docs/architecture/iptvnator-ui-guidelines.md` with the responsive
information-priority contract. Add a user-facing fix note under `.changes/`.

## Follow-up PRs

1. Separate the persisted and effective collapse state for Groups and Channels,
   with accessible restore controls and focus handling.
2. Make the right region content-aware: keep Guide when EPG exists, but remove
   the empty external-player region when it has no useful content and let
   Channels use a bounded wider layout.
3. Treat a first-class Guide/search entry as separate product discovery rather
   than silently expanding issue #1118.
