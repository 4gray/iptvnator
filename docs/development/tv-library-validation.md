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
NAS deployment and TV-to-NAS library playback remain pending until it is run.

## Real LG

Installed 0.1.9 on OLED55BX9LB / firmware 04.64.00 / Chromium 68. The new Settings
section renders and its URL input receives focus; its screenshot was visually
inspected. The existing source remains present and the Mac backend stays Connected.
No runtime exceptions or alerts occurred in this screen check. Inputs were operated
through the actual TV debugger, not a physical remote. No sample library or fabricated
history was installed on the television. This does not certify NAS connectivity,
physical-keyboard entry or cross-device viewing state.

Ignored evidence is in `dist/tv-verification/library-*.log`,
`library-container.json`, `lg-library-settings.json` and `lg-library-settings.png`.
The deployment bundle is under ignored `dist/tv-nas/`. A release note is included
in `.changes/tv-server-library.md`. No push, PR, paid CI or image publication occurs.
