import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Real-SQLite coverage for the retired search-key cleanups, run inside
 * Electron so better-sqlite3 links against the ABI the app ships with. The
 * mock-based spec proves the SQL shape; this one proves what a persisted
 * database looks like after an upgrade — from a release that skipped every
 * cleanup, from the previous release, on a fresh database, and on the next
 * startup after that.
 */
it('drops only retired search rows across skipped, previous, pre-person, fresh and repeated startups', () => {
    const electron = createRequire(__filename)('electron') as string;
    const connectionUrl = pathToFileURL(
        resolve(__dirname, 'connection.ts')
    ).href;
    const result = execFileSync(
        electron,
        [
            '--import',
            'tsx',
            '--eval',
            `
        const { default: Database } = await import('better-sqlite3');
        const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(connectionUrl)});
        console.log = () => undefined;
        const V2_MARKER = 'migration:tmdb-search-lookup-v2-cache-cleanup:v1';
        const V3_MARKER = 'migration:tmdb-search-lookup-v3-cache-cleanup:v1';
        const ROWS = [
            ['tv', 'title:феик|year:2026', 'ru-RU', null],
            ['tv', 'title:феик|year:2026|v2', 'ru-RU', null],
            ['tv', 'title:the boys|year:2019|v2', 'en-US', 76479],
            ['tv', 'title:фейк|year:2026|v3', 'ru-RU', 317869],
            ['tv', 'id:317869|v2', 'ru-RU', 317869],
            ['tv', 'id:317869|season:1', 'ru-RU', 317869],
            ['person', 'person:287', 'en-US', 287],
            ['movie', 'badProviderId:999', 'any', null],
            ['movie', 'trending:week', 'en-US', null],
        ];
        function openDb(markers) {
            const db = new Database(':memory:');
            hooks.createTables(db);
            const insert = db.prepare('INSERT INTO tmdb_metadata (media_type, lookup_key, language, tmdb_id, payload) VALUES (?, ?, ?, ?, ?)');
            for (const [type, key, lang, id] of ROWS) insert.run(type, key, lang, id, id === null ? null : '{"id":' + id + '}');
            const mark = db.prepare("INSERT INTO app_state (key, value, updated_at) VALUES (?, 'done', datetime('now'))");
            for (const marker of markers) mark.run(marker);
            return db;
        }
        function snapshot(db) {
            return {
                keys: db.prepare('SELECT lookup_key FROM tmdb_metadata ORDER BY lookup_key').all().map((r) => r.lookup_key),
                payloads: db.prepare("SELECT payload FROM tmdb_metadata WHERE lookup_key LIKE 'id:%' ORDER BY lookup_key").all().map((r) => r.payload),
                markers: db.prepare("SELECT key FROM app_state WHERE key LIKE 'migration:tmdb-search-lookup-%' AND value = 'done' ORDER BY key").all().map((r) => r.key),
            };
        }
        // Skipped every release since the unversioned keys: both cleanups run
        // through the real initialization path
        const skipped = openDb([]);
        hooks.runMigrations(skipped);
        const skippedAfter = snapshot(skipped);
        // Next startup: a row written meanwhile under the current key survives
        skipped.prepare("INSERT INTO tmdb_metadata (media_type, lookup_key, language, tmdb_id) VALUES ('tv', 'title:гудовы|year:2026|v3', 'ru-RU', 318894)").run();
        hooks.runMigrations(skipped);
        const repeated = snapshot(skipped);
        // Previous release: the unversioned cleanup already ran; only v2 rows go
        const previous = openDb([V2_MARKER]);
        hooks.runMigrations(previous);
        const previousAfter = snapshot(previous);
        hooks.runMigrations(previous);
        const previousRepeated = snapshot(previous);
        // Oldest historical schema: the pre-'person' CHECK. That migration
        // rebuilds the pure-cache table empty by design; the cleanups must
        // still record their markers on the rebuilt table and stay idempotent.
        const prePerson = new Database(':memory:');
        hooks.createTables(prePerson);
        prePerson.exec("DROP TABLE tmdb_metadata; CREATE TABLE tmdb_metadata (id INTEGER PRIMARY KEY AUTOINCREMENT, media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')), lookup_key TEXT NOT NULL, language TEXT NOT NULL, tmdb_id INTEGER, payload TEXT, fetched_at TEXT DEFAULT (datetime('now'))); CREATE UNIQUE INDEX tmdb_metadata_lookup_unique ON tmdb_metadata(media_type, lookup_key, language)");
        prePerson.prepare("INSERT INTO tmdb_metadata (media_type, lookup_key, language, tmdb_id) VALUES ('tv', 'title:феик|year:2026', 'ru-RU', NULL)").run();
        hooks.runMigrations(prePerson);
        const prePersonAfter = { ...snapshot(prePerson), check: prePerson.prepare("SELECT sql FROM sqlite_master WHERE name = 'tmdb_metadata'").get().sql.includes("'person'") };
        hooks.runMigrations(prePerson);
        const prePersonRepeated = snapshot(prePerson);
        // Fresh database through the real initialization path
        const fresh = new Database(':memory:');
        hooks.createTables(fresh);
        hooks.runMigrations(fresh);
        const freshAfter = snapshot(fresh);
        hooks.runMigrations(fresh);
        const freshRepeated = snapshot(fresh);
        process.stdout.write(JSON.stringify({ skippedAfter, repeated, previousAfter, previousRepeated, prePersonAfter, prePersonRepeated, freshAfter, freshRepeated }));
    `,
        ],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                TSX_TSCONFIG_PATH: resolve(process.cwd(), 'tsconfig.base.json'),
            },
        }
    );

    const V2_MARKER = 'migration:tmdb-search-lookup-v2-cache-cleanup:v1';
    const V3_MARKER = 'migration:tmdb-search-lookup-v3-cache-cleanup:v1';
    const survivors = [
        'badProviderId:999',
        'id:317869|season:1',
        'id:317869|v2',
        'person:287',
        'title:фейк|year:2026|v3',
        'trending:week',
    ];
    const detailsPayloads = ['{"id":317869}', '{"id":317869}'];

    expect(JSON.parse(result)).toEqual({
        skippedAfter: {
            keys: survivors,
            payloads: detailsPayloads,
            markers: [V2_MARKER, V3_MARKER],
        },
        repeated: {
            keys: [...survivors, 'title:гудовы|year:2026|v3'].sort(),
            payloads: detailsPayloads,
            markers: [V2_MARKER, V3_MARKER],
        },
        previousAfter: {
            // The unversioned row is that generation's business, already done
            keys: [...survivors, 'title:феик|year:2026'].sort(),
            payloads: detailsPayloads,
            markers: [V2_MARKER, V3_MARKER],
        },
        previousRepeated: {
            keys: [...survivors, 'title:феик|year:2026'].sort(),
            payloads: detailsPayloads,
            markers: [V2_MARKER, V3_MARKER],
        },
        prePersonAfter: {
            keys: [],
            payloads: [],
            markers: [V2_MARKER, V3_MARKER],
            check: true,
        },
        prePersonRepeated: {
            keys: [],
            payloads: [],
            markers: [V2_MARKER, V3_MARKER],
        },
        freshAfter: { keys: [], payloads: [], markers: [V2_MARKER, V3_MARKER] },
        freshRepeated: {
            keys: [],
            payloads: [],
            markers: [V2_MARKER, V3_MARKER],
        },
    });
});
