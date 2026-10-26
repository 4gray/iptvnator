# Shared sources for self-hosted PWA and Electron

Date: 2026-10-25. Status: implemented; local validation completed. Platform release checks remain below.
Audited checkout: `a9f4ae38ea3c56d8fc10601c60a082f53759efdb`.

## Outcome and scope

One self-hosted IPTVnator instance on a NAS owns a shared source library.
Phones/tablets using its PWA and Electron on Windows, Linux and macOS connect
to that instance. Adding, editing or deleting a source changes the library for
every connected device. An open, visible client discovers changes within a
15-second polling interval under normal network conditions; returning from
background/suspend triggers an immediate refresh.

The first delivery synchronizes **source definitions only**: M3U/M3U8 URL,
uploaded/pasted M3U, Xtream and Stalker connections. One instance has one shared
library and an optional shared access token. Accounts, multiple household
libraries, offline mutation queues and real-time push are later work.

Local playback engines, provider networking, catalog caches and device
preferences keep their runtime ownership. Connecting Electron to a NAS does
not turn it into the PWA runtime or make the NAS a media relay.

## What exists in this checkout

| Area | Evidence and actual status |
| --- | --- |
| Storage seams | `PlaylistStorageBackend` selects Electron or IndexedDB; `USER_DATA_STORAGE` defaults to localStorage. The shared playlist row codec and `IPTVNATOR_DATA_DIR` exist. |
| Server | `apps/web-backend/src/app/storage/` implements `/v1/instance`, playlist documents, app state and Xtream user-state endpoints, shared SQLite migrations, token protection and document ETags. |
| Docker | Bundles PWA, nginx and backend; server storage defaults on with a persistent `/data` volume. |
| PWA client | `apps/web/src/main.ts` performs ordinary Angular bootstrap; no instance probe or server-storage providers are connected. `PlaylistStorageKind` is only `electron \| indexeddb`. |
| Electron client | No configurable server connection. Xtream reads/writes SQLite through `ElectronXtreamDataSource` and `DatabaseService`; some paths bypass `PlaylistsService`. |
| Progress | Backend namespace `xtream-playback-positions` exists. There is no connected cross-device client flow. Desktop and PWA still use their local persistence. |
| EPG | No server EPG API/import service. The PWA contract explicitly excludes XMLTV/EPG support; desktop EPG remains local. |

Earlier [design](../docs/superpowers/specs/2026-10-08-server-storage-design.md)
and [overview](2026-10-11-server-storage.md) planned PWA user-state sync before
Electron. Preparatory phases 1 and 2a are present; the
[PWA phase 2b](2026-10-11-server-storage-phase-2b-pwa.md) remains a plan in this
checkout. This plan revises the pending delivery: bring Electron into the
sources release and defer user-state sync and EPG. Do not execute the old
phase 2b verbatim or assume that its sample code already exists.

## Data boundary

Introduce a versioned, provider-discriminated source definition instead of
using the entire `Playlist` object as the synchronization payload.

| Shared source definition | Local data, excluded from synchronization |
| --- | --- |
| Stable source ID, kind and display title | Favorites, recently viewed, watched state and playback positions |
| M3U URL, Xtream endpoint/credentials, Stalker endpoint/MAC and configured credentials | Catalog/category caches, import status, counts, health results and usage timestamps |
| Source request headers (`userAgent`, `referrer`, `origin`) | Stalker session tokens, token identity fingerprints, watchdog state and account snapshots |
| Configured Stalker serial/device/signature identity and portal mode | Player selection, downloads, recording state, UI ordering, hidden groups/categories and parental locks |
| Canonical raw M3U for uploaded or pasted sources | Absolute device file paths, parsed M3U caches and global/manual EPG settings |

Do not generate a new Stalker device identity on each client. Share the
configured connection identity, while negotiating sessions locally. Provider
limits and concurrent sessions using the same MAC must be tested and documented;
sharing a source does not expand the provider's session allowance.

