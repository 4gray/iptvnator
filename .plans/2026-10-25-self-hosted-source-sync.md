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
Provider EPG is already available in PWA independently of source sync. The
remaining EPG work above means NAS-managed XMLTV import, scheduling, query APIs
and cross-device policy, rather than adding that existing provider view again.
The PWA/Electron bootstrap now installs only the source-sync projection and
device-local user storage. The older server API/client modules remain compatible
for explicit consumers; their activity synchronization is not enabled alongside
source sync. Legacy full-document reads materialize raw uploads for TV clients.
Existing server user-state records are preserved. Established browsers adopt
their legacy activity once during upgrade; new clients start with local activity
and subsequent activity changes do not synchronize.


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

### PR preparation validation (2026-10-26)

Integrated master through `48fcec10530d5c9dccd323a90ff9ff973a1de9a2`.
The mixed PWA/Electron source-sync suite passed 4 scenarios; Chromium's
self-hosted/server-storage suite passed 9 scenarios, including source-only
backup restoration with existing server favorites preserved. Targeted/full
owning unit suites, PWA build, TypeScript, affected lint, release-note format,
agent guidance and 129 local/CI E2E task graphs passed. Review-time evidence
is in `/tmp/iptvnator-sync-pr-*.log`; the exact reviewed commit is recorded in
the pull request. The Greptile CLI is unavailable locally (exit 127); repository
workflow permits proceeding with Codex review and reporting this limitation.

The first completed local Codex review identified six issues, all addressed:
clear inherited Electron profile selection after disconnect; retain the newest
parsed source during delayed activity writes; retry failed URL materialization
at unchanged source revisions; rehydrate an open M3U channel list; preserve
detected EPG alongside local manual/disabled choices; and retain a selected
custom API base when reconnecting. Regression unit checks and all five mixed
PWA/Electron scenarios pass, including active M3U replacement and restoration
of the original Electron library after a relaunch with inherited environment.

The second local review identified canonical-ID races during backup import,
open Stalker connections retaining old configuration and authoritative inventory
merges reviving removed metadata. Restore now follows the accepted source ID
for activity and parental locks, duplicate source creation retains device-local
activity, and inventory replacement keeps only the omitted parsed payload.
Open Stalker routes reconcile persisted connection changes through their
serialized route/session owner. Optional favorites synchronization, EPG and
viewing progress synchronization remain outside this delivery.

The third review identified adoption of existing per-instance browser activity
caches, concurrent tab writes during M3U materialization and missing accepted
metadata after ordinary source creation. The browser now lazily adopts its own
old instance cache once per namespace, preserving newer profile values and
deletion tombstones without reading/uploading remote activity. Browser playlist
commits preserve current activity atomically in IndexedDB; profile mutations
also use Web Locks where available. Every accepted source creation reloads
authoritative metadata so subsequent edits carry the original revision.

The fourth review identified legacy browser PIN/lock migration, adoption of
existing M3U/Stalker activity before the source-only projection, stale activity
writes between tabs and bootstrap failures from malformed connection data or
denied browser storage. Missing profile PIN/lock values now migrate once with
fail-closed error handling. Established clients adopt legacy playlist activity
once, validating the instance and retaining existing local rows; new clients
and subsequent refreshes do not import remote activity. Stale local writes
raise a conflict for the existing re-read/reapply retry. Connection failures
leave the app and Server settings reachable through a recovery alert.

Regression validation for these fixes passed 906 service unit tests, all five
mixed PWA/Electron scenarios and 14 production-PWA Chromium scenarios, including
legacy activity migration, denied storage and malformed saved configuration.
The Ukrainian source-sync translation group was completed alongside the recovery
message; all locale key and usage checks pass. The fifth committed-branch
review remains the final pre-push gate after the checks below.

The pre-push bundle check exposed eager Material controls and sync code on the
standalone startup path. The status panel now defers its view, with a native
settings fallback, and the initializer imports the sync service only for a
selected server. The existing initial-bytes budget is retained.

All 36 Tier A projects passed the full local run. After the bundle-boundary
changes, the seven affected unit/coverage projects passed again and their
reports were merged with the unchanged projects: statements 84.73%, branches
75.71%, functions 82.99%, lines 85.10%. Coverage thresholds are unchanged;
coverage health has advisory same-name-spec warnings for files covered by
their owning suites and E2E. All 59 lint projects and 41 spec TypeScript
programs pass. Production initial payload is 1,198,520 bytes, below the existing
1,200,301-byte limit. Portable-source helpers and provider-message detection
use public file-level entries to keep deferred code out of bootstrap.

After those import-boundary changes, mixed-runtime E2E passed all five
scenarios again, and the production-PWA Chromium run passed all 14 scenarios.
Release-note validation and the final translation checks pass as well.

### Fifth local review: remaining pre-PR blockers

Reviewed runtime revision: `ca65d2800a0de0a00714efc51180dccb381f9521`.
Codex completed its fifth round and reproduced two accepted P2 findings:

- [x] Resolve a browser's temporary `pending:` discovery connection when a
  recovered backend definitively reports `storage: none`. The current instance
  assertion rejects before clearing the temporary connection, so the original
  local library stays inaccessible until the user disconnects manually. A
  confirmed source-server connection must still retain its current error policy.
