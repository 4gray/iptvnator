# Server Storage for the Self-hosted PWA — Design

Date: 2026-10-08, revised 2026-10-11 against `master` at `7abf479de`.
Status: approved direction ("the server is the single source of truth in
self-hosted mode"). Implementation plans:

- `.plans/2026-10-11-server-storage.md` (overview and order)
- `.plans/2026-10-11-server-storage-phase-1-seams.md`
- `.plans/2026-10-11-server-storage-phase-2a-backend.md`
- `.plans/2026-10-11-server-storage-phase-2b-pwa.md`

Upstream demand: #305 (store playlists on the server for the Docker version,
open since 2023), #514 (closed as its duplicate), #1616 (sync watched state
and favorites between devices).

## 1. Summary

The Docker image runs the browser PWA. All user data lives in the browser:
playlists in IndexedDB, Xtream favorites, recently viewed, playback positions
and collection snapshots in localStorage. The bundled `web-backend` is a
stateless proxy, so every device that opens the NAS address starts empty.

This design gives `web-backend` an optional server storage: the same SQLite
database the Electron app uses (`libs/shared/database`, `initDatabase()`),
stored on a Docker volume, plus a small versioned HTTP API. When the instance
reports server storage, the PWA keeps playlists and playlist-scoped user data
on the server. Adding a playlist stays the ordinary "Add playlist" flow.

## 2. Goals

1. A playlist added on one device appears on every device that opens the same
   self-hosted instance (M3U, Xtream, Stalker).
2. M3U and Stalker favorites and recently viewed (stored inside the playlist
   document) and Xtream favorites, recently viewed, collection snapshots and
   playback positions follow the playlist, not the browser.
3. Browser data moves to the server once, with consent, and is never deleted.
4. No behavior change for Electron and for PWA deployments without server
   storage.
5. The HTTP contract mirrors the renderer's existing playlist document store,
   so a later Electron "connect to server" phase reuses it.

## 3. Non-goals for this release

- Server-side EPG (phase 3) and Electron connecting to a server (phase 4).
- Syncing device settings (theme, language, player, EPG URLs), parental locks,
  the global favorites order and UI preferences. They stay per device.
- Live push of changes (SSE). Devices read the server on every playlist read
  and re-read Xtream user data when the tab becomes visible.
- User accounts. One optional shared access token.
- Credential encryption at rest. Documented limitation.

## 4. Findings that shaped the design

| Finding | Consequence |
| --- | --- |
| `PlaylistsService` persists whole playlist documents through a narrow bridge (`dbGetAppPlaylist(s)`, `dbGetAppPlaylistMetas`, `dbUpsertAppPlaylist(s)`, `dbDeletePlaylist`, `dbDeleteAllPlaylists`, `dbGet/SetAppState`). Every mutation re-reads the document, patches it and writes it back. | The server implements the same document contract over HTTP. The client change is one adapter plus a resolver; `PlaylistsService` keeps its API. |
| Electron stores the whole document as JSON in `playlists.payload`, with projected columns for fast metadata reads (`buildPlaylistRow` / `parseAppPlaylist`). | Move that codec into `libs/shared/database` and reuse it on the server. Same row format on desktop and server. |
| `initDatabase()` in `libs/shared/database` creates the full schema and runs every migration; the path comes from `path-utils`. | The server calls `initDatabase()`. A new `IPTVNATOR_DATA_DIR` variable in `path-utils` points it at the Docker volume. |
| better-sqlite3 13 is a Node-API addon. | One binary loads in Node and Electron. Only the Alpine Docker image needs its own native build stage. |
| Read-modify-write of a document carrying a large M3U payload would move megabytes per favorite click over Wi-Fi. | `GET` answers `304` on a matching ETag; an upsert whose payload object is the one the client received sends `keepPayload=1` without the payload. |
| Xtream PWA user data is four localStorage maps keyed by playlist id (`xtream-favorites`, `xtream-recent-items`, `xtream-collection-items`, `xtream-playback-positions`); `xtream-playlists` is a derived cache. | Server table `server_user_state(namespace, playlist_id, value)`. The client keeps a write-through cache under its own key prefix and sends only changed playlist entries. |
| nginx proxies `/api/` with the default 1 MB body limit. | Raise `client_max_body_size` with the server body limit. |
| The hosted PWA build points at an external parser API. | The client probes for server storage only when the deployment writes a runtime `BACKEND_URL` (the Docker entrypoint does). |
| Settings sections are grouped (App, Library, Devices, Data) and gated by capability requirements. | New "Server" section in the Data group before Backup, requirement `server-storage`. |
| New i18n keys must be translated in all 19 locales (`pnpm run i18n:check`). | Translation is a planned task. |
| Production files: target < 300 lines, hard 400; `web-backend-app.ts` (673) and `playlists.service.ts` (1580) are baselined. | New code lives in new files; baselined files only gain mounting lines. |