For URL M3U, share the URL and request configuration; downloaded/parsed channel
snapshots and refresh execution remain local. For file/text M3U, put canonical
raw text on the server and materialize it locally. Another device must never
try to open the originating computer's `filePath`. Refreshing a file snapshot
requires an explicit replacement upload. Relative media paths in uploaded M3U
need a resolvable source base; report unsupported device-local media paths.

XMLTV references embedded in raw M3U remain part of that source content. This
does not provide synchronized EPG settings, imported programmes or PWA EPG UI.

## Architecture decisions

### Shared registry and local runtime projections

Use the existing server database, authentication, instance identity and codecs.
Add a narrow source API backed by the existing playlist rows. Keep the existing
whole-document and `/v1/user-state` APIs compatible and preserve all existing
stored fields. New source operations merge only allowed definition fields into
the row; they must not replace embedded favorites/history/session fields.

All source create/edit/delete/import commands pass through one shared source
authority in server mode. The server commits first; clients then project the
accepted definition into local storage. A local projection is a runtime cache,
not a competing source of authority. Applying a remote change must not publish
it back to the server.

Keep `PlaylistStorageBackend` as the local storage adapter seam. Add explicit
projection methods that preserve local state, rather than redirecting every
whole-playlist write over HTTP. This avoids accidentally syncing M3U/Stalker
favorites and session tokens. Most `PlaylistsService` callers should keep their
existing API; source mutations delegate to the authority, while user-state and
cache-only mutations stay local.

Electron's selected local SQLite profile still contains source rows with the
server IDs. Xtream retains `ElectronXtreamDataSource`, database-first catalogs,
native playback, EPG, downloads and worker behavior. PWA retains its browser
data source and local user-state storage. No full database synchronization.

### Source API and conflict handling

Proposed routes under `/v1` (`/api/v1` through Docker nginx):

- `GET /sources`: lightweight source definitions, per-source revisions and a
  collection ETag; no embedded raw M3U bodies. Support `If-None-Match`/`304`.
- `GET /sources/:id`: one complete definition, with uploaded raw M3U when
  required, and an ETag.
- `PUT /sources/:id`: explicit create with a client-generated ID and
  `If-None-Match: *`.
- `PATCH /sources/:id`: validated source-field changes with `If-Match`.
- `DELETE /sources/:id`: conditional delete with `If-Match`.

Advertise source-sync/schema support through an additive instance capability;
do not infer compatibility from `/health` or the existence of storage alone.
Source mutations and legacy playlist writes/deletes must invalidate the same
source and collection revisions. The existing boot-ID approach can invalidate
cached revisions after restart; durable incremental change logs are unnecessary
without an offline mutation queue.

Checking the revision and committing the mutation must be one serialized server
operation. A stale edit/delete returns `412`; the client reloads the source and
offers to reapply the intended edit. No silent whole-document overwrite. A stale
update of a deleted source must fail, never upsert it back. Do not automatically
retry uncertain create requests; first reconcile by ID and report the outcome.
Deleting all shared sources needs an explicit shared-library warning and a
collection revision check.

### Connection, profiles and failure behavior

- Settings → Data → Server is available in both runtimes: server URL, optional
  token, connection test, instance identity, connection status, last successful
  synchronization, refresh, import local sources and disconnect.
- The PWA served by the NAS discovers the configured same-instance backend.
  Electron allows an explicit base URL such as `https://nas.example/iptvnator`;
  normalize the deployment path to its API once and support reverse-proxy
  subpaths. A manually connected external PWA additionally needs compatible
  browser origin/TLS policy; document the supported deployment combinations.
- A successful instance probe distinguishes server storage from a stateless
  backend. Once server mode is configured, timeout, `401`, invalid JSON or an
  incompatible API must show a connection error, never silently open an empty
  local library. A confirmed `storage: none` retains ordinary standalone mode.
- Persist connection selection before source startup. Namespace local source
  projections and user data by instance/profile. Standalone data stays intact;
  switching servers with colliding source IDs cannot share catalogs or history.
  Prefer restart/reload on profile changes for v1 so every store, worker and
  cached request uses the selected profile consistently.
- Offline with a completed local projection: show the last synchronized source
  list and allow existing local playback paths where possible. Disable shared
  source mutations; there is no pending write queue. First connection without
  a snapshot shows a retryable unavailable state. Local activity may continue.
