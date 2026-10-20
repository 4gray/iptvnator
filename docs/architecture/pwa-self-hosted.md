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
  replaced, and one with `If-Match` answers `412 conflict` when another
  write replaced that version, one with `If-None-Match: *` when the
  playlist exists already
- `GET /v1/user-state`, `PUT|DELETE /v1/user-state/:namespace/:playlistId`:
  Xtream favorites, recently viewed, collection snapshots and playback
  positions, one JSON value per namespace and playlist; `GET` adds a
  content tag per entry (`tags`), and a write with `If-Match: "<tag>"` or
  `If-None-Match: *` answers `412` with the current value and tag when the
  entry changed since, and a `PUT` for a playlist the server does not have
  answers `404 playlist_missing` (the client drops that edit), so an edit
  queued on another device cannot bring a deleted playlist's state back
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
(network error, timeout, a 5xx such as nginx's 502 while the backend
restarts, or a refusal other than 404, such as a proxy's 429), a browser that remembers this backend still starts in server
mode, offline, and reloads once the server answers; it never falls back to
an empty browser library. Until that reload it sends no writes
(`holdWrites`) and no token anywhere (`ServerStorageStatusService.accessToken()`
is null for an unverified instance): the address may lead to another
server or database by then, which the reload's probe finds out. An answer without server storage, or a 404 from
an older backend, forgets it (`server-storage-start.ts`). Everything else of the
client lives behind the `@iptvnator/services/server-storage` sub-entry, so
other builds never load it; `ServerStorageStatusService` and the token
helpers stay in the main `@iptvnator/services` barrel because the rail,
settings and guards read them in every build.

- **Playlists.** `ServerStorageSession.start()` (an app initializer) plugs
  `ServerPlaylistDocumentStore` into `PlaylistStorageBackend` (kinds
  `electron`, `server`, `indexeddb`). The store caches full documents by
  ETag and uploads a document whose payload it served unchanged with
  `keepPayload=1`, so a favorite or a rename does not resend a large M3U.
  A mutation carries `If-Match` with the version it was read at (of its
  payload, else of the served copy it was built from, as for portal
  documents): when
  another device wrote in between, the server answers `412`, the store
  throws `PlaylistWriteConflict`, and `PlaylistsService`'s per-playlist
  write queue runs the mutation again on a fresh read (a retry on the same,
  unread copy writes unconditionally, as before). Imports and start-up
  migrations (`dbUpsertAppPlaylists`) write unconditionally, and the store
  refuses a document without an id. "Remove all" first lets queued
  playlist writes land, and writes issued meanwhile wait until it is done.
  An M3U favorite
  toggle or reorder goes through `transformPlaylistFavorites`: a toggle adds
  or removes that one channel, a reorder applies its order, on the
  favorites read at write time. After a write the store
  keeps its copy only when `X-Replaced-ETag` names the version its payload
  came from.
- **Xtream user data.** `USER_DATA_STORAGE` becomes `ServerUserDataStorage`:
  the four synced namespaces are cached per server instance, under
  `iptvnator-server:cache:<instanceId>:<namespace>` (the legacy unprefixed
  keys are never written in server mode; a tab still open on another
  server never writes over this one's cache) and
  each change sends only the playlist entries that differ, debounced, with a
  `keepalive` flush when the page hides. A change is compared with the map
  the caller read: when the cache changed since (another tab, a re-read),
  only the entries the caller changed are applied to it. Batches go out one after another
  (the page-hide flush waits for a batch still travelling, and a flush
  scheduled before it waits for the page-hide batch it sent at once), a failed write,
  including a refused `keepalive` one or one the server took and never
  answered (it ends after the request timeout), stays queued for the next
  flush (a write saved whose answer was cut off counts as saved on an
  unknown version: only later edits replay on the next conflict), and
  every unconfirmed write (queued or travelling) is saved in `localStorage`
  per page load (`iptvnator-server:unsent-writes:<instanceId>:<page>`). The
  tab remembers its page load in `sessionStorage`, so a reload takes its
  writes over and sends them first (the old copy goes only once the new one
  is saved, at the latest with this page's next saved copy; until then the
  tab's pointer names the kept page loads too, oldest first also when a
  duplicate adopted them, so another reload finds them even without their
  registry records and replays them in order; a duplicate of a tab that
  still runs leaves them, like that tab's page load, to it). A page marks
  its record closed on `pagehide`, and it stays closed when a page-hide
  write failing afterwards rewrites it (not into the back-forward cache, where
  its record goes stale, as in a background tab the browser suspends;
  restored or shown again after another tab adopted it, the page reloads
  rather than send those writes again, and until then it neither sends nor
  saves them, also when its retry timer runs first), and
  only a closed, stale or missing record is taken over: a duplicated tab,
  which copies `sessionStorage`, leaves the running tab its writes. A page
  load that still looked live (or whose close flag storage refused) is
  checked again every 30 s and, once it does not, adopted like a closed
  tab's: its edits go ahead of this page's newer ones, and without a
  server version this page read they are sent so that they conflict and
  replay; the writes of a tab closed before it
  could send them are queued, ahead of its own, by another tab once that
  tab's record has gone stale (at its next re-read, or its 30 s check when
  it has nothing to sync and never re-reads); the result replays the
  closed tab's edits first and this tab's newer ones last. An adopted edit
  changes only what is still as its page saw it (`EditStep.yields`), also
  at every later conflict: an item or key changed since, by this tab or
  another device, keeps its newer value. Tabs never clear each other's.
  Cache and saved writes belong to one server database
  (`iptvnator-server:cache-owner`); another one behind the same address
  starts clean. Startup waits for the first read only a few seconds;
  `UserDataStorage.ready()` waits for a first read in flight (it starts
  none, so an offline page is not held up) and tells whether one
  succeeded. The Xtream data source's favorites, favorite checks, history
  and position reads wait for it, so a new device does not show empty
  lists or start playback without its resume position. A backup export or
  restore (also its replay when the playlist opens) reads the server again
  first (`ready(true)`: another device may have changed the lists since) and
  fails when that read does not succeed: unread maps would export as empty lists, and a restore's lists
  would merge into the server's instead of replacing them (the restore
  stays parked). A restore also replaces nothing while this page's own
  writes for the playlist are unsent (they would join the replacement) and
  counts only once the server took its lists (`UserDataStorage.flushed`)
  as they are: a conflict that merged another device's edit in leaves it
  parked to run again on a fresh read. Replayed edits keep recently viewed lists newest first,
  as the app cuts them at their limit from the end. Also,
  re-reads run one at a time and keep entries edited while they were in
  flight or not yet saved, and entries another tab saved meanwhile or had
  unconfirmed when the read went out (the answer predates them; their next
  write here conflicts and replays). A response body cut off after its headers counts
  as offline. Each write is sent on the tag of the entry it was made
  against (`UserDataWriteQueue`); after a `412` the edit (before → after) is
  replayed on the server's current value, so another device's change to the
  same playlist's entry is kept. A queued write keeps its edits as steps
  (before → after, also in the saved writes): an edit continuing the last
  one joins it; one made behind a travelling write, after a write whose
  answer was lost, or on another tab's change is kept apart; and a
  conflict replays them in order. So a lost
  write is not dropped, and adding and then removing an item still removes
  it when the addition landed. When two tabs edit one entry before either
  write lands, a removal of the other tab's unsent item holds if that tab's
  write lands first, as it does when a tab is left (its writes go out on
  hide); otherwise the item can come back. An edit made on another tab's unsent change, and an entry a
  re-read keeps from the cache, are sent on a version no entry has
  (`UNKNOWN_TAG`), so they conflict and are replayed too. Page-hide writes report their
  new tag or conflict like any other, and one behind a travelling write is
  taken from the queue only when that one is answered. While a playlist is
  being deleted its edits wait; the delete drops them only when it
  succeeds, and a re-read sent before it skips the deleted playlist. Edits made before the first successful read
  are held as before → after and applied to the server's value once it
  arrives (`applyEdit`): a new device or a stale cache adds its favorite
  instead of replacing the server's list. On this tab's recovered unsent
  write they are kept as their own steps after it. They are saved per page load too
  (`iptvnator-server:deferred-edits:<instanceId>:<page>`). Records in
  `localStorage` (`iptvnator-server:unconfirmed:<instanceId>:<page>`, one
  key per page load so tabs never overwrite each other's, renewed every
  30 s while it has unsent writes, stale after ten minutes) let a re-read
  in one tab keep the cache values another tab is still sending, and a
  stale record marks a closed tab whose writes another tab adopts (the
  storage adapter lists its keys for this). Saved writes without any record
  are left to the tab's own reload: that tab may still run. A value too big for `localStorage`, or any
  value when the browser refuses storage access, stays readable from
  memory, so callers and the diff baseline agree. A re-read
  updates the cache; views already open show another device's changes on
  their next load (no live push). Start-up waits
  up to 3 s for the first read.
- **Connection state.** `ServerStorageStatusService` is `online`, `offline`
  (a request did not reach the server, or a proxy answered 502, 503 or 504
  for it; retried every 30 s and when the tab returns, as are writes the
  server refused and a first read that failed while it is `online`) or
  `unauthorized` (a 401 clears the stored token; only a reload after a new
  token leaves it, so a late answer cannot undo sign-out). The rail shows a status
  shortcut, an offline banner sits above the workspace content, and failed
  writes raise a snackbar (`SERVER_STORAGE.WRITE_FAILED`, or `TOO_LARGE` for
  a 413), the same one at most every five minutes.
- **Access token.** With `IPTVNATOR_ACCESS_TOKEN` the instance reports
  `auth: 'token'` (the backend refuses a token without server storage: the
  PWA has no sign-in flow for a stateless backend); without a stored token, or after a 401, the guards route to
  `/server-sign-in` (the start-up screen lets it through although the
  playlists could not load), which checks the token against `/v1/instance/status`
  before it stores it under `iptvnator-server:access-token` and reloads (a
  browser that refuses to store it is told so instead). The token is stored
  with the instance id it was given for, and a page sends it only to that
  instance: a tab still open on the old backend after `BACKEND_URL` changed
  does not send the new server's token there, and goes to sign-in instead.
  `ServerAccessTokenInterceptor` adds the header to `HttpClient` calls to the
  backend, and `PwaService` adds it to its two raw `fetch` calls only while
  server mode runs on a verified instance and only when the URL resolves
  to the backend (`isBackendUrl`); it joins paths to the backend URL
  without its trailing slashes, so `BACKEND_URL=/` never yields a
  protocol-relative `//…` URL that names another host. The browser forgets the token
  when the backend answers without server storage, or as another server or
  database (backend URL or instance id) than the one it remembers; sign-in
  therefore remembers the server along with the token, or reports storage
  trouble. A page started from memory first checks that the instance at the
  address is the remembered one (`ensureVerified`), and reloads if not
  (a reload after a server answered late gives the next start probe as
  long as requests take, once, so a slow server does not reload forever),
  before sign-in sends the token. So does a page that went offline (any
  backend call can tell: the storage API with its page-hide `keepalive`
  writes, `HttpClient` calls through the interceptor and `PwaService`'s raw
  fetches report no answer, or a
  gateway's 502/503/504 that is not the backend's own JSON, as offline)
  before its next read: until then it sends neither the token nor writes (a
  replaced volume at the same address is another database), and it checks
  the instance as soon as it goes offline, so a blip costs no retry
  interval (only the instance, and once per retry interval: a read or a
  check that keeps failing waits for the retry; the retry also runs while a
  late answer set an unchecked page online). Sign-out always navigates to sign-in, also when a guard kept the
  page the first time. Both turn
  the guard's 401 (`isServerAccessChallenge`) into `reportAccessDenied()`,
  as the storage API client does with any 401, so a token changed on the
  server sends an open page back to sign-in; a late 401 for a token
  replaced since (a new sign-in) changes nothing, nor does one for a page
  that holds its token back until the instance is checked.
- **Moving browser data.** `ServerMigrationService` offers, once per server
  instance (marker `iptvnator-server:migration:<instanceId>`), to move the
  playlists this browser kept in IndexedDB (`planServerMigration`), Stalker
  rows from before the portal-mode flag normalized first (server rows get
  the same Stalker metadata migration once per server, as a desktop
  database copied there can predate it: each row read again and written as
  a conditional mutation, a conflict retried at the next start). A
  playlist the server already has, by id or by source (Xtream server and
  user, Stalker portal and MAC, M3U URL), merges into the server's copy; the
  others upload with their ids, create-only (`If-None-Match: *`): one that
  another tab or device moved first is merged into instead of overwritten. A merged playlist gains the browser
  document's favorites and history (M3U favorites name channels by stream
  URL, as the app looks them up; older ones by a channel id that is random
  per import, which becomes its URL on both sides; history entries keep
  their URL id and get the server's channel id as `channel_id`; recently viewed newest first by `added_at`,
  one per item with its newest view; Stalker items by id, category and series
  flag, since one provider category can hold a movie and a series of one
  id; nothing is dropped), and the legacy Xtream maps follow under
  the server id; each copy's bare legacy Xtream ids are typed from its own
  snapshots first (`typeLegacyXtreamRefs`; snapshots keep their bare key as
  an alias), then `combineUserData` unions
  lists (playback positions by content type and Xtream id, renamed to the
  server playlist; recently viewed items newest first and one per item,
  its newest view, since the app cuts history from the end) and merges
  maps, the server's value winning on a
  conflict. Parental locks stay in the browser but move to the server
  playlist id with it; while the lock store or a browser user-data map
  cannot be read the move counts as failed. A parked Xtream restore (a
  browser backup import that could not finish) is copied to the server
  playlist id it merged into, unless that one has its own. Browser data is never
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
mode can substitute `ServerUserDataStorage`. The key names are shared as
`XTREAM_USER_DATA_KEYS` with the playlist backup, which exports and restores
the favorites, recent items, positions and snapshots through the same token
(`PwaXtreamBackupStateService`; see
[backup/restore](./playlist-backup-restore.md#browser-runtime)).

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
