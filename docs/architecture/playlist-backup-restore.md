# Playlist Backup/Restore Architecture

This document describes the versioned playlist backup/restore flow used by the
settings screen.

Server source import is a separate, definition-only operation in Settings →
Data → Server. It reads the retained standalone profile, previews its sources,
then creates or fingerprint-matches them on the server without restoring user
state or changing the original profile. Full backup import/export retains the
scope below; it is not the source-sync wire format. See
[shared source library](pwa-self-hosted.md#shared-source-library).

## Entry Points

- UI: `apps/web/src/app/settings/settings-backup-section.component.ts`
  (embedded in `settings.component.html`), with the file read/handoff in
  `apps/web/src/app/settings/settings-backup.facade.ts`
- Backup service: `libs/services/src/lib/playlist-backup.service.ts`
- Manifest types: `libs/shared/interfaces/src/lib/playlist-backup.interface.ts`
- Xtream pending restore storage:
  `libs/services/src/lib/xtream-pending-restore.service.ts`
- Browser (PWA) Xtream user state:
  `libs/services/src/lib/pwa-xtream-backup-state.service.ts`

## Manifest Contract

Backups are versioned JSON manifests, not raw `Playlist[]` dumps and not SQLite
database snapshots.

Top-level shape:

- `kind: "iptvnator-playlist-backup"`
- `version: 1`
- `exportedAt`
- `includeSecrets`
- `settings?.epgUrls`
- `playlists[]`

The manifest is portable across machines because it stores playlist definitions
and portable user state, while excluding cache-only database content.

## Export Scope

### M3U

M3U backups are self-contained.

- Always export canonical `rawM3u` from `PlaylistsService.getRawPlaylistById()`
- Preserve source metadata when available:
    - original source kind: `url`, `file`, or `text`
    - original URL
    - `userAgent`, `referrer`, `origin`
    - `filePathHint` for provenance only
- Export playlist-scoped user state:
    - favorites by channel URL
    - recently viewed M3U items
    - hidden group titles (exact strings, including surrounding whitespace)

The embedded raw text is the canonical restore artifact. The internal parsed
playlist object graph is not the backup format.

### Xtream

Xtream backups export connection metadata, desktop catalog selection, and portable user state.
The optional top-level `xtreamContentTypes` array contains `live`, `movie`, and/or
`series`; an empty array loads no catalogs, while absence retains legacy all-types
behavior. Restore validates this field and replaces the destination's selection.
Browser import preserves the metadata but does not apply desktop catalog filtering.

- Connection metadata:
    - `serverUrl`
    - `username`
    - `password`
- User state:
    - hidden categories by `{ categoryType, xtreamId }`
    - favorites by `{ contentType, xtreamId, addedAt?, position? }`
    - recently viewed by `{ contentType, xtreamId, viewedAt, backdropUrl? }`
      (`backdropUrl` is written and read by the browser build only)
    - playback positions as `PlaybackPositionData[]`
    - optional VOD source pins by `{ matchKey, contentId, updatedAt? }`
    - optional title snapshots `collectionItems` (browser build only; see
      [Browser runtime](#browser-runtime))

An imported Xtream archive can wait for its catalog to download. Export reads
that pending snapshot before consulting the catalog: its hidden categories,
favorites, history, and positions are authoritative, including empty lists.
Pending pins are authoritative when present; an absent `sourcePins` field keeps
the existing store's pins when that store is available, or stays absent when it
is unavailable. Re-export neither applies nor consumes the pending snapshot,
so it also works before the portal has been opened and in browser runtimes.
Parental category locks still come from the current lock store.

For desktop sources whose restored selection omits catalogs, history and hidden
category choices without an available catalog are parked separately under
`xtream-catalog-restore-<playlistId>`. This dormant record does not keep the source
in an active/failed import state. Re-export merges it with the current complete
history and category choices without consuming it. Re-enabling types merges their
parked data into the cache-refresh snapshot and consumes only the applied types;
it never replays old favorite removals, positions or source pins. Existing cached
catalogs can accept their data even when their import selection is disabled.
A new explicit archive has fresh receipt ownership and replaces older deferred
choices. Explicit history clearing and source deletion clear corresponding dormant
data. Storage failures retain the original active restore for retry rather than
acknowledging an incomplete restore.

Dormant records use the active source profile's storage prefix, including the
server instance ID in connected desktop mode. Export, replay, history clearing
and source deletion only read or mutate that profile. A replay snapshot also
retains its storage key, so switching profiles cannot consume an identical record
owned by another server. Standalone records keep their existing unprefixed keys;
they are not adopted by an unrelated server profile.
Electron Settings bulk deletion also clears dormant records after the native
delete succeeds; a failed delete retains them. Shared-source deletion keeps its
conditional per-source cleanup so newer sources in another tab remain untouched.

A failed pending-storage, recent-history or playback-position read fails export.
An unreadable collection must never be serialized as a successful empty collection.

Edit-time and ordinary Refresh cache recovery use an internal `preservePlaybackPositions: true`
policy because catalog replacement leaves position rows intact. Retry keeps the
current rows, including progress, additions and removals made after a failure.
Export during that recovery reads current positions rather than the parked
snapshot. The policy is excluded from archives and cleared on explicit backup
import, which still restores the archive's authoritative positions.
Its native history journal lives in profile-scoped SQLite `app_state`, using the
`xtream-history-recovery:` key prefix. Current watch updates and explicit removals
or clears update that journal in the same transaction as live history. Export
uses its current history and excludes already-owned or removed dormant entries;
explicit backup import clears the journal after parking the new archive and
passing restore preflight. Pending explicit-archive retries repeat that reset
before replay, and fail without changing history if it is still unavailable.
Older cache-only pending records migrate their unfinished-type history into the
journal before import or re-export; completed retained types keep current rows.
Cache replay is atomic and keeps the journal until
deferred state completes, so retry cannot undo intervening history actions.
Cache-pending exports reconcile hidden flags by current category identity too:
live visibility wins for present categories, while absent categories retain
their parked choices.

Explicitly excluded:

- cached categories/content rows
- import-status flags and other app-state cache markers
- downloads

### Stalker

Stalker backups export connection metadata plus playlist-scoped favorites/recent
state.

- Exported connection fields:
    - `portalUrl`
    - `macAddress`
    - `isFullStalkerPortal`
    - `username`
    - `password`
    - `userAgent`
    - `referrer`
    - `origin`
    - serial/device/signature fields when present
- Exported user state:
    - favorites snapshots
    - recently viewed snapshots

Explicitly excluded — session state, as opposed to the connection definition:

- `stalkerToken`
- `stalkerSessionIdentity` (the fingerprint the token was negotiated for)
- `stalkerWatchdogTimeout` / `stalkerTimeslot` (the profile-advertised cadence)
- `stalkerAccountInfo`
- playback positions in v1

### App Settings

Only EPG source URLs are backed up at the app-settings level.

Language preferences are local settings and are neither exported nor restored
by a playlist backup. Restoring EPG URLs preserves the current language and
other settings. Legacy local `pt` preferences normalize to `pt-BR` when loaded
or updated; the next settings write persists that canonical code.

- Exported: `settings.epgUrls`
- Excluded: cached EPG database content

## Import Flow

The settings backup facade (`settings-backup.facade.ts`, driven by
`settings-backup-section.component.ts`) reads the file (`file.text()`) and
hands its contents to `PlaylistBackupService.importBackup()`.

The service:

1. Validates the manifest kind/version and every entry before any writes.
   M3U favorites, history and hidden groups and Stalker favorites/history must
   be complete arrays of the expected element types. Source/connection fields,
   playlist identity/title and EPG URL settings are checked before processing
   even an earlier valid entry. Optional v1 extensions remain optional; Xtream
   ID-less historical entries still use the compatibility normalizer below.
2. Rejects legacy raw `Playlist[]` JSON blobs.
3. Builds stable source fingerprints for merge-vs-create decisions.
4. Upserts complete playlist documents through
   `PlaylistsService.restorePlaylist()`, under the normal playlist write queue
   and authority lock. Browser IndexedDB uses `put`, since `add` rejects an
   existing id; refresh's merge API is unsuitable because it preserves the
   current favorites instead of restoring the archive's explicit lists.
5. Restores provider-specific user state.

Fingerprint rules:

- M3U URL playlists: normalized URL
- M3U without URL: hash of canonical `rawM3u`
- Xtream: normalized `serverUrl + username`
- Stalker: normalized `portalUrl + macAddress`

If a fingerprint matches an existing playlist:

- keep the existing playlist ID
- update mutable metadata from the backup
- replace playlist-scoped state with the backup payload

If no fingerprint matches:

- create a new playlist
- reuse `exportedId` only when it is unused
- otherwise generate a new UUID

## Xtream Restore Contract

Xtream restore is type-aware end to end. The app no longer stores plain
`xtream_id[]` arrays for refresh/import restore because IDs can collide across
`live`, `movie`, and `series`.

Runtime contract:

- shared shape: `XtreamPendingRestoreState`
- persisted in local storage by playlist ID; selected source-server profiles
  prefix the key with their instance. A verified legacy browser instance adopts
  its unprefixed archive once before strict reads or mutations. Migration verifies
  the copy and receipt, preserves newer profile values and original archives,
  and prevents consumed snapshots from being reimported.
- consumed by:
    - Xtream refresh actions
    - settings backup import
    - Xtream content initialization

Restore state originates from untrusted sources (user-supplied backup files,
stale localStorage entries), so every read and write goes through
`normalizeXtreamPendingRestoreState` (`libs/shared/interfaces`). Entries in
`hiddenCategories`, `favorites`, and `recentlyViewed` without a usable numeric
`xtreamId` are dropped rather than restored: backups exported by builds
affected by issue #1017 contain ID-less hidden-category entries, and matching
them against category rows would otherwise degrade to a type-only comparison
that hides every category of that type. Category rows themselves cross the DB
worker IPC boundary in the snake_case wire shape declared by
`XCategoryFromDb`/`XtreamCategoryFromDb`; the category operations project
their Drizzle rows explicitly to keep that contract true.

Replacing the playlist's pins deletes by playlist and writes the replacements
in one transaction. It does not use the capped keyed-clear operation, which
could leave surplus pins behind. Any replacement failure fails the entry and
retains the pending snapshot for retry.

`sourcePins` (VOD multi-source) is the one **optional** collection, and the
normalizer preserves that: an absent field stays absent rather than becoming
`[]`, because restore treats a PRESENT collection as authoritative and clears
the playlist's existing pins before applying it. Materializing an empty array
would turn "this archive predates pins" into "this archive says there are
none": archives
written before multi-source existed simply do not have it, so its absence is
age rather than damage and only a wrong type is rejected. A pin is carried
under the playlist it points AT — exporting it anywhere else would restore a
preference for a portal the archive never contained. Its `matchKey` identifies
the film rather than the portal, so it survives untouched; only the playlist id
is remapped to the imported copy. Pins whose match key or content id is
unusable are dropped, since writing one would occupy the unique key of a film
it does not describe.

Electron restore behavior:

1. Category import reads pending hidden-category state while saving categories.
2. After content import, favorites/recent state is restored by typed
   `{ contentType, xtreamId }` matching.
3. Playback positions are replaced for the destination playlist in one SQLite
   transaction through `DB_REPLACE_ALL_PLAYBACK_POSITIONS`. Empty means clear;
   a failed insert rolls back the deletion and all earlier inserts.
4. VOD source pins are re-applied against the IMPORTED playlist id.

A rejected category visibility write fails the entry and retains its pending
snapshot. Both the visibility reset and the subsequent hide must succeed;
returning `false` is a storage failure, never a successful restore.

For existing Xtream playlists with a fully populated offline cache, backup
import applies the restore immediately. Otherwise the typed restore payload is
left pending until the next Xtream initialization/import. Both paths use strict
playback-position replacement: unavailable storage, rejected IPC, or an
unsuccessful response fail the restore and leave the pending snapshot intact.
Atomic restore support is checked separately from the ordinary Xtream SQLite
capability gate. An older preload missing the replacement method keeps using
SQLite for playback and backup export. Import parks the snapshot first, then
rejects unsupported atomic restore before checking catalog completeness or
writing category visibility, collections, positions, or pins. Deferred restore
performs the same preflight before applying user state. The retained snapshot
can be retried once atomic replacement becomes available. Ordinary playback
keeps its existing capability checks and best-effort persistence API.
The whole restore is not one database transaction; already applied
categories/favorites/history can
remain after a later failure, but the snapshot remains available to retry the
complete restore. It is consumed only after every restore step succeeds.

### Browser Runtime

Whenever `XTREAM_DATA_SOURCE` resolves to `PwaXtreamDataSource` — the
browser, or a desktop bridge without the Xtream SQLite API
(`RuntimeCapabilitiesService.supportsXtreamSqliteDataSource`) — Xtream
favorites, recently viewed items, playback positions and title snapshots live
in the `USER_DATA_STORAGE` maps owned by `PwaXtreamDataSource`
(`XTREAM_USER_DATA_KEYS`; see
[PWA portal user data](./pwa-self-hosted.md#pwa-portal-user-data)).
`PwaXtreamBackupStateService` reads and writes them through that token, so the
self-hosted server storage is covered too.

- Export converts each playlist's entries to the archive shape. Typed keys
  (`movie:42`) carry their identity; a legacy bare id resolves only through
  the snapshot stored under it, and is left out when none identifies it.
  Recently viewed keeps the newest view per title, with the artwork saved
  for that view as `backdropUrl`. `collectionItems` carries
  the snapshots of exported favorites and history, and is omitted when there
  are none. Hidden categories stay `[]` and `sourcePins` stays absent: the
  browser tracks neither.
- An unreadable map (storage error, malformed JSON, a playlist entry that is
  not a list) fails the export instead of being written as an empty list.
  So does server mode when it cannot read the server's user data: the
  export reads it again (`UserDataStorage.ready(true)`, as another device
  may have changed it since this page's first read) and fails when that
  read does not succeed. A restore does the same and stays parked, since its
  replacement lists would otherwise merge into the server's; it also stays
  parked until the server took that playlist's lists.
- A pending restore snapshot still wins over the stored maps, as on desktop.
- Import parks the restore state like the desktop does, then applies it at
  once through `XtreamPendingRestoreService.applyAndConsume`: the browser has
  no catalog cache to wait for. Favorites, history and positions of the
  imported playlist id are replaced (positions get that id); other playlists'
  entries are untouched. `collectionItems` merge into the playlist's
  snapshots, keyed by typed identity; an archive without them leaves the
  snapshots alone, malformed items are skipped, a damaged cache is replaced,
  and a quota error on this cache does not fail the restore.
- The lists are written before the optional title snapshots, so the cache
  never takes storage space they need (as for additions; see the
  [snapshot-storage contract](./xtream-portal-compatibility.md)). A failed
  write fails the entry and keeps the snapshot parked, so the Xtream store
  replays the complete state when the playlist next opens. That replay
  carries no title snapshots, so they are still merged after a failed list
  write, unless storage is full and they would take room the replay needs.

Older builds ignore `collectionItems`; the manifest version stays `1`.

## Current UX

The settings page now exports/imports “playlist backups” instead of the old
raw JSON application dump.

- Export filename:
  `iptvnator-playlist-backup-YYYY-MM-DD.json`
- Import summary reports:
    - imported
    - merged
    - skipped
    - failed

The settings facade guards import, file selection and export with one busy
state. Reset is disabled while backup work is active; backup actions are
blocked during reset. Cancelling the chooser or native save is a no-op, and
file-read/import failures release the busy state. Keyboard focus returns to
the import trigger after the playlist inventory finishes loading and the
router outlet is visible again, if the browser lost focus while that trigger
was disabled. Focus the user moved elsewhere is retained.

Import progress and the final counts live in a persistent, localized status
region on the backup page. A partial result explains that already applied
changes are retained and the archive can be retried. Raw archive, parser and
storage errors are not shown or logged by this facade, since their text can
contain credentials. Export errors use the settings dismissible error toast.

Validation is a preflight, not a cross-store transaction. Invalid structure
causes no writes; an operational storage failure after a valid archive starts
can leave completed entries or steps in place. The pending Xtream snapshot
supports retry. SQLite positions and pins retain their own transactional
replacement guarantees described above.

Regression coverage: `playlist-backup.service.validation.spec.ts`,
`playlist-backup.service.xtream-restore.spec.ts`,
`settings-backup.facade.spec.ts`, browser `backup-restore.e2e.ts`, and Electron
`backup-roundtrip.e2e.ts`. Browser tests use isolated contexts and fictional
archives; Electron tests use their own temporary data root.