- [x] During an awaited metadata-only source edit, preserve the newest local
  parsed M3U payload, count, refresh timestamps and detected EPG sources. Another
  tab without Web Locks can refresh the channels while the title PATCH is in
  flight; the current merge retains activity but writes the older parsed snapshot
  under the newly accepted source revision, preventing polling from repairing it.

Both need regression coverage and another committed-branch review before push.
The local-review workflow stops after five rounds with findings, so no branch
push or PR creation has occurred. An explicit exception was requested before
continuing that review/fix loop. Greptile CLI remains unavailable (exit 127).
Fifth-round verdict: `/tmp/iptvnator-sync-pr-codex-5.out`; all validation results
above remain passing for the reviewed runtime revision, but they do not cover
these newly reproduced cases.

### Review continuation authorized (2026-10-26)

The user explicitly authorized further review beyond the five-round limit.
The two fifth-round findings are implemented. A valid stateless response clears
only unconfirmed browser discovery, preserves newer selections from other tabs
and reloads into the original profile; storage errors prevent a reload loop.
Title-only source edits preserve the newest unchanged parsed projection,
including refresh metadata and detected EPG, while explicit caller refreshes
still save their own parsed payload. Two regression tests reproduced the
channel rollback before the fix. All 917 service tests pass after the fix,
including recovery, retained confirmed selections and concurrent URL/upload
M3U refreshes. Browser validation passes all 15 scenarios, including restored standalone
access after pending discovery, and mixed-runtime validation passes all five
PWA/Electron scenarios. The production bundle remains within the unchanged
limit at 1,198,933 bytes. The sixth committed-branch review follows integration
of the newly merged Portuguese regional locales.

### Current-master integration before review six

Merged master `e2699e92051987fd69d8355db0e56177197be00d` (Portuguese
regional locales) without conflicts and repeated the frozen dependency install.
The source-sync group now covers both `pt-BR` and `pt-PT`; all 21 translated
catalogues pass key, placeholder and markup checks. All 36 Tier A coverage
projects pass again: statements 84.78%, branches 75.75%, functions 83.00%,
lines 85.16%; coverage health passes. All 59 lint projects and all 41 spec
TypeScript programs pass, along with renderer/main type checks and release
notes. The production initial payload is 1,199,373 bytes against the unchanged
1,200,301-byte limit. The final Chromium run passes 16 scenarios (including
regional language persistence), and all five mixed PWA/Electron scenarios pass
again on the merged code. Physical NAS and packaged-platform smoke checks
remain in the release follow-ups above.

### Sixth review fixes before review seven

Codex reviewed `18599d076644c8f8c35df88f3b1385bc274a591d` and identified
two additional P2 cases: direct `crypto.randomUUID()` broke explicit source
imports on insecure LAN origins, and the move to profile-scoped pending
Xtream restore keys hid existing unprefixed archives. Both are addressed:
imports use the shared insecure-context-safe generator; strict pending reads
and writes adopt a verified legacy browser instance once, verify the copy
and receipt, preserve newer profile values and original archives, and prevent
consumed archives from resurfacing. Native and unverified profiles remain
isolated. Regression tests reproduced both failures before the fix.

The shared read-snapshot token and inheritance helper now have a small eager
module; projection reconciliation stays with the deferred sync engine. The
production initial payload is 1,199,068 bytes, within the unchanged limit.
Services, web and both affected Xtream projects pass, and merged coverage
passes at statements 84.79%, branches 75.76%, functions 83.00%, lines 85.17%.
The Chromium run passes 17 scenarios, including replay-safe legacy archive
exports and source import with `randomUUID` unavailable. All five mixed PWA/Electron scenarios pass again. Targeted lint, runtime
and affected spec type checks, release notes and agent guidance pass before
the seventh committed-branch review.

### Seventh review fixes before review eight

Codex reviewed `916d5f8ed00dd44b4caa0f8cf51acc8d5ffbea30` and reproduced
two P2 cases. A sibling tab that found its shared IndexedDB already updated
failed to notify its own NgRx consumers; each tab now publishes a collection
revision change regardless of who wrote the projection. Legacy playlist
adoption also omitted hidden groups and curated EPG state; the seed now
retains those preferences and local ordering alongside favorites/history.
Both regression tests failed before the fixes and pass afterwards. All 928
service tests pass, targeted lint and type checks pass, and merged coverage
passes at statements 84.80%, branches 75.76%, functions 83.02%, lines 85.18%.
All 18 Chromium scenarios pass, including two tabs sharing one IndexedDB and
verification of migrated hidden groups and EPG selections in the stored row.
The initial payload stays at 1,199,068 bytes within the unchanged limit.

All five mixed PWA/Electron scenarios pass again. Release-note and agent
guidance validation pass before the eighth committed-branch review.


### Eighth review fixes before review nine

Codex reviewed `66061f2fed3b0a78b03f5adf0925f73719f36c90` and found three
issues. Browser authorization now requires a successful anonymous probe of the
selected instance. Failed inventory refreshes revoke verification, and source
HTTP, Angular HTTP and fetch-based provider proxy transports block the complete
request until re-verification, including its provider credentials. The Chromium
regression verifies replacement at the same URL both in an open client and on
reload with an active cached source; no saved token or provider request escapes.

