# Stalker Portal EPG Architecture

This document describes the current EPG implementation for Stalker/Ministra ITV
channels in IPTVnator.

Related architecture docs:

- [Stalker Portal Architecture](./stalker-portal.md)
- [Remote Control Architecture](./remote-control.md)

## Overview

Stalker now uses two EPG paths with different purposes:

- The active channel EPG panel uses `get_epg_info` as a bulk endpoint, fetches a
  7-day window once per playlist session, caches programs by channel id, and
  renders the selected channel through the shared `app-epg-timeline` component.
- Channel rows never send per-row EPG requests. The bulk EPG load is triggered
  **eagerly when a category's channels first render** (a constructor effect in
  `StalkerLiveStreamLayoutComponent` calls `ensureBulkItvEpg(168)` once ITV
  channels are present) — not only after the first channel is played — so the
  row "now playing" previews and the EPG panel populate immediately. Rows derive
  their current program and progress bar from the cached bulk map.
  - Effect ordering matters: the eager-EPG effect is registered **after** the
    playlist-change effect that calls `clearBulkItvEpgCache()`. On a portal
    switch the cache is cleared first and then refilled; if the order is
    reversed the clear clobbers the just-loaded bulk EPG on initial render.
  - `ensureBulkItvEpg` de-duplicates (via `isLoadingBulkItvEpg` /
    `bulkItvEpgLoaded` + matching playlist/period), so the eager trigger and the
    play-time `loadEpgForChannel` path never double-fetch.
- If a portal does not return usable bulk data for the selected channel, the
  active panel falls back to `get_short_epg`.

This keeps the live list cheap while giving the active panel the same
date-navigator UI used in the M3U/Xtream flows.

## Architecture

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                 StalkerLiveStreamLayoutComponent                          │
│  libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/         │
│                                                                            │
│  sidebar rows                    active channel panel                      │
│  ────────────                    ───────────────────                      │
│  row preview map                 playChannel()                             │
│  from bulk cache                 │                                          │
│         │                        ▼                                          │
│         │                  ensureBulkItvEpg(168)                           │
│         │                  selectedItvEpgPrograms()                        │
│         ▼                        │                                          │
│  current program preview         ├── bulk hit → app-epg-timeline               │
│  after first bulk load           └── empty/unsupported → short fallback    │
└────────────────────────────────────────────────────────────────────────────┘
                   │                                │
                   ▼                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           with-stalker-epg.feature                         │
│                                                                            │
│  bulkItvEpgByChannel: Record<string, EpgProgram[]>                         │
│  bulkItvEpgPlaylistId / bulkItvEpgPeriodHours / bulkItvEpgLoaded           │
│  ensureBulkItvEpg()  selectedItvEpgPrograms()                              │
└────────────────────────────────────────────────────────────────────────────┘
                   │                                │
                   ▼                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                            Stalker Portal API                              │
│                                                                            │
│  action=create_link      action=get_short_epg      action=get_epg_info     │
└────────────────────────────────────────────────────────────────────────────┘
```

## Stalker EPG API

### `get_short_epg` (active-panel fallback)

**Request**

```text
GET load.php?type=itv&action=get_short_epg&ch_id={channel_id}&size={n}&JsHttpRequest=1-xml
```

**Current usage**

- Active panel fallback path: `size=10`

**Response**

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
                "stop_timestamp": "1736951400"
            }
        ]
    }
}
```

**Notes**

- The response is normalized into shared `EpgItem[]`
- The list-preview path uses this directly
- The active-panel fallback maps the result into controlled `EpgProgram[]`

### `get_epg_info` (bulk active-panel source)

**Request**

```text
GET load.php?type=itv&action=get_epg_info&period={hours}&JsHttpRequest=1-xml
```

**Current usage**

- Fetched once with `period=168`
- Scoped to the current playlist session
- Not refetched on active-channel change

**Expected response**

```json
{
    "js": {
        "data": {
            "45": [
                {
                    "id": "1",
                    "name": "Program Title",
                    "descr": "Program description",
                    "time": "2025-01-15 14:00:00",
                    "time_to": "2025-01-15 16:00:00",
                    "start_timestamp": "1736949600",
                    "stop_timestamp": "1736956800"
                }
            ]
        }
    }
}
```