## 5. Product decisions

1. In server mode the server is the authority for playlists and the synced
   user data. There is no per-playlist "local or server" choice.
2. Server storage is opt-in on the backend: `IPTVNATOR_STORAGE=server`. The
   bare `web-backend` defaults to `none`; the Docker image sets `server`.
3. Optional `IPTVNATOR_ACCESS_TOKEN`. When set, every route except
   `/`, `/health`, `/config.js` and `GET /v1/instance` requires
   `Authorization: Bearer <token>`, including the provider proxy routes.
4. Migration:
   - First device (server has no playlists, browser has some, no marker for
     this instance): a dialog offers "Move to server". Playlists are copied
     with their ids, then the four Xtream user-data maps for those ids.
   - Any later device (server already has playlists): Settings → Server
     offers "Import this browser's playlists", which runs the existing backup
     export (browser) and import (server) with fingerprint merging, so the
     same provider added on two devices is not duplicated.
   - Browser data is never deleted. The server-mode cache uses its own
     localStorage key prefix, so legacy keys stay intact.
5. Offline: reads and writes fail with a visible state. The rail shows an
   offline server icon, a banner explains that changes cannot be saved, and
   failed writes show a snackbar. No offline write queue.
6. "Delete all playlists" in server mode warns that it clears the server for
   every device.

## 6. Architecture

```
Browser (PWA)                                       Docker container
┌─────────────────────────────────────────┐         ┌───────────────────────────────────────┐
│ main.ts: probeServerInstance()           │  /api   │ nginx (client_max_body_size 64m)      │
│   → provideServerStorage(instance)       │────────►│   └─► web-backend (Express)           │
│ PlaylistsService (API unchanged)         │         │        ├ proxy routes (unchanged)     │
│   └ PlaylistStorageBackend               │         │        ├ access guard (optional)      │
│       ├ Electron bridge   (desktop)      │         │        └ /v1 storage router           │
│       ├ ServerPlaylistDocumentStore      │  HTTP   │            ├ instance, status         │
│       └ IndexedDB         (plain PWA)    │◄───────►│            ├ playlists (documents)    │
│ PwaXtreamDataSource                      │         │            ├ app-state                │
│   └ USER_DATA_STORAGE                    │         │            └ user-state               │
│       ├ localStorage                     │         │ ServerDatabase: initDatabase()        │
│       └ ServerUserDataStorage (cache)    │         │   + server_user_state                 │
│ ServerStorageStatusService (signals)     │         │   /data/databases/iptvnator.db (WAL)  │
└─────────────────────────────────────────┘         └───────────────────────────────────────┘
```

### 6.1 HTTP API (`/v1`, mounted under nginx `/api`)

All JSON. Errors: `{ message, status, code? }`.

| Route | Purpose |
| --- | --- |
| `GET /v1/instance` | Public. `{ service: 'iptvnator', apiVersion: 1, instanceId, storage: 'server' \| 'none', auth: 'none' \| 'token' }`. The frontend and backend ship in one image, so the PWA shows its own version. |
| `GET /v1/instance/status` | `{ playlists, databaseBytes, databasePath, startedAt }`. Also the token check. |
| `GET /v1/playlists?view=meta` | Metadata documents (no payload). |
| `GET /v1/playlists` | Full documents (backup export, global favorites). |
| `GET /v1/playlists/:id` | Full document, `ETag`; `If-None-Match` → `304`. |
| `PUT /v1/playlists/:id[?keepPayload=1]` | Upsert. With `keepPayload`, the stored `playlist`, `items` and `header` fields are kept; `409 payload_missing` when there is no stored row. Responds with the new `ETag`. |
| `DELETE /v1/playlists/:id` | Delete the row and its user-state entries. |
| `DELETE /v1/playlists` | Delete all playlists and all user state. |
| `GET/PUT /v1/app-state/:key` | `{ value }`. |
| `GET /v1/user-state` | `{ entries: { [namespace]: { [playlistId]: value } } }`. |
| `PUT/DELETE /v1/user-state/:namespace/:playlistId` | One entry. Namespaces are an allow-list. |