Synchronized Electron inventory reads now reuse the existing lightweight native
metadata API. Browser metadata excludes parsed/raw M3U bodies and source
baselines. Shared editors load one complete row before enabling edits and retain
its source baseline/revision for conditional writes. The Xtream connection test
is rebound to that hydrated form. Stale-source cleanup also uses native metadata
when available. These changes need no database schema or worker protocol change.
An active Stalker title update now refreshes the current store label without
resetting categories, selection, session authentication or the watchdog timer.

An additional source-fingerprint regression preserves trailing slashes inside
signed URL query values, keeping distinct credentials from being deduplicated.
Targeted tests cover all four fixes. Chromium passes 19 production PWA scenarios,
and the mixed PWA/Electron suite passes all five scenarios. Runtime-config and
replacement-response mocks explicitly block Service Workers; the separate real
Service Worker stylesheet test remains enabled. The affected unit/coverage
projects, lint, application/spec/E2E type checks, release notes and agent guidance
pass. The E2E harness check uses ES2022/DOM library types for its existing
`replaceAll` calls. Optional favorites sync, NAS-managed EPG and playback progress
remain follow-ups above, outside this source-only delivery.

Final pre-review production build passes at 1,199,406 initial bytes within the
unchanged 1,200,301-byte limit. Merged coverage across 36 projects passes at
statements 84.81%, branches 75.76%, functions 83.04%, lines 85.19%. Two advisory
same-name-spec warnings remain for the HTTP adapters covered by their owning
unit projects and browser/mixed-runtime E2E suites.


### Ninth review fixes before review ten

Codex reviewed `a2861dc095ff7f4febb2e30f04d5e32fd72eaa51` and reproduced two
P2 cases. Startup now waits only for local profile readiness and starts network
refresh in the background. A slow M3U provider cannot hold Angular behind the
splash; cached sources, settings and disconnect remain accessible. The first read of an incomplete
cache stays deferred until refresh settles; a failed projection rejects reads
rather than exposing a false empty library. Server settings bypass the source
loading screen through a recovery link in the connection banner. A successful
projection reloads mounted consumers through the existing change notification. Regression tests cover
both first connection and an already initialized cache.

Pending instance promotion now checks that the saved connection still matches
the captured pending selection. A newer connection or disconnect wins; the old
tab reloads without rewriting it or clearing its discovery-disabled marker.
Initial runtime discovery also preserves a choice made while its anonymous
probe was in flight. Regressions cover connect, disconnect and normal promotion.

An additional test reproduced an unchanged active Xtream source label after a
remote rename. The route session now updates its current name/title without
resetting the session, rechecking portal status or reimporting the catalog. The
test fails before the fix and passes afterwards. Playlist mapping/bootstrap
helpers moved to `xtream-route-playlist.ts` to keep the route owner below the
400-line hard limit without changing that limit or the legacy baseline.

Final checks before review ten pass: 938 service tests, 641 Xtream feature
tests and the complete web unit project; 21 Chromium production PWA scenarios
and all five mixed PWA/Electron scenarios. Browser regressions exercise delayed
provider responses on first/cached startup and pending recovery after another
tab disconnects. Source inventory readiness still guards the workspace; server
settings remain accessible while it is pending or failed.

Merged coverage across 36 projects passes at statements 84.82%, branches
75.78%, functions 83.05%, lines 85.20%. Four advisory same-name-spec warnings
remain for private helpers/adapters/views covered by owning projects and E2E.
The production initial payload is 1,199,678 bytes within the unchanged
1,200,301-byte limit. Affected lint and application/spec/E2E type checks, release
notes and agent guidance pass. No coverage or line-count limits were weakened.


### Tenth review fixes before review eleven

Codex reviewed `9a847e409dede9a5f733801a9bd2a81279a3f98a` and reproduced
a P2 normalization mismatch after a native SQLite round trip. An empty optional
header survived in the accepted source baseline but read back as `undefined`
in the local row. Device-only favorites/history writes then attempted a source
PATCH and failed while offline. Source equality now compares the effective
SQLite representation of projected string fields, including trimmed/empty
values, without modifying inputs. Raw M3U and payload-only Stalker identity
remain exact. Offline-write regressions for all three headers fail before the
fix and pass afterwards, with no server request.

A further capability regression proves that a browser with an unrelated
`window.electron` object can still resolve pending discovery when the source
bridge is absent. The branch now checks the specific source-connection bridge
rather than generic Electron presence, following the runtime capability contract.
This regression also fails before the fix and passes afterwards.

Before review eleven, all 942 service, 659 interface and 241 web-backend tests
pass. Chromium passes all 21 scenarios and mixed PWA/Electron all five.
Application/spec type checks, affected lint, release notes and agent guidance
pass. The unchanged initial-byte limit passes at 1,199,678 bytes. Merged
coverage across 36 projects passes at statements 84.82%, branches 75.79%,
functions 83.05%, lines 85.20%, with advisory private-helper/view spec warnings.
No coverage, payload or line-count gate was weakened.


