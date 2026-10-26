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

For continuous TV use, host the matching backend on an always-on machine rather
than an interactive agent/terminal process. A temporary detached process can
survive terminal exit but is not a supervised service: it does not restart after
a crash/reboot and is unavailable while the Mac sleeps. Do not silently install
boot/login services.

The [self-hosted container](../../docker/README.md) includes this web backend
under `/api`: with the default port mapping, enter `http://<NAS-IP>:4333/api`
on TV. Build the matching TV branch until its backend changes are published;
verify `/api/tv/connection` reports protocol 1 and pairing support, and include
`file://com.iptvnator.tv.prototype-webos` alongside the NAS web origin in
`CLIENT_URL`. The existing Compose restart policy is `unless-stopped`.
TV favorites/progress remain local. Sources can optionally connect through
Settings → Server library, independently from the provider backend URL. See the
[server source library contract](../architecture/tv-application.md#optional-server-source-library)
and [companion container instructions](../../docker/tv/README.md).

### Follow-up TODO

- [x] Deploy the matching TV backend alongside the existing Synology PWA.
  The companion on port 4335 is healthy, uses automatic restart and supplies TV
  CORS. The real LG now uses its provider backend and server-library gateway;
  catalog requests, QR session creation/cancellation and app relaunch pass.
  The existing PWA on port 4333 and its data volume remain unchanged. See the
  [deployment verification](tv-library-validation.md#real-lg).
- [x] Add optional TV server sources: M3U/Xtream/Stalker, explicit copy of a
  local source, cached reads, refresh/status, instance checks and identity-safe
  disconnect. See the server library contract above for conflict/deletion rules.
- [ ] Add shared favorites, history and resume, with provider-specific mapping
  and conflict/offline tests; these remain local on TV.

Server sources and NAS deployment are verified in 0.1.9. Cross-device viewing
state remains a separate follow-up.

After a temporary backend failure, the TV retries an idle failed connection
four times with increasing delays. Retry connection starts a new budget.
Connected is a backend health/auth check, not proof that the portal has
reconnected. See the architecture contract for retry and playback ownership.

`tv-e2e` owns isolated ports 4311, 3433, 3434, 3420 and 3421.
Concurrent worktrees can set `TV_E2E_PORT_OFFSET=10000` to move these servers
and the shared test helpers together without stopping an existing run. It starts the built TV
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
`dist/tv-package/com.iptvnator.tv.prototype_0.1.25_all.ipk` with the pinned webOS
CLI. Inspect it with:

```sh
pnpm exec ares-package -i dist/tv-package/com.iptvnator.tv.prototype_0.1.25_all.ipk
pnpm exec ares-setup-device --list
```

Only after the user supplies an enabled Developer Mode target and pairing:

```sh
pnpm exec ares-install --device <configured-device> dist/tv-package/com.iptvnator.tv.prototype_0.1.25_all.ipk
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

Settings > Set up from phone opens a separate QR form for TMDB, metadata
language, home layout and EPG. Paste a new key or leave it blank to keep the
TV's saved key, then choose Apply settings on TV. Existing keys never appear on
the phone. Saving requires a committed TV write; declining changes nothing.

## TMDB setup

In Settings > Metadata · TMDB, enable metadata, enter your own v3 API key or
v4 read access token, choose a language, optionally check the key, then save.
No real key is bundled or needed by automated tests. Home's featured title and
movie/series details gain artwork, descriptions and available cast/directors or
creators. The selected season also gains available episode stills/descriptions
and non-generic names. Catalog rows, live channels, episode identity and commands
remain provider-owned. Errors leave provider content usable. Key validation does
not enable metadata: save the opt-in switch and check its saved state message.
The TV browser must reach `api.themoviedb.org` and `image.tmdb.org` directly.
The [TMDB enrichment and series-title verification](tv-tmdb-enrichment-validation.md)
records real API observations, regression checks and the separate 0.1.16 device gate.
The 0.1.19 follow-up adds circular people controls, complete filmographies and
on-demand title availability searches within the active source.

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

The [Stalker Live investigation](tv-live-playback-investigation.md) compares TV
and Electron link resolution and records the still-open signed-HLS hardware gate.

The [dated verification report](tv-validation.md) records completed local checks,
the remaining Angular Stalker Escape failure, and the separate hardware gate.

The [backdrop and TMDB follow-up report](tv-metadata-validation.md) records the
0.1.1 package checks separately from the original MVP and real LG validation.

The [phone setup and discovery report](tv-phone-validation.md) records the
0.1.2 package checks and their separate real-device results.

The [browsing, artwork and phone settings report](tv-browsing-validation.md)
records the 0.1.3 follow-up, screenshots and hardware checks.

[TV catalog sorting validation](tv-sort-validation.md) records the 0.1.4 sorting,
persistence, browser and separate real-LG checks. Movies and Series each have a
Sort by selector; Recently added is the default. Their saved choices are separate.

[TV visual refinement validation](tv-visual-validation.md) records the 0.1.5
compact headers, resume artwork, typed favorites and channel fallback checks.

[TV resume validation](tv-resume-validation.md) records the 0.1.6 native seek
retry, saved-position protection and separate real-LG playback checks.

[TV Home feature validation](tv-home-validation.md) records the 0.1.7 manual
unfinished-title hero, retained resume rail and separate real-LG checks.

[TV Live browsing validation](tv-live-validation.md) records the 0.1.8 category
browser, full-height lists and stable preview/guide checks.

[TV server source library validation](tv-library-validation.md) records the 0.1.9
checks and the separate NAS administrator installation step.

[TV Live overlay validation](tv-overlay-validation.md) records the 0.1.10 channel
drawer and expanded single-channel guide checks, separately from hardware results.

[TV multi-channel guide validation](tv-grid-validation.md) records the 0.1.11
grid, shared EPG geometry and provider-cache checks, separately from LG results.

[TV stabilization validation](tv-stabilization-validation.md) records the 0.1.12
master integration, storage protection, recovery and home-server onboarding,
with the unresolved native playback checks kept separate.


[TV Settings categories validation](tv-settings-validation.md) records the category
layout, draft/save isolation, focus restoration, phone modal and local package
checks, including the rebased 0.1.15 installation on the real LG.
