# M3U Playlist Module Architecture

This document describes the M3U playlist module architecture, which handles traditional M3U/M3U8 playlists (as opposed to Xtream Codes or Stalker Portal).

## Overview

The M3U playlist module provides:

- Channel list display with virtual scrolling (90,000+ channels support)
- EPG (Electronic Program Guide) integration
- Favorites management with drag-and-drop reordering
- Channel grouping, search, and per-list channel sorting
- Per-playlist group visibility management in the groups view
- Video playback with multiple player backends

## Module Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VIDEO PLAYER PAGE                            │
│          libs/playlist/m3u/feature-player/src/lib/video-player/     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────────┐  ┌────────────────────┐ │
│  │   Sidebar   │  │    Video Player      │  │  EPG Timeline      │ │
│  │             │  │  (ArtPlayer/Video.js)│  │  (panel below)     │ │
│  │ ┌─────────┐ │  │                      │  │                    │ │
│  │ │Channel  │ │  │                      │  │                    │ │
│  │ │List     │ │  │                      │  │                    │ │
│  │ │Container│ │  │                      │  │                    │ │
│  │ └─────────┘ │  │                      │  │                    │ │
│  └─────────────┘  └──────────────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        NgRx STORE (m3u-state)                        │
│                         libs/m3u-state/                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Playlist │ │ Channel  │ │   EPG    │ │Favorites │ │  Filter  │  │
│  │ Reducer  │ │ Reducer  │ │ Reducer  │ │ Reducer  │ │ Reducer  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## M3U Parsing (`iptv-playlist-parser` fork)

