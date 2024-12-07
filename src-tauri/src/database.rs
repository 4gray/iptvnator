use tauri_plugin_sql::{Migration, MigrationKind};

pub fn get_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "Create initial tables for Xtream API data",
        kind: MigrationKind::Up,
        sql: "
                CREATE TABLE IF NOT EXISTS playlists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    api_url TEXT NOT NULL,
                    username TEXT NOT NULL,
                    password TEXT NOT NULL,
                    last_updated DATETIME
                );
                
                CREATE TABLE IF NOT EXISTS categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    playlist_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL CHECK (type IN ('live', 'movies', 'series')),
                    xtream_id INTEGER NOT NULL,
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
            ",
    }]
}