- Poll the small source inventory every 15 seconds while visible/active, with
  one in-flight refresh, backoff on failure, and immediate refresh on reconnect,
  visibility/focus or Electron resume. Fetch full raw M3U only when its revision
  changes. Hidden/mobile clients refresh when resumed; promise no background SLA.
- Disconnect returns to the retained standalone profile and never deletes NAS
  sources. Token rejection preserves the selected server/profile and opens sign-in.

### Transport and token scope

PWA uses HTTP to the selected backend. Its access-token handling also covers
that backend's provider proxy routes, since the current guard protects them.
Scope authorization to the configured backend origin **and API base path**;
never attach the NAS token to a provider, media URL, TMDB or redirected host.

Electron uses a narrow typed preload/main-process source-sync transport with
validated operations and a configured server endpoint. Do not expose arbitrary
authenticated HTTP through IPC. Allow an explicitly configured LAN server,
retain certificate validation and apply redirect/token restrictions. Store the
token through available OS-protected Electron storage; if unavailable, offer a
session-only token instead of silently writing it in plaintext. PWA token
persistence must have an explicit policy and be isolated to the connection.
Use shared redacting logging for errors, URLs and diagnostic state.

Provider and media requests keep their current PWA/Electron transports.
Connecting a desktop client does not route its streams through the NAS.

## Implementation sequence

1. **Contract and server source API.** Add shared DTOs, conversion/validation,
   capability discovery, conditional mutations and inventory ETags. Reuse raw
   M3U and fingerprint concepts from backup/restore without invoking its full
   user-state restore. Test the repositories with real SQLite, legacy stored
   documents, empty databases, restarts and simultaneous requests.
2. **Shared source authority and local projection.** Implement connection
   session/profile selection, polling, revision cache, explicit source commands
   and projection adapters. Audit create/edit/delete, reorder, restore/reset,
   OS file import, native playlist refresh, Stalker repair and session writes.
   Route definition changes through authority; leave local-only changes local.
   A failed local projection after a server commit is a retryable refresh, not
   a second create or a falsely reported server failure.
3. **PWA integration.** Complete pre-bootstrap discovery/profile selection,
   startup readiness/error integration, backend-scoped authentication, shared
   settings/status UI and browser projection. Two independent browser contexts
   must synchronize all three source types without user-state leakage.
4. **Electron integration.** Add typed preload/main transport, early profile
   selection, secure token storage and worker-owned source projection/cleanup.
   Update Xtream creation/edit/refresh paths that write through `DatabaseService`
   directly and Stalker source materialization. A remote deletion cancels stale
   imports and removes only that profile's local projection and related caches.
   Late worker completions must not recreate a deleted source.
5. **Import, deployment and release gates.** Offer explicit source-only import
   from the retained local profile, with preview and fingerprint merge. Never
   auto-upload every existing device's library. Match existing server sources
   by normalized M3U URL/raw-text fingerprint, Xtream endpoint + username, or
   Stalker endpoint + MAC. Preserve server IDs, return local→server ID mapping,
   handle concurrent duplicate imports on the server and record progress so
   partial failure/retry is idempotent. Keep the original profile untouched.
   Finish Docker/NAS documentation, mixed-runtime tests, translations and the
   user-visible release note before enabling the feature by default.

Shared source contracts belong in `libs/shared/interfaces`; pure fingerprint
and definition helpers need a utility owner. Shared injectable orchestration
belongs in `libs/services` with a dedicated sub-entry if needed to protect
initial bundle size. Runtime wiring remains in `apps/web`,
`apps/electron-backend` and `apps/web-backend`; SQL projection work belongs in
the database worker. Use existing scoped aliases and project tags. Read the
provider, SQLite-worker and UI/theme skills before implementing those changes.

## Acceptance and validation

Required integration scenarios:

- PWA → PWA, PWA → Electron, Electron → PWA, and two independent Electron
  profiles: add, rename, edit connection details and delete sources.
- M3U URL, file and text plus Xtream and Stalker. A remotely added source must
  open and play on the receiving runtime, not merely appear in the source list.
