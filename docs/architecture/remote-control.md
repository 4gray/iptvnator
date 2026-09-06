# Remote Control Architecture

This document describes the current remote control implementation in IPTVnator, including:

- HTTP API exposed by Electron main process
- IPC bridge between Electron main and Angular renderer
- Feature support and integration points for M3U, Xtream, and Stalker
- Remote web UI structure and behavior

Related architecture docs:

- [Stalker Portal Architecture](./stalker-portal.md)
- [Stalker Portal EPG Architecture](./stalker-epg.md)

## Scope

Remote control is a desktop-only feature that serves a mobile-friendly web app from the Electron backend and routes remote actions into the running renderer.

Current capabilities:

- Channel up / down
- Channel select by number
- Volume commands (implemented in command layer; active support currently in M3U flow)
- Playback status polling (portal, live-state, channel name/number, EPG now, volume capability)

## High-Level Flow

1. User opens remote web UI (`http://<local-ip>:<port>`).
2. Remote web app calls `/api/remote-control/*`.
3. Electron main handles API request and sends IPC to renderer:
    - `CHANNEL_CHANGE` for up/down
    - `REMOTE_CONTROL_COMMAND` for numeric/volume commands
4. Renderer-specific feature module (M3U/Xtream/Stalker) applies action.
5. Renderer pushes status snapshots back to main via:
    - `REMOTE_CONTROL_STATUS_UPDATE`
6. Remote web app polls `/api/remote-control/status` and updates UI.

## Backend (Electron Main)

### HTTP server and static app hosting

- File: `apps/electron-backend/src/app/server/http-server.ts`
- Responsibilities:
    - Serves static remote app from:
        - dev: `dist/apps/remote-control-web/browser`
        - prod: `<appPath>/remote-control-web/browser`
    - Keeps every non-API request inside that configured static root: the request
      pathname is decoded once, malformed encoding and NUL bytes fail closed,
      and the platform-specific resolved path must remain the root or its
      descendant. Angular route fallback may serve only that root's `index.html`;
      it must never bypass the containment check.
    - Routes `/api/remote-control/*` to registered handlers.
    - Starts/stops/restarts on settings updates.

### Remote control event module

- File: `apps/electron-backend/src/app/events/remote-control.events.ts`
- Bootstrapped in: `apps/electron-backend/src/main.ts` via `RemoteControlEvents.bootstrapRemoteControlEvents()`

Registered endpoints:

- `POST /api/remote-control/channel/up`
- `POST /api/remote-control/channel/down`
- `POST /api/remote-control/channel/select-number` with `{ number: <int> }`
- `POST /api/remote-control/volume/up`
- `POST /api/remote-control/volume/down`
- `POST /api/remote-control/volume/toggle-mute`
- `GET /api/remote-control/status`

IPC emitted to renderer:

- `CHANNEL_CHANGE` payload: `{ direction: 'up' | 'down' }`
- `REMOTE_CONTROL_COMMAND` payload:
    - `{ type: 'channel-select-number', number }`
    - `{ type: 'volume-up' | 'volume-down' | 'volume-toggle-mute' }`

Status ingestion from renderer:

- Listens on `REMOTE_CONTROL_STATUS_UPDATE`
- Maintains in-memory `RemoteControlStatus` object returned by `/status`
- Live updates (`isLiveView: true` or unspecified) MERGE into the previous
  status, so partial pushes (e.g. the M3U volume-only update) keep the
  channel fields. A non-live update (`isLiveView: false`) is an
  AUTHORITATIVE RESET: only `portal` survives (the update's value, else the
  last known one), `supportsVolume` is forced to `false`, and every other
  now-playing field is dropped — even if a caller accidentally includes one.
  This keeps the remote from advertising a channel that stopped playing.

### Settings integration

- Main handler: `apps/electron-backend/src/app/events/settings.events.ts`
- On `SETTINGS_UPDATE`, reads `remoteControl` and `remoteControlPort`, persists to store, and calls:
    - `httpServer.updateSettings(enabled, port)`

## Preload Bridge

- File: `apps/electron-backend/src/app/api/main.preload.ts`

Exposed APIs relevant to remote control:

