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
- Channel rows read the bulk cache first. The bulk EPG load is triggered
  **eagerly when a category's channels first render** (a constructor effect in
  `StalkerLiveStreamLayoutComponent` calls `ensureBulkItvEpg(168)` once ITV
  channels are present) — not only after the first channel is played — so the
  row "now playing" previews and the EPG panel populate immediately. Rows derive
  their current program and progress bar from the cached bulk map; rows the
  settled bulk guide cannot answer fall back to throttled per-channel
  `get_short_epg` through `StalkerEpgPreviewQueue` (see "Channel row preview
  flow").
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

### `get_short_epg` (active-panel and row-preview fallback)

**Request**

```text
GET load.php?type=itv&action=get_short_epg&ch_id={channel_id}&size={n}&JsHttpRequest=1-xml
```

**Current usage**

- Active panel fallback path: `size=10`
- Row-preview fallback queue: `size=3` (`EPG_PREVIEW_FETCH_SIZE`)

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
- Two fallback consumers use this path and map the result into controlled
  `EpgProgram[]`: the active-panel fallback and the throttled row-preview
  queue (both only when the bulk guide cannot answer "what's on now")

### `get_epg_info` (bulk row-preview and active-panel source)

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

The short EPG path serves the two fallback flows: the active panel and the
throttled row-preview queue.

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
3. The component ensures `ensureBulkItvEpg(168)` has run; the eager row effect
   normally started the same de-duplicated request before playback
4. `selectedItvEpgPrograms()` merged with the short-EPG fallback feeds
   `app-epg-timeline` (`mergeEpgProgramLists`; bulk wins an exact start-time
   collision)
5. The component falls back to `get_short_epg` whenever the bulk list cannot
   answer "what's on now" — because it is empty **or** because it only carries
   future programmes (some portals' `get_epg_info` omits the currently airing
   one). The fallback fills the gap; the bulk data keeps providing the days
   ahead.

The active panel no longer uses local EPG pagination or a "Load more" button.
When Stalker live TV is playing through an internal player, the active panel is
wrapped in the shared collapsible live EPG panel. The collapsed/expanded state
uses the shared `live-epg-panel-state` preference and is only applied after a
stream URL has been resolved; external playback keeps the full EPG-only panel.

### Channel row preview flow

Once non-radio ITV channels render, the post-reset component effect calls
`ensureBulkItvEpg(168)`. It starts eagerly before playback and is de-duplicated
against the active-channel path. As soon as the bulk request completes, visible
row previews derive locally from `bulkItvEpgByChannel`:

- pick the current program for the channel, if one exists
- compute progress from the cached program timestamps

Rows the bulk guide cannot answer fall back to per-channel `get_short_epg`
through `StalkerEpgPreviewQueue`
(`stalker-live-stream-layout/stalker-live-epg-preview.ts`), mirroring the
Xtream `EpgQueueService`: the queue only starts after the bulk request has
settled (so it never races the answer it is a fallback for), fetches the
currently rendered channels with bounded concurrency and inter-request
spacing, caches results — including empty ones — for five minutes, and is
reset on playlist switch because channel ids are only unique per portal.
Each sync's backlog is additionally capped (30 channels, top of the list
first) and the sidebar's scroll handler re-syncs (throttled) to fill the
next gaps, so request count tracks how far the user actually scrolls rather
than how many rows are rendered. Channels with a manual XMLTV mapping are
excluded from the fallback entirely — their bulk record holds the mapped
schedule, and the portal short EPG must not stand in for the data the
mapping deliberately replaces. Because a fetch can be enqueued before the
mapping lookup resolves, the queue's completion callback revalidates
ownership: a row claimed in the meantime by a mapping override or by bulk
data is never overwritten by the late portal response. Mapping ownership is
a fact of the saved mapping row, independent of whether the mapped guide
currently has programs — an empty mapped guide still keeps the portal EPG
out. Ownership changes are published reactively (`applyMappedItvEpg`
re-patches the bulk record even when the mapped guide contributed nothing),
so a fallback row rendered before the mapping lookup finished is removed by
the rerun sync. The backlog is superseded whenever the rendered list empties (a
legacy-paged category switch) or the view leaves ITV (radio), so abandoned
rows stop consuming portal request capacity.

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
- the selected channel has no **currently airing** program in the cached bulk
  map — a bulk list of future-only programmes is treated as incomplete, not as
  an answer

The fallback is merged with the bulk list rather than replacing it, so the
panel shows "now" from the short EPG and the days ahead from the bulk guide.

The fallback is keyed to the selected channel, not to the category: a category
switch in the sidebar leaves the channel playing and keeps its fallback (and a
fallback load still in flight) intact. It is dropped when the selection moves
to another channel or when the view leaves ITV for radio, where the route
session clears the selection.
The stored fallback is tagged with the channel it was fetched for and the
merge only applies while that channel is still selected — a channel switch
moves the selection synchronously, while the old fallback is replaced only
after the new channel's EPG load runs, so an unscoped merge would leak the
previous channel's programmes into the new panel during (or after a failed)
playback resolution.
Row previews use the same per-channel fallback through the throttled
`StalkerEpgPreviewQueue` once the bulk request has settled (see "Channel row
preview flow").

Manually mapped channels never take the portal fallback, on either path: the
component resolves the channel's mapping before falling back
(`applyMappedItvEpg` for the one id, then
`hasItvEpgMappingOverride`) and keeps mapped channels on their mapped
schedule even when it has no currently airing entry — the mapping exists to
replace the portal EPG, so portal data must not be merged back in.

## Manual EPG Mapping

Stalker channels carry no XMLTV identifier, so when the portal's own EPG is
missing or wrong the only uploaded-EPG entry point is a **manual mapping**:
right-click a channel in the ITV sidebar (or in global favorites) and pick
"Map EPG channel" to attach it to a channel from an uploaded XMLTV guide.

- Mappings are stored in the shared `epg_channel_mappings` table under the
  playlist-scoped key `stalker:{playlistId}:{channelId}`
  (`buildStalkerEpgMappingKey` in
  `libs/shared/interfaces/src/lib/epg-mapping-key.util.ts`).
- `withStalkerEpg().applyMappedItvEpg(channelIds)` batch-resolves mappings
  (one `getEpgMappingsBatch` IPC per new id set) and overlays the mapped
  XMLTV programs onto `bulkItvEpgByChannel`, so both the active panel and
  the row previews pick them up with no template changes. Overrides are
  re-merged whenever `ensureBulkItvEpg` replaces the bulk record and are
  re-checked after the mapping dialog closes with a change.
- The collection views (global favorites/recent) resolve the same keys in
  `StreamResolverService` (`loadStalkerEpgItems` for the detail panel,
  `loadStalkerEpgBatch` + `prefetchEpgMappings` for row previews).
- Everything is gated behind `supportsEpgMapping`, so the PWA never shows
  the menu entry.

## Future Enhancements

- add cache refresh / invalidation for long-running live sessions
- add Stalker catch-up support to `app-epg-timeline` once the playback flow exists
- optionally add category-level prefetch timing metrics for bulk EPG