All four parse call sites (Electron `playlist-source.ts` import, `playlist-refresh.worker.ts`, `web-backend` `/parse`, PWA `playlists.service.ts`) use the
[4gray/iptv-playlist-parser](https://github.com/4gray/iptv-playlist-parser) fork, pinned by commit SHA in `package.json`. The fork tracks upstream
`freearhey/iptv-playlist-parser` (currently synced to v0.15.2) plus two deliberate deltas iptvnator depends on:

- **`radio` attribute** — `item.radio` (string, `'true'` triggers the radio player, EPG suppression, and external-player gating app-wide). Upstream does not have this field; it must survive every upstream sync.
- **Pipe stripping** — `item.url` is cut at the first `|`; `|User-Agent=` / `|Referer=` params still land in `item.http`. Upstream 0.15.0 stopped stripping, but iptvnator consumes `item.url` verbatim in hls.js/mpv/vlc, catch-up URL building, and url-keyed favorites.

There is intentionally **no URL validation** (upstream removed it in 0.15.0): any non-empty non-`#` line after `#EXTINF` becomes the item URL. This is what fixes issue #1189 (Pluto TV JWT URLs longer than validator's 2084-char IE-era limit used to be rejected, and the stalled item index collapsed the whole playlist into one channel). `#` comment lines and unknown directives are appended to `item.raw` and never treated as URLs.

The behavioral contract is guarded by `apps/web/src/app/iptv-playlist-parser.contract.spec.ts` (jest maps the module to the real parser source) and by the fork's own test suite.

## State Management (libs/m3u-state/)

### State Structure

```typescript
interface PlaylistState {
    // Active channel being played
    active: Channel | undefined;

    // Whether the current route is still resolving channel data
    channelsLoading: boolean;

    // All channels from current playlist
    channels: Channel[];

    // EPG state
    epg: {
        epgAvailable: boolean;
        activeEpgProgram: EpgProgram | undefined;
        currentEpgProgram: EpgProgram | undefined;
    };

    // Playlist metadata (entity adapter)
    playlistsMeta: {
        ids: string[];
        entities: Record<string, PlaylistMeta>;
        selectedId: string | undefined;
        allPlaylistsLoaded: boolean;
        selectedFilters: PlaylistSourceFilter[];
    };
}
```

`PlaylistMeta` is the persisted playlist-facing subset of the playlist entity.
For M3U playlists it now also carries `hiddenGroupTitles?: string[]`, which is
used by the groups view to remember which group titles the user has hidden.

### Actions

| Action Group         | Actions                                                                                | Purpose                        |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| **PlaylistActions**  | `loadPlaylists`, `addPlaylist`, `removePlaylist`, `parsePlaylist`, `setActivePlaylist` | Playlist CRUD                  |
| **ChannelActions**   | `setChannels`, `setActiveChannel`, `setAdjacentChannelAsActive`                        | Channel selection & navigation |
| **EpgActions**       | `setActiveEpgProgram`, `setCurrentEpgProgram`, `setEpgAvailableFlag`                   | EPG state                      |
| **FavoritesActions** | `updateFavorites`, `setFavorites`                                                      | Favorites management           |
| **FilterActions**    | `setSelectedFilters`                                                                   | Playlist type filtering        |

### Key Selectors

```typescript
// Channel selectors
selectActive; // Current playing channel
selectChannelsLoading; // Channel list loading flag
selectChannels; // All channels array
selectFavorites; // Favorite channel URLs

// Playlist selectors
selectAllPlaylistsMeta; // All playlists
selectActivePlaylistId; // Selected playlist ID
selectCurrentPlaylist; // Active playlist object
selectPlaylistTitle; // Title with "Global favorites" fallback

// EPG selectors
selectIsEpgAvailable; // EPG data available flag
selectCurrentEpgProgram; // Current playing program
```

## Channel List Container

**Location**: `libs/ui/components/src/lib/channel-list-container/`

### Component Architecture

```
channel-list-container/
├── channel-list-container.component.ts   # Parent - shared state coordinator
├── channel-list-container.component.html
├── channel-list-container.component.scss
│
├── all-channels-tab/                      # Virtual scroll + search
│   ├── all-channels-tab.component.ts
│   ├── all-channels-tab.component.html
│   └── all-channels-tab.component.scss
│
├── groups-tab/                            # Expansion panels + infinite scroll
│   ├── groups-tab.component.ts
│   ├── groups-tab.component.html
│   └── groups-tab.component.scss
│
├── favorites-tab/                         # Drag-drop reordering
│   ├── favorites-tab.component.ts
│   ├── favorites-tab.component.html
│   └── favorites-tab.component.scss
│
└── channel-list-item/                     # Individual channel display
    ├── channel-list-item.component.ts
    ├── channel-list-item.component.html
    └── channel-list-item.component.scss
```

### Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│              ChannelListContainerComponent                    │
│                      (Parent)                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Shared State (Signals):                                │  │
│  │  - channelEpgMap: Map<string, EpgProgram>              │  │
│  │  - progressTick: number (30s interval)                 │  │
│  │  - shouldShowEpg: boolean                              │  │
│  │  - favoriteIds: Set<string>                            │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                   │
│     ┌─────────────────────┼─────────────────────┐            │
│     ▼                     ▼                     ▼            │
│ ┌─────────┐         ┌──────────┐         ┌───────────┐      │
│ │   All   │         │  Groups  │         │ Favorites │      │
│ │Channels │         │   Tab    │         │    Tab    │      │
│ │  Tab    │         │          │         │           │      │
│ └────┬────┘         └────┬─────┘         └─────┬─────┘      │
│      │                   │                     │             │
│      └───────────────────┴─────────────────────┘             │
│                          │                                   │
│                          ▼                                   │
│              (channelSelected) output                        │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           ▼
                    Store Dispatch
              ChannelActions.setActiveChannel
```

### Loading States

- `M3uWorkspaceRouteSession` owns route-driven channel loading for the player/sidebar routes: `all` and `groups`.
- The route session sets `channelsLoading` before `getPlaylist()` resolves and clears it when `ChannelActions.setChannels` lands.
- `ChannelListContainerComponent` now renders a dedicated skeleton state while `channelsLoading` is true.
- `ChannelListContainerComponent` no longer clears `channels` on destroy; route/session code is the single owner of shared list lifecycle during navigation.
- The dedicated `/workspace/playlists/:id/favorites` and `/workspace/playlists/:id/recent` collection routes do not drive the shared sidebar channel list; they default to the `playlist` scope so rail links always open the current playlist view, not the last persisted global scope.
- M3U favorites and recent collection rows preserve their full `Channel` payload on unified live items so the shared live list can open the read-only channel details context menu without reconstructing partial channel data.
- Recent live rows support context-menu removal in the unified all-playlists view; the row-level delete shortcut remains available on playlist-scoped M3U recent rows.
- Empty playlists and empty search results are no longer conflated:
    - loading: skeletons
    - empty source: no channels in the playlist after loading completes
    - empty search: no matches within an already loaded playlist

### Group Visibility Management

- `GroupsViewComponent` owns the M3U-only "Manage groups" action and dialog in
  `libs/ui/components/src/lib/channel-list-container/groups-view/`.
- The groups rail header also owns an inline search toggle that filters the
  currently visible groups without mutating the workspace-level route search
  term used by the broader channel views.
- The dialog operates on the full grouped dataset, while the left rail and
  channel pane render only groups whose titles are not listed in
  `hiddenGroupTitles`.
- `ChannelListContainerComponent` reads `hiddenGroupTitles` from the active M3U
  playlist metadata and passes it into the groups view. Saving dialog changes
  dispatches `PlaylistActions.updatePlaylistMeta`.
- `PlaylistsService.updatePlaylistMeta()` persists `hiddenGroupTitles` into the
  stored playlist payload, and M3U refresh/update flows preserve the existing
  value when refreshed playlist data omits the field.
- The groups route keeps the manage action reachable even when every group is
  hidden by separating "playlist has no groups" from "no visible/search-matching
  groups" empty states.

### Channel Sorting

- `AllChannelsViewComponent` owns sorting for the all-channels list and
  persists the selected mode under `m3u-all-channels-sort-mode`.
- `GroupsViewComponent` owns sorting for the selected group's channel pane and
  persists the selected mode under `m3u-groups-channel-sort-mode`.
- Both views support three modes: `Playlist Order`, `Name A-Z`, and `Name Z-A`.
  `Playlist Order` is the default and preserves the original channel order from
  the M3U playlist.
- Sorting is applied after the current search filter and before virtual-scroll
  rendering. Playlist order avoids cloning the full list when no search term is
  active.

### EnrichedChannel Pattern

For performance optimization, channels are pre-enriched with EPG data:

```typescript
interface EnrichedChannel extends Channel {
    epgProgram: EpgProgram | null | undefined;
    logo: string; // Playlist tvg-logo first, XMLTV icon fallback second
    progressPercentage: number; // Pre-computed by parent
}
```

The renderer now keeps two lookup maps for M3U collection views:

- `channelEpgMap` for current-program preview data
- `channelIconMap` for XMLTV channel icon fallback data

Logo resolution is runtime-only and follows this rule:

1. playlist `tvg-logo`
2. matched XMLTV `<channel><icon src="...">`
3. generic `live_tv` fallback in the list item component

EPG lookup keys use the same precedence in both program and icon paths:

1. `tvg-id`
2. `tvg-name`
3. channel name

All four collection tabs (all-channels, groups, favorites, recent) share a single
EPG-enrichment implementation in `channel-list-container/epg-enrichment.util.ts`,
fed the same `channelEpgMap`/`channelIconMap` from the container — there is no
per-tab EPG logic:

- `calculateEpgProgress(program, now?)` — clamped, **rounded** progress in
  `[0, 100]`, guarded against missing/invalid timestamps and zero-length
  programmes (never returns `NaN`).
- `resolveChannelEpgProgram(channel, channelEpgMap)` — the current programme for
  a channel by its lookup key (used by the per-item recent view).
- `buildChannelEpgMetadataMap(channelEpgMap, now?)` — the side-car
  `key → {epgProgram, progressPercentage}` map (used by all-channels/groups/
  favorites). Callers read their `progressTick()` signal first so the computed
  re-runs on the ~30s tick.

### EPG Panel (Timeline & List views)

The programme guide under the player renders in one of **two interchangeable
views**, chosen by the **`epgViewMode`** setting (`'timeline'` default, or
`'list'`; Settings → EPG → *Guide view*):

- **Timeline** — a horizontal **ribbon** (`app-epg-timeline`,
  `libs/ui/epg/src/lib/epg-timeline/`).
- **List** — a vertical, single-day **programme list** (`app-epg-list-view`,
  `libs/ui/epg/src/lib/epg-list-view/`) with a prev/today/next stepper.

Both are shared by all four live surfaces: the M3U video player, the unified live
tab, and the Xtream and Stalker live-stream layouts (replacing the former
vertical `app-epg-list` / `app-epg-view`). `EpgListViewComponent` mirrors
`EpgTimelineComponent`'s input/output contract **1:1**, so each host swaps them
with a plain `@if (epgViewMode() === 'list') { <app-epg-list-view … /> } @else {
<app-epg-timeline … /> }` — identical bindings in both branches. Hosts read
`epgViewMode` from `SettingsStore` (a signal), so flipping the setting swaps the
panel live. The setting flows end-to-end (`Settings.epgViewMode` →
`DEFAULT_SETTINGS` → `SettingsStore`/`StorageMap` → the segmented control in
`settings-epg-section`) and needs no backend change. The control is
**Electron-only in practice** — the EPG settings section (and the form control)
is gated behind `supportsEpg`, which is false in PWA; there the stored value
simply stays at the `'timeline'` default.

Both components stay presentation-focused; the reusable, view-agnostic pieces
(shared by the timeline and the list) are split out and re-exported from
`@iptvnator/ui/epg`:

- `epg-timeline.utils.ts` (axis/blocks/date helpers) + `epg-timeline-render.util.ts`
  (short-programme tiers, grouping, zoom bounds) — the ribbon geometry.
- `epg-archive.util.ts` — catch-up gating (`isWithinArchiveWindow`,
  `canCatchUpProgramme`, `epgDialogActionFor`) off `when`/`startMs` primitives.
- `epg-summary.util.ts` — `EpgTimelineSummary` + collapsed-summary progress maths
  (`summaryProgress` / `summaryMinutesLeft` / …).
- `epg-programme-dialog.service.ts` — `EpgProgrammeDialogService`, opens the
  shared details dialog and returns the chosen `live` / `timeshift` action.
- `epg-timeline-scroll.controller.ts` — `TimelineScrollController` (ribbon
  scrolling + channel-select auto-focus); timeline-specific, kept out of the
  component so it stays under the line ceiling.

The **list view** (`epg-list-view/`) composes those same shared modules — it does
**not** duplicate classification or gating logic. It reuses `classifyTimelineWhen`
/ `hasProgramsForDateKey` / `nearestDateKeyWithPrograms`, `epg-archive.util`,
`epg-summary.util`, the `epg-date` helpers, `EpgProgrammeDialogService`, and the
shared `app-epg-timeline-empty-state` — and drops all ribbon geometry, zoom, and
horizontal scroll. It filters the loaded window to the selected day (overlap-based,
matching `hasProgramsForDateKey`), sorts, and deduplicates via a pure
`buildEpgListRows` (`epg-list-view.utils.ts`); renders each row through the dumb
`app-epg-list-view-row`; and delegates its own vertical auto-focus + sticky
"now" strip to `EpgListScrollController` (`epg-list-scroll.controller.ts`). Render
states, the collapsed inline summary, the date stepper, catch-up/timeshift
activation, and the details dialog behave identically to the timeline.

- **One channel, preloaded window.** The panel always shows a single channel.
  Each provider returns a multi-day window in roughly one call (M3U
  `GET_CHANNEL_PROGRAMS`; Stalker `get_epg_info`; Xtream `get_simple_data_table`),
  so the whole ribbon is rendered up front and day navigation is **scroll within
  the loaded window** — no per-day lazy fetch. The date stepper / "Now" jump
  scroll the ribbon; the day label follows the scroll position.
- **Auto-focus on channel select.** When a channel's EPG (re)loads or the ribbon
  (re)mounts, the timeline centres the **currently airing programme** in the
  viewport **instantly** (`behavior: 'auto'`, no scroll animation) — selecting a
  channel lands on "now" without the user pressing the Now button. The jump is
  deduped by programme-set identity (`programsFocusKey`), so the 30s now-tick,
  zoom changes, or a host re-emitting the same data never re-jump the viewport;
  switching channels (or returning after viewing an empty-day channel) re-centres.
  The explicit "Now" button still animates (`behavior: 'smooth'`) since it is a
  deliberate user action. See `TimelineScrollController.maybeAutoFocus` /
  `focusCurrentProgram` in `epg-timeline-scroll.controller.ts`.
- **Controlled component.** `app-epg-timeline` is presentation-only: it takes
  `programs`, `archivePlaybackAvailable`, `archiveDays`, `activeProgram`,
  `isLivePlayback`, `loading`, `emptyReason`, `selectedDate`, `collapsed`,
  `summary` and emits `programActivated`, `returnToLive`, `selectedDateChange`,
  `openEpgSettings`, `retry`, `collapsedChange`. The host layout owns playback,
  persists the collapse state (`liveEpgPanelState` in localStorage), and (for
  the M3U player) the `EpgActions.setCurrentEpgProgram` / `setEpgAvailableFlag`
  / `setActiveEpgProgram` dispatches. The timeline owns the **single** panel
  bar — collapse chevron + channel name on the left, return-to-live / jump /
  date stepper on the right — and the collapsed inline summary; the former
  `app-live-epg-panel` wrapper has been removed from the live layouts.
- **Dynamic bar subtitle.** Under the channel name the bar shows the
  **now-playing programme title** when expanded and a `summary` exists
  (`.epg-timeline__subtitle`) — readable title style, not the uppercase mono
  label. During timeshift it switches to the archive programme with a `history`
  icon and cyan accent (`.is-arch`). It falls back to the static `sourceLabel`
  (`Timeline` / `Xtream` / `Stalker Portal`) only when collapsed or when the
  channel has no programme.
- **State-aware toolbar controls.** The right-side controls are **hidden** (not
  disabled) when they cannot act, so a channel with no EPG shows a clean bar
  instead of dead controls: `showRibbonControls()` gates "Now" + zoom to the
  `ribbon` state only (nothing to jump to or zoom otherwise), and
  `showDateStepper()` keeps the date stepper for `ribbon` **and** `empty-day`
  (the only states where the channel has EPG on some day), hiding it for the
  no-EPG-anywhere states and while loading. Return-to-live is a playback control
  (`!isLivePlayback()`) and is independent of EPG state.
- **State-driven affordances.** Blocks are coloured past / now / future, with a
  red "now" playhead. Catch-up "Watch" appears on past blocks — and as a
  start-over replay button on the currently-airing block — only when
  `archivePlaybackAvailable` (Xtream `tv_archive`, M3U `catchup-*`); Stalker is
  schedule-only (dimmed past + a notice, no false buttons). The "i" button opens
  the shared `app-epg-item-description` dialog with a state-aware action.
- **Empty / error states.** `emptyReason` selects one of six states
  (`loading` skeleton, `empty-day`, `channel-unmapped`, `provider-no-epg`,
  `m3u-needs-setup`, `error`) via `app-epg-timeline-empty-state`. Icon tone is
  neutral for info, blue for actionable, red for errors; an action button is
  shown only when one really exists. The empty-state host `flex: 1`-fills the
  area below the toolbar and centres within **that** (compact icon/title/sub),
  rather than a fixed `min-height` that used to overflow the compact inline panel
  and push the icon/text — and the `empty-day` action buttons — below the visible
  edge. `empty-day` itself is decided by `hasProgramsForDateKey`, which is
  **overlap-based** (a programme counts for a day when `[start, stop)` intersects
  it, end-exclusive) — so a film that starts the previous evening and runs past
  midnight still keeps the ribbon on "today" while it airs, matching the sidebar
  (which matches by "airing now"); a start-date-only check used to drop to
  `empty-day` after midnight even though the programme was on air.
- **Short-programme strategy.** In a proportional ribbon a 5-minute programme
  would be an unreadable sliver, so `buildTimelineRenderItems`
  (`epg-timeline.utils.ts`) applies a layered fix: (A) a **minimum block width**
  (`TIMELINE_MIN_BLOCK_WIDTH_PX`); (B) width-adaptive **content tiers** —
  `wide` (title + time, 3-line clamp) → `med` (one-line ellipsis) → `narrow`
  (**vertical title**, no time) → `micro` (just a marker); (C) a **hover/focus
  popover** revealing the full title + time + description for any non-`wide`
  block (it flips above the block when the panel is near the screen bottom);
  (D) a px-per-minute **zoom** slider (tick density adapts via
  `timelineTickStepForScale`); and (E) **grouping** of ≥4 consecutive short
  (<10 min) programmes into one dashed "N short" chip when zoomed out
  (`scale < TIMELINE_GROUP_ZOOM_MAX`), expanded by clicking it. The ribbon
  canvas lives in the child `app-epg-timeline-track`; the parent owns the
  scroller, toolbar (incl. the zoom slider) and state.
- **Panel height & titles.** Block titles wrap onto as many lines as the card
  height allows and are clipped (not single-line ellipsis); the foot ("ON NOW"
  tag / "Watch") stays pinned at the bottom. With an inline player the guide is
  a compact panel (`.epg.epg--inline` → `flex: 0 0 clamp(180px, 36vh, 264px)`
  in `_portal-layout.scss`) so the player stays dominant; with an external
  player the guide keeps `flex: 1` and fills the whole content area. In **list
  mode** the hosts also set `.epg--list`, which raises only the inline clamp
  (`--epg-inline-height: clamp(280px, 46vh, 430px)`) — vertical rows need more
  height than the ribbon; the timeline height is unchanged, and the collapsed
  56px clamp still wins because the modifier sets just the CSS variable.
- **Wide-tier description preview.** When a block is the `wide` tier (rendered
  width ≥ `132px`, i.e. long programmes and/or zoomed in) **and** the programme
  has a `desc`, a dimmed (`--text-secondary`) preview of the description renders
  under the title (`.epg-timeline__block-desc`). Gated to `wide` only, so
  narrower cards and the moderate default zoom stay clean; the full description
  still lives in the hover popover for every tier. To avoid ugly mid-line cuts,
  wide-tier `time`/`title`/`desc` use `flex-shrink: 0` so flexbox can never
  shrink them to a fractional height: each self-clips on **whole lines** with an
  ellipsis via `-webkit-line-clamp` (title ≤ 2 lines, description ≤ 3) instead of
  being cut mid-line by the parent's `overflow: hidden`. At the usual inline
  panel height the title + 3-line preview fit without the parent clipping at all.

### Playlist-Declared EPG Sources

Some M3U providers declare XMLTV sources in the playlist header instead of
requiring the user to add them in Settings. The importer extracts EPG URLs from
`#EXTM3U` header attributes `x-tvg-url`, `url-tvg`, and `tvg-url` in
`@iptvnator/shared/m3u-utils`, then stores the normalized, deduplicated
candidates on `Playlist.detectedEpgUrls`.

`Playlist.epgUrls` is the enabled playlist-scoped subset used for automatic
import and lookup. Two additional lists preserve user edits:

- `Playlist.manualEpgUrls` stores URLs the user explicitly added for this
  playlist, including detected catalog URLs the user manually enabled.
- `Playlist.disabledEpgUrls` stores detected URLs the user removed from this
  playlist so playlist refreshes do not silently re-enable them.

- Up to five detected URLs are enabled automatically.
- Larger header lists are treated as provider catalogs. The importer keeps all
  candidates in `detectedEpgUrls`, but auto-enables only recommended URLs whose
  `guides/<country>` path matches playlist hints such as `tvg-country` or the
  country suffix in `tvg-id` (`channel.ua`). Language hints are used only when no
  country hints are present. If no recommendation can be made, the importer
  falls back to the first five detected URLs so generic provider catalogs still
  produce usable local EPG sources instead of silently enabling none.
- Recommendations are capped so a malformed or global provider list cannot
  start dozens of XMLTV downloads during playlist import.

These URLs are playlist-scoped by default:

- `libs/m3u-state` auto-fetches enabled `epgUrls` when M3U playlists are
  loaded, added, or refreshed, using the same EPG progress/import pipeline as
  Settings-managed XMLTV URLs. Before fetching, playlist URLs already present in
  global Settings are filtered out so the same XMLTV URL is not downloaded
  twice. Within a running session, the effect remembers the last fetchable URL
  set per playlist and only re-fetches when that URL set changes; metadata-only
  edits such as renaming a playlist or hiding groups do not re-download local
  EPG sources. When the local URL set expands, only newly added fetchable URLs
  are downloaded; disabling or removing one source does not re-download the
  remaining sources. Explicit playlist refreshes bypass that session fetch key
  and re-download the current fetchable local EPG URLs. Partial metadata updates
  that omit `epgUrls` preserve the previous fetch key, while an explicit empty
  `epgUrls` list clears it. Add/update metadata effects trigger playlist-local
  EPG fetches only after the playlist persistence call succeeds, and metadata
  updates that do not include any EPG source fields do not evaluate the fetch
  plan.
- The Electron EPG database stores `source_url` on imported programs so current
  program lookups can ask for the active playlist's EPG sources first. Existing
  databases backfill this column from `epg_channels.source_url` once, in bounded
  batches, after the scoped indexes are created. When multiple EPG files reuse
  the same XMLTV channel id, the channel row keeps its original `source_url`
  attribution instead of being overwritten by the last imported source; program
  scoping remains source-specific through `epg_programs.source_url`.
- `ChannelListContainerComponent` enables EPG rows when either global settings
  URLs or the active M3U playlist has `epgUrls`. EPG availability refreshes are
  debounced so several playlist-local XMLTV imports completing close together
  coalesce into one visible-channel EPG refresh. The visible channel list also
  refreshes when the effective EPG source context changes, so a playlist whose
  `epgUrls` arrive after the channels are rendered does not wait for the next
  periodic refresh before showing current programs. A successful EPG import
  clears current-program lookup caches before publishing availability, so an
  early "no current program" lookup cannot mask freshly imported rows until the
  TTL expires.
- Scoped lookups fall back only to Settings-managed EPG URLs for channels
  missing from the playlist-declared source. Playlist-local sources from other
  playlists are not treated as global fallback sources. Single-channel current
  program lookups include the source URL set in their cache and in-flight keys,
  so playlist-local and global lookups deduplicate without reusing the wrong
  source scope. Batch current-program lookups use the same source-scoped
  per-channel TTL cache and order-insensitive in-flight batch deduplication
  before reaching IPC; missing exact channel-id matches are resolved with batched
  id/display-name candidate queries rather than a per-channel fallback loop.
  Those candidate queries match the **raw key case-sensitively** as well as via
  `LOWER()`: SQLite's `LOWER()`/`COLLATE NOCASE` only fold ASCII, so for non-ASCII
  names (Cyrillic, Greek, …) a `LOWER()`-only match would miss channels whose
  M3U name and EPG `display_name` share the same casing — the raw exact match
  keeps parity with the timeline's single-channel exact-display-name lookup, and
  the JS `resolveChannelMetadataCandidate` then folds with full-Unicode
  `toLowerCase()`. The "airing now" window is compared with timezone-aware SQLite
  `datetime()` on both sides (`EpgQueryService.isAiringAt`), not raw string
  comparison: stored EPG timestamps often carry an offset (e.g. `+03:00`) while
  `now` is built as UTC (`…Z`), so a lexical compare would be wrong by the offset
  and surface a stale (or no) current programme. After the scoped + legacy
  candidate queries, any candidate that resolved by id/display-name but still has
  no in-scope current programme is retried once **unscoped** (all sources),
  mirroring the timeline's own unscoped `getChannelPrograms` lookup. This keeps
  the channel-list "now" line consistent with the timeline when a channel's row
  and its programmes carry different `source_url` values (shared XMLTV ids across
  multiple imports), where the channel resolves in scope but its programmes are
  tagged with a source that is not currently enabled.
  When upgrading an existing database whose historical programs have no
  `source_url`, scoped program and metadata queries try those legacy unscoped
  rows only after the requested source scope returns no result, so old EPG data
  remains visible without taking precedence over freshly imported scoped data.
  Channel metadata lookups use the same playlist-first, Settings-managed
  fallback strategy so icons and display names can still come from global EPG
  sources when the playlist-local guide only supplies programs. If multiple EPG
  sources reuse the same XMLTV channel id, channel metadata and display-name
  fallback lookups treat a channel as source-scoped when either the channel row
  itself or matching programs are tagged with the requested `source_url`.
- The playlist details dialog shows enabled EPG URLs with explicit actions to
  refresh, remove, or add a source to global Settings. It also allows adding one
  or more manual playlist-local sources and indicates when additional detected
  candidates were not auto-enabled. Removing a playlist-local source also
  clears programs tagged with that `source_url` and prunes only orphaned channel
  rows for that same source before saving the playlist metadata change, so a
  failed cleanup keeps the source enabled and visible. Shared XMLTV channel ids
  from other sources are preserved. Detected playlist sources are not silently
  promoted to global settings.

### Performance Optimizations

| Optimization                  | Implementation                                            |
| ----------------------------- | --------------------------------------------------------- |
| **Virtual Scroll**            | CDK virtual scroll for 90,000+ channels                   |
| **Computed Signals**          | `enrichedChannels` computed signal replaces template pipe |
| **Debounced Search**          | 300ms debounce on search input                            |
| **Global Progress Tick**      | Single 30s interval instead of per-item intervals         |
| **OnPush Change Detection**   | All components use OnPush                                 |
| **Infinite Scroll in Groups** | IntersectionObserver loads 50 channels at a time          |
| **Memoized Group Enrichment** | `enrichedGroupChannelsMap` computed signal                |

### Tab Components

#### AllChannelsViewComponent

- **Inputs**: `channels`, `channelEpgMap`, `channelIconMap`, `progressTick`, `shouldShowEpg`, `itemSize`, `activeChannelUrl`, `favoriteIds`
- **Outputs**: `channelSelected`, `favoriteToggled`
- **Features**: Workspace search, persisted channel sorting, virtual scrolling, no-results placeholder

#### GroupsViewComponent

- **Inputs**: Same as AllChannelsTab + `groupedChannels`
- **Outputs**: `channelSelected`, `favoriteToggled`
- **Features**: Resizable groups rail, local group search, group visibility management, persisted selected-group channel sorting

#### FavoritesViewComponent

- **Inputs**: `favorites`, `channelEpgMap`, `channelIconMap`, `progressTick`, `shouldShowEpg`, `activeChannelUrl`
- **Outputs**: `channelSelected`, `favoriteToggled`, `favoritesReordered`
- **Features**: Drag-and-drop reordering with CDK DragDrop, read-only channel details context menu

#### RecentViewComponent

- **Inputs**: recent channels, `channelEpgMap`, `channelIconMap`, `progressTick`, `shouldShowEpg`, `activeChannelUrl`
- **Outputs**: `channelSelected`, `favoriteToggled`, `recentItemRemoved`
- **Features**: Read-only channel details context menu, row-level and context-menu removal

## EPG Integration

### EpgService (`@iptvnator/epg/data-access`)

```typescript
class EpgService {
    // Fetch EPG for multiple URLs
    fetchEpg(urls: string[]): void;

    // Get programs for a channel
    getChannelPrograms(channelId: string): void;

    // Batch fetch current programs
    getCurrentProgramsForChannels(
        channelIds: string[],
        options?: { sourceUrls?: string[] }
    ): Observable<Map<string, EpgProgram>>;

    // Batch fetch XMLTV channel metadata for logo fallback
    getChannelMetadataForChannels(
        channelIds: string[],
        options?: { sourceUrls?: string[] }
    ): Observable<Map<string, EpgChannelMetadata | null>>;

    // Observables
    epgAvailable$: Observable<boolean>;
    currentEpgPrograms$: Observable<EpgProgram[]>;
}
```

### EPG Components

| Component                     | Purpose                              |
| ----------------------------- | ------------------------------------ |
| `EpgTimelineComponent`        | Horizontal timeline for one channel  |
| `EpgListViewComponent`        | Vertical single-day list alternative |
| `EpgItemDescriptionComponent` | Program details dialog               |
| `MultiEpgContainerComponent`  | Grid view of all channels' schedules |

## Video Player

**Location**: `libs/playlist/m3u/feature-player/src/lib/video-player/`

### Supported Players

- **ArtPlayer** (default) - Modern player with plugins
- **Video.js** - Fallback with HLS support
- **HTML5** - Basic video element
- **Audio** - For radio streams

### Player Features

- Channel navigation (prev/next)
- Favorites toggle
- EPG sidebar
- Collapsible inline EPG panel for internal players, persisted through the
  shared `live-epg-panel-state` preference
- Multi-EPG modal view
- Channel info overlay
- External player support (MPV, VLC) in Electron
- M3U archive/catch-up playback for supported replay schemes

### Archive / Catch-Up Playback

- The shared EPG UI only shows the archive replay badge when the host confirms
  that the selected M3U channel has a playable replay scheme. Archive days
  alone are not enough.
- M3U catch-up support is resolved in `@iptvnator/shared/m3u-utils` from channel metadata and
  the archived program start time.
- Supported replay precedence:
    1. `catchup.source` if it is an HTTP(S) URL. IPTVNator rewrites or appends
       standard `utc` and `lutc` query params on that URL.
    2. Legacy same-stream shift playback when `catchup.type === 'shift'`. In
       that case IPTVNator rewrites or appends `utc` and `lutc` on `channel.url`.
    3. Legacy same-stream shift fallback when no explicit catch-up mode is
       declared, archive-day metadata exists (`tvg.rec`, `timeshift`, or
       `catchup.days`), and `channel.url` itself is an HTTP(S) stream URL. This
       covers providers that only advertise archive retention such as
       `tvg-rec="7"` but still expect standard `utc` and `lutc` query params on
       the live URL.
- `tvg.rec`, `timeshift`, and `catchup.days` still define the archive window
  shown in the EPG, but replay remains unavailable when the provider declares a
  different explicit catch-up scheme that IPTVNator does not understand or when
  the stream URL itself is not an HTTP(S) replay target.
- Active replay is stored separately from the selected channel in
  `playlistState.activePlaybackUrl`. Inline and external players use
  `activePlaybackUrl ?? activeChannel.url`, and returning to live playback
  clears the override.
- The unified favorites/recent live tab
  (`libs/portal/shared/ui/.../unified-collection/unified-live-tab.component.ts`)
  hosts the same timeline but does not use the NgRx playlist state; it keeps
  its own `activeTimeshift` signal, resolves the replay URL with
  `resolveM3uCatchupUrl`, and swaps the inline player's playback target (or
  hands the URL to the configured external player). Selecting another channel,
  closing the player, or "Return to live" clears the override.
