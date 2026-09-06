# Programme Guide (Multi-EPG) Redesign — M3U Host

Sub-project 1 of the guide rework tracked by issue #171. It rebuilds the
multi-channel EPG grid as a host-agnostic component, fills it with the
playlist's own channels, makes channel rows switch playback, and restyles it in
the visual language of the EPG timeline under the player. Sub-project 2 (Xtream
and Stalker hosts) is out of scope here but shapes the data contract; see
"Deferred to sub-project 2".

Decisions were taken against a visual companion:
https://claude.ai/code/artifact/0cac36f6-9027-46a7-bd0c-b264416e6acf
(Q1 layout → B "player docked on top", Q2 grid styling → as drawn, Q3 density
→ comfortable by default with a toggle).

## Goal

- The guide shows the channels of the current playlist scope (all channels, a
  group, or favorites) in playlist order, never the whole XMLTV channel table.
- Clicking a channel row switches live playback without closing the guide;
  double-click or Enter switches and closes. The player stays visible while
  the guide is open.
- The grid reuses the timeline's tokens, typography, now-line, card tiers and
  behaviour so both guides read as one product.
- Rows for channels without EPG data stay in place (numbers match the sidebar)
  and can be hidden with an "Only with EPG" toggle.
- The old SVG overlay, its IPC and its capability are removed, not kept beside
  the new implementation.

## Current Problem

`MultiEpgContainerComponent` (`libs/ui/epg/src/lib/multi-epg/`) is a
full-window CDK overlay opened from `VideoPlayerComponent.openMultiEpgView()`.
It receives `playlistChannels` but only uses the emission as a reload trigger:
its data comes from `EPG_GET_CHANNELS_BY_RANGE`, which pages through the
entire `epg_channels` table alphabetically and issues one programme query per
channel. A large XMLTV therefore fills the grid with hundreds of channels the
playlist does not carry. Channel rows are not clickable, only programmes are,
and the SVG + `foreignObject` layout cannot virtualise rows. The overlay
covers the player, so a native-view Embedded MPV surface, which paints above
the DOM, would hide the grid, and channel switching from an overlay is blind
anyway.

## Considered Approaches

### 1. Host-owned layout mode + injected data source (selected)

The guide becomes `app-epg-guide` in `libs/ui/epg`, ignorant of playlists and
portals. A host provides `EPG_GUIDE_SOURCE`. The M3U host keeps a `guideOpen`
signal; while it is on, the template drops the sidebar and the timeline,
renders the guide, and CSS reflows the player container into a docked strip
on top. The player component keeps its DOM position, so nothing remounts and
native-view Embedded MPV syncs bounds like on any resize. This is the same
pattern as the fullscreen channel panel: the host owns layout, the shared
component owns content.

### 2. Keep the CDK overlay and cut a "hole" for the player

Two independent layers would have to agree pixel-for-pixel on resize and
zoom, the overlay lives in another stacking context (window controls,
dialogs), and the scope switcher in the guide toolbar would have to reach
sidebar state through the overlay. Rejected as fragile.

### 3. Child route `/workspace/playlists/:id/guide`

The M3U child routes only drive the sidebar view; the guide needs the whole
width, so the parent template would still switch layout on route state. That
is approach 1 plus routing, and the only gain is a URL nobody asked for.

## Data Contract: `EPG_GUIDE_SOURCE`

Defined in `libs/ui/epg/src/lib/epg-guide/epg-guide-source.ts` (types and the
injection token only, no Angular services).

```ts
interface EpgGuideChannel {
    id: string;          // host-stable id (M3U: channel.id)
    number: number;      // 1-based position within the current scope
    name: string;
    logoUrl: string | null;
    epgKey: string | null; // programme lookup key; null = host knows there is no binding
}

interface EpgGuideScope {
    id: string;
    label: string;
    kind: 'all' | 'group' | 'favorites';
}

interface EpgGuideWindow {
    channels: EpgGuideChannel[];
    fromMs: number; // provider-clock instants (display offset already removed)
    toMs: number;
}

interface EpgGuideSource {
    readonly channels: Signal<EpgGuideChannel[]>; // scope-resolved, playlist order, radio/movies excluded by host
    readonly scopes: Signal<EpgGuideScope[]>;
    readonly scopeId: Signal<string>;
    setScope(id: string): void;
    loadPrograms(window: EpgGuideWindow): Promise<Map<string, EpgProgram[]>>; // keyed by channel.id
    loadCoverage(window: EpgGuideWindow): Promise<Set<string>>;              // channel.ids with ≥1 programme
    readonly activeChannelId: Signal<string | null>;
    activate(channelId: string): void; // switch playback; the guide stays open
    searchPrograms?(query: string): Promise<EpgProgram[]>; // toolbar search hidden when absent
    catchUp?: {
        canWatch(channel: EpgGuideChannel, program: EpgProgram): boolean;
        watch(channel: EpgGuideChannel, program: EpgProgram): void;
    };
}
```

