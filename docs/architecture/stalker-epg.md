# Stalker Portal EPG Architecture

This document describes the EPG (Electronic Program Guide) implementation for Stalker/Ministra portal live TV (ITV) streams.

Related architecture docs:

- [Stalker Portal Architecture](./stalker-portal.md)
- [Remote Control Architecture](./remote-control.md)

## Overview

The Stalker ITV live stream layout displays EPG data in the right panel when a live channel is playing. EPG is fetched per-channel using the Stalker `get_short_epg` API action, which returns the current program plus the next ~5 upcoming programs. The response is mapped to the shared `EpgItem` interface and rendered by the reusable `EpgViewComponent`.

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                  StalkerLiveStreamLayoutComponent                         │
│            apps/web/src/app/stalker/stalker-live-stream-layout/          │
│                                                                           │
│  ┌──────────────┐    ┌──────────────────────┐    ┌─────────────────────┐ │
│  │   Sidebar    │    │   Video Player       │    │   EPG Panel         │ │
│  │  (channels)  │    │  (WebPlayerView)     │    │  (EpgViewComponent) │ │
│  │              │    │                      │    │                     │ │
│  │  click ──────┼────┼──► playChannel() ────┼────┼──► loadEpgFor...() │ │
│  └──────────────┘    └──────────────────────┘    └─────────────────────┘ │
│                              │                            │               │
└──────────────────────────────┼────────────────────────────┼───────────────┘
                               │                            │
                               ▼                            ▼
                    ┌──────────────────────┐     ┌────────────────────────┐
                    │    StalkerStore      │     │    StalkerStore        │
                    │  fetchLinkToPlay()   │     │  fetchChannelEpg()     │
                    └──────────┬───────────┘     └────────────┬───────────┘
                               │                              │
                               ▼                              ▼
                    ┌──────────────────────────────────────────────────────┐
                    │              Stalker Portal API                       │
                    │  action=create_link         action=get_short_epg     │
                    └──────────────────────────────────────────────────────┘