### Eleventh review fixes before review twelve

Codex reviewed `74f5aaaef1f29d4e39cf64c8aa44a4acc856ee51` and reproduced
two issues. A source mutation rejected with `409 instance_changed` now revokes
verification immediately, before propagating the error, and preserves the
identity-change recovery message. A unit regression and browser edit-to-proxy
scenario verify that neither the NAS token nor provider credentials can be
sent afterwards. Anonymous refresh probes keep checking the selected identity.

The native pending-favorites converter now enumerates and reads the selected
profile namespace, matching the pending-restore service. A standalone archive
with an identical playlist ID can no longer seed the server-profile SQLite
database. Regressions cover explicit playlist reads, collection-wide reads,
profile-owned archives and preservation of the original archive. All five new
unit cases fail before the fixes and pass afterwards. A new native E2E case
checks the same-ID isolation through the real favorites view and SQLite bridge.

Before review twelve, all 947 service tests pass, as do all 22 Chromium
production PWA scenarios and all six mixed PWA/Electron scenarios. The native
archive-isolation scenario confirms its source snapshot survives a full app
restart while the server-profile favorites table remains empty. Affected
lint and application/spec/E2E type checks, release notes and agent guidance
pass. Merged coverage across 36 projects passes at statements 84.83%, branches
75.80%, functions 83.05%, lines 85.20%, with an advisory same-name-spec warning
for the converter covered by service tests and native E2E. Production initial
bytes pass at 1,199,844 within the unchanged 1,200,301-byte limit.

### Current-master integration and token ownership before review twelve

Master advanced to `bc4d24e148a218b8c84603ac6ce6a802762da5e1` (PR #2008,
contrast/search recovery). It merged without conflicts; frozen installation and
Nx discovery were repeated and the installed lock matches. The seven changed
unit projects, 22 Chromium scenarios, six mixed-runtime scenarios and the new
light/dark/mobile workspace contrast E2E passed on the merge.

An additional regression reproduced reuse of a previous instance's session
token after another tab selected a replacement database at the same API address.
Browser token keys now bind the API address and instance ID as a tuple, and
all save, sign-in, promotion and disconnect paths use that binding. Unbound
legacy entries are never forwarded automatically. The regression fails before
the change and passes afterwards. A browser scenario also verifies that the
replacement receives no old Authorization header, then connects successfully
with its own explicitly entered token.

Final merged checks before review twelve pass: 948 service tests, the complete
web unit project, all seven changed upstream unit projects, 23 Chromium source/
self-hosted/PWA scenarios, six mixed-runtime scenarios and the upstream
light/dark/mobile workspace contrast E2E. Affected lint, application/spec/E2E
type checks, 21-catalogue translation validation, 165 release notes and agent
guidance pass. Merged coverage across 36 projects passes at statements 84.83%,
branches 75.81%, functions 83.04%, lines 85.21%, with advisory private-helper/
view spec warnings. The initial payload is 1,200,177 bytes within the unchanged
1,200,301-byte limit. Physical NAS and packaged platform checks remain release
follow-ups; no release or external deployment was performed.

### Twelfth review fixes before review thirteen

Codex reviewed `ea5e403705dd697674f6aaa2608704e40dbef4ba` and found two
recovery gaps. Browser provider failures now revoke source identity verification
for both HttpClient and raw fetch. Retrying waits for a deduplicated anonymous,
uncached instance probe. A generation check prevents a late proof from reopening
authorization after a newer outage. Existing inventory subscriptions and the
proxy guard are deferred so standalone startup retains its payload budget.

Unreadable native connection configuration now selects an isolated recovery
profile instead of aborting startup or opening the standalone library. The
settings page permits explicit repair/disconnection. Native saves use a flushed
private temporary file and atomic rename. Synchronous preload errors are
serialized without configuration contents. The native recovery E2E verifies
retention of the original library and its restoration after disconnect/restart;
the test owns the restart instead of spawning an untracked Electron process.

Nine regression cases reproduce on the prior implementations (two raw-fetch,
four HttpClient and three configuration cases). Affected full unit projects
pass: 951 service, 563 web and 2,702 Electron backend tests. Merged 36-project
coverage passes unchanged gates at statements 84.84%, branches 75.81%, functions
83.05%, lines 85.22%, with advisory same-name-spec warnings for deferred wiring
and its status view. Six existing mixed-runtime scenarios pass; the seventh,
new recovery scenario passes after correcting test-owned relaunch. Application,
spec/E2E types and owning lint pass. Two production browser outage/replacement
scenarios were added for final validation. Master subsequently advanced with
Vite 8.1.6, which will be included before the next local review.

Final checks before review thirteen include master `00c8284acdc1ed68dc5a89731e30dfbf50776ffb`
(Vite 8.1.6). Frozen install, installed-lock comparison and Nx discovery pass.
Browser connection writes now live in a deferred settings module; raw fetch adds
its authorization headers once at the guarded transport boundary. The unchanged
launch/renderer.initialBytes gate passes at 1,200,296 bytes (limit 1,200,301).