- `onChannelChange(callback) => unsubscribe`
- `onRemoteControlCommand(callback) => unsubscribe`
- `updateRemoteControlStatus(status) => void`

Type definitions:

- `apps/web/src/typings.d.ts`
- `global.d.ts`

## Renderer Integrations

All renderer integrations resolve the Electron remote-control bridge through
`RuntimeCapabilitiesService.supportsRemoteControl`. A partial Electron bridge
is treated as unsupported unless it exposes all remote-control methods:
`updateRemoteControlStatus`, `onChannelChange`, and
`onRemoteControlCommand`. This keeps PWA/self-hosted builds and partial test
bridges from accidentally activating desktop-only remote-control behavior.

Every integration publishes the shared reset snapshot
(`REMOTE_CONTROL_RESET_STATUS` in
`libs/portal/shared/util/src/lib/remote-channel-navigation.ts`:
`{ portal: 'unknown', isLiveView: false, supportsVolume: false }`) in its
`ngOnDestroy`/destroy hook, so leaving a live surface always clears the
remote UI instead of freezing the last channel on it. The M3U player also
publishes it when the active channel is cleared IN PLACE (e.g. quitting an
external MPV/VLC session dispatches `resetActiveChannel` while the route
stays mounted).

## Live channel return and playback order

Xtream and Stalker live views keep a component-owned playback queue through
`LiveChannelPlaybackQueue` in `portal-shared-data-access`. Explicit selection
captures the actual displayed order, including search/sort and a fullscreen
panel's own filter. Remote up/down, numeric selection and the published channel
number use that queue while category or search browsing remains independent.
Same-channel replay and remote selection preserve it. Source/type changes and
view destruction discard it; ITV and radio never share an owner.

Stalker captures before asynchronous URL resolution and commits only the winning
successful request. Paged lists extend the queue only as more rows arrive for
the original category and search scope. They do not fetch a global catalog for
remote navigation. Xtream excludes removed streams and hidden or removed
categories from eligible queue entries.

A conditional **Show playing channel** icon in the channel header appears when
the playing channel is absent from the browsed results and its category remains
accessible. It clears `q` and the store query, returns to that category, expands
the sidebar, then scrolls and focuses the playing row. It never starts playback
or changes the playback/session/catchup identity. A collapsed sidebar first uses
its existing restore action. Removed categories are not recreated or unhidden.
Stalker reuses the already-resolved playing item as a temporary normal row when
it lies beyond loaded provider pages. This row is deduplicated once it arrives
in provider results and discarded on browsing or playback changes; returning
never crawls the catalog. Raw provider rows alone extend the playback queue.

## Shared helpers

- File: `libs/portal/shared/util/src/lib/remote-channel-navigation.ts`

Functions:

- `getAdjacentChannelItem(...)`: wraps around on boundaries for up/down
- `getChannelItemByNumber(...)`: 1-based number to list item mapping

Used by the M3U, Xtream, and Stalker live integrations and the unified live
tab (collections).

- File: `libs/portal/shared/util/src/lib/favorites-channel-sort.ts`

`deriveVisibleFavoriteChannels(...)` computes the search-filtered,
mode-conditionally sorted list a collection surface renders. The global
favorites list and the unified live tab's remote navigation both call it, so
the remote's channel order and numbering can never diverge from the rendered
rows.

## M3U integration

