# Playlist Backup/Restore Architecture

This document describes the versioned playlist backup/restore flow used by the
settings screen.

## Entry Points

- UI: `/Users/4gray/Code/iptvnator/apps/web/src/app/settings/settings-backup-section.component.ts`
  (embedded in `settings.component.html`), with the file read/handoff in
  `/Users/4gray/Code/iptvnator/apps/web/src/app/settings/settings-backup.facade.ts`
- Backup service: `/Users/4gray/Code/iptvnator/libs/services/src/lib/playlist-backup.service.ts`
- Manifest types: `/Users/4gray/Code/iptvnator/libs/shared/interfaces/src/lib/playlist-backup.interface.ts`
- Xtream pending restore storage:
  `/Users/4gray/Code/iptvnator/libs/services/src/lib/xtream-pending-restore.service.ts`

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
    - hidden group titles

The embedded raw text is the canonical restore artifact. The internal parsed
playlist object graph is not the backup format.

### Xtream

Xtream backups export only connection metadata plus portable user state.

- Connection metadata:
    - `serverUrl`
    - `username`
    - `password`
- User state:
    - hidden categories by `{ categoryType, xtreamId }`
    - favorites by `{ contentType, xtreamId, addedAt?, position? }`
    - recently viewed by `{ contentType, xtreamId, viewedAt }`
    - playback positions as `PlaybackPositionData[]`

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

Explicitly excluded:

- `stalkerToken`
- `stalkerAccountInfo`
- playback positions in v1

### App Settings

Only EPG source URLs are backed up at the app-settings level.

- Exported: `settings.epgUrls`
- Excluded: cached EPG database content

## Import Flow

The settings backup facade (`settings-backup.facade.ts`, driven by
`settings-backup-section.component.ts`) reads the file (`file.text()`) and
hands its contents to `PlaylistBackupService.importBackup()`.

The service:

1. Validates the manifest kind/version before any writes.
2. Rejects legacy raw `Playlist[]` JSON blobs.
3. Builds stable source fingerprints for merge-vs-create decisions.
4. Upserts playlists into app playlist storage.
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
- persisted in local storage by playlist ID
- consumed by:
    - Xtream refresh actions
    - settings backup import
    - Xtream content initialization

Electron restore behavior:

1. Category import reads pending hidden-category state while saving categories.
2. After content import, favorites/recent state is restored by typed
   `{ contentType, xtreamId }` matching.
3. Playback positions are cleared and re-applied from backup state.

For existing Xtream playlists with a fully populated offline cache, backup
import applies the restore immediately. Otherwise the typed restore payload is
left pending until the next Xtream initialization/import.

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
