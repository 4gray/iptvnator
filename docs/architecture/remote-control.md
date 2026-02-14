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

## Shared helpers

- File: `apps/web/src/app/shared/services/remote-channel-navigation.util.ts`

Functions:

- `getAdjacentChannelItem(...)`: wraps around on boundaries for up/down
- `getChannelItemByNumber(...)`: 1-based number to list item mapping

Used by M3U, Xtream, and Stalker live integrations.

## M3U integration

- File: `apps/web/src/app/home/video-player/video-player.component.ts`

Implemented behavior:

- Subscribes to:
  - `onChannelChange` (up/down)
  - `onRemoteControlCommand` (number + volume)
- Applies channel up/down by active channel URL over `channels$`
- Applies number select through existing `switchToChannelByNumber(...)`
- Applies volume commands:
  - up/down in 0.1 increments
  - toggle mute with last non-zero volume restore
  - persists to `localStorage`
- Publishes status snapshots via `updateRemoteControlStatus(...)`:
  - `portal: 'm3u'`
  - `isLiveView: true`
  - channel name/number
  - EPG now fields
  - `supportsVolume: true`, `volume`, `muted`
- Cleans listeners/subscriptions in `ngOnDestroy`.

## Xtream integration (live view)

- File: `apps/web/src/app/xtream-tauri/live-stream-layout/live-stream-layout.component.ts`

Implemented behavior:

- Subscribes to:
  - `onChannelChange` for up/down
  - `onRemoteControlCommand` for number select
- Up/down:
  - Uses selected live item `selectedItem().xtream_id`
  - Navigates inside `selectItemsFromSelectedCategory()`
  - Calls `playLive(nextItem)`
- Number select:
  - Maps number to item in current category list
  - Calls `playLive(channel)`
- Publishes status via effect:
  - `portal: 'xtream'`
  - `isLiveView` only when selected content type is `live` and item is selected
  - channel name/number + current EPG item
  - `supportsVolume: false`
- Cleans listeners in `ngOnDestroy`.

## Stalker integration (ITV live view)

- File: `apps/web/src/app/stalker/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`

Implemented behavior:

- Subscribes to:
  - `onChannelChange` for up/down
  - `onRemoteControlCommand` for number select
- Up/down:
  - Uses `selectedItem().id`
  - Navigates inside `itvChannels()`
  - Calls `playChannel(nextItem)`
- Number select:
  - Maps number into `itvChannels()`
  - Calls `playChannel(channel)`
- Publishes status via effect:
  - `portal: 'stalker'`
  - `isLiveView` only for selected content type `itv` with active item
  - channel name/number + current EPG item
  - `supportsVolume: false`
- Cleans listeners in `ngOnDestroy`.

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
  - `apps/web/src/app/settings/settings.component.ts`
  - `apps/web/src/app/settings/settings.component.html`
- Features:
  - Toggle `remoteControl`
  - Configure `remoteControlPort`
  - Display local URLs and QR codes for remote access
  - Local IP list loaded via `getLocalIpAddresses()`

## Feature Matrix (Current)

| Capability | M3U | Xtream Live | Stalker ITV |
|---|---|---|---|
| Channel up/down | Yes | Yes | Yes |
| Number select | Yes | Yes | Yes |
| Status publish | Yes | Yes | Yes |
| Volume command handling | Yes | No | No |
| `supportsVolume` in status | true | false | false |

## Known limitations

- Volume commands are currently no-op in Xtream and Stalker integrations.
- Remote status uses polling from web UI (2s), not push/WebSocket.
- Number-based selection is list-position based (1-based index in active list scope), not global EPG number mapping.
- Remote API currently has no auth/TLS; intended for trusted local networks.

## Operational notes

- UI updates in remote web app require rebuilding `remote-control-web` so Electron serves fresh `dist` assets.
- If stale UI appears, clear browser cache/hard-refresh mobile browser.

## Future extension points

- Add optional auth token for `/api/remote-control/*` endpoints.
- Add WebSocket/SSE status push for lower latency and reduced polling.
- Add cross-portal volume abstraction and capability negotiation.
- Add last-channel, favorites navigation, and search/select commands.
