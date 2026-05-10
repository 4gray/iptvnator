/**
 * Database connection and initialization for IPTVnator
 * Uses Drizzle ORM with better-sqlite3
 * Stores database file under ~/.iptvnator/databases/ by default.
 * E2E tests can override the root with IPTVNATOR_E2E_DATA_DIR.
 *
 * Provides two connection modes:
 * - Full access (for electron-backend): creates tables, read-write
 * - Read-only access (for agent-backend): no table creation, read-only queries
 */

import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { getIptvnatorDatabasePath } from './path-utils';

export type DatabaseInstance = BetterSQLite3Database<typeof schema>;

const TRACE_ENV_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

let db: DatabaseInstance | null = null;
let sqlite: Database.Database | null = null;
let initPromise: Promise<DatabaseInstance> | null = null;

function readTraceFlag(name: string): boolean {
    const value = process.env[name]?.trim().toLowerCase();
    return value ? TRACE_ENV_TRUE_VALUES.has(value) : false;
}

function isSqlTraceEnabled(): boolean {
    return (
        readTraceFlag('IPTVNATOR_TRACE_STARTUP') ||
        readTraceFlag('IPTVNATOR_TRACE_DB') ||
        readTraceFlag('IPTVNATOR_TRACE_SQL')
    );
}

function compactSqlForTrace(sql: string): string {
    const compactSql = sql.replace(/\s+/g, ' ').trim();
    return compactSql.length <= 180
        ? compactSql
        : `${compactSql.slice(0, 177)}...`;
}

function traceSql(scope: string, message: string, payload?: unknown): void {
    if (payload === undefined) {
        console.log(`[IPTVnator Trace][${scope}] ${message}`);
        return;
    }

    console.log(
        `[IPTVnator Trace][${scope}] ${message} ${JSON.stringify(payload)}`
    );
}

/**
 * Get the database file path
 */
export function getDatabasePath(): string {
    return getIptvnatorDatabasePath();
}

/**
 * SQL statements for creating all tables
 */
