# Playlist Backup/Restore Architecture

This document describes the versioned playlist backup/restore flow used by the
settings screen.

## Entry Points

- UI: `apps/web/src/app/settings/settings-backup-section.component.ts`
  (embedded in `settings.component.html`), with the file read/handoff in
  `apps/web/src/app/settings/settings-backup.facade.ts`
- Backup service: `libs/services/src/lib/playlist-backup.service.ts`
- Manifest types: `libs/shared/interfaces/src/lib/playlist-backup.interface.ts`
- Xtream pending restore storage:
  `libs/services/src/lib/xtream-pending-restore.service.ts`

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

`includeSecrets` is an enforced security boundary, not just a UI hint. New
exports set it to `false` unless the user explicitly opts in. An import that
declares `includeSecrets: false` but contains gated credential/device fields is
rejected before writes. Older version-1 manifests that omitted the field retain
their legacy secret-bearing interpretation for backward compatibility.

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

- Connection metadata always includes `serverUrl`.
- Default redacted export adds `credentialsOmitted: true` and contains neither
  username nor password.
- Explicit secret export includes `username` and `password`.
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

- Required exported connection fields:
    - `portalUrl`
    - `macAddress`
- Optional non-secret connection fields, exported when present:
    - original `sourceUrl`
    - `isFullStalkerPortal`
    - profile preset
    - non-secret transport configuration
    - `userAgent`
    - `referrer`
    - `origin`
- Explicit secret export additionally includes:
    - `username`
    - `password`
    - structured identity overrides
    - legacy serial/device/signature fields when present
- Exported user state:
    - favorites snapshots
    - recently viewed snapshots

Explicitly excluded:

- `stalkerToken`
- `stalkerAccountInfo`
- `stalkerLandingUrl`, `stalkerRequestRecipe`,
  `stalkerRecipeClassifierVersion`, and `stalkerLastVerifiedAt`
- live cookies, handshake randoms, leases, challenges, and playback contexts
- playback positions in v1

Compatibility `portalUrl` remains exported as connection metadata. Restore
re-resolves from `sourceUrl` when it is present.

The opt-in warning remains necessary even for a redacted backup: portal hosts,
MAC addresses, and private M3U source URLs can still be sensitive.

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

Base fingerprint rules:

- M3U URL playlists: normalized URL
- M3U without URL: hash of canonical `rawM3u`
- Xtream: normalized server URL, then the exact principal when credentials are
  present
- Secret-bearing Stalker: normalized source + MAC + profile + exact effective
  identity/transport. A matching exported ID is preferred; otherwise exactly
  one exact username/principal match is required. The password is never part
  of the fingerprint, so an exported-ID match may patch it. Structured
  identity/transport wins, with equivalent legacy fields as fallback

If a fingerprint matches an existing playlist:

- keep the existing playlist ID
- update mutable metadata from the backup
- replace playlist-scoped state with the backup payload

If no fingerprint matches:

- create a new playlist
- reuse `exportedId` only when it is unused
- otherwise generate a new UUID

Redacted provider entries are deliberately stricter:

- redacted Xtream preserves credentials only when an exact exported-ID/server
  match has both a usable username and password. Otherwise, including an exact
  row with an incomplete credential pair, import prompts for credentials,
  validates the exact submitted values against an active portal response
  without using the status cache, and can be skipped without creating or
  overwriting a row. A validated pair patches that exact row instead of
  creating a duplicate
- redacted Stalker preserves local credentials only on an exact exported-ID,
  source, MAC, and profile match; otherwise it creates a credential-less row,
  which later follows the normal status-2 Stalker connection flow
- ambiguous legacy Stalker matches create a separate row rather than merging
  two possible devices/accounts

Restore fields use patch semantics: present values replace, allowed empty
values clear, and omitted fields preserve the existing value on any merge.
Redacted entries can merge only under the stricter exact-match rules above, so
unmatched redacted rows cannot inherit local secrets. The excluded learned
Stalker fields are an intentional exception: every Stalker restore clears
`stalkerLandingUrl`, `stalkerRequestRecipe`,
`stalkerRecipeClassifierVersion`, and `stalkerLastVerifiedAt`, including on a
matched merge, so the next connection re-resolves and verifies the imported
definition.

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
- “Include portal credentials and device identity” is off by default.
- Import prompts for missing Xtream credentials; the user may validate them or
  skip that entry. Blank, inactive, expired, and unavailable credentials are
  rejected before playlist persistence.
- Import summary reports:
    - imported
    - merged
    - skipped
    - failed
