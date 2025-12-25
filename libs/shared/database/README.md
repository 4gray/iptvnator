# Database

Shared database library for IPTVnator providing Drizzle ORM schema and connection utilities.

## Usage

```typescript
// Full access (electron-backend)
import { getDatabase, initDatabase } from 'database';

// Read-only access (agent-backend)
import { getReadOnlyDatabase } from 'database';

// Schema and types
import { content, categories, playlists, type Content } from 'database';
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
