# Database

Shared database library for IPTVnator providing Drizzle ORM schema and connection utilities.

## Usage

```typescript
// Full access (electron-backend)
import { getDatabase, initDatabase } from '@iptvnator/shared/database';

// Read-only access (agent-backend)
import { getReadOnlyDatabase } from '@iptvnator/shared/database';

// Schema and types
import { content, categories, playlists, type Content } from '@iptvnator/shared/database';
```

## Exports

### Schema (`schema.ts`)
- **Tables**: `playlists`, `categories`, `content`, `recentlyViewed`, `favorites`
- **Types**: `Playlist`, `Category`, `Content`, `RecentlyViewed`, `Favorite` (and `New*` variants)

### Connection (`connection.ts`)
- `getDatabase(options?)` - Full read-write access
- `getReadOnlyDatabase()` - Read-only access for agent queries
- `initDatabase(options?)` - Initialize with custom options
- `closeDatabase()` - Close connection
- `getDatabasePath()` - Get database file path

## Database Location

The SQLite database is stored at: `~/.iptvnator/databases/iptvnator.db`

## Upgrade Compatibility And Migrations

Users may skip releases. The application must apply every required migration in
dependency order when opening an older database, preserving user data without
requiring intermediate application installations or a database reset. This is
the repository policy mirrored in `AGENTS.md` and `CLAUDE.md`.

`src/lib/connection.ts` owns initialization: `createTables()` creates missing
schema objects, then `runMigrations()` applies column/index migrations and
dedicated schema/data upgrades. One-off data migrations can record completion
in `app_state`. Keep existing migration paths when adding new ones.

When changing initialization:

- Create required tables before migrating them. `CREATE TABLE IF NOT EXISTS`
  leaves existing columns unchanged.
- Add missing columns before creating indexes or triggers, or running queries,
  that depend on those columns. Put indexes depending on migrated columns in
  `INDEX_MIGRATION_STATEMENTS`, after `COLUMN_MIGRATION_STATEMENTS`, rather than
  in the earlier schema creation phase.
- Preserve existing data and make migrations safe on repeated startup. Record
  completion only after the associated migration succeeds.
- Exercise the actual initialization path with real SQLite and historical
  schema fixtures containing representative playlists, favorites, history, and
  playback positions. Verify both schema changes and preservation of those rows;
  mocked SQL calls alone do not establish upgrade compatibility.
- Include direct upgrades across skipped releases, the previous release, a fresh
  install, and repeated startup. If a release changes migration ordering, cover
  each distinct affected historical schema.

The #1580 index-ordering fix is included in 0.24 through PR #1550.
`src/lib/connection-upgrades.spec.ts` exercises `initDatabase()` with real
SQLite under the Electron runtime, using fresh-install schema snapshots from
tags 0.19–0.23 and a fresh current database. The `epg_channel_id` column is absent
in 0.19, present from 0.20, and indexed from 0.23. Each case checks current Drizzle
tables, columns/types, and named indexes/uniqueness, as well as preserved user
rows, foreign keys, database integrity, index availability, and repeated startup;
an existing EPG index must keep its definition and root page. Snapshots live in
`src/lib/testing/fixtures/` and are independent of the current schema, so moving
the index ahead of its column migration makes the 0.19 case fail again.

Run this coverage with `pnpm nx test database --runInBand`. The Electron UI and
worker upgrade flow is also covered by
`pnpm nx run electron-backend-e2e:e2e-ci--src/legacy-playlist-migration.e2e.ts`.
