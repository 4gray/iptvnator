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
│  │   Sidebar   │  │    Video Player      │  │   EPG List         │ │
│  │             │  │  (ArtPlayer/Video.js)│  │   (Right drawer)   │ │
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
  case-insensitive id/display-name candidate queries rather than a per-channel
  fallback loop.
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
| `EpgListComponent`            | Timeline view for single channel     |
| `EpgListItemComponent`        | Individual program in timeline       |
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