All 25 Chromium production PWA scenarios and all seven mixed PWA/Electron
scenarios pass. The outage scenarios explicitly re-check an edited connection
in the same running app, proving an anonymous identity probe precedes further
provider traffic. The identity-rejection scenario observes new proxy requests
after the rejection is applied, excluding valid background health calls that
can precede that response. Updated service/web coverage passes again; the full
Electron backend project also passes (951 / 563 / 2,702 tests respectively).
Merged 36-project coverage remains statements 84.84%, branches 75.81%, functions
83.05%, lines 85.22%. Owning lint and application/spec/E2E types, release-note
validation and agent guidance pass. Same-name-spec warnings are advisory;
connection mutations are covered by the connection/discovery/service suites
and production browser scenarios. No validation thresholds were changed.

### Thirteenth review fixes before review fourteen

Codex reviewed `a3c92af8a4baeb4d2faac4cab34ee014f58fb39e`. Its reproduced
P1 came from nullable optional identity controls in the source editor reaching
source serialization through the real playlist metadata merger. Definitions
now omit absent null fields, and comparisons treat them as absent, while the
server API keeps rejecting null input. Regression coverage uses Angular form
controls, the real `PlaylistsService.updatePlaylistMeta` path and the synced
store for M3U URL, uploaded M3U, Xtream and Stalker renames. A production PWA
scenario edits through the actual dialog and observes the rename on a second
client. Explicit false boolean options remain preserved.

Its P2 was a missing native cleanup hook after remote source deletion. SQL
removes relational sidecars; both runtimes now also invoke the shared hooks,
including parental-lock JSON and in-memory cleanup. The native E2E seeds the
real lock store, restarts, deletes remotely and recreates the same source ID;
the old locks remain absent. The parental-lock and PWA contracts were updated.
All six new unit regressions fail before the fixes and pass afterwards.

Final checks pass: 25 Chromium production PWA scenarios, eight mixed PWA/
Electron scenarios, all 956 service and 660 shared-interface tests. The affected
raw-fetch suite also passes (27 tests); the prior full web/backend results remain
563 / 2,702 tests. Merged coverage across 36 projects passes unchanged gates:
statements 84.84%, branches 75.83%, functions 83.05%, lines 85.22%, with advisory
same-name-spec warnings for the source settings module/barrel. Owning lint and
application/spec/E2E types pass. Shared browser setup was extracted to a helper
to preserve the 1,200-line test-file limit without changing the limit/baseline.

The PWA build passes its initial-byte limit. The exact production build command
used by CI was also run without the Nx cache and passes at 1,200,285 bytes,
within the unchanged 1,200,301-byte launch/renderer.initialBytes limit. A duplicate
redirect option was removed from a raw-fetch caller; its transport continues
setting redirect:error centrally. Release notes and agent guidance validate.

### PR #2013 review follow-up before local review fifteen

Local Codex round fourteen and GitHub Codex both accepted
`d59754c2f3663d3f8ea93cc9bdac034e5fbbfc02` without actionable findings; the local
review independently ran 1,957 tests. PR #2013 was opened and attached. Greptile
then identified two valid gaps: source-write outages retained authorization,
and failed local deletion cleanup was forgotten after the source row disappeared.
Both are addressed together before the next push; no findings are declined.

The shared browser source transport now revokes proof on network/parse failures,
server 5xx, rejected tokens and instance-change responses, including direct
import callers. Logical conflicts retain their normal conditional-write behavior.
Provider retries re-probe anonymously before carrying saved secrets. Twenty-one
new transport/service regression cases failed against the previous code. Extra
coverage verifies direct imports, JSON 5xx and the provider retry boundary.

`SourceCleanupQueue` writes a profile-local marker per source ID before deleting
cache rows or clearing the inventory. Hooks and marker removal are retryable;
failed work survives row deletion and restart. Refresh and source mutations finish
pending work before incoming IDs can be reused. Per-ID keys preserve work from
other tabs/profiles. Failed marker persistence prevents deletion; unsuccessful
SQL deletion never clears locks prematurely. A native E2E uses real SQLite
triggers to fail parental-store writes, restarts the app, then verifies cleanup
and safe ID reuse. No schema or migration change was needed.

A temporary managed worktree validated the exact GitHub merge commit
`90b94edd83665f2afbdbd41b0b6a938b8c42ee13`: 956 service and 94 shared-TMDB tests
passed, but initial bytes exceeded the limit by 308. Master #2009 was merged
into this branch as `14714ae76738cd2f9dd272d13e09f33c5d322beb`; frozen install,
lock comparison and Nx discovery were repeated. The temporary checkout was
archived. Authorization now lives in a deferred transport module; bootstrap
selects the namespace and does not grant secret-bearing access. Standalone
fetch behavior keeps its synchronous start. The exact CI production build
passes at 1,200,187 bytes, within the unchanged 1,200,301-byte limit.

Final local results before review fifteen: all 27 production Chromium PWA
scenarios and nine mixed-runtime scenarios pass; 986 service, 564 web and
94 shared-TMDB tests pass with coverage. Merged 36-project coverage passes at
statements 84.94%, branches 75.93%, functions 83.11%, lines 85.32%. Advisory
same-name-spec warnings include upstream TMDB files and the authorization
module covered by the connection/transport suites. Affected lint, application/
spec/E2E types, 168 release notes and agent guidance validate. Prior shared-
interface/backend results remain 660 / 2,702 tests. No gate was weakened.