Rules:

- Programmes are the shared `EpgProgram` (XMLTV shape). Portal adapters convert
  `EpgItem` with the existing `toEpgProgram` from
  `unified-live-epg-summary.util`.
- A channel with `epgKey === null` renders "No programme information" without
  a request.
- `loadCoverage` exists so the "Only with EPG" toggle has a complete answer
  before rows scroll into view; hiding rows as they load would look like data
  loss. For M3U it is one SQL `EXISTS`; Stalker's bulk cache answers for free.
- Time windows are provider-clock instants: the guide converts the selected
  day with `epgProviderClockMs` before requesting and renders with
  `epgDisplayTimeMs`, exactly one offset form per comparison (contract in
  `epg-display-offset.util.ts`). The guide reads
  `SettingsStore.resolvedEpgOffsetMinutes` itself, as the programme dialog
  does, because it has several openers.
- The contract does not carry the player, "now playing", or layout. Those are
  host concerns.

## Guide Component

Location: `libs/ui/epg/src/lib/epg-guide/`. Every production file stays under
300 lines.

- `epg-guide.component` — shell. Injects the source, owns the selected day,
  zoom, density, channel filter, "Only with EPG" state. Outputs `close` and
  `channelActivated`. The time axis is 00:00–24:00 of the selected day; the
  now-line and its time badge tick once a minute; "Now" returns to today and
  scrolls the current time into view. Single click on a row or on an
  "ON NOW" card calls `activate`; double-click or Enter calls `activate` then
  emits `close`; click on a past or future card opens the existing programme
  dialog via `EpgProgrammeDialogService`.
- `epg-guide-toolbar.component` — ‹ date ›, Now, scope select, "Only with
  EPG" toggle, density toggle (comfortable 60 px / compact 44 px), zoom range
  (120–480 px per hour), channel filter, programme search (only when the
  source implements `searchPrograms`). Density, zoom and the toggle persist in
  `localStorage` under `epg-guide:density`, `epg-guide:zoom`,
  `epg-guide:only-with-epg`; the scope is not persisted.
- `epg-guide-row.component` (OnPush) — channel cell (number, logo, name;
  second line: current programme title, "No programme information", or
  "▶ Playing" plus an equaliser icon for the active row) and the lane with
  cards. Card tiers reuse the timeline's rules: wide = mono time + title,
  narrow (< ~70 px) = title only, micro (< ~20 px) = bar with tooltip. Past
  cards have no fill and a thin border; "ON NOW" cards carry a progress wash
  and tag; the active channel's row uses the selection surface and a left
  accent bar.
- `epg-guide-layout.util` — day window, ticks, now-x, card left/width/tier
  computed through `epg-timeline-render.util` so grid and timeline agree.
- `epg-guide-programs.service` (component-provided) — cache keyed by
  (channel id, day), batched loads for visible rows plus a 10-row buffer,
  per-channel status `idle | loading | loaded`, coverage per day, reset on
  scope or source change. Batches are capped at 100 channels per IPC.
- `epg-guide-keyboard.controller` — ↑/↓ channel, ←/→ programme, Enter play,
  I details, N now, PgUp/PgDn day, Esc close. Ignores events from inputs and
  while a dialog is open.
- `epg-guide-now-playing.component` — the right part of the docked player
  strip: channel, programme title, description, progress, Close (Esc) and
  Collapse. Rendered by the host beside the player, because the strip itself
  is host layout.

Rendering: CDK virtual scroll over fixed-height rows inside one viewport that
scrolls both ways; the channel column is `position: sticky; left: 0`, the
ruler `sticky; top: 0`. Styles come from `_epg-theme.scss`, the timeline's
token set; card radius is 8 px (timeline uses 11 px on 96 px cards).