const CREATE_TABLE_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      serverUrl TEXT,
      username TEXT,
      password TEXT,
      date_created TEXT DEFAULT (datetime('now')),
      last_updated TEXT,
      type TEXT NOT NULL CHECK (type IN ('xtream', 'stalker', 'm3u-file', 'm3u-text', 'm3u-url')),
      userAgent TEXT,
      origin TEXT,
      referrer TEXT,
      filePath TEXT,
      autoRefresh INTEGER DEFAULT 0,
      macAddress TEXT,
      url TEXT,
      portal_url TEXT,
      count INTEGER,
      import_date TEXT,
      update_date INTEGER,
      position INTEGER,
      favorites TEXT,
      recently_viewed TEXT,
      payload TEXT,
      last_usage TEXT
  )`,
    `CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
  )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('live', 'movies', 'series')),
      xtream_id INTEGER NOT NULL,
      hidden INTEGER DEFAULT 0,
      UNIQUE(playlist_id, type, xtream_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
  )`,
    `CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      rating TEXT,
      added TEXT,
      poster_url TEXT,
      backdrop_url TEXT,
      epg_channel_id TEXT,
      tv_archive INTEGER,
      tv_archive_duration INTEGER,
      direct_source TEXT,
      xtream_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('live', 'movie', 'series')),
      UNIQUE(category_id, type, xtream_id),
      FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
  )`,
    `CREATE TABLE IF NOT EXISTS recently_viewed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER NOT NULL,
      playlist_id TEXT NOT NULL,
      viewed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (content_id) REFERENCES content (id) ON DELETE CASCADE,
      FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
  )`,
    `CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER NOT NULL,
      playlist_id TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      position INTEGER DEFAULT 0,
      FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  )`,
    `CREATE INDEX IF NOT EXISTS idx_content_type ON content(type)`,
    `CREATE INDEX IF NOT EXISTS idx_content_category ON content(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_playlist ON categories(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS idx_content_title ON content(title)`,
    `CREATE INDEX IF NOT EXISTS idx_content_xtream ON content(xtream_id)`,
    `CREATE INDEX IF NOT EXISTS idx_content_type_added ON content(type, added)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type)`,
    // Partial covering index for visible categories — supports the dashboard's
    // getGlobalRecentlyAdded plus searchContent/globalSearch when excludeHidden
    // is set. SQLite can satisfy the join (category_id PK lookup) plus the
    // hidden = 0 filter directly from this index without touching the
    // categories row, and hidden categories are absent so they're skipped
    // before any row lookup.
    `CREATE INDEX IF NOT EXISTS idx_categories_visible ON categories(id, playlist_id, type) WHERE hidden = 0`,
    `CREATE UNIQUE INDEX IF NOT EXISTS favorites_content_playlist_unique ON favorites(content_id, playlist_id)`,
    `CREATE INDEX IF NOT EXISTS favorites_playlist_idx ON favorites(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS favorites_content_idx ON favorites(content_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS recently_viewed_content_playlist_unique ON recently_viewed(content_id, playlist_id)`,
    `CREATE INDEX IF NOT EXISTS recently_viewed_playlist_idx ON recently_viewed(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS recently_viewed_viewed_at_idx ON recently_viewed(viewed_at)`,
    `CREATE INDEX IF NOT EXISTS recently_viewed_playlist_viewed_idx ON recently_viewed(playlist_id, viewed_at DESC)`,
    // EPG tables
    `CREATE TABLE IF NOT EXISTS epg_channels (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      icon_url TEXT,
      url TEXT,
      source_url TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
  )`,
    `CREATE TABLE IF NOT EXISTS epg_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      start TEXT NOT NULL,
      stop TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      icon_url TEXT,
      rating TEXT,
      episode_num TEXT,
      FOREIGN KEY (channel_id) REFERENCES epg_channels(id) ON DELETE CASCADE
  )`,
    // EPG indexes
    `CREATE INDEX IF NOT EXISTS idx_epg_channels_source ON epg_channels(source_url)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_channels_name ON epg_channels(display_name)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_channel ON epg_programs(channel_id)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_start ON epg_programs(start)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_stop ON epg_programs(stop)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_time_range ON epg_programs(channel_id, start, stop)`,
    // FTS5 virtual table for full-text search on EPG programs
    `CREATE VIRTUAL TABLE IF NOT EXISTS epg_programs_fts USING fts5(
      title,
      description,
      category,
      content='epg_programs',
      content_rowid='id'
  )`,
    // Triggers to keep FTS index in sync with epg_programs table
    `CREATE TRIGGER IF NOT EXISTS epg_programs_ai AFTER INSERT ON epg_programs BEGIN
      INSERT INTO epg_programs_fts(rowid, title, description, category)
      VALUES (new.id, new.title, new.description, new.category);
  END`,
    `CREATE TRIGGER IF NOT EXISTS epg_programs_ad AFTER DELETE ON epg_programs BEGIN
      INSERT INTO epg_programs_fts(epg_programs_fts, rowid, title, description, category)
      VALUES ('delete', old.id, old.title, old.description, old.category);
  END`,
    `CREATE TRIGGER IF NOT EXISTS epg_programs_au AFTER UPDATE ON epg_programs BEGIN
      INSERT INTO epg_programs_fts(epg_programs_fts, rowid, title, description, category)
      VALUES ('delete', old.id, old.title, old.description, old.category);
      INSERT INTO epg_programs_fts(rowid, title, description, category)
      VALUES (new.id, new.title, new.description, new.category);
  END`,
    // Playback Positions table
    `CREATE TABLE IF NOT EXISTS playback_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      content_xtream_id INTEGER NOT NULL,
      content_type TEXT NOT NULL CHECK (content_type IN ('vod', 'episode')),
      series_xtream_id INTEGER,
      season_number INTEGER,
      episode_number INTEGER,
      position_seconds INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS playback_positions_content_playlist_unique ON playback_positions(content_xtream_id, playlist_id, content_type)`,
    `CREATE INDEX IF NOT EXISTS playback_positions_playlist_idx ON playback_positions(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS playback_positions_series_idx ON playback_positions(series_xtream_id)`,
    `CREATE INDEX IF NOT EXISTS playback_positions_updated_idx ON playback_positions(updated_at)`,
    `CREATE INDEX IF NOT EXISTS playback_positions_playlist_updated_idx ON playback_positions(playlist_id, updated_at DESC)`,
    // Downloads table
    `CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      xtream_id INTEGER NOT NULL,
      content_type TEXT NOT NULL CHECK (content_type IN ('vod', 'episode')),
      series_xtream_id INTEGER,
      season_number INTEGER,
      episode_number INTEGER,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      file_name TEXT,
      file_path TEXT,
      poster_url TEXT,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'downloading', 'completed', 'failed', 'canceled')),
      bytes_downloaded INTEGER DEFAULT 0,
      total_bytes INTEGER,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS downloads_xtream_playlist_unique ON downloads(xtream_id, playlist_id, content_type)`,
    `CREATE INDEX IF NOT EXISTS downloads_playlist_idx ON downloads(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS downloads_status_idx ON downloads(status)`,
];

/**
 * Migration statements that may fail if already applied
 * These are run with try-catch to handle existing columns
 */
const COLUMN_MIGRATION_STATEMENTS = [
    // v1.0.0 -> v1.1.0: Add hidden column to categories for category management
    `ALTER TABLE categories ADD COLUMN hidden INTEGER DEFAULT 0`,
    // v1.1.0 -> v1.2.0: Add playlist metadata/payload columns for M3U + unified playlist persistence
    `ALTER TABLE playlists ADD COLUMN portal_url TEXT`,
    `ALTER TABLE playlists ADD COLUMN count INTEGER`,
    `ALTER TABLE playlists ADD COLUMN import_date TEXT`,
    `ALTER TABLE playlists ADD COLUMN update_date INTEGER`,
    `ALTER TABLE playlists ADD COLUMN position INTEGER`,
    `ALTER TABLE playlists ADD COLUMN favorites TEXT`,
    `ALTER TABLE playlists ADD COLUMN recently_viewed TEXT`,
    `ALTER TABLE playlists ADD COLUMN payload TEXT`,
    // v1.2.0 -> v1.3.0: Add position column to favorites for global favorites ordering
    `ALTER TABLE favorites ADD COLUMN position INTEGER DEFAULT 0`,
    // v1.4.0 -> v1.5.0: Preserve Xtream live metadata required for EPG/catch-up
    `ALTER TABLE content ADD COLUMN epg_channel_id TEXT`,
    `ALTER TABLE content ADD COLUMN tv_archive INTEGER`,
    `ALTER TABLE content ADD COLUMN tv_archive_duration INTEGER`,
    `ALTER TABLE content ADD COLUMN direct_source TEXT`,
    // v1.5.0 -> v1.6.0: Cinematic backdrop persisted on first detail fetch
    `ALTER TABLE content ADD COLUMN backdrop_url TEXT`,
];

const INDEX_MIGRATION_STATEMENTS = [
    // v1.3.0 -> v1.4.0: Prevent duplicate Xtream categories/content rows
    `CREATE UNIQUE INDEX IF NOT EXISTS categories_playlist_type_xtream_unique ON categories(playlist_id, type, xtream_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS content_category_type_xtream_unique ON content(category_id, type, xtream_id)`,
    // v1.6.0 -> v1.7.0: Query global favorites in stable display order
    `CREATE INDEX IF NOT EXISTS favorites_playlist_position_idx ON favorites(playlist_id, position, added_at DESC)`,
];

export const __databaseConnectionTestHooks = {
    createTableStatements: CREATE_TABLE_STATEMENTS,
    columnMigrationStatements: COLUMN_MIGRATION_STATEMENTS,
    indexMigrationStatements: INDEX_MIGRATION_STATEMENTS,
} as const;

/**
 * Create tables if they don't exist
 */
function createTables(sqliteDb: Database.Database): void {
    for (const stmt of CREATE_TABLE_STATEMENTS) {
        sqliteDb.exec(stmt);
    }
}

function isDuplicateColumnError(error: unknown): boolean {
    const message =
        typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message ?? '')
            : '';

    return message.toLowerCase().includes('duplicate column name');
}

type XtreamCategoryDuplicateGroup = {
    playlistId: string;
    type: 'live' | 'movies' | 'series';
    xtreamId: number;
};

type XtreamCategoryCandidate = {
    id: number;
    hidden: number;
    contentCount: number;
};

type XtreamContentDuplicateGroup = {
    categoryId: number;
    type: 'live' | 'movie' | 'series';
    xtreamId: number;
};

type XtreamContentCandidate = {
    id: number;
};

function deduplicateXtreamCache(sqliteDb: Database.Database): void {
    const executeCleanup = sqliteDb.transaction(() => {
        const duplicateCategoryGroups = sqliteDb
            .prepare(
                `SELECT
                    playlist_id AS playlistId,
                    type,
                    xtream_id AS xtreamId
                 FROM categories
                 GROUP BY playlist_id, type, xtream_id
                 HAVING COUNT(*) > 1`
            )
            .all() as XtreamCategoryDuplicateGroup[];

        const selectCategoryCandidates = sqliteDb.prepare(
            `SELECT
                categories.id AS id,
                COALESCE(categories.hidden, 0) AS hidden,
                COUNT(content.id) AS contentCount
             FROM categories
             LEFT JOIN content ON content.category_id = categories.id
             WHERE categories.playlist_id = ?
               AND categories.type = ?
               AND categories.xtream_id = ?
             GROUP BY categories.id, categories.hidden
             ORDER BY COUNT(content.id) DESC, COALESCE(categories.hidden, 0) ASC, categories.id ASC`
        );
        const updateContentCategory = sqliteDb.prepare(
            `UPDATE content SET category_id = ? WHERE category_id = ?`
        );
        const deleteCategory = sqliteDb.prepare(
            `DELETE FROM categories WHERE id = ?`
        );

        for (const group of duplicateCategoryGroups) {
            const candidates = selectCategoryCandidates.all(
                group.playlistId,
                group.type,
                group.xtreamId
            ) as XtreamCategoryCandidate[];
            const canonicalCategoryId = candidates[0]?.id;

            if (!canonicalCategoryId) {
                continue;
            }

            for (const candidate of candidates.slice(1)) {
                updateContentCategory.run(canonicalCategoryId, candidate.id);
                deleteCategory.run(candidate.id);
            }
        }

        const duplicateContentGroups = sqliteDb
            .prepare(
                `SELECT
                    category_id AS categoryId,
                    type,
                    xtream_id AS xtreamId
                 FROM content
                 GROUP BY category_id, type, xtream_id
                 HAVING COUNT(*) > 1`
            )
            .all() as XtreamContentDuplicateGroup[];

        const selectContentCandidates = sqliteDb.prepare(
            `SELECT id
             FROM content
             WHERE category_id = ?
               AND type = ?
               AND xtream_id = ?
             ORDER BY id ASC`
        );
        const moveFavorites = sqliteDb.prepare(
            `INSERT INTO favorites (content_id, playlist_id, added_at, position)
             SELECT ?, playlist_id, added_at, COALESCE(position, 0)
             FROM favorites
             WHERE content_id = ?
             ON CONFLICT(content_id, playlist_id) DO NOTHING`
        );
        const deleteFavorites = sqliteDb.prepare(
            `DELETE FROM favorites WHERE content_id = ?`
        );
        const moveRecentlyViewed = sqliteDb.prepare(
            `INSERT INTO recently_viewed (content_id, playlist_id, viewed_at)
             SELECT ?, playlist_id, viewed_at
             FROM recently_viewed
             WHERE content_id = ?
             ON CONFLICT(content_id, playlist_id) DO UPDATE SET
                viewed_at = CASE
                    WHEN excluded.viewed_at > recently_viewed.viewed_at
                        THEN excluded.viewed_at
                    ELSE recently_viewed.viewed_at
                END`
        );
        const deleteRecentlyViewed = sqliteDb.prepare(
            `DELETE FROM recently_viewed WHERE content_id = ?`
        );
        const deleteContent = sqliteDb.prepare(`DELETE FROM content WHERE id = ?`);

        for (const group of duplicateContentGroups) {
            const candidates = selectContentCandidates.all(
                group.categoryId,
                group.type,
                group.xtreamId
            ) as XtreamContentCandidate[];
            const canonicalContentId = candidates[0]?.id;

            if (!canonicalContentId) {
                continue;
            }

            for (const candidate of candidates.slice(1)) {
                moveFavorites.run(canonicalContentId, candidate.id);
                deleteFavorites.run(candidate.id);
                moveRecentlyViewed.run(canonicalContentId, candidate.id);
                deleteRecentlyViewed.run(candidate.id);
                deleteContent.run(candidate.id);
            }
        }
    });

    executeCleanup();
}

function runMigrationStatements(
    sqliteDb: Database.Database,
    statements: string[]
): void {
    for (const stmt of statements) {
        try {
            sqliteDb.exec(stmt);
        } catch (error) {
            // Ignore idempotent ALTER TABLE errors on existing columns.
            if (isDuplicateColumnError(error)) {
                continue;
            }

            const compactStmt = stmt.replace(/\s+/g, ' ').trim();
            const message =
                typeof error === 'object' &&
                error !== null &&
                'message' in error
                    ? String((error as { message?: unknown }).message ?? error)
                    : String(error);

            console.warn(
                `Migration failed (continuing): ${compactStmt} :: ${message}`
            );
        }
    }
}

/**
 * Run migrations that may fail if already applied
 */
function runMigrations(sqliteDb: Database.Database): void {
    runMigrationStatements(sqliteDb, COLUMN_MIGRATION_STATEMENTS);
    deduplicateXtreamCache(sqliteDb);
    runMigrationStatements(sqliteDb, INDEX_MIGRATION_STATEMENTS);
}

export interface DatabaseOptions {
    /** Open database in read-only mode (for agent-backend) */
    readonly?: boolean;
    /** Skip table creation (useful for read-only connections) */
    skipTableCreation?: boolean;
}

/**
 * Initialize the database connection with full access (read-write)
 * Creates tables if they don't exist
 * Used by electron-backend
 */
export async function initDatabase(
    options: DatabaseOptions = {}
): Promise<DatabaseInstance> {
    const { readonly = false, skipTableCreation = false } = options;

    if (db) return db;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const filePath = getDatabasePath();
        sqlite = new Database(filePath, {
            readonly,
            verbose: isSqlTraceEnabled()
                ? (message?: unknown) => {
                      traceSql('sql-main', 'query', {
                          sql: compactSqlForTrace(String(message ?? '')),
                      });
                  }
                : undefined,
        });

        if (isSqlTraceEnabled()) {
            traceSql('sql-main', 'open', {
                filePath,
                readonly,
            });
        }

        // Enable foreign keys
        sqlite.pragma('foreign_keys = ON');
        sqlite.pragma('busy_timeout = 5000');

        if (!readonly) {
            sqlite.pragma('journal_mode = WAL');
            sqlite.pragma('synchronous = NORMAL');
        }

        sqlite.pragma('cache_size = -64000');
        sqlite.pragma('temp_store = MEMORY');
        sqlite.pragma('mmap_size = 268435456');

        // Create tables only for read-write connections
        if (!readonly && !skipTableCreation) {
            createTables(sqlite);
            runMigrations(sqlite);
        }

        const database = drizzle(sqlite, { schema });
        db = database;
        return database;
    })();

    return initPromise;
}

/**
 * Get the database instance
 * Initializes the database if not already initialized (with defaults for full access)
 * Used by electron-backend
 */
export async function getDatabase(
    options?: DatabaseOptions
): Promise<DatabaseInstance> {
    if (db) return db;
    return initDatabase(options);
}

/**
 * Get a read-only database connection
 * Used by agent-backend for safe read-only queries
 */
export async function getReadOnlyDatabase(): Promise<DatabaseInstance> {
    return getDatabase({ readonly: true, skipTableCreation: true });
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
    if (sqlite) {
        try {
            sqlite.pragma('optimize');
        } catch {
            // Optimize is advisory; never block close on it.
        }

        sqlite.close();

        if (isSqlTraceEnabled()) {
            traceSql('sql-main', 'close');
        }

        sqlite = null;
        db = null;
        initPromise = null;
    }
}