### Current VOD integration before local review fifteen

Master advanced again with #2007 (`197efc0ae2ac4f1d853edf07f21a52d59911092a`),
including PWA Xtream data-source changes. It merged without conflicts as
`865346d87`; frozen install, lock comparison, Nx discovery and the updated
Xtream skill/compatibility contract were checked. No further source-sync code
changes were needed for that integration.

All 27 production PWA scenarios pass again, as does the shared Xtream/Stalker
PWA/Electron playback scenario. The complete nine-scenario mixed suite passed
for the source transport/journal fixes; the affected provider scenario was
repeated after #2007. Coverage passes with all 986 service, 564 web, 648 Xtream
data-access and 514 Xtream feature tests. Merged 36-project coverage is now
statements 84.95%, branches 75.97%, functions 83.13%, lines 85.33%, with advisory
same-name-spec warnings. All 94 shared-TMDB tests passed on the preceding
integration. Exact CI production initial bytes pass at 1,200,246 within the
unchanged 1,200,301 limit. Six affected lint projects, application and affected
spec/E2E types, 21-catalogue i18n, release notes, skills and agent guidance pass.

### Local review fifteen and CI follow-up

Codex reviewed committed revision `fcce412fcabad6569f6d11bd2f3e60f10288c18a`
and found two valid P2 issues. An interrupted first native synchronization could
deadlock while deleting cached rows: parental cleanup awaited settings, whose
EPG reconciliation awaited source initialization. Cleanup now releases that
initialization wait before awaiting hooks; the store still rejects incomplete
inventory until projection succeeds. The regression failed before the fix.
A real native restart scenario seeds an incomplete receipt and parental locks,
deletes the source remotely, then verifies initialization and lock removal.

Discovery now preserves standalone behavior for legacy stateless backends that
return HTTP 404 without JSON. Pending discovery can return to the original
library after the same response; confirmed server profiles retain their cache
and recovery controls. The transport revokes previous proof on discovery 404.
Unit regressions and production PWA scenarios cover initial and pending legacy
discovery. The initial-discovery regression failed against the previous code.

The first published revision's CI exposed a missing component-local Material
form-field defaults provider in Server settings. The component now supplies the
shared provider; the exact repository guard fails before this addition and
passes afterwards. The same CI round confirmed the initial-bytes failure already
reproduced and fixed locally, while Docker, platform builds and most platform
E2E checks passed. These older-head checks are not the final merge gate.

Final local checks before review sixteen pass: 29 Chromium production PWA
scenarios and ten mixed PWA/Electron scenarios; all 990 service and 564 web
tests with coverage. Merged coverage across 36 projects passes unchanged gates
at statements 84.95%, branches 75.98%, functions 83.13%, lines 85.33%.
The first browser run exceeded the existing 30-second deadline in the shared
source rename scenario; the complete rerun with tracing passes, including that
scenario in 17.4 seconds, without changing its deadline. Four owning lint
targets, application/spec/E2E types, Material form-field/theme guards, Playwright
task graphs, 169 release notes and agent guidance pass. Exact CI production
initial bytes pass at 1,200,265 within the unchanged 1,200,301-byte limit.
The base remains `197efc0ae2ac4f1d853edf07f21a52d59911092a` after fetching.

### Local review sixteen: durable readiness before conditional refresh

Codex reviewed `1bc7a94b21eca7d7a049a72da70ff4384a9d02eb` and reproduced one
valid P2: a rejected initialization-receipt write left the collection ETag
advanced while the store remained unreadable. A later HTTP 304 then reported
connected without retrying the receipt or notifying views. The revision now
advances only after receipt persistence succeeds. An explicit unsuccessful
bridge result also remains a recoverable failure. Both new unit regressions
fail before the fix and pass afterwards, covering recovery and a subsequent
unchanged refresh without duplicate notifications. The native SQLite fault
fixture also covers initialization-receipt writes during interrupted startup.

An interrupted local test run left its synthetic backend alive, invalidating
the next mixed suite by reusing that process's library. The owned leftover
process was terminated. Fixture readiness now requires the spawned backend's
own listening message before probing health, so another process cannot make a
new fixture appear ready. No application data or developer server was touched.

Final validation before review seventeen passes: all 11 mixed PWA/Electron
scenarios and all 29 production PWA Chromium scenarios; all 992 service tests
with coverage. The prior 564 web tests remain current for the unchanged web
component code. Merged 36-project coverage passes at statements 84.95%,
branches 75.99%, functions 83.13%, lines 85.33%. Owning lint, application and
affected spec types, release notes and guidance pass. The exact CI production
build passes its unchanged initial-byte limit at 1,200,269 / 1,200,301 bytes.
The latest base fetch still resolves to `197efc0ae2ac4f1d853edf07f21a52d59911092a`.

### Published review seventeen and CI command-contract correction

Codex accepted `d43df3484f19b368d0973f886645ff8b2a188808` without actionable
findings and independently ran 2,283 passing tests. That commit was pushed to
PR #2013, its description updated, and both fixed Greptile threads resolved.
No findings were declined; Greptile CLI remains unavailable (exit 127).