## M3U Host

- `VideoPlayerComponent` gains `guideOpen` and `guideDockCollapsed` signals
  (the latter persisted under `epg-guide:dock-collapsed`). While
  `guideOpen()` is true the sidebar and the `.epg` block are not rendered;
  `<app-epg-guide>` takes their place; `.content-container` gets `is-guide`
  and CSS turns `.video-player` into a 128 px strip (16:9 video on the left,
  `app-epg-guide-now-playing` beside it; 40 px single line when collapsed).
  `app-web-player-view` keeps its DOM position, so HTML5/hls.js, Video.js,
  ArtPlayer and both Embedded MPV engines keep playing; native-view syncs
  bounds as on any resize.
- The guide is unavailable for radio and recognised movies (no
  `app-web-player-view` host there) and in the PWA (`supportsEpg` is false).
  Entering player fullscreen closes the guide; the guide and the fullscreen
  channel panel are mutually exclusive.
- `M3uEpgGuideSourceService` in
  `libs/playlist/m3u/feature-player/src/lib/epg-guide/`, provided by the host
  component as `EPG_GUIDE_SOURCE`. Channels come from NgRx (`selectChannels`,
  groups, favorites); scopes are "All channels", each group, "Favorites"; the
  initial scope follows `activeView()` and the sidebar's selected group.
  `epgKey` uses the `stream-resolver` chain `tvg.id → tvg.name → name`; radio
  and movie entries are excluded. `loadPrograms`/`loadCoverage` call the new
  bridge methods with the playlist's `sourceUrls`, as
  `EpgService.getCurrentProgramsForChannels` does, so playlist-scoped EPG wins.
  `activate` dispatches `ChannelActions.setActiveChannel`; `activeChannelId`
  mirrors `activeChannel()`. `searchPrograms` uses `EPG_SEARCH_PROGRAMS` and
  filters results to the scope's resolved channel ids. `catchUp` is not wired
  in this sub-project.
- Entry points, all toggling the same signal:
  1. Workspace header action (`m3u-epg-guide`, icon `grid_view`, label
     "Programme guide"), highlighted while open.
  2. Command palette entry (same action).
  3. A "Guide" button in the timeline toolbar next to Now and zoom: new
     `openGuide` output on `app-epg-timeline`, rendered only when the host is
     subscribed.
  4. Key `G` on the M3U player page, handled by the host's existing document
     listener (the PageUp/PageDown zapping one) with the same exclusions:
     typing, dialogs, player fullscreen. Not added to workspace-level
     shortcuts, so portals without a guide never swallow G.
- Closing: Esc, the strip's Close button, any entry point again,
  double-click on a channel, leaving the route.

## Backend

Two new IPC handlers registered in `epg.events.ts`, implemented in a new
`epg-guide-query.service.ts` (`epg-query.service.ts` is already past 900
lines).

- `EPG_GET_PROGRAMS_FOR_CHANNELS { channelIds, fromMs, toMs, sourceUrls? }` →
  `Record<requestedId, EpgProgram[]>`. Id resolution matches
  `GET_CURRENT_PROGRAMS_BATCH`: manual mappings via `queryByResolvedChannelIds`,
  then exact id in scoped sources, legacy rows, then case-insensitive
  `id`/`display_name` candidates. One SQL per batch:
  `channel_id IN (...) AND start < to AND stop > from` on
  `idx_epg_programs_time_range`; programmes crossing the day boundary are
  included. Batches are limited to 100 ids; the renderer splits.
- `EPG_GET_PROGRAM_COVERAGE { channelIds, fromMs, toMs, sourceUrls? }` →
  `string[]` of requested ids with at least one programme in the window. Same
  resolution, then `SELECT DISTINCT channel_id … WHERE start < to AND stop >
  from`. 2000 keys cost one resolution and one query, not 2000.
- Bridge: `getEpgProgramsForChannels` and `getEpgProgramCoverage` in
  `ElectronBridgeApi`, `main.preload.ts`, `EpgRuntimeBridgeService`;
  capability `supportsEpgGuide` in `RuntimeCapabilitiesService` replaces
  `supportsEpgChannelBrowser` inside the composite `supportsEpg`. Both methods
  get rows in `main.preload.spec-data.ts`.