ETags are `"<bootId>-<revision>"` from an in-memory per-playlist revision
counter; the server is the only writer of its database.

### 6.2 Server

`apps/web-backend/src/app/storage/`: config, database bootstrap
(`initDatabase()` + `server_user_state` + instance id in `app_state`),
playlist repository on the shared codec, user-state repository, revision
tracker, access guard, routers. `main.ts` opens storage when enabled and
closes it on `SIGTERM`. Storage errors are logged by name and route only.

### 6.3 Client

- `PlaylistStorageBackend` (libs/services) resolves the document store:
  server store in server mode, Electron bridge when `supportsSqlite`, else
  IndexedDB. It can switch to browser storage temporarily for the migration
  export.
- `@iptvnator/services/server-storage` (sub-entry, kept out of the eager
  barrel): API client, document store, user-data storage, session, migration.
- `ServerStorageStatusService` (main barrel, tiny): connection state for the
  rail, banner and Settings.
- `apps/web/src/app/server-storage/`: probe, providers (dynamically imported
  from `main.ts` only in server mode), sign-in route, migration dialog,
  Settings section.

## 7. UX

Mockup (2026-10-08, settings navigation has since gained groups):
https://claude.ai/artifact/3WheJAgeNL5ag6kmtPrJcD

1. Settings → Data → Server: connection pill and address,
   storage figures, "Export backup", "Import this browser's playlists" (when
   local playlists exist), access mode with "Sign out" when a token is used.
2. Migration dialog over the workspace on first boot (rule 5.4).
3. Rail: server icon above Settings with connected, offline and locked states.
   Offline banner under the header with "Retry".
4. Sign-in page `/server-sign-in` when the instance requires a token.

## 8. Error handling

| Situation | Behavior |
| --- | --- |
| Probe fails or times out (2.5 s) | Browser mode, no server UI. |
| Request fails after boot | Status `offline`, banner, write failures show a snackbar; retry on `visibilitychange` and every 30 s. |
| `401` | Status `unauthorized`, stored token cleared, redirect to sign-in. |
| `413` | Snackbar names the limit. |
| `409 payload_missing` on `keepPayload` | Client retries once with the full document. |
| Data directory not writable | Backend exits on start with a clear log line; the container restarts. |

## 9. Testing

- Unit: codec round trip, path variable, resolver, document store (ETag,
  keepPayload), user-data storage (diff, debounce, hydrate), probe, session,
  migration decision, settings section, rail indicator.
- Backend: repositories on real SQLite in a temp directory; routes through a
  real server and `fetch`; access guard.
- E2E: `@server-storage` spec against a storage-enabled backend on its own
  port and temp directory: a playlist added in one browser context appears in
  another; the migration dialog moves a seeded browser playlist. The token
  page and guards are covered by unit tests (an E2E run would need a third
  backend).
- Docker: `docker compose config`, image build, start with a volume.

## 10. Phases

| Phase | Content | Closes |
| --- | --- | --- |
| 1 | Seams, no behavior change: shared codec, `IPTVNATOR_DATA_DIR`, `PlaylistStorageBackend`, `USER_DATA_STORAGE`. | — |
| 2a | Server storage in `web-backend`, Docker volume, nginx limits, docs. | — |
| 2b | PWA server mode, migration, Settings → Server, rail/banner, sign-in, i18n, E2E, release note. | #305, #514 |
| 3 | Server-side EPG for the PWA. | PWA EPG gap |
| 4 | Electron connects to a server. | #1616 for NAS owners |

## 11. Risks

- **Concurrent edits on two devices**: last write wins per document or per
  Xtream map entry. Every playlist mutation re-reads first, so the window is
  one round trip.
- **Large payloads**: M3U global favorites and backup export read all full
  documents, as IndexedDB does today.
- **Open instances**: storing credentials raises the cost of an unprotected
  public instance. Docs and the Settings page state it; use the token or
  reverse-proxy auth.
- **Native module in multi-arch images**: built in a target-platform stage.
