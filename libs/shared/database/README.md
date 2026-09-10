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

For the upgrade failure reported in #1580, the 0.24 fix should cover databases
from 0.19, 0.20, 0.21, 0.22, and 0.23: the `epg_channel_id` column is absent in
0.19, present from 0.20, and indexed from 0.23. The index must be created only
after the column migration; an existing index must remain valid. This documents
the required regression coverage, not a claim that the fix is already applied.