- Catch-up activation is never silent: if the replay URL cannot be resolved
  for a programme the user clicked, both hosts surface a
  `EPG.TIMELINE.CATCHUP_FAILED` snackbar instead of doing nothing.

## Interfaces

### Channel Interface

```typescript
interface Channel {
    id: string;
    url: string;
    name: string;
    group: { title: string };
    tvg: {
        id: string; // For EPG matching
        name: string;
        url: string;
        logo: string;
        rec: string;
    };
    epgParams?: string;
    timeshift?: string;
    catchup?: { type?: string; source?: string; days?: string };
    radio: string;
    http: {
        referrer: string;
        'user-agent': string;
        origin: string;
    };
}
```

### Playlist State Additions

```typescript
interface PlaylistState {
    active: Channel | undefined;
    activePlaybackUrl: string | null;
    currentEpgProgram: EpgProgram | undefined;
    epgAvailable: boolean;
    channels: Channel[];
}
```

### EpgProgram Interface

```typescript
interface EpgProgram {
    start: string; // ISO string
    stop: string; // ISO string
    channel: string; // TVG ID
    title: string;
    desc: string | null;
    category: string | null;
    episodeNum?: string | null;
    iconUrl?: string | null;
    rating?: string | null;
}
```

## Routes

```
/playlists/:id          # Video player with playlist
/iptv                   # Default IPTV route
```

## Adding New Features

### To add a new tab to channel list:

1. Create component in `channel-list-container/new-tab/`
2. Accept inputs: `channels`, `channelEpgMap`, `progressTick`, `shouldShowEpg`, `activeChannelUrl`
3. Emit `channelSelected` output
4. Add to parent template and imports

### To add EPG-related features:

1. Use `EpgService` for data fetching
2. Subscribe to `channelEpgMap` signal for current programs
3. Dispatch `EpgActions` for state updates

### To modify favorites behavior:

1. Dispatch `FavoritesActions.updateFavorites` for toggle
2. Dispatch `FavoritesActions.setFavorites` for reordering
3. Effects automatically persist to database
