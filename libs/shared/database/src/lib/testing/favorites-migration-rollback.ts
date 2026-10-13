import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureDurableFavorites } from '../favorites-table';

export function verifyFavoriteMigrationRollback() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    try {
        sqlite.exec(`CREATE TABLE playlists (id TEXT PRIMARY KEY);
            CREATE TABLE content (id INTEGER PRIMARY KEY, xtream_id INTEGER, type TEXT,
                title TEXT, poster_url TEXT, backdrop_url TEXT, tmdb_id INTEGER,
                release_year INTEGER, original_title TEXT);
            CREATE TABLE favorites (id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL
                REFERENCES content(id) ON DELETE CASCADE, playlist_id TEXT REFERENCES playlists(id),
                added_at TEXT, position INTEGER);
            INSERT INTO playlists VALUES ('p');
            INSERT INTO content (id, xtream_id, type, title) VALUES (1, 7, 'movie', 'ABC');
            INSERT INTO favorites VALUES (42, 1, 'p', '2025-01-01', 9);
            CREATE VIEW favorites_dependency AS SELECT id FROM favorites;`);
        const before = sqlite.prepare('SELECT * FROM favorites').all();
        assert.throws(
            () => ensureDurableFavorites(sqlite),
            /favorites_dependency/
        );
        assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
        assert.deepEqual(
            sqlite.prepare('SELECT * FROM favorites').all(),
            before
        );
        assert.equal(
            sqlite
                .prepare(
                    "SELECT name FROM sqlite_master WHERE name = 'favorites_durable'"
                )
                .get(),
            undefined
        );
        sqlite.exec('DROP VIEW favorites_dependency');
        sqlite.pragma('foreign_keys = OFF');
        sqlite.exec(`INSERT INTO favorites VALUES (43, 1, 'deleted', '2024-01-01', 10);
            INSERT INTO favorites VALUES (44, 999, 'p', '2024-01-02', 11);`);
        sqlite.pragma('foreign_keys = ON');
        const withOrphans = sqlite.prepare('SELECT * FROM favorites').all();
        const exec = sqlite.exec;
        sqlite.exec = function injectInvalidOwner(statement) {
            const result = exec.call(this, statement);
            if (
                statement ===
                'ALTER TABLE favorites_durable RENAME TO favorites'
            ) {
                exec.call(
                    this,
                    "UPDATE favorites SET playlist_id = 'new-orphan' WHERE id = 42"
                );
            }
            return result;
        };
        // The missing content link is repaired during the rebuild. A mere
        // before/after violation count would conceal a new orphan in its place.
        try {
            assert.throws(
                () => ensureDurableFavorites(sqlite),
                /introduced a foreign key violation/
            );
        } finally {
            sqlite.exec = exec;
        }
        assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
        assert.deepEqual(
            sqlite.prepare('SELECT * FROM favorites').all(),
            withOrphans
        );
        assert.equal(
            sqlite
                .prepare(
                    "SELECT name FROM sqlite_master WHERE name = 'favorites_durable'"
                )
                .get(),
            undefined
        );
        ensureDurableFavorites(sqlite);
        assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
        ensureDurableFavorites(sqlite);
        sqlite.exec('DELETE FROM content');
        assert.deepEqual(
            sqlite
                .prepare(
                    'SELECT id, content_id, title, added_at, position FROM favorites'
                )
                .get(),
            {
                id: 42,
                content_id: null,
                title: 'ABC',
                added_at: '2025-01-01',
                position: 9,
            }
        );
        assert.deepEqual(
            (
                sqlite.pragma('foreign_key_check') as {
                    rowid: number;
                    parent: string;
                }[]
            ).map(({ rowid, parent }) => ({ rowid, parent })),
            [{ rowid: 43, parent: 'playlists' }]
        );
        assert.equal(
            sqlite.prepare('SELECT id FROM favorites').all().length,
            3
        );
    } finally {
        sqlite.close();
    }
}
