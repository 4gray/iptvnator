-- Fresh-install schema from tag v0.17.1, apps/electron-backend/src/app/database/connection.ts.
-- Whitespace compacted; statements retain their original order. No EPG, playback
-- position or download tables yet, and categories has no `hidden` column.
CREATE TABLE IF NOT EXISTS playlists ( id TEXT PRIMARY KEY, name TEXT NOT NULL, serverUrl TEXT, username TEXT, password TEXT, date_created TEXT DEFAULT (datetime('now')), last_updated TEXT, type TEXT NOT NULL CHECK (type IN ('xtream', 'stalker', 'm3u-file', 'm3u-text', 'm3u-url')), userAgent TEXT, origin TEXT, referrer TEXT, filePath TEXT, autoRefresh INTEGER DEFAULT 0, macAddress TEXT, url TEXT, last_usage TEXT );
CREATE TABLE IF NOT EXISTS categories ( id INTEGER PRIMARY KEY AUTOINCREMENT, playlist_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('live', 'movies', 'series')), xtream_id INTEGER NOT NULL, FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE );
CREATE TABLE IF NOT EXISTS content ( id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, title TEXT NOT NULL, rating TEXT, added TEXT, poster_url TEXT, xtream_id INTEGER NOT NULL, type TEXT NOT NULL CHECK (type IN ('live', 'movie', 'series')), FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE );
CREATE TABLE IF NOT EXISTS recently_viewed ( id INTEGER PRIMARY KEY AUTOINCREMENT, content_id INTEGER NOT NULL, playlist_id TEXT NOT NULL, viewed_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (content_id) REFERENCES content (id) ON DELETE CASCADE, FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE );
CREATE TABLE IF NOT EXISTS favorites ( id INTEGER PRIMARY KEY AUTOINCREMENT, content_id INTEGER NOT NULL, playlist_id TEXT NOT NULL, added_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE, FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE );
CREATE INDEX IF NOT EXISTS idx_content_type ON content(type);
CREATE INDEX IF NOT EXISTS idx_content_category ON content(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_playlist ON categories(playlist_id);
CREATE INDEX IF NOT EXISTS idx_content_title ON content(title);
CREATE INDEX IF NOT EXISTS idx_content_xtream ON content(xtream_id);
CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_content_playlist_unique ON favorites(content_id, playlist_id);
CREATE INDEX IF NOT EXISTS favorites_playlist_idx ON favorites(playlist_id);
CREATE INDEX IF NOT EXISTS favorites_content_idx ON favorites(content_id);
CREATE UNIQUE INDEX IF NOT EXISTS recently_viewed_content_playlist_unique ON recently_viewed(content_id, playlist_id);
CREATE INDEX IF NOT EXISTS recently_viewed_playlist_idx ON recently_viewed(playlist_id);
CREATE INDEX IF NOT EXISTS recently_viewed_viewed_at_idx ON recently_viewed(viewed_at);
