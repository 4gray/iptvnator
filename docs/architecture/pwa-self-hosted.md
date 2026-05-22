# PWA Self-hosted Architecture

This document describes the browser PWA and self-hosted Docker path.

## Ownership

- `apps/web` owns the Angular browser UI and PWA service worker configuration.
- `apps/web-backend` owns the browser-only backend proxy for remote playlist,
  Xtream, and Stalker requests.
- `docker/` owns the production self-hosted image that bundles the PWA and
  `web-backend` into one container.

The old external `4gray/iptvnator-backend` repository is not required for the
default self-hosted deployment. Sync behavior from that repository only when a
change intentionally restores or imports missing backend capabilities.

## Runtime Backend Configuration

The PWA reads `window.__IPTVNATOR_CONFIG__.BACKEND_URL` through
`apps/web/src/app/services/runtime-config.ts`. The static placeholder lives at
`apps/web/src/assets/app-config.js` and keeps hosted builds working without
Docker-specific values.

The Docker entrypoint rewrites `assets/app-config.js` at container startup.
`ngsw-config.json` explicitly excludes this file from Angular service worker
asset hashing so a runtime rewrite does not break cache validation.

## Service Worker Build

Use the PWA build configuration for browser deployments:

```bash
pnpm nx build web --configuration=pwa
```

The build must emit these files in `dist/apps/web`:

- `ngsw-worker.js`
- `ngsw.json`
- `safety-worker.js`
- `worker-basic.min.js`

`web:serve-static` serves `dist/apps/web` and builds with `web:build:pwa`, so it
exercises the same output layout as Docker. If Nx daemon state returns stale
service worker outputs while changing build options, run:

```bash
pnpm nx reset
pnpm nx build web --configuration=pwa --skip-nx-cache
```

## Web Backend

The current self-hosted PWA uses these `apps/web-backend` routes:

- `GET /health`
- `GET /config.js`
- `POST /provider-targets` with `{ "url": "<provider-url>" }`
- `GET /parse?targetId=<id>`
- `GET /xtream?targetId=<id>&username=<u>&password=<p>&action=<action>`
- `GET /stalker?targetId=<id>&macAddress=<mac>&action=<action>`

The PWA continues to use `PwaService`; only the backend base URL is resolved at
runtime. Electron routes remain owned by the Electron backend and preload
bridge.

Renderer code that needs to branch by runtime should use
`RuntimeCapabilitiesService` from `@iptvnator/services` instead of adding new
direct `window.electron` or `DataService.getAppEnvironment()` checks. Keep
feature decisions expressed as capabilities such as `supportsEpg`,
`supportsSqlite`, `supportsXtreamSqliteDataSource`, `supportsDownloads`, or
`supportsManagedExternalPlayers` so PWA and Electron behavior stays auditable
from one shared boundary. `supportsSqlite` requires the complete playlist
storage preload API surface used by `PlaylistsService`, `supportsDownloads`
requires the complete downloads preload API surface used by `DownloadsService`,
`supportsEpg` requires the Electron EPG preload methods used by the shared EPG
panels (`fetchEpg`, `getChannelPrograms`, `checkEpgFreshness`,
`forceFetchEpg`, `clearEpgData`, `getEpgChannelsByRange`, and
`searchEpgPrograms`), `supportsPlaylistRefresh` requires the native playlist
refresh/cancel/progress bridge, `supportsXtreamSectionNavigation` is available
in PWA and in Electron when either the SQLite Xtream data source or the Xtream
API transport is available, `supportsDesktopFileSave` requires both
`saveFileDialog` and `writeFile`, and
`supportsManagedExternalPlayers` requires the MPV and VLC preload launch and
path-setting methods (`openInMpv`, `openInVlc`, `setMpvPlayerPath`, and
`setVlcPlayerPath`); a partial Electron bridge must not expose desktop-only
actions in the PWA/shared UI.

## Runtime Limitations

The self-hosted build is the browser PWA, not the Electron desktop app. Keep
these limitations explicit in UI, troubleshooting, and release notes:

- EPG/XMLTV is not supported in the PWA yet. Do not render live EPG panels,
  multi-EPG shortcuts, or EPG-fetching flows in browser/PWA mode, and do not use
  EPG as the readiness signal for Docker.