- File: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.ts`

Implemented behavior:

- Subscribes to:
    - `onChannelChange` (up/down)
    - `onRemoteControlCommand` (number + volume)
- Applies channel up/down by active channel URL over `channels$`
- Applies number select through existing `switchToChannelByNumber(...)`
- Dispatches remote channel changes as explicit playback requests so MPV/VLC starts immediately even when mouse channel rows require double-click before external playback.
- Applies volume commands:
    - up/down in 0.1 increments
    - toggle mute with last non-zero volume restore
    - persists to `localStorage`
    - propagates to built-in inline players: Video.js, HTML5, ArtPlayer, and radio `AudioPlayerComponent`
    - does not control external MPV/VLC sessions or the experimental Embedded MPV player; while one of those is the effective player, volume commands are a deliberate no-op (`isRemoteVolumeSupported`) instead of silently mutating the stored web-player volume
- Publishes status snapshots via `updateRemoteControlStatus(...)`:
    - `portal: 'm3u'`
    - `isLiveView: true`
    - channel name/number
    - EPG now fields
    - `supportsVolume` reflects the EFFECTIVE playback: `true` for built-in inline playback (radio audio, the DASH-forced web player, HTML5/Video.js/ArtPlayer), `false` while MPV/VLC or Embedded MPV owns the audio. `isRemoteVolumeSupported` checks in order: radio first (its inline audio element is always mounted, so it stays controllable even past a lingering external session), then a live external session (covers both a diagnostic-recovery "Open in MPV/VLC" launch while a web player remains configured AND the managed clear-DASH fallback after Shaka's browser-support preflight fails — the session check must precede the DASH shortcut), then the DASH-forced inline player, then the configured player setting. An effect republishes the capability when the session starts or ends. The remote UI disables its volume buttons on `false`
    - `volume`, `muted`
- Cleans listeners/subscriptions and publishes the reset snapshot in `ngOnDestroy`.

## Xtream integration (live view)

- File: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.ts`

Implemented behavior:

- Subscribes to:
    - `onChannelChange` for up/down
    - `onRemoteControlCommand` for number select
- Up/down:
    - Uses selected live item `selectedItem().xtream_id`
    - Navigates inside the captured eligible playback queue
    - Calls `playLive(nextItem, true)` so remote actions explicitly start playback
- Number select:
    - Maps number to item in the same captured eligible queue
    - Calls `playLive(channel, true)` so remote actions explicitly start playback
- Publishes status via effect:
    - `portal: 'xtream'`
    - `isLiveView` only when selected content type is `live` and item is selected
    - channel name/number + current EPG item
    - `supportsVolume: false`
- Cleans listeners and publishes the reset snapshot in `ngOnDestroy`.

## Stalker integration (ITV live view)

- File: `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`

Implemented behavior:

- Subscribes to:
    - `onChannelChange` for up/down
    - `onRemoteControlCommand` for number select
- Up/down:
    - Uses `selectedItem().id`
    - Navigates inside the captured ITV/radio playback queue
    - Calls `playChannel(nextItem, true)` so remote actions explicitly start playback
- Number select:
    - Maps number into the same captured playback queue
    - Calls `playChannel(channel, true)` so remote actions explicitly start playback
- Publishes status via effect:
    - `portal: 'stalker'`
    - `isLiveView` for selected content type `itv` OR `radio` with an active
      item — the radio route reuses this layout and its remote handlers, so
      it reports live status too (channel numbering follows the radio list).
      EPG fields are published for `itv` ONLY: `selectedItvEpgPrograms` is
      fed by the ITV-keyed bulk cache, which survives itv→radio navigation,
      and Ministra assigns small integer ids to itv and radio independently
      — a radio id routinely collides with an unrelated TV channel. The
      index comparison uses `normalizeStalkerEntityId`, because radio ids
      (`radio-1`) are not numeric.
    - channel name/number + current EPG item
    - `supportsVolume: false`
- Cleans listeners and publishes the reset snapshot in `ngOnDestroy`.

## Unified live tab integration (favorites / recent / global collections)

- Files:
    - `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab-remote-control.ts`
      (`setupUnifiedLiveTabRemoteControl`, called from the tab's constructor)
    - `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.ts`

One integration covers every collection surface that plays live TV inline
without routing to a portal live layout:

- M3U favorites/recent (`/workspace/playlists/:id/favorites|recent`)
- Xtream favorites/recent (`/workspace/xtreams/:id/favorites|recent`)
- Stalker favorites/recent (`/workspace/stalker/:id/favorites|recent`)
- Global favorites/recent (`/workspace/global-favorites`, `/workspace/global-recent`)
- Dashboard live clicks, which land on those collection routes with an
  auto-open item

Implemented behavior:

- Channel up/down and number select navigate `visibleChannels()` — the
  search-filtered, mode-conditionally sorted list derived by the same
  `deriveVisibleFavoriteChannels` helper the rendered sidebar uses
- Remote actions play via the same path as an explicit double-click
  (`activateItem(item, false, true)`), so external MPV/VLC starts
  immediately
- Publishes status via effect:
    - `portal` is the ACTIVE item's `sourceType` (`m3u` / `xtream` /
      `stalker`) — a mixed global collection reports whichever source is
      playing
    - `isLiveView: true` once a selection has resolved playback
    - channel name, visible-list channel number, and the current EPG summary
      (timeshift-aware)
    - `supportsVolume: false` (the collections player does not expose a
      remote-controllable volume yet)
