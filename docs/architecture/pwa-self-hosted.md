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

Angular also emits hashed font and media assets under `dist/apps/web/media/`.
Keep `/media/**` in `ngsw-config.json` so the PWA service worker can cache
bundled fonts, including Material Icons.

The Angular service worker is a browser/PWA feature only. Packaged Electron
loads the same Angular production bundle from `file://.../app.asar/web`, but it
must not register `ngsw-worker.js`; otherwise a desktop update can leave the
first Electron window controlled by a stale file-origin service worker and serve
old chunks from Electron `userData`. Electron clears legacy `serviceworkers` and
`cachestorage` storage from its default session before loading the packaged
renderer so existing desktop installs recover on the next startup without
clearing unrelated app storage.

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
and EPG renderer code should use `EpgRuntimeBridgeService` from
`@iptvnator/epg/data-access` instead of calling `window.electron` directly.
Playback-position renderer code should use `PlaybackPositionRuntimeBridgeService`
from `@iptvnator/services` for Electron SQLite persistence and external-player
position update events; `supportsPlaybackPositionStorage` and
`supportsPlaybackPositionUpdates` describe those surfaces independently so PWA
and partial Electron bridges can degrade without direct preload checks.
`supportsEpg` remains the aggregate full EPG capability, while narrower runtime
capabilities cover individual EPG surfaces: import/progress, current-program
lookup, optional current-program batch reads, optional channel metadata,
freshness checks, clear/force-fetch management, channel browsing, and program
search. `supportsPlaylistRefresh` requires the native playlist
refresh/cancel/progress bridge, `supportsXtreamSectionNavigation` is available
in PWA and in Electron when either the SQLite Xtream data source or the Xtream
API transport is available, `supportsDesktopFileSave` requires both
`saveFileDialog` and `writeFile`, `supportsManagedExternalPlayers` requires the
MPV and VLC preload launch methods (`openInMpv` and `openInVlc`), and
`supportsExternalPlayerPathSettings` requires the path-setting methods
(`setMpvPlayerPath` and `setVlcPlayerPath`); a partial Electron bridge must not
expose desktop-only actions in the PWA/shared UI.

## Runtime Limitations

The self-hosted build is the browser PWA, not the Electron desktop app. Keep
these limitations explicit in UI, troubleshooting, and release notes:

- EPG/XMLTV is not supported in the PWA yet. Do not render live EPG panels,
  programme-guide entry points, or EPG-fetching flows in browser/PWA mode, and
  do not use EPG as the readiness signal for Docker.
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

### Provider redirects and connection policy

`ValidatedHttpClient` applies the registration URL policy again before every
outbound request on `/xtream`, `/stalker`, `/parse`, and `/parse-xml`, including
the initial request. Axios automatic redirects are disabled (`maxRedirects: 0`);
301, 302, 303, 307 and 308 are followed manually, with at most five redirects.
Relative `Location` values resolve against the URL actually sent, including its
query. Missing/malformed locations, repeated URLs (ignoring fragments), and an
exhausted redirect budget fail without dispatching another request. Intermediate
bodies are destroyed at headers; malformed or endless redirect bodies do not
block following an otherwise valid location. Final bodies retain a native socket
inactivity timer: axios stream mode stops its own timeout handling at headers,
so `provider-response.ts` keeps that timer active until consumption finishes.
A body failure preserves received HTTP status evidence; cancellation remains
inconclusive before any redirect.

Every DNS answer must be a valid permitted IP. Mixed public/private answers
fail closed. The strict policy rejects private/reserved IPv4, IPv4-mapped private
IPv6, and IPv6 outside global unicast `2000::/3`, plus protocol-assignment,
documentation and 6to4 ranges within it. These deliberately conservative ranges
follow the [IANA IPv6 address space](https://www.iana.org/assignments/ipv6-address-space/)
and [special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/).
The LAN opt-in applies to the whole
chain; it still requires HTTP(S), no URL userinfo and concrete DNS addresses.

Fresh HTTP/HTTPS agents pin socket lookup to the exact validated IPv4/IPv6
answer set for that hop. No second DNS query or pooled connection may substitute
an unvalidated address. The default axios transport uses a fixed logical hostname (`provider.invalid`)
so its connection authority cannot come from user-controlled URL metadata;
the pinned lookup alone selects an IP. Its native request-options adapter sets
`path` separately, so even `//host/path` cannot replace the connection authority.
It also owns the deadline from dispatch through response headers, since axios's
built-in connection timer only covers its own native transport objects. The original provider host and port are
explicitly preserved in Host, TLS SNI and certificate identity checks (literal
IPs omit SNI but still verify the original IP). Axios proxies and Node environment proxies
are disabled for these requests so a proxy cannot independently resolve the
origin. Deployments that require an outbound HTTP proxy must use a different
network arrangement; setting `HTTP_PROXY`/`HTTPS_PROXY` does not route provider
requests through it. This guarantee concerns address selection in the Node
transport, not routing/NAT performed outside the process. Private-network
opt-in intentionally relaxes address restrictions.

Original axios `params` are applied only to the initial request. Subsequent
queries come from `Location` resolution, without appending the original
credentials again. Authorization, Cookie, Proxy-Authorization and Stalker SN
headers are retained only on the same origin; changes of host, port or scheme
(including HTTPS downgrades) strip them for the rest of the chain. User-Agent
and other non-secret protocol headers survive. Providers can explicitly put
query values in `Location`; the backend does not rewrite provider-issued URLs.

Policy errors contain fixed messages/statuses without URLs, DNS exceptions or
transport objects. Portal routes keep HTTP 200 with a `{ message, status }`
error envelope; playlist/XMLTV routes use the actual error status. Registration
continues to use real HTTP error statuses. See
[host connectivity guard](host-connectivity-guard.md) for chain ownership and
failure attribution.

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
   pnpm is installed globally at the exact `packageManager` version rather than
   through Corepack, which Node 25 unbundled, so the base-image major stays
   free to move.
2. Runtime stage uses `node:24-alpine` with nginx installed. nginx serves
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
