/**
 * Database connection and initialization for IPTVnator
 * Uses Drizzle ORM with better-sqlite3
 * Stores database file under ~/.iptvnator/databases/
 *
 * Provides two connection modes:
 * - Full access (for electron-backend): creates tables, read-write
 * - Read-only access (for agent-backend): no table creation, read-only queries
 */

import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as schema from './schema';

export type DatabaseInstance = BetterSQLite3Database<typeof schema>;

let db: DatabaseInstance | null = null;
let sqlite: Database.Database | null = null;
let initPromise: Promise<DatabaseInstance> | null = null;

/**
 * Get the database file path
 */
export function getDatabasePath(): string {
    const dbDir = join(homedir(), '.iptvnator', 'databases');

    // Ensure the directory exists
    if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
    }

    return join(dbDir, 'iptvnator.db');
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
      last_usage TEXT
  )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('live', 'movies', 'series')),
      xtream_id INTEGER NOT NULL,
      hidden INTEGER DEFAULT 0,
      FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
  )`,
    `CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      rating TEXT,
      added TEXT,
      poster_url TEXT,
      xtream_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('live', 'movie', 'series')),
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
      FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  )`,
    `CREATE INDEX IF NOT EXISTS idx_content_type ON content(type)`,
    `CREATE INDEX IF NOT EXISTS idx_content_category ON content(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_playlist ON categories(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS idx_content_title ON content(title)`,
    `CREATE INDEX IF NOT EXISTS idx_content_xtream ON content(xtream_id)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS favorites_content_playlist_unique ON favorites(content_id, playlist_id)`,
    `CREATE INDEX IF NOT EXISTS favorites_playlist_idx ON favorites(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS favorites_content_idx ON favorites(content_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS recently_viewed_content_playlist_unique ON recently_viewed(content_id, playlist_id)`,
    `CREATE INDEX IF NOT EXISTS recently_viewed_playlist_idx ON recently_viewed(playlist_id)`,
    `CREATE INDEX IF NOT EXISTS recently_viewed_viewed_at_idx ON recently_viewed(viewed_at)`,
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
];

/**
 * Migration statements that may fail if already applied
 * These are run with try-catch to handle existing columns
 */
const MIGRATION_STATEMENTS = [
    // v1.0.0 -> v1.1.0: Add hidden column to categories for category management
    `ALTER TABLE categories ADD COLUMN hidden INTEGER DEFAULT 0`,
];

/**
 * Create tables if they don't exist
 */
function createTables(sqliteDb: Database.Database): void {
    for (const stmt of CREATE_TABLE_STATEMENTS) {
        sqliteDb.exec(stmt);
    }
}

/**
 * Run migrations that may fail if already applied
 */
function runMigrations(sqliteDb: Database.Database): void {
    for (const stmt of MIGRATION_STATEMENTS) {
        try {
            sqliteDb.exec(stmt);
        } catch (error) {
            // Ignore errors for migrations that may have already been applied
            // (e.g., "duplicate column name" for ALTER TABLE ADD COLUMN)
        }
    }
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
        sqlite = new Database(filePath, { readonly });

        // Enable foreign keys
        sqlite.pragma('foreign_keys = ON');

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
        sqlite.close();
        sqlite = null;
        db = null;
        initPromise = null;
    }
}