```

## Stalker EPG API

### `get_short_epg` (per-channel)

**Request:**
```
GET load.php?type=itv&action=get_short_epg&ch_id={channel_id}&JsHttpRequest=1-xml
```
Uses standard Stalker auth headers (Bearer token + MAC cookie).

**Response:**
```json
{
  "js": {
    "data": [
      {
        "id": "123",
        "ch_id": "45",
        "name": "Program Title",
        "descr": "Program description",
        "time": "2025-01-15 14:00:00",
        "time_to": "2025-01-15 14:30:00",
        "duration": "1800",
        "start_timestamp": "1736949600",
        "stop_timestamp": "1736951400",
        "t_time": "14:00",
        "t_time_to": "14:30"
      }
    ]
  }
}
```

**Notes:**
- If the channel has no `xmltv_id` set on the server, returns an empty array
- Response normalization handles both `{ js: { data: [...] } }` and `{ js: [...] }` formats
- No backend (Electron IPC) changes needed — the generic `stalker.events.ts` handler forwards any `params` to the portal URL

### `get_epg_info` (bulk — reserved for future use)

```
GET load.php?type=itv&action=get_epg_info&period={hours}&JsHttpRequest=1-xml
```

Returns EPG for all channels for a given time period. Currently unused but the enum value `StalkerPortalActions.GetEpgInfo` is defined for future bulk EPG features.

## Data Mapping

### Stalker EPG → `EpgItem` Interface

| Stalker field      | `EpgItem` field    | Notes |
|--------------------|--------------------|-------|
| `id`               | `id`               | Converted to string |
| `ch_id`            | `channel_id`       | Falls back to passed `channelId` |
| `name`             | `title`            | |
| `descr`            | `description`      | |
| `time`             | `start`            | Full datetime string |
| `time_to`          | `end`, `stop`      | Both set to same value |
| `start_timestamp`  | `start_timestamp`  | Unix timestamp as string |
| `stop_timestamp`   | `stop_timestamp`   | Unix timestamp as string |
| _(n/a)_            | `epg_id`           | Empty string |
| _(n/a)_            | `lang`             | Empty string |

### `EpgItem` Interface

```typescript
// libs/shared/interfaces/src/lib/epg-item.interface.ts
interface EpgItem {
    id: string;
    epg_id: string;
    title: string;
    lang: string;
    start: string;
    end: string;
    stop: string;
    description: string;
    channel_id: string;
    start_timestamp: string;
    stop_timestamp: string;
}
```

## Implementation Details

### Key Files

| File | Purpose |
|------|---------|
| `libs/shared/interfaces/src/lib/stalker-portal-actions.enum.ts` | `GetShortEpg`, `GetEpgInfo` enum values |
| `apps/web/src/app/stalker/stalker.store.ts` | `fetchChannelEpg()` method |
| `apps/web/src/app/stalker/stalker-live-stream-layout/stalker-live-stream-layout.component.ts` | EPG signals + `loadEpgForChannel()` |
| `apps/web/src/app/stalker/stalker-live-stream-layout/stalker-live-stream-layout.component.html` | `<app-epg-view>` integration |
| `libs/ui/shared-portals/src/lib/epg-view/epg-view.component.ts` | Shared EPG display component |

### StalkerStore.fetchChannelEpg()

Location: `apps/web/src/app/stalker/stalker.store.ts` (in `withMethods`)

```typescript
async fetchChannelEpg(channelId: number | string): Promise<EpgItem[]>
```

- Sends `get_short_epg` request with `ch_id` param
- Supports both full Stalker portals (authenticated via `StalkerSessionService`) and simple portals (direct IPC)
- Returns mapped `EpgItem[]` or empty array on failure
- No store state mutation — returns data directly to the component

### StalkerLiveStreamLayoutComponent EPG Integration

The component manages EPG state locally with signals:

```typescript
readonly epgItems = signal<EpgItem[]>([]);
readonly isLoadingEpg = signal(false);
```

**Flow:**
1. User clicks a channel in the sidebar → `playChannel(item)`
2. `fetchLinkToPlay()` gets the stream URL
3. If using embedded player, `streamUrl` is set and `loadEpgForChannel(item.id)` is called
4. `loadEpgForChannel()` sets loading state, calls `stalkerStore.fetchChannelEpg()`, updates `epgItems`
5. Template renders `<app-epg-view [epgItems]="epgItems()">` or a loading spinner

### EpgViewComponent (shared)

Location: `libs/ui/shared-portals/src/lib/epg-view/`

Reusable component shared between Stalker and Xtream live stream layouts:
- **Input:** `epgItems: EpgItem[]`
- Displays program list with time, title, and info button
- Highlights current program with green progress bar
- Handles empty state (shows "EPG not available" message)
- Info button opens `EpgItemDescriptionComponent` dialog with title and description

**Current program detection:**
```typescript
isCurrentProgram(item: EpgItem): boolean {
    const now = new Date().getTime();
    const start = new Date(item.start).getTime();
    const stop = new Date(item.stop ?? item.end).getTime();
    return now >= start && now <= stop;
}
```

This works with Stalker's datetime format (`"2025-01-15 14:00:00"`) because `new Date()` parses it correctly.

## Authentication

EPG requests follow the same authentication pattern as all Stalker API calls:

| Portal Type | Auth Method |
|-------------|-------------|
| **Full Stalker** (`isFullStalkerPortal: true`) | `StalkerSessionService.makeAuthenticatedRequest()` — handles token refresh and retry on 401 |
| **Simple Stalker** | Direct IPC via `DataService.sendIpcEvent(STALKER_REQUEST, ...)` — no auth headers |

## Future Enhancements

### Bulk EPG in Channel List Sidebar

Use `get_epg_info` with `period=3` to pre-fetch current program titles for all channels when a category is selected:
- Call `get_epg_info` after category selection
- Build a `Map<channelId, currentProgram>`
- Show current program name below channel title in the sidebar
- Display progress bar per channel item

This is a separate task due to Stalker's lazy-loaded channel pagination model.

### EPG Auto-Refresh

Currently EPG is fetched once per channel selection. A future enhancement could add a timer to refresh EPG data periodically (e.g., every 5 minutes) to keep the "current program" indicator accurate during long viewing sessions.
