import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from 'database-schema';

export type AppDatabase = BetterSQLite3Database<typeof schema>;
