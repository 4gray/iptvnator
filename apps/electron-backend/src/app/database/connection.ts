/**
 * Database connection and initialization for Electron
 * Uses Drizzle ORM with better-sqlite3
 * Stores database file under ~/.iptvnator/databases/
 */

import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as schema from './schema';

let db: BetterSQLite3Database<typeof schema> | null = null;
let sqlite: Database.Database | null = null;
let initPromise: Promise<BetterSQLite3Database<typeof schema>> | null = null;

/**
 * Get the database file path
 */
function getDatabasePath(): string {
    const dbDir = join(homedir(), '.iptvnator', 'databases');

    // Ensure the directory exists
    if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
    }

    return join(dbDir, 'iptvnator.db');
}

/**
 * Initialize the database connection
 * Creates tables if they don't exist
 */
export async function initDatabase(): Promise<BetterSQLite3Database<typeof schema>> {
    if (db) return db;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const filePath = getDatabasePath();
        sqlite = new Database(filePath);

        // Enable foreign keys
        sqlite.pragma('foreign_keys = ON');

        const database = drizzle(sqlite, { schema });

        // Create tables if they don't exist
        createTables();

        db = database;
        return database;
    })();

    return initPromise;
}

/**
 * Create tables if they don't exist
 */
function createTables() {
    if (!sqlite) return;

    const statements = [
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
    ];

    for (const stmt of statements) {
        sqlite.exec(stmt);
    }
}

/**
 * Get the database instance
 * Initializes the database if not already initialized
 */
export async function getDatabase(): Promise<BetterSQLite3Database<typeof schema>> {
    if (db) return db;
    return initDatabase();
}