**Notes**

- The store supports the channel-keyed bulk shape above as the primary contract
- For weak or mock-style portals that still return array-style data, the store
  treats the result as compatibility input and leaves the short-EPG fallback path
  available

## Data Mapping

### Fallback data (`get_short_epg`) → `EpgItem`

The short EPG path now exists only for the active-panel fallback flow.

Key mapped fields:

| Stalker field     | `EpgItem` field   |
| ----------------- | ----------------- |
| `id`              | `id`              |
| `ch_id`           | `channel_id`      |
| `name`            | `title`           |
| `descr`           | `description`     |
| `time`            | `start`           |
| `time_to`         | `end`, `stop`     |
| `start_timestamp` | `start_timestamp` |
| `stop_timestamp`  | `stop_timestamp`  |

### Active panel data (`get_epg_info` / fallback) → `EpgProgram`

The active panel uses controlled `EpgProgram[]` because `app-epg-timeline` filters
and groups by day.

Normalization rules:

- `start` / `end` are converted to ISO strings
- `startTimestamp` / `stopTimestamp` are always populated
- Programs are sorted by start time per channel
- `selectedItvId` is used to project cached bulk data to the active channel

## Implementation Details

### Key files

| File                                                                                                                 | Purpose                                                         |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.ts`                                | bulk cache and fallback handling                                |
| `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`             | active-channel EPG loading and controlled `app-epg-timeline` wiring |
| `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.html`           | active panel template                                           |
| `libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.ts`                    | shared controlled EPG timeline with date navigator                  |

### Store API

The Stalker EPG feature exposes one bulk method plus the short-EPG fallback:

```ts
fetchChannelEpg(channelId: number | string, size?: number): Promise<EpgItem[]>
ensureBulkItvEpg(periodHours = 168): Promise<void>
```

It also exposes:

- `selectedItvEpgPrograms`
- `clearBulkItvEpgCache()`

Bulk state is keyed by playlist so cached results do not leak between Stalker
playlists.

### Active panel flow

1. User activates a live channel
2. The component ensures playback link resolution as before
3. The component calls `ensureBulkItvEpg(168)` on first use for the playlist
4. `selectedItvEpgPrograms()` feeds `app-epg-timeline`
5. If the selected channel has no bulk programs, the component falls back to
   `get_short_epg`

The active panel no longer uses local EPG pagination or a "Load more" button.
When Stalker live TV is playing through an internal player, the active panel is
wrapped in the shared collapsible live EPG panel. The collapsed/expanded state
uses the shared `live-epg-panel-state` preference and is only applied after a
stream URL has been resolved; external playback keeps the full EPG-only panel.

### Channel row preview flow

Before the first live-channel playback, channel rows do not fetch EPG at all.

After bulk EPG has been loaded once for the playlist, visible row previews are
derived locally from `bulkItvEpgByChannel`:

- pick the current program for the channel, if one exists
- compute progress from the cached program timestamps
- leave the row in its existing placeholder state when no current program exists

## Cache Lifecycle

- Bulk EPG is fetched once per playlist session
- Channel switches only read from `bulkItvEpgByChannel`
- The cache is cleared when the Stalker playlist changes
- This implementation does not add TTL-based refresh or background polling

## Authentication

EPG requests follow the standard Stalker request path:

| Portal type           | Auth path                                          |
| --------------------- | -------------------------------------------------- |
| Full Stalker portal   | `StalkerSessionService.makeAuthenticatedRequest()` |
| Simple Stalker portal | generic IPC request path via Electron              |

No EPG-specific backend transport was needed; the Electron Stalker request
handler forwards portal params directly.

## Fallback Behavior

Some providers do not implement `get_epg_info` consistently. The active panel
therefore falls back to `get_short_epg` when:

- the bulk request fails
- the bulk response is empty
- the selected channel has no programs in the cached bulk map

This keeps the panel usable even on limited portals, while still taking
advantage of the richer bulk API when it is available. Row previews do not
fallback to per-channel requests in this mode; they remain empty until bulk EPG
is available.

## Future Enhancements

- add cache refresh / invalidation for long-running live sessions
- add Stalker catch-up support to `app-epg-timeline` once the playback flow exists
- optionally add category-level prefetch timing metrics for bulk EPG