The exact GitHub merge with master #2010, `c86633b4ea2f759c79ff27caef14d44c7b823995`,
was built in a separate managed checkout after frozen install, lock comparison
and Nx discovery. Production build and form-field defaults pass; initial bytes
are 1,200,267 within the unchanged 1,200,301-byte limit. The temporary worktree
was archived. The published CI also passes initial bytes, Docker, CodeQL, lint
and the release-note gate.

CI's performance-harness tests then found the new `source-sync` target using
`pnpm exec playwright`. The existing command contract requires direct binaries
because Nx already adds node_modules/.bin to PATH and nested pnpm can change
the target cwd. Local reproduction fails the same deterministic guard. The
target now invokes `playwright` directly; no test or threshold was changed.
The complete harness passes with 693 tests and its existing Windows-only shell
test skipped on macOS. Both interrupted-startup native scenarios pass through
the corrected target. Task-graph, owning lint, guidance and release-note gates
pass. Runtime source-sync code is unchanged from the reviewed commit.


### Local review eighteen and web CI fixture correction

Codex accepted `90298e515daefab7a90ea3a4d359f4ed42768128` without actionable
findings and independently passed 114 source-sync tests and three source-router
tests. Greptile CLI is still unavailable (exit 127). The complete published CI
round finished: all Electron shards and package builds on Windows, Linux and
macOS pass, alongside Docker, CodeQL, lint and initial-byte checks. Its only
failed jobs are the command-contract guard corrected above and Web E2E.

Web CI reports four failures: three sparse VOD variants and a conflicting
favorite's removal assertion. All four reproduce locally before correction.
The VOD fixture explicitly configures a backend but never answers instance
discovery, so startup correctly waits for the unavailable source inventory.
The fixture now identifies its mock as a stateless proxy before bootstrap.
Favorite removal awaits an asynchronous identity lookup/write; the assertion
now waits for persisted removal and also verifies that the saved card disappears.

Production verification exposed that the favorites fixture had only intercepted
the development backend address, while the built PWA uses a different default.
It now sets the mock backend explicitly, answers stateless discovery and blocks
Service Workers so routes remain intercepted after a cold reload. All eight
availability tests and three VOD variants pass on the production build, together
with the existing 29 source/self-hosted/style/locale scenarios: 40 passed.
An overbroad exploratory static selector also selected unrelated dev-only
fixtures whose backend defaults are not configured for production; the final
static validation explicitly selects the six affected/supported spec files.
The exact production build and unchanged initial-byte gate pass again at
1,200,269 / 1,200,301 bytes. Owning lint and E2E type checks pass. These changes
only correct test fixtures and assertions; runtime code remains at the reviewed
`d43df3484f19b368d0973f886645ff8b2a188808` revision.

The complete Chromium suite also passes with the CI settings: 218 passed,
one existing static-PWA-only scenario skipped in development, no failures or
retries (14.6 minutes). Production static verification runs that stylesheet
scenario separately among the 40 passing tests above. Generated test screenshots
were restored or removed; they are not part of this change. The base fetch
still resolves to master `fbda4564ac8860c55f8341283cfbce8b82cc067f`.


### Local review nineteen: native identity and accepted M3U edits

Review of `eb31afbdf70447461efc42425c3d10997386472c` found two valid issues;
that commit was not pushed. A native import could bypass the renderer service
state after an instance mismatch and disclose the saved token/source body.
An accepted local M3U URL/body edit could retain the old parsed channels while
recording the new revision, preventing future polls from repairing the cache.
No findings were declined. The user has explicitly authorized continued fixes
and review beyond the five-round cap.

`SourceServerTransport` now owns main-process identity proof for every source
IPC request, including direct imports. It probes anonymously before decrypting
or sending a token/body, revokes proof after identity/auth/transport failures,
and binds proof to API URL plus instance ID. Generations prevent a late probe
from restoring authorization after a newer failure or connection selection.
Explicit connection checks also bind their list request to the probed instance.
Six native IPC regressions fail before the fix and pass afterwards. A separate
transport test covers a late response from a previously selected profile.

Accepted connection/body edits now materialize against the prior definition
before persisting the accepted revision, preserving the caller device fields.
A failed URL fetch remains pending, forcing a later projection attempt instead
of accepting an unchanged inventory forever. All three new URL/raw-text/retry
regressions fail before the fix and pass afterwards. Existing title-only edits,
concurrent channel refresh and local-activity tests continue passing.

Validation passes: 995 service tests, 2,709 Electron backend tests and merged
36-project coverage (statements 84.96%, branches 76.01%, functions 83.14%, lines
85.34%) with unchanged gates and no coverage-health warnings. The nine source
suites pass 117 tests. The exact CI production build without the Nx cache passes
at 1,200,266 / 1,200,301 initial bytes. Instrumented Electron E2E output is not a
production payload measurement; the exact production build supplies this gate.