- The display offset never reaches SQL (see the contract rules above).

## Removed

- `libs/ui/epg/src/lib/multi-epg/` (component, spec, `overlay-ref.token.ts`),
  its export, its `max-lines-baseline.mjs` entry, `openMultiEpgView` and the
  `COMPONENT_OVERLAY_REF` wiring in `VideoPlayerComponent`.
- `EPG_GET_CHANNELS_BY_RANGE`, `EpgQueryService.getChannelsByRange`,
  `getEpgChannelsByRange` in preload and contract, `supportsEpgChannelBrowser`.
- Comments describing the "multi-EPG overlay" in
  `window-controls.component.ts`, `epg-item-description.component.ts`,
  `docs/architecture/workspace-shell.md`: the guide is ordinary host layout,
  so the window controls no longer have an overlay to stay above.
- i18n keys `TOP_MENU.OPEN_MULTI_EPG` and
  `WORKSPACE.SHELL.COMMANDS.OPEN_MULTI_EPG_DESCRIPTION`, replaced by
  `EPG.GUIDE.*` (toolbar, density, empty states, key hints, player strip)
  added to all 19 locales with the `i18n-fill` skill.

## Testing

- Unit, `ui-epg`: layout util (ticks, now-x, boundary-crossing cards, tiers);
  programs service (visible-row batching, per-day cache, coverage, reset on
  scope change); keyboard controller (navigation, input/dialog exclusions);
  guide component (click/double-click/Enter → `activate`/`close`, toggle hides
  only uncovered rows, density/zoom/toggle persistence).
- Unit, `playlist-m3u-feature-player`: source adapter (scopes from groups and
  favorites, `epgKey` chain, radio/movie exclusion, `sourceUrls` forwarded,
  `activate` dispatches); `video-player.component.spec` (guide mode hides
  sidebar and timeline, the player instance is unchanged, fullscreen closes
  the guide, G and Esc).
- Unit, `electron-backend`: `epg-guide-query.service.spec` on in-memory SQLite
  (day window with boundary overlap, manual mapping and case-insensitive
  `display_name` resolution, scoped sources, batch limit, coverage);
  `main.preload.spec-data.ts` rows for both methods.
- E2E, `electron-backend-e2e`: new `epg-guide.e2e.ts` on the fixture used by
  `epg.e2e.ts` (imports XMLTV, renders the timeline): open the guide from the
  timeline button, rows equal the playlist's channels in order, the toggle
  hides the row without EPG, clicking a channel changes the active channel,
  Esc closes, and the `<video>` element is the same node (marker attribute set
  before opening).
- `pnpm run typecheck:ci` and `pnpm nx lint` on touched projects; manual CDP
  check on native-view Embedded MPV for strip bounds on open, collapse and
  window zoom.

## Documentation and Release Note

- `docs/architecture/m3u-playlist-module.md`: a "Programme guide" section
  (contract, host mode, IPC, persisted keys, keys) replaces the "Multi-EPG
  modal view" line.
- `CLAUDE.md`: `ui/epg` description, EPG section, and the display-offset
  sentence naming the "multi-EPG overlay". `workspace-shell.md` and
  `pwa-self-hosted.md` where they mention the overlay.
- README and website reference `multi-epg-view.webp`; it is recaptured only
  by the release screenshot script against the mock servers and is a
  release-time follow-up, not part of the PR.
- `.changes/epg-programme-guide.md`, `type: feature`, highlight
  "Programme guide, rebuilt": the guide shows your playlist's channels in
  their order, a click switches channel without interrupting playback, the
  player stays on screen, a Guide button lives in the programme panel, G
  opens it, plus an "only with EPG" toggle and two density modes.

## Deferred to Sub-project 2

- Xtream and Stalker adapters for `EPG_GUIDE_SOURCE`. Decided direction: per
  channel exactly one source, no toolbar switch. Xtream follows the existing
  "prefer uploaded EPG over Xtream" setting (portal `get_simple_data_table`
  first otherwise, XMLTV as fallback) and loads visible rows lazily through
  `EpgQueueService`; Stalker uses the bulk `get_epg_info` cache with manual
  mapping overlays as the live layout already does. A small source hint may
  appear on hover.
- `catchUp` wiring for M3U catch-up attributes.
- Time-windowed lazy loading inside a day (v1 loads the whole day for the
  visible rows).