- Uploaded M3U works on a second device without the original file; native
  refresh/cache writes and playback activity do not publish unintended changes.
- Simultaneous edits yield a visible conflict; delete versus edit/import does
  not resurrect rows. An idle open client updates without navigation/reload.
- Token/no token, revoked token, offline startup/reconnect, NAS restart and
  volume preservation, reverse-proxy subpath and mismatched client/API version.
- First connection, existing local libraries, duplicate/partial imports,
  disconnect/reconnect and switching between instances with identical source
  IDs preserve the original data and keep local user state isolated.
- Favorites, history, progress, Stalker tokens and EPG data do not leak between
  clients; existing native playback/EPG/download paths remain usable.
- Packaged Electron on Windows, Linux and macOS; PWA on phone/tablet browsers;
  NAS deployment on supported `amd64`/`arm64` hardware. Verify browser secure
  context/install behavior and trusted certificate setup for the documented URLs.

Before implementation checks, use `.nvmrc`, install with the pinned pnpm and
`pnpm install --frozen-lockfile`, then run Nx discovery and inspect affected
targets. Existing owners include `shared-interfaces`, `services`, `database`,
`m3u-state`, `portal-xtream-data-access`, `portal-stalker-data-access`,
`playlist-import-feature`, `workspace-shell-feature`, `web`, `web-backend` and
`electron-backend`. Run targeted unit/lint/type checks for the actual diff,
both runtime builds, mixed-client browser/Electron E2E and required local
coverage gates. Discover any new/atomized targets instead of guessing them.

Use isolated temporary server data directories and client profiles for tests.
Mixed-runtime E2E must declare `web-backend` as an input/dependency of its owning
test project. Validate compose, build/start the Docker image with a volume, and
record the tested commit plus results. Run `pnpm run i18n:check` and
`pnpm run release:notes:validate` for the implementation. Add a `.changes/` note
when source sync becomes user-visible. No release note is needed for this plan.

Update the canonical [PWA/self-hosted contract](../docs/architecture/pwa-self-hosted.md),
[backup/import contract](../docs/architecture/playlist-backup-restore.md),
[Docker guide](../docker/README.md) and affected runtime/provider/worker
contracts as behavior lands. Observe the local committed-branch review gate
before any PR push. Check repository visibility and workflow triggers before
pushing; private-repository paid CI requires explicit user authorization.

## Follow-up roadmap

1. **Playback progress and watched state:** a shared provider/content identity,
   episode identity, resume/completed semantics, conflict rules and local↔server
   adapters for Electron, PWA, inline and external players. Existing Xtream
   user-state endpoints are a foundation, not evidence of completed sync.
2. **Optional favorites synchronization in Settings:** add an explicit opt-in
   switch in the server settings, disabled by default. Define the scope per
   connected profile, initial local/server merge, duplicate handling, per-item
   add/remove semantics and behavior when the switch is turned off. Turning it
   off must retain local favorites and must not erase favorites on the server.
   Use portable content identities for M3U, Xtream and Stalker; avoid whole-map
   overwrites. History and ordered collections remain a separate later scope.
3. **Server EPG:** XMLTV source management/import/scheduling on NAS, programme
   query/search APIs, PWA capability bridge, freshness/timezone rules and a
   policy for Electron consuming server versus local EPG. This is a server
   feature, not copying a desktop EPG SQLite file between clients.
4. **Further options if needed:** SSE/push, offline queued source edits,
   multiple household libraries/accounts and an optional provider/media relay.

### Outstanding work after the sources delivery

- [ ] Refresh the existing draft self-hosting website guide and its screenshots
  before publication; it describes the earlier whole-document PWA experiment.

- [ ] Add the optional favorites-sync setting and the local/server adapters
  described above. Current favorites remain local in both PWA and Electron.
- [ ] Synchronize playback progress and watched state across PWA and Electron,
  including film/episode identity, resume/completed semantics, concurrent
  playback conflict rules and support for inline and external players.
- [ ] Add server-side EPG source management, XMLTV import/scheduling and query
  APIs, then connect PWA and Electron with freshness/timezone handling.
