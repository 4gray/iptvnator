-- Verbatim CREATE statements from v0.19.0 libs/shared/database/src/lib/connection.ts
CREATE TABLE IF NOT EXISTS playlists (
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
  );
CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('live', 'movies', 'series')),
      xtream_id INTEGER NOT NULL,
      hidden INTEGER DEFAULT 0,
      FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
  );
CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      rating TEXT,
      added TEXT,
      poster_url TEXT,
      xtream_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('live', 'movie', 'series')),
      FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
  );
CREATE TABLE IF NOT EXISTS recently_viewed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER NOT NULL,
      playlist_id TEXT NOT NULL,
      viewed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (content_id) REFERENCES content (id) ON DELETE CASCADE,
      FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
  );
CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER NOT NULL,
      playlist_id TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  );
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
CREATE TABLE IF NOT EXISTS epg_channels (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      icon_url TEXT,
      url TEXT,
      source_url TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE IF NOT EXISTS epg_programs (
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
  );
CREATE INDEX IF NOT EXISTS idx_epg_channels_source ON epg_channels(source_url);
CREATE INDEX IF NOT EXISTS idx_epg_channels_name ON epg_channels(display_name);
CREATE INDEX IF NOT EXISTS idx_epg_programs_channel ON epg_programs(channel_id);
CREATE INDEX IF NOT EXISTS idx_epg_programs_start ON epg_programs(start);
CREATE INDEX IF NOT EXISTS idx_epg_programs_time_range ON epg_programs(channel_id, start, stop);
CREATE VIRTUAL TABLE IF NOT EXISTS epg_programs_fts USING fts5(
      title,
      description,
      category,
      content='epg_programs',
      content_rowid='id'
  );
CREATE TRIGGER IF NOT EXISTS epg_programs_ai AFTER INSERT ON epg_programs BEGIN
      INSERT INTO epg_programs_fts(rowid, title, description, category)
      VALUES (new.id, new.title, new.description, new.category);
  END;
CREATE TRIGGER IF NOT EXISTS epg_programs_ad AFTER DELETE ON epg_programs BEGIN
      INSERT INTO epg_programs_fts(epg_programs_fts, rowid, title, description, category)
      VALUES ('delete', old.id, old.title, old.description, old.category);
  END;
CREATE TRIGGER IF NOT EXISTS epg_programs_au AFTER UPDATE ON epg_programs BEGIN
      INSERT INTO epg_programs_fts(epg_programs_fts, rowid, title, description, category)
      VALUES ('delete', old.id, old.title, old.description, old.category);
      INSERT INTO epg_programs_fts(rowid, title, description, category)
      VALUES (new.id, new.title, new.description, new.category);
  END;
CREATE TABLE IF NOT EXISTS playback_positions (
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
  );
CREATE UNIQUE INDEX IF NOT EXISTS playback_positions_content_playlist_unique ON playback_positions(content_xtream_id, playlist_id, content_type);
CREATE INDEX IF NOT EXISTS playback_positions_playlist_idx ON playback_positions(playlist_id);
CREATE INDEX IF NOT EXISTS playback_positions_series_idx ON playback_positions(series_xtream_id);
CREATE INDEX IF NOT EXISTS playback_positions_updated_idx ON playback_positions(updated_at);
CREATE TABLE IF NOT EXISTS downloads (
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
  );
CREATE UNIQUE INDEX IF NOT EXISTS downloads_xtream_playlist_unique ON downloads(xtream_id, playlist_id, content_type);
CREATE INDEX IF NOT EXISTS downloads_playlist_idx ON downloads(playlist_id);
CREATE INDEX IF NOT EXISTS downloads_status_idx ON downloads(status);