- The PWA does not use the Electron SQLite database or DB worker. Playlist
  metadata uses `PlaylistsService` with IndexedDB; Xtream favorites, recently
  viewed items, playback positions, and cached collection snapshots use
  `PwaXtreamDataSource` browser storage.
- Browser playlist deletion must go through `PlaylistsService`, not
  `DatabaseService`. `PlaylistsService.deletePlaylist()` runs registered
  cleanup hooks such as the PWA Xtream cleanup so localStorage sidecar data does
  not survive after the source is removed.
- The Docker/PWA runtime cannot launch MPV, VLC, IINA, Embedded MPV, download
  manager flows, or Electron remote-control features. If inline browser
  playback fails, the supported browser fallback is copying the stream URL and
  opening it manually in an external player.

Provider URLs are registered before proxy calls so the proxy endpoints do not
accept raw target URLs in query strings. Registration validates the target URL
before any outbound request:

- only `http:` and `https:` provider URLs are accepted
- URL credentials are rejected
- loopback, private, link-local, and reserved network targets are blocked by
  default
- `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1` explicitly enables trusted
  local/LAN targets for development, mock servers, or private deployments

Do not disable TLS certificate validation in the backend proxy. For private
certificate authorities, configure Node with `NODE_EXTRA_CA_CERTS`.

## PWA Portal User Data

Xtream favorites and recently viewed items use the browser-side
`PwaXtreamDataSource` when Electron DB preload APIs are unavailable. The
`XTREAM_DATA_SOURCE` provider chooses the Electron SQLite-backed source only
when `RuntimeCapabilitiesService.supportsXtreamSqliteDataSource` is true; a
browser PWA or partial preload bridge must fall back to the PWA source and run
the browser cleanup hook on playlist deletion. The PWA stores this user activity
and sidecar state in localStorage:

- `xtream-collection-items`
- `xtream-favorites`
- `xtream-recent-items`
- `xtream-playlists`
- `xtream-playback-positions`

Entries should include a content snapshot when the item is added. Global
collection routes and the dashboard can then restore titles, posters, content
type, and category IDs after navigation or a page reload without relying on the
Electron SQLite content table.

Shared collection services that need Xtream favorites or recent data should use
`XTREAM_DATA_SOURCE` from `@iptvnator/portal/xtream/data-access` from a
`type:data-access` or `type:feature` boundary. UI libraries in the M3U domain
must not import Xtream data-access directly; use `PlaylistsService` for source
metadata changes and let app-level cleanup providers handle portal-specific
browser sidecar data.

## Docker Runtime

The Docker image has two stages:

1. Build stage installs dependencies and runs `web:pwa` plus `web-backend`.
2. Runtime stage uses `node:22-alpine` with nginx installed. nginx serves
   `dist/apps/web` and proxies `/api/*` to the local Express backend.
   The entrypoint renders the nginx config from a `${PORT}` template, starts the
   backend, waits for `/health`, and then starts nginx. If either process exits
   after startup, the entrypoint exits the container so the compose restart
   policy can recover the service.

Default runtime values:

- `BACKEND_URL=/api`
- `CLIENT_URL=http://localhost:4333`
- `PORT=3000`
- `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=0`
- `NODE_EXTRA_CA_CERTS` unset

When hosting behind another domain, set `CLIENT_URL` to the browser origin and
keep `BACKEND_URL=/api` unless the reverse proxy exposes the backend elsewhere.
Only set `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1` when the self-hosted
instance is restricted to trusted users and intentionally needs private network
IPTV targets. For providers using private certificate authorities, mount the CA
bundle into the container and set `NODE_EXTRA_CA_CERTS` to that mounted path.

## Validation

Use the narrow validation ladder for self-hosted changes:

```bash
pnpm nx test web-backend
pnpm nx test web --runTestsByPath apps/web/src/app/services/runtime-config.spec.ts
pnpm nx build web --configuration=pwa --skip-nx-cache
pnpm nx build web-backend
pnpm nx run web-e2e:e2e -- --project=chromium --grep @self-hosted
docker compose -f docker/docker-compose.yml config
```

Run `docker build -t iptvnator:self-hosted-test -f docker/Dockerfile .` when a
Docker daemon is available.

For manual Docker smoke testing, run the Xtream and Stalker mock servers plus a
small M3U fixture, then verify in the browser that M3U, Xtream, and Stalker can
add sources, play an item, toggle favorites, populate global favorites,
populate recently viewed, and appear on the dashboard rails.
