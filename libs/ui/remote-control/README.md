# remote-control

UI library for the remote control web app.

## Scope

- Sends channel up/down commands to `/api/remote-control/channel/up|down`
- Sends direct number-based channel selection (`/channel/select-number`)
- Reads live playback status from `/api/remote-control/status`
- Sends volume commands (`/volume/up|down|toggle-mute`)
- Used for live channel navigation in:
- M3U playlists
- Xtream Live TV
- Stalker ITV

## Running unit tests

Run `nx test remote-control` to execute the unit tests.
