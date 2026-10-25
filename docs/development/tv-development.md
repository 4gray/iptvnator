# TV development and validation

Use `.nvmrc` (Node 22.23.2) and the repository pnpm version. Install frozen
worktree dependencies before Nx discovery. The [TV architecture](../architecture/tv-application.md)
is the canonical runtime/provider/persistence contract.

```sh
pnpm nx serve tv
pnpm nx build tv-setup # needed before launching backend source directly
CLIENT_URL=http://localhost:4310 PORT=3333 IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1 TSX_TSCONFIG_PATH=tsconfig.base.json node --import tsx apps/web-backend/src/main.ts
pnpm nx run tv-setup:typecheck
pnpm nx run tv:typecheck
pnpm nx run tv-tests:typecheck
pnpm nx run tv-e2e:typecheck
pnpm nx test tv
pnpm nx run-many -t lint -p tv,tv-setup,tv-feature,tv-ui,tv-data-access,tv-util,tv-tests,tv-e2e,web-backend
pnpm nx e2e tv-e2e
pnpm nx run tv:package
```

The app serves on port 4310. Configure the backend origin explicitly; the
existing backend development target permits localhost:4200 by default, so for
TV development set `CLIENT_URL=http://localhost:4310` (or the exact origin used
on your LAN) when starting the backend process. The URL entered on the TV must
name a host reachable from the TV; `localhost` means the television itself.
LAN/private targets require the backend's documented private-network opt-in.

`tv-e2e` owns isolated ports 4311, 3433, 3420 and 3421. It starts the built TV
client, actual web backend, and existing Stalker/Xtream mocks. Its explicit Nx
dependencies include these projects and the phone setup application. Provider catalog/auth/EPG requests go
through the actual backend. The isolated test backend also permits the `null`
Origin for the packaged `file://` connection test; a real deployment must allow
the actual TV app Origin explicitly. Synthetic media is local WebM, redirected from
mock stream addresses. These tests verify application behavior and native
HTML-video lifecycle in modern Playwright Chromium. They do not validate the
BX's Chromium 68 engine, native HLS, transport stream decoding or MAG headers.
`tv-playlist.m3u` and `tv-test-media.webm` are local mock-server fixtures only.

The package target produces
`dist/tv-package/com.iptvnator.tv.prototype_0.1.2_all.ipk` with the pinned webOS
CLI. Inspect it with:

```sh
pnpm exec ares-package -i dist/tv-package/com.iptvnator.tv.prototype_0.1.2_all.ipk
pnpm exec ares-setup-device --list
```

Only after the user supplies an enabled Developer Mode target and pairing:

```sh
pnpm exec ares-install --device <configured-device> dist/tv-package/com.iptvnator.tv.prototype_0.1.2_all.ipk
pnpm exec ares-launch --device <configured-device> com.iptvnator.tv.prototype
```

Do not root, wake, reconfigure or pair a television without appropriate scope.
Do not copy unrelated credentials into fixtures or diagnostic scripts.

## Add sources from a phone

Install the matching TV and backend builds. `pnpm nx build web-backend` first
builds `tv-setup` and copies its assets into `dist/apps/web-backend/tv-setup`;
ship that directory alongside `main.cjs`. Nx serve/test targets also build the
phone assets. Direct `node --import tsx` launches need the explicit build above.
For a packaged TV, allow `file://com.iptvnator.tv.prototype-webos` in `CLIENT_URL`.

Sources automatically looks for a backend if none is saved. Settings and Sources
also expose Find backend, manual URL/token entry, and a verified connection
indicator. A Docker/reverse-proxy address can include `/api`; QR form assets and
requests resolve relative to that backend prefix. See the architecture contract
for discovery limits. Discovery does not start or install a backend.

After connection, select Add from phone, scan the QR on the same home network,
choose M3U/Xtream/Stalker, and submit. Confirm Add source on the TV. The phone
reports success only after TV storage commits. Closing the TV setup cancels the
link; expired links require a fresh QR. Reloading the phone page also requires
rescanning because its temporary capability is held only in memory.

## TMDB setup

In Settings > Metadata · TMDB, enable metadata, enter your own v3 API key or
v4 read access token, choose a language, optionally check the key, then save.
No real key is bundled or needed by automated tests. Home's featured title and
movie/series details gain artwork and descriptions; catalog rows, live channels
and episode metadata remain provider-owned. Errors leave provider content usable.
The TV browser must reach `api.themoviedb.org` and `image.tmdb.org` directly.

## Hardware update on 2026-10-25

The user enabled Developer Mode and supplied the pairing passphrase. The CLI
target `iptvnator-lg-bx` now connects to `192.168.178.44:9922` as `prisoner`.
System information confirms OLED55BX9LB, SDK 5.6.2 and firmware 04.64.00.
Prototype 0.1.1 (revision `845dd7af3bfe59391fc885d9e715cd13320cdb3e`) installed
and launched successfully. Its IPK SHA-256 is
`271ec54220bd99cb2c4ab3464c3d961a5d6418892aeed408d48c2a660aca8a93`.

The actual TV debugger reports Chrome 68.0.3440.106, a 1920×1080 viewport,
rendered Sources/Add a source headings, one native video element and zero
visible alert elements. The first-launch screenshot was visually inspected
and saved locally at `dist/tv-verification/lg-first-launch.png`. Several menu
Unicode icons show missing-glyph squares on this device; this remains a UI
follow-up, resolved by SVG icons in the [0.1.2 report](tv-phone-validation.md).
No provider credentials or backend were configured during this
installation. This verifies installation and first-screen rendering, not
physical remote operation, provider/media playback, cold relaunch persistence
or TMDB connectivity. The remaining checklist below still applies.

## Hardware status on 2026-10-21

Device: LG OLED55BX9LB, firmware 04.64.00, previously discovered at
`lgwebostv.fritz.box` / `192.168.178.44`. Read-only TCP checks for ports 9922,
9998, 3000 and 3001 all timed out. `ares-setup-device --list` contains only the
standard local emulator, with no paired TV. No install, launch, pairing, power
or settings operation was attempted. Hardware verification remains pending.

Record device firmware, tested local commit and results for each of:

- IPK installation and cold launch from the normal launcher.
- Real remote arrows/OK/461 Back and Magic Remote pointer, focus and page
  restoration, text entry and root Back returning to the system launcher.
- Xtream/Stalker/M3U direct catalog probes independently from media probes.
- Real Live HLS and MPEG-TS: picture, audio, channel changes and preview/fullscreen.
- Movie and each series mode: picture/audio, seek, pause/resume and Back.
- Same-host gated Stalker media and tokenized foreign-host links; distinguish
  unsupported header requirements from authentication or codec failures.
- Source/favorite/position persistence after closing and cold relaunching the app.
- Network loss, unavailable backend, invalid/expired credentials, empty catalogs,
  unsupported streams and local storage exhaustion.

Product completion and device readiness must be reported separately. XMLTV,
DRM, downloads, synchronization, autostart, Home takeover and transcoding
are outside the approved MVP.

## Implementation verification

The [dated verification report](tv-validation.md) records completed local checks,
the remaining Angular Stalker Escape failure, and the separate hardware gate.

The [backdrop and TMDB follow-up report](tv-metadata-validation.md) records the
0.1.1 package checks separately from the original MVP and real LG validation.

The [phone setup and discovery report](tv-phone-validation.md) records the
0.1.2 package checks and their separate real-device results.