All 41 selected production PWA scenarios pass, including an editor regression
where changing User-Agent replaces the writing client channels and survives a
reload. URL itself is currently a read-only editor field; URL and raw-body edits
are covered at the storage boundary. The helper keeps the serial server-storage
spec below its unchanged 1,200-line limit. All 11 prior mixed PWA/Electron cases
pass; the added native identity case passes separately against an observing HTTP
fixture. It verifies that a replacement instance receives only anonymous probes,
then confirms recovery against the original identity. Its first fixture attempt
used page.reload on a file route; the corrected case uses the normal connection
Refresh action. No application reload behavior was changed.

Owning lint, application/spec/E2E types, release notes and guidance pass. The
canonical self-hosted contract records native proof revocation and local edit
materialization. The existing feature release note covers these fixes. The
prior full Chromium result (218 passed, one static-only skip, no retries) belongs
to the pre-runtime-fix commit; the affected production scenarios above were
rerun after these changes, and PR CI will exercise the complete combined tree.


### Review twenty and master integration (2026-10-27)

Codex accepted `a71848a45afd57d46a4fca99747e454533c57a0d` with no actionable
regressions and independently passed 200 focused tests. Greptile CLI remains
unavailable (exit 127). All 30 GitHub checks then passed on merge
`606c1f480a587a02c2dc0eba7217e19e328c0b85` with master
`fbda4564ac8860c55f8341283cfbce8b82cc067f`: unit/type/coverage gates, 220 Chromium
tests (one static-PWA-only skip, no retries), all nine Electron shards across
Windows/Linux/macOS, every installer build, Docker, CodeQL, performance gates
and the automatic PR artifact draft job. Both GitHub review threads are resolved.

During that long CI run, master advanced to
`1f09b0f80f2b296854ea162fddbd6ba62022c649` (#2014). The final readiness check
caught two conflicts before reporting the PR ready. The favorite-removal test
had independently received the same async-persistence correction upstream;
retain the polling assertion and disappearance check together with the stateless
proxy fixture. The server-settings template had been replaced by this feature,
while upstream changed its former whole-document controls to shared kit roles.
Keep the source-only connection/import/recovery UI and apply those roles to its
controls: Connect and confirmed Import are accent actions; Refresh, preview
Import and Disconnect are secondary actions; Cancel keeps the ghost role.
The obsolete whole-document UI is not reintroduced.

The integration also incorporates #2010, already exercised by the previous
CI merge, into the branch ancestry. Frozen install, lock comparison and Nx
discovery pass after the merge. Two added browser cases verify the shared-source
server actions in light/dark themes. All 48 production PWA scenarios pass,
including those cases and the upstream radio keyboard/disabled-control checks.
All 12 mixed PWA/Electron cases pass as one suite, plus both native settings
kit cases. Web (564), UI components (467) and playlist import (118) tests pass
with coverage. Merged 36-project gates pass at statements 84.97%, branches 76%,
functions 83.14%, lines 85.35%. The pre-commit health output has four advisory
same-name-spec warnings on upstream settings/download views; their owning tests
and E2E cover the affected flows, and no fake specs or weakened gates were added.
The native/source core is unchanged from the previously reviewed and CI-tested
commit.

The exact production build without Nx cache passes at 1,200,262 / 1,200,301
initial bytes. Owning lint, application/spec/E2E types, release notes and guidance
pass. The current UI guidelines already define the merged action roles; the
existing source-sync feature note and upstream UI note cover this integration.
Repeat the committed-branch review gate before pushing this merge, then validate
the new PR merge tree. Do not infer readiness from the prior head checks.

### Current dialog-kit integration (2026-10-27)

Master advanced again to `0fb706dbc332b76f6c4b1308b4363c666672a421` (#2017)
before the committed-branch review. Integrate it without conflicts. The shared
playlist editor retains asynchronous source-row hydration while adopting the
upstream Stalker additional-settings disclosure. Its fields stay mounted when
folded. An added production-PWA regression creates a shared Stalker source on
the backend, hydrates its editor, folds the prefilled disclosure, renames the
source and verifies that all configured serial/device/signature/credential
fields remain on the server.

Frozen install, lock comparison and discovery of 61 Nx projects pass. All 49
selected production-PWA scenarios, all 12 mixed PWA/Electron scenarios, the
three upstream browser action cases, the native playlist-dialog case and all
four native playback-diagnostics cases pass. The production-PWA stylesheet
case uses a real Service Worker; routed backend fixtures block it explicitly.

Full owning coverage passes for web (564), UI components (470), playback
(1,663), Xtream feature (648), EPG UI (338), portal shared UI (220), Stalker
feature (504), playlist import (119), playlist shared UI (172), shared
interfaces (660) and Stalker data access (630). Merged 36-project coverage
passes unchanged gates at statements 84.97%, branches 76.01%, functions
83.14%, lines 85.35%; the four upstream advisory same-name-spec warnings from
the prior integration remain. Eleven owning lint projects, application/spec/
E2E types, translations, release notes and agent/skill guidance pass.

The exact production build without Nx cache passes at 1,200,261 / 1,200,301
initial bytes. The source runtime core remains unchanged from `a71848a45`,
whose full PR CI passed. The existing source feature note and upstream UI
notes cover this integration; no new release behavior is added. Run the local
reviewers on the committed combined branch before pushing, then require fresh
PR checks for that head rather than reusing the old CI verdict.
