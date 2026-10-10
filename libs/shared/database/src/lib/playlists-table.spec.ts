import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface RebuildOutcome {
    warnings: string[];
    columns: string[];
    tableSql: string;
    playlists: Record<string, unknown>[];
    favorites: Record<string, unknown>[];
    leftoverRebuildTable: boolean;
    foreignKeys: number;
    integrity: string;
    dependents: { type: string; name: string }[];
    triggerFires: boolean;
}

/**
 * Runs ensurePlaylistsPayloadLast against a real in-memory SQLite database
 * holding a pre-0.19 playlists table (payload appended before the EPG URL
 * columns), a favorites table referencing it, and an orphaned favorite a
 * legacy profile can carry. better-sqlite3 is built for Electron, so the
 * script runs under Electron as Node.
 */
function rebuildLegacyPlaylists(options: {
    blockingView: boolean;
}): RebuildOutcome {
    const electronPath = createRequire(__filename)('electron') as string;
    const moduleUrl = pathToFileURL(
        resolve(__dirname, 'playlists-table.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { ensurePlaylistsPayloadLast } = await import(${JSON.stringify(moduleUrl)});
        const sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = ON');
        sqlite.exec(\`
            CREATE TABLE playlists (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, serverUrl TEXT,
                username TEXT, password TEXT,
                date_created TEXT DEFAULT (datetime('now')), last_updated TEXT,
                type TEXT NOT NULL CHECK (type IN ('xtream', 'stalker', 'm3u-file', 'm3u-text', 'm3u-url')),
                userAgent TEXT, origin TEXT, referrer TEXT, filePath TEXT,
                autoRefresh INTEGER DEFAULT 0, macAddress TEXT, url TEXT,
                last_usage TEXT
            );
            ALTER TABLE playlists ADD COLUMN portal_url TEXT;
            ALTER TABLE playlists ADD COLUMN count INTEGER;
            ALTER TABLE playlists ADD COLUMN import_date TEXT;
            ALTER TABLE playlists ADD COLUMN update_date INTEGER;
            ALTER TABLE playlists ADD COLUMN position INTEGER;
            ALTER TABLE playlists ADD COLUMN favorites TEXT;
            ALTER TABLE playlists ADD COLUMN recently_viewed TEXT;
            ALTER TABLE playlists ADD COLUMN payload TEXT;
            ALTER TABLE playlists ADD COLUMN epg_urls TEXT;
            ALTER TABLE playlists ADD COLUMN detected_epg_urls TEXT;
            ALTER TABLE playlists ADD COLUMN manual_epg_urls TEXT;
            ALTER TABLE playlists ADD COLUMN disabled_epg_urls TEXT;
            CREATE TABLE favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_id INTEGER NOT NULL,
                playlist_id TEXT NOT NULL,
                FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
            );
            INSERT INTO playlists (id, name, type, url, last_usage, count, payload,
                epg_urls, detected_epg_urls, manual_epg_urls, disabled_epg_urls)
            VALUES ('m3u', 'Saved list', 'm3u-url', 'https://list.invalid/a.m3u',
                '2026-01-01T00:00:00.000Z', 2, '{"channels":[{"name":"One"},{"name":"Two"}]}',
                '["https://epg.invalid/a.xml"]', '["https://epg.invalid/b.xml"]',
                '["https://epg.invalid/c.xml"]', '[]');
            INSERT INTO playlists (id, name, type, serverUrl, username, password)
            VALUES ('xtream', 'Saved source', 'xtream', 'https://source.invalid', 'user', 'secret');
            INSERT INTO favorites (content_id, playlist_id) VALUES (1, 'm3u'), (2, 'xtream');
        \`);
        sqlite.pragma('foreign_keys = OFF');
        sqlite.exec("INSERT INTO favorites (content_id, playlist_id) VALUES (3, 'deleted')");
        sqlite.pragma('foreign_keys = ON');
        sqlite.exec(\`
            CREATE INDEX playlists_type_idx ON playlists(type);
            CREATE TRIGGER playlists_reject_blocked BEFORE INSERT ON playlists
            WHEN NEW.id = 'blocked' BEGIN SELECT RAISE(ABORT, 'blocked id'); END;
        \`);
        if (${options.blockingView}) {
            sqlite.exec('CREATE VIEW playlist_names AS SELECT name FROM playlists');
        }
        const warnings = [];
        console.warn = (...args) => warnings.push(args.map(String).join(' '));
        console.log = () => undefined;
        ensurePlaylistsPayloadLast(sqlite);
        let triggerFires = false;
        try {
            sqlite.prepare("INSERT INTO playlists (id, name, type) VALUES ('blocked', 'B', 'm3u-url')").run();
        } catch (error) {
            triggerFires = String(error).includes('blocked id');
        }
        const byName = (rows) => rows.map((row) =>
            Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
        process.stdout.write(JSON.stringify({
            warnings,
            columns: sqlite.prepare("SELECT name FROM pragma_table_info('playlists')").all().map((r) => r.name),
            tableSql: sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'playlists'").get().sql,
            playlists: byName(sqlite.prepare('SELECT * FROM playlists ORDER BY id').all()),
            favorites: sqlite.prepare('SELECT * FROM favorites ORDER BY id').all(),
            leftoverRebuildTable: Boolean(sqlite.prepare(
                "SELECT 1 FROM sqlite_master WHERE name = 'playlists_payload_rebuild'").get()),
            foreignKeys: sqlite.pragma('foreign_keys', { simple: true }),
            dependents: sqlite.prepare(
                "SELECT type, name FROM sqlite_master WHERE tbl_name = 'playlists' AND sql IS NOT NULL AND type IN ('index', 'trigger') ORDER BY name").all(),
            triggerFires,
            integrity: sqlite.pragma('integrity_check', { simple: true }),
        }));
        sqlite.close();
    `;
    const output = execFileSync(
        electronPath,
        ['--import', 'tsx', '--eval', script],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 30_000,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                TSX_TSCONFIG_PATH: resolve(process.cwd(), 'tsconfig.base.json'),
            },
        }
    );
    return JSON.parse(output) as RebuildOutcome;
}

const expectedPlaylists = [
    expect.objectContaining({
        id: 'm3u',
        name: 'Saved list',
        url: 'https://list.invalid/a.m3u',
        last_usage: '2026-01-01T00:00:00.000Z',
        count: 2,
        payload: '{"channels":[{"name":"One"},{"name":"Two"}]}',
        epg_urls: '["https://epg.invalid/a.xml"]',
        detected_epg_urls: '["https://epg.invalid/b.xml"]',
        manual_epg_urls: '["https://epg.invalid/c.xml"]',
        disabled_epg_urls: '[]',
    }),
    expect.objectContaining({
        id: 'xtream',
        serverUrl: 'https://source.invalid',
        username: 'user',
        password: 'secret',
        payload: null,
    }),
];

const expectedDependents = [
    { type: 'trigger', name: 'playlists_reject_blocked' },
    { type: 'index', name: 'playlists_type_idx' },
];

const expectedFavorites = [
    { id: 1, content_id: 1, playlist_id: 'm3u' },
    { id: 2, content_id: 2, playlist_id: 'xtream' },
    { id: 3, content_id: 3, playlist_id: 'deleted' },
];

describe('ensurePlaylistsPayloadLast on real SQLite', () => {
    it('moves payload last and keeps every row, favorite, pre-existing orphan, index and trigger', () => {
        const outcome = rebuildLegacyPlaylists({ blockingView: false });

        expect(outcome.warnings).toEqual([]);
        expect(outcome.columns.at(-1)).toBe('payload');
        expect(outcome.columns).toHaveLength(28);
        expect(outcome.playlists).toEqual(expectedPlaylists);
        // Not cascaded away by the drop, and the orphan it found does not
        // block the rebuild.
        expect(outcome.favorites).toEqual(expectedFavorites);
        expect(outcome.leftoverRebuildTable).toBe(false);
        expect(outcome.foreignKeys).toBe(1);
        expect(outcome.integrity).toBe('ok');
        expect(outcome.dependents).toEqual(expectedDependents);
        expect(outcome.triggerFires).toBe(true);
    });

    it('rolls everything back when a step fails, and turns foreign keys back on', () => {
        // A view on playlists makes the rename fail after the drop.
        const outcome = rebuildLegacyPlaylists({ blockingView: true });

        expect(outcome.warnings).toEqual([
            expect.stringContaining(
                '[DB] playlists payload-last rebuild failed:'
            ),
        ]);
        expect(outcome.columns.at(-1)).toBe('disabled_epg_urls');
        expect(outcome.tableSql).toContain('payload TEXT, epg_urls TEXT');
        expect(outcome.playlists).toEqual(expectedPlaylists);
        expect(outcome.favorites).toEqual(expectedFavorites);
        expect(outcome.leftoverRebuildTable).toBe(false);
        expect(outcome.foreignKeys).toBe(1);
        expect(outcome.integrity).toBe('ok');
        expect(outcome.dependents).toEqual(expectedDependents);
        expect(outcome.triggerFires).toBe(true);
    });
});