- Publishes the reset snapshot when nothing is playing and on destroy;
  unsubscribes both command listeners on destroy.

## Remote Web App

### App shell

- App: `apps/remote-control-web/src/app/app.ts`
- Template: `apps/remote-control-web/src/app/app.html`
- Style: `apps/remote-control-web/src/app/app.scss`
- Renders shared library component: `<lib-remote-control />`

### Shared remote UI library

- Component:
    - `libs/ui/remote-control/src/lib/remote-control/remote-control.component.ts`
    - `libs/ui/remote-control/src/lib/remote-control/remote-control.component.html`
    - `libs/ui/remote-control/src/lib/remote-control/remote-control.component.scss`
- Service:
    - `libs/ui/remote-control/src/lib/remote-control/remote-control.service.ts`

Implemented UI behavior:

- Channel pad (`CH+`, `CH-`)
- Numeric keypad (`0-9`, `DEL`, `CLR`, `OK`)
- Volume controls (`VOL-`, `MUTE/UNMUTE`, `VOL+`)
- Status card (portal, channel name/number, current program)
- Polls `/status` every 2s
- Uses action wrapper to refresh status after command execution

## Settings UI and discoverability

- Files:
    - `apps/web/src/app/settings/settings-remote-control-section.component.ts`
      (+ `.html`) — the section rendered by `settings.component.html`
    - `apps/web/src/app/settings/settings-remote-control.facade.ts` — LAN
      address lookup and QR-code visibility state
- Features:
    - Toggle `remoteControl`
    - Configure `remoteControlPort`
    - Display local URLs and QR codes for remote access
    - Local IP list loaded via `getLocalIpAddresses()`

## Feature Matrix (Current)

| Capability                 | M3U player                            | Xtream Live | Stalker ITV/Radio | Collections (favorites/recent/global) |
| -------------------------- | ------------------------------------- | ----------- | ----------------- | ------------------------------------- |
| Channel up/down            | Yes                                   | Yes         | Yes               | Yes                                   |
| Number select              | Yes                                   | Yes         | Yes               | Yes                                   |
| Status publish             | Yes                                   | Yes         | Yes               | Yes                                   |
| Status reset on leave      | Yes                                   | Yes         | Yes               | Yes                                   |
| Volume command handling    | Yes, for built-in inline playback     | No          | No                | No                                    |
| `supportsVolume` in status | true only for built-in inline players | false       | false             | false                                 |

Navigation scope differs by surface: the M3U player navigates the FULL
playlist (its sidebar always renders the full list), Xtream/Stalker navigate
the currently filtered category list, and the collections tab navigates the
search-filtered, sorted collection exactly as rendered.

## Known limitations

- Volume commands are currently no-op in Xtream, Stalker, and collection
  integrations; in the M3U player they are no-op while MPV/VLC or Embedded
  MPV owns the audio.
- Remote status uses polling from web UI (2s), not push/WebSocket.
- Number-based selection is list-position based (1-based index in active list scope), not global EPG number mapping (`tvg-chno` is not consulted).
- Remote API currently has no auth/TLS; intended for trusted local networks.

## Operational notes

- UI updates in remote web app require rebuilding `remote-control-web` so Electron serves fresh `dist` assets.
- If stale UI appears, clear browser cache/hard-refresh mobile browser.

## Future extension points

- Add optional auth token for `/api/remote-control/*` endpoints.
- Add WebSocket/SSE status push for lower latency and reduced polling.
- Add cross-portal volume abstraction and capability negotiation.
- Add last-channel, favorites navigation, and search/select commands.
