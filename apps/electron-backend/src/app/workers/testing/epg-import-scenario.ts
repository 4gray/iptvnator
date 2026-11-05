import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runScenarioWorker } from './epg-scenario-worker';
import { gzipSync } from 'node:zlib';
import { getIptvnatorDatabasePath } from '@iptvnator/shared/database/path-utils';
import { __databaseConnectionTestHooks } from '@iptvnator/shared/database';
import { EpgDatabase } from '../epg-database';

export type EpgImportScenario =
    | 'valid'
    | 'malformed'
    | 'truncated'
    | 'gzip-error'
    | 'gzip-corrupt'
    | 'write-error'
    | 'cancelled'
    | 'cancelled-publish'
    | 'retry'
    | 'empty';

export async function runEpgImportScenario(
    scenario: EpgImportScenario,
    programmeCount = 1001
) {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-epg-atomic-'));
    process.env.IPTVNATOR_E2E_DATA_DIR = directory;
    const localFile = join(directory, 'guide.xml');
    let source = localFile;
    let pausedFeed = '';
    const server =
        scenario === 'cancelled'
            ? createServer((_request, response) => {
                  response.writeHead(200, {
                      'Content-Type': 'application/xml',
                  });
                  response.write(pausedFeed);
                  // Keep the source open until the worker is terminated after progress.
              })
            : undefined;
    if (server) {
        await new Promise<void>((resolveListening) =>
            server.listen(0, '127.0.0.1', resolveListening)
        );
        const address = server.address();
        if (!address || typeof address === 'string')
            throw new Error('Missing test server address');
        source = `http://127.0.0.1:${address.port}/guide.xml`;
    }
    const sqlite = new Database(getIptvnatorDatabasePath());
    sqlite.pragma('journal_mode = WAL');
    const statements = __databaseConnectionTestHooks.createTableStatements;
    for (const sql of statements) {
        if (/(?:TABLE|INDEX|TRIGGER) IF NOT EXISTS (?:idx_)?epg_/.test(sql))
            sqlite.exec(sql);
    }
    class SharedDatabase {
        constructor() {
            return sqlite;
        }
    }
    const seed = new EpgDatabase(SharedDatabase as unknown as typeof Database);
    const channel = (name: string) => ({
        id: 'shared',
        displayName: [{ lang: '', value: name }],
        icon: [],
        url: [],
    });
    const programme = (title: string, start = '2099-01-01T00:00:00Z') => ({
        channel: 'shared',
        start,
        stop: new Date(Date.parse(start) + 3600000).toISOString(),
        title: [{ lang: '', value: title }],
        desc: [],
        category: [],
        date: '',
        episodeNum: [],
        icon: [],
        rating: [],
    });
    const previousDay = new Date();
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const expiredDay = new Date();
    expiredDay.setUTCDate(expiredDay.getUTCDate() - 8);
    seed.insertChannels([channel('Previous source')], source);
    seed.insertPrograms(
        [
            programme('Previous programme'),
            programme('Previous archive', previousDay.toISOString()),
            programme('Expired archive', expiredDay.toISOString()),
        ],
        source
    );
    seed.insertChannels([channel('Other source')], 'other-source');
    seed.insertPrograms([programme('Other programme')], 'other-source');
    sqlite.exec(`
        UPDATE epg_channels SET updated_at = '2000-01-01T00:00:00Z';
        UPDATE epg_channel_sources SET updated_at = '2000-01-01T00:00:00Z';
        INSERT INTO epg_channel_mappings (channel_key, epg_channel_id) VALUES ('manual', 'shared');
    `);
    if (scenario === 'write-error' || scenario === 'retry')
        sqlite.exec(`CREATE TRIGGER fail_fixture BEFORE INSERT ON epg_programs
        WHEN NEW.title = 'New 1000' BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END`);
    const snapshot = () => ({
        channels: sqlite
            .prepare('SELECT * FROM epg_channels ORDER BY id')
            .all(),
        provenance: sqlite
            .prepare(
                'SELECT * FROM epg_channel_sources ORDER BY channel_id, source_url'
            )
            .all(),
        programmes:
            programmeCount > 1001
                ? []
                : sqlite
                      .prepare('SELECT * FROM epg_programs ORDER BY id')
                      .all(),
        mappings: sqlite
            .prepare('SELECT * FROM epg_channel_mappings ORDER BY id')
            .all(),
    });
    const before = snapshot();
    const channels = Array.from(
        { length: 100 },
        (_, index) =>
            `<channel id="${index === 0 ? 'shared' : `new-${index}`}"><display-name>Updated ${index}</display-name></channel>`
    ).join('');
    const programmes = Array.from(
        { length: programmeCount },
        (_, index) =>
            `<programme channel="shared" start="20990101000000 +0000" stop="20990101010000 +0000"><title>New ${index}</title></programme>`
    ).join('');
    const ending =
        scenario === 'malformed'
            ? '<broken></tv>'
            : scenario === 'truncated' || scenario === 'cancelled'
              ? ''
              : '</tv>';
    const xml =
        scenario === 'empty'
            ? '<tv></tv>'
            : `<tv>${channels}${programmes}${ending}`;
    const gzip = gzipSync(xml);
    if (scenario === 'gzip-corrupt') gzip[gzip.length - 8] ^= 0xff;
    pausedFeed = xml;
    writeFileSync(
        localFile,
        scenario === 'gzip-error'
            ? gzip.subarray(0, gzip.length - 8)
            : scenario === 'gzip-corrupt'
              ? gzip
              : xml
    );
    const bundle = join(directory, 'epg-parser.worker.cjs');
    buildSync({
        entryPoints: [
            resolve(
                'apps/electron-backend/src/app/workers/epg-parser.worker.ts'
            ),
        ],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['better-sqlite3'],
        tsconfig: resolve('tsconfig.base.json'),
    });
    try {
        const workerResult = await runScenarioWorker(
            bundle,
            source,
            sqlite,
            scenario === 'cancelled'
                ? 'download'
                : scenario === 'cancelled-publish'
                  ? 'publish'
                  : undefined
        );
        const failedSnapshot = snapshot();
        let retryResult:
            Awaited<ReturnType<typeof runScenarioWorker>> | undefined;
        if (scenario === 'retry') {
            sqlite.exec('DROP TRIGGER fail_fixture');
            retryResult = await runScenarioWorker(
                bundle,
                source,
                sqlite,
                undefined
            );
        }
        // Check the external-content FTS index against live rows, not only MATCH hits.
        sqlite.exec(
            "INSERT INTO epg_programs_fts(epg_programs_fts, rank) VALUES('integrity-check', 1)"
        );
        const after = snapshot();
        const titles = sqlite
            .prepare(
                programmeCount > 1001
                    ? "SELECT title FROM epg_programs WHERE title IN ('Previous archive', 'Other programme') ORDER BY title"
                    : 'SELECT title FROM epg_programs ORDER BY title'
            )
            .all() as Array<{ title: string }>;
        const fts = sqlite
            .prepare(
                "SELECT COUNT(*) AS count FROM epg_programs_fts WHERE epg_programs_fts MATCH 'New'"
            )
            .get();
        return {
            ...workerResult,
            failedSnapshot,
            retryResult,
            before,
            after,
            titles: titles.map((row) => row.title),
            fts,
            programmeCount: sqlite
                .prepare('SELECT COUNT(*) AS count FROM epg_programs')
                .get(),
        };
    } finally {
        sqlite.close();
        if (server) {
            server.closeAllConnections();
            await new Promise<void>((resolveClosed) =>
                server.close(() => resolveClosed())
            );
        }
        rmSync(directory, { recursive: true, force: true });
    }
}
