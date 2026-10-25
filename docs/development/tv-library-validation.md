# TV server source library validation

Date: 2026-10-25. TV package: 0.1.9.

Settings adds an independently configured server source library. Sources use the
existing PWA `/v1` API, with public instance verification before authentication,
create-only explicit copies and an atomic local cache. Shared favorites/history/
progress and Electron server mode are not implemented by this change.

## Local checks

Node 22.23.2 and pnpm 10.33.0; installed lockfile comparison and Nx discovery.
46 TV unit tests pass, including source identity preservation, MAG credentials,
full/simple mode, device-local tokens, stored M3U playback, server replacement,
create-only copies and conflicting IDs. The four existing PWA migration-plan tests
pass after its pure source identity helper is moved to shared interfaces.

A full browser run passes all 55 scenarios. Four library scenarios then pass in a
separate targeted run after adding the late-reply playback/disconnect guard. They
use a real isolated server-storage backend, all three provider mocks and a stored
M3U payload. Checks include provider browsing, cache relaunch, server rename,
authentication failure, offline reads, replaced instance without credential
forwarding, explicit upload, deletion recovery and stale replies. The native VOD
fixture verifies that a pending library response does not interrupt playback.
Existing navigation helpers now wait for the source form to leave and scheduled
navigation frames; visual/scroll assertions wait for their first rendered card.

TV/test/E2E typing and affected lint pass. Release notes, guidance, skills, focus
rings, stylesheet inputs, font weights and whitespace checks pass. No dependencies,
project tags or boundary rules changed. Production classic-script/ES2018 verification
and IPK packaging pass. Electron E2E is not run: Electron runtime/storage is unchanged.

## Companion container

The Linux amd64 image builds locally, using the pinned existing PWA runtime and
matching bundled TV backend. A second disposable container using the deployed
NAS image serves as the test library. Real HTTP checks verify TV discovery,
instance lookup, 401 without a token, authenticated reads, create-only PUT with
412 on replacement, preflight, denied DELETE and the CORS origin allowlist.
No real NAS library records are read into diagnostic files or changed by these tests.

The existing Synology container is healthy but lacks TV routes. Its internal
Docker network is available. Deployment uses a separate Compose project and
connects to the existing service over that network; no existing database volume
is mounted or copied. The SSH account has read-only passwordless Docker access;
installation therefore needs the user's administrator command on the NAS.
The prepared installer verifies package hashes before loading/starting the image.
The user completed that administrator installation on 2026-10-25. The companion
`iptvnator-tv:0.1.9` on port 4335 and the original PWA on port 4333 are both healthy.
Health, TV discovery, connection check and library instance endpoints return 200;
TV-origin CORS is present. The phone setup HTML also returns 200.

## Real LG

Installed 0.1.9 on OLED55BX9LB / firmware 04.64.00 / Chromium 68. The new Settings
section renders and its URL input receives focus; its screenshot was visually
inspected. The existing source remains present and the Mac backend stays Connected.
No runtime exceptions or alerts occurred in this screen check. Inputs were operated
through the actual TV debugger, not a physical remote. No sample library or fabricated
history was installed on the television.

After NAS installation, the actual LG Settings UI saved
`http://nas.fritz.box:4335/api` as backend and
`http://nas.fritz.box:4335/library` as library. Both report Connected. Two server
sources were downloaded, alongside the original local source (three total).
Original source IDs and active selection were preserved; the complete serialized
favorites/history/positions remained equal before and after connection (five each).
Only counts and equality results were recorded, not source credentials.

The active Stalker source loaded 28 visible movie cards, 11 visible category rows
and 14 visible channel rows. Actual TV network responses from the NAS provider
proxy and library endpoints were 200. Home displayed 12 cards without a retry
banner. Phone setup generated a QR session on the TV and cancellation succeeded;
no phone submission or scan was performed in this pass.

Closing and launching the installed app with webOS CLI preserved both NAS URLs,
all three sources and viewing-data counts; backend and library reconnected with
no alerts or runtime exceptions. The TV was left on Home. These checks confirm
NAS catalog/library connectivity, not native media playback, physical-remote
entry, each imported M3U source's reachability or cross-device viewing state.
The temporary Mac backend was left running as a fallback; the TV now uses NAS.

Ignored evidence is in `dist/tv-verification/library-*.log`,
`library-container.json`, `lg-library-settings.json`, `lg-library-settings.png`
and `lg-nas-*.json/png`.
The deployment bundle is under ignored `dist/tv-nas/`. A release note is included
in `.changes/tv-server-library.md`. No push, PR, paid CI or image publication occurs.
