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

Server storage adds versioned routes under `/v1`, which the PWA uses in
[server storage mode](#server-storage-mode):

- `GET /v1/instance` (always public): `{ service, apiVersion, instanceId,
  storage: 'server' | 'none', auth: 'none' | 'token' }`
- `GET /v1/instance/status`: playlist count, database size and path
- `GET /v1/playlists[?view=meta]`, `GET|PUT|DELETE /v1/playlists/:id`,
  `DELETE /v1/playlists`: whole playlist documents; `GET` sends an `ETag`
  and answers `304` to a matching `If-None-Match`, and
  `PUT ...?keepPayload=1` keeps the stored `playlist`, `items` and
  `header` fields (`409 payload_missing` without a stored row); every `PUT`
  answers with the new `ETag` and `X-Replaced-ETag`, the version it
  replaced
- `GET /v1/user-state`, `PUT|DELETE /v1/user-state/:namespace/:playlistId`:
  Xtream favorites, recently viewed, collection snapshots and playback
  positions, one JSON value per namespace and playlist
- `GET|PUT /v1/app-state/:key`

Server storage lives in `apps/web-backend/src/app/storage/`. With
`IPTVNATOR_STORAGE=server`, `main.ts` opens the shared database through
`initDatabase()` (path from `IPTVNATOR_DATA_DIR`), so the server has the same
schema and migrations as the desktop app and writes playlists with the
shared row codec. It adds two server-only tables: `server_user_state` for
Xtream user data, and `server_playlist_meta`, a copy of each document
without its M3U payload fields that metadata reads use instead of walking
the payload blobs (filled once on open for rows written without it). ETags
come from an in-memory revision counter; the server is the only writer of
its database. Storage errors are logged by error name and code only, because
Drizzle messages can carry bound values such as portal credentials. With
`IPTVNATOR_ACCESS_TOKEN`, every route except `/`, `/health`, `/config.js`
and `/v1/instance` requires `Authorization: Bearer <token>`, the proxy
routes included; its 401 carries `WWW-Authenticate: Bearer
realm="iptvnator"`, which a provider error passed on by the proxy never
does; the PWA sends it once its sign-in page has stored it.
Browser app state written through
`/v1/app-state` is stored under a `client:` key prefix, apart from
server-owned keys such as the instance id.

`pnpm nx run web-backend:serve` starts the backend by hand on port 3333 with
`TSX_TSCONFIG_PATH=tsconfig.base.json`, which `tsx` needs for the
`@iptvnator/*` path aliases. `apps/web-e2e/playwright.config.ts` does not use
that target: it launches `node --import tsx apps/web-backend/src/main.ts` with
an `env` that mirrors the target's. Nx `run-commands` starts its command in a
detached process group, and Playwright stops a `webServer` with a
process-group `SIGKILL` (`taskkill /T /F` on Windows). The kill therefore
reached only `pnpm`/`nx`, and the orphaned server kept port 3333 after the run.
`apps/web-backend/src/app/project-config.spec.ts` fails if a Playwright config
launches the backend through Nx or its `env` drifts from the `serve` target.
`WEB_BACKEND_PORT` (default 3333) relocates the E2E backend and the
`self-hosted.e2e.ts` URLs, like `MOCK_PORT` does for the mocks. Use it when
another worktree holds 3333. `server-storage.e2e.ts` talks to a second
backend from the same config, launched with `IPTVNATOR_STORAGE=server` on
`STORAGE_BACKEND_PORT` (default 3334) and a data directory named after the
Playwright process, so every run starts with an empty store; the spec
accepts at most that one extra launch. The `web:serve` entry can stay on Nx:
`@angular/build:dev-server` runs inside the Nx process, so the group kill
stops it. Playwright launches that command itself even outside CI: the
web-e2e targets carry no Nx `serve` dependency, because Nx refuses a
non-parallel task with a continuous dependency. The mock servers follow the
same rule; see [Xtream mock Playwright integration](xtream-mock-server.md#playwright-integration).

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

## Server Storage Mode

`main.ts` probes `GET /v1/instance` before bootstrapping, and only when the
deployment wrote a runtime `BACKEND_URL` into `window.__IPTVNATOR_CONFIG__`
(the Docker entrypoint does; hosted builds and Electron never probe). On
`storage: 'server'` it imports `apps/web/src/app/server-storage/` lazily and
merges `provideServerStorage()` into the app config, and remembers the
instance under `iptvnator-server:instance`. When the probe gets no answer
(network error, timeout, or a 5xx such as nginx's 502 while the backend
restarts), a browser that remembers this backend still starts in server
mode, offline, and reloads once the server answers; it never falls back to
an empty browser library. An answer without server storage, or a 404 from
an older backend, forgets it (`server-storage-start.ts`). Everything else of the
client lives behind the `@iptvnator/services/server-storage` sub-entry, so
other builds never load it; `ServerStorageStatusService` and the token
helpers stay in the main `@iptvnator/services` barrel because the rail,
settings and guards read them in every build.

- **Playlists.** `ServerStorageSession.start()` (an app initializer) plugs
  `ServerPlaylistDocumentStore` into `PlaylistStorageBackend` (kinds
  `electron`, `server`, `indexeddb`), so `PlaylistsService` is unchanged. The
  store caches full documents by ETag and uploads a document whose payload it
  served unchanged with `keepPayload=1`, so a favorite or a rename does not
  resend a large M3U. It keeps its copy after such a write only when
  `X-Replaced-ETag` names the version its payload came from; otherwise
  another device wrote in between and the next read fetches the document.
- **Xtream user data.** `USER_DATA_STORAGE` becomes `ServerUserDataStorage`:
  the four synced namespaces are cached under the `iptvnator-server:` key
  prefix (the legacy unprefixed keys are never written in server mode) and
  each change sends only the playlist entries that differ, debounced, with a
  `keepalive` flush when the page hides. Batches go out one after another
  (the page-hide flush waits for a batch still travelling), a failed write,
  including a refused `keepalive` one, stays queued for the next flush, and
  the page-hide flush saves every unconfirmed write (queued or travelling)
  under `iptvnator-server:unsent-writes:<instanceId>` for the next visit.
  Cache and saved writes belong to one server database
  (`iptvnator-server:cache-owner`); another one behind the same address
  starts clean. Also,
  re-reads run one at a time and keep entries edited while they were in
  flight or not yet saved. A re-read whose result does not fit the cache
  keeps the old cache and baseline together. A response body cut off after
  its headers counts as offline. Before the first read finishes, an edit is
  compared with the cache, so it sends only its own entry. A re-read
  updates the cache; views already open show another device's changes on
  their next load (no live push). Start-up waits
  up to 3 s for the first read.
- **Connection state.** `ServerStorageStatusService` is `online`, `offline`
  (a request did not reach the server, or a proxy answered 502, 503 or 504
  for it; retried every 30 s and when the tab returns) or
  `unauthorized` (a 401 clears the stored token; only a reload after a new
  token leaves it, so a late answer cannot undo sign-out). The rail shows a status
  shortcut, an offline banner sits above the workspace content, and failed
  writes raise a snackbar (`SERVER_STORAGE.WRITE_FAILED`, or `TOO_LARGE` for
  a 413).
- **Access token.** With `IPTVNATOR_ACCESS_TOKEN` the instance reports
  `auth: 'token'` (the backend refuses a token without server storage: the
  PWA has no sign-in flow for a stateless backend); without a stored token, or after a 401, the guards route to
  `/server-sign-in` (the start-up screen lets it through although the
  playlists could not load), which checks the token against `/v1/instance/status`
  before it stores it under `iptvnator-server:access-token` and reloads.
  `ServerAccessTokenInterceptor` adds the header to `HttpClient` calls to the
  backend, and `PwaService` adds it to its two raw `fetch` calls. Both turn
  the guard's 401 (`isServerAccessChallenge`) into `reportAccessDenied()`,
  so a token changed on the server sends an open page back to sign-in.
- **Moving browser data.** `ServerMigrationService` offers, once per server
  instance (marker `iptvnator-server:migration:<instanceId>`), to move the
  playlists this browser kept in IndexedDB (`planServerMigration`). A
  playlist the server already has, by id or by source (Xtream server and
  user, Stalker portal and MAC, M3U URL), merges into the server's copy; the
  others upload with their ids. A merged playlist gains the browser
  document's favorites and history (M3U favorites name channels by stream
  URL; older ones by a channel id that is random per import and is
  translated through the URL; nothing is dropped), and the legacy Xtream maps follow under
  the server id; each copy's bare legacy Xtream ids are typed from its own
  snapshots first (`typeLegacyXtreamRefs`), then `combineUserData` unions
  lists (playback positions by content type and Xtream id, renamed to the
  server playlist) and merges maps, the server's value winning on a
  conflict. Parental locks stay in the browser but move to the server
  playlist id with it. Browser data is never
  deleted, the move does not start while user-data writes are unsent, and
  the marker is written only when nothing failed, so Settings → Server
  keeps offering a partial move.

What stays per device: settings, parental lock PINs and locked groups,
the global favorites order and other UI preferences in browser storage.

## Runtime Limitations

The self-hosted build is the browser PWA, not the Electron desktop app. Keep
these limitations explicit in UI, troubleshooting, and release notes:

- EPG/XMLTV is not supported in the PWA yet. Do not render live EPG panels,
  programme-guide entry points, or EPG-fetching flows in browser/PWA mode, and
  do not use EPG as the readiness signal for Docker.
- The PWA does not use the Electron SQLite database or DB worker. Playlist
  metadata uses `PlaylistsService` with IndexedDB, which
  `PlaylistStorageBackend` selects when no SQLite bridge exists; Xtream
  favorites, recently viewed items, playback positions, and cached collection
  snapshots use `PwaXtreamDataSource` browser storage. In
  [server storage mode](#server-storage-mode) both live on the server
  instead.
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

`PwaXtreamDataSource` and `PwaCollectionStorage` reach these keys through the
`USER_DATA_STORAGE` token from `@iptvnator/services` (default:
`localStorage`), never through `localStorage` directly, so server storage
mode can substitute `ServerUserDataStorage`.

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
- `IPTVNATOR_STORAGE=server`, `IPTVNATOR_DATA_DIR=/data` (a `VOLUME`)
- `IPTVNATOR_ACCESS_TOKEN` unset, `IPTVNATOR_MAX_DOCUMENT_MB=64`
- `IPTVNATOR_BACKEND_START_TIMEOUT=300`: seconds the entrypoint waits for
  `/health`; the backend migrates its database before it listens

better-sqlite3 is a native addon, so the Dockerfile builds it in a separate
`native` stage that is not pinned to `$BUILDPLATFORM`; multi-arch builds
produce it for each target platform. nginx raises `client_max_body_size` to
64 MB for `/api/` and gzips JSON responses.

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
pnpm nx test web-backend --testPathPatterns=storage
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

## Service factory and build bases

`DataService` in `libs/services/src/lib/data.service.ts` is the renderer service
contract. `DataFactory()` in `apps/web/src/app/app.config.ts` chooses
`ElectronService` for the desktop bridge and `PwaService` for browser HTTP and
IndexedDB work. This environment-level selection is not evidence for an
individual capability: Xtream data-source selection requires its complete
SQLite bridge, and feature visibility follows `RuntimeCapabilitiesService`.
The same workspace route tree is used in both runtimes.

Desktop relational data uses the canonical schema/connection in
`libs/shared/database`; the SQLite path is `~/.iptvnator/databases/iptvnator.db`.
Desktop Chromium settings/storage still exist alongside SQLite. PWA data uses
browser IndexedDB (with browser quotas); its structure is not the SQL schema.
Browser-selected file uploads remain possible even though native filesystem
access is Electron-only.

Web development and PWA use `baseHref="/"`; packaged Electron frontend uses
`baseHref="./"` so file URLs resolve. In `apps/web/project.json`, `production`
is the Electron frontend build, `pwa` is the web build, and `development` uses
the index base. Do not ship the Electron frontend build as a PWA deployment.