- [ ] Define separate opt-in policies for favorites, progress and future
  activity synchronization; connecting a source server alone must not upload
  a device's existing activity without the user's choice.
- [ ] Verify packaged Windows/Linux/macOS clients, real iPhone/iPad PWA
  installation and a physical Synology deployment on supported architectures.
- [ ] Consider history/collections, push updates, offline mutation queues and
  household accounts only after the source-only release is validated.

Requested on 2026-10-26: keep these follow-ups in the plan, outside the sources
pull request. Source sync remains the only synchronization enabled by this PR.

### Integration with current master (2026-10-26)

The Oct 25 audit above describes the original base revision. Current master
also contains a whole-document PWA client and a TV source-library client.
The PWA/Electron bootstrap now installs only the source-sync projection and
device-local user storage. The older server API/client modules remain compatible
for explicit consumers; their activity synchronization is not enabled alongside
source sync. Legacy full-document reads materialize raw uploads for TV clients.
Existing server user-state records are preserved rather than automatically
copied into, or erased by, the new per-device profiles.


## Implementation and validation record

Implemented the source registry API with conditional writes and instance checks,
PWA/Electron profile selection, local projections, polling/reconnect, token
handling, source-only import, connection settings and recovery UI. The source
release leaves viewing activity and EPG local, as agreed.

Validated locally on macOS using Node 22.23.2 and pnpm 10.33.0:

- All 34 Tier A unit/coverage projects passed after updating the affected
  contract fixtures and the settings navigation expectation. Coverage tools,
  policy, merge and the existing health/ratchet gate passed without changing
  thresholds. Final measurements are recorded below.
- The mixed-runtime `electron-backend-e2e:source-sync` suite passed all four
  scenarios with real temporary backend databases, two PWA contexts and two
  independent Electron profiles. It covers source propagation, uploaded M3U
  playback, native Xtream playback, Stalker playback in PWA, renames/deletions,
  late native source creation rejection, token recovery, offline cached startup,
  duplicate import and return to the preserved standalone browser library.
- Web/native builds, production and four affected spec TypeScript programs,
  lint for all ten affected owners, i18n checks for 19 locales, release-note
  validation, guidance validation, E2E task graph checks and Compose validation
  passed. The new historical SQLite import test also checks read-only handling
  of real old columns, missing databases and corrupt input.
- Docker image `iptvnator:source-sync-20261025` built successfully. Production
  PWA startup and server settings were checked in light, dark and phone layouts.
  Source API, token rejection, stale-write rejection, stable instance identity
  and persisted sources after a volume-backed container restart were verified.
  Temporary containers, volumes and client profiles were removed.

Platform release checks still require packaged Windows/Linux/macOS binaries,
real iPhone/iPad browser/PWA installation and a physical Synology NAS. Local
Electron validation used the macOS E2E build; Docker used the host architecture.
No release publication or external deployment was performed.


Final checked base revision: `a9f4ae38ea3c56d8fc10601c60a082f53759efdb`. Implementation remains in the local
working tree. SHA256 of the sorted changed/untracked file paths and contents:
`20f041e89a8c221008bfbe665491e4a73aae65559c64aeefb1c63b22faa49abd` (111 files; this ignored plan is excluded).

Merged coverage across 34 projects: statements 84.11%, branches
75.17%, functions 82.33%, lines 84.49%. The existing ratchet and
critical-file checks pass. Coverage health reports advisory missing-same-name
spec warnings; the owning unit projects and mixed-runtime E2E were run.

Final Docker image: `sha256:69d80ec6893913b46603d07cb84eb7c93121d065aa0a9cc1fd41f5f6c52bbfe8`.
Relevant local QA logs are `/tmp/iptvnator-source-sync-e2e-final.log`,
`/tmp/iptvnator-sync-coverage-health-last.log`,
`/tmp/iptvnator-source-sync-docker-qa.log` and the final type/lint logs with
`/tmp/iptvnator-sync-` prefixes. Screenshots from the production image:
`/tmp/iptvnator-source-sync-light.png`, `...-dark.png`, `...-mobile.png`.
