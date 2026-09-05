import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Exercise worker SQL with Electron's native SQLite binding, including upgrades. */
function runDatabaseScenario(scenario: string): unknown {
    const moduleUrl = pathToFileURL(resolve(__dirname, 'epg-database.ts')).href;
    const connectionUrl = pathToFileURL(
        resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { EpgDatabase, EpgDatabaseSourceClearOperation, EpgDatabaseClearOperation }
            = await import(${JSON.stringify(moduleUrl)});
        const { __databaseConnectionTestHooks } = await import(${JSON.stringify(connectionUrl)});
        const sqlite = new Database(':memory:');
        const statements = __databaseConnectionTestHooks.createTableStatements
            .filter(sql => /(?:TABLE|INDEX|TRIGGER) IF NOT EXISTS (?:idx_)?epg_/.test(sql));
        for (const sql of statements) sqlite.exec(sql);
        class SharedDatabase { constructor() { return sqlite; } }
        const worker = new EpgDatabase(SharedDatabase);
        const clear = new EpgDatabaseSourceClearOperation(SharedDatabase);
        const importSource = (source, programs = true, clearFirst = false) => {
            worker.insertChannels([{
                id: 'shared', displayName: [{ value: source + ' News' }],
                icon: [{ src: source + '.png' }], url: [source + '.website']
            }], source, clearFirst);
            if (programs) worker.insertPrograms([{
                channel: 'shared', start: '2099-01-01T00:00:00Z',
                stop: '2099-01-01T01:00:00Z', title: [{value: source}]
            }], source);
        };
        const channel = () => sqlite.prepare('SELECT * FROM epg_channels WHERE id = ?').get('shared');
        ${scenario}
        sqlite.close();
    `;
    return JSON.parse(
        execFileSync(
            createRequire(__filename)('electron'),
            ['--import', 'tsx', '--eval', script],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    TSX_TSCONFIG_PATH: resolve(
                        process.cwd(),
                        'tsconfig.base.json'
                    ),
                },
            }
        )
    );
}

describe('source-owned XMLTV channel metadata', () => {
    it.each(['A', 'B'])(
        'restores the survivor when removing %s, then removes the final owner',
        (removed) => {
            const survivor = removed === 'A' ? 'B' : 'A';
            const result = runDatabaseScenario(`
            importSource('A'); importSource('B');
            clear.run('${removed}');
            clear.run('${removed}');
            const surviving = channel();
            const programs = sqlite.prepare('SELECT source_url FROM epg_programs').all();
            clear.run('${survivor}');
            process.stdout.write(JSON.stringify({ surviving, programs, remaining: channel() ?? null }));
        `);
            expect(result).toEqual({
                surviving: expect.objectContaining({
                    display_name: `${survivor} News`,
                    icon_url: `${survivor}.png`,
                    url: `${survivor}.website`,
                    source_url: survivor,
                }),
                programs: [{ source_url: survivor }],
                remaining: null,
            });
        }
    );

    it('retains metadata-only owners during another source refresh and removal', () => {
        expect(
            runDatabaseScenario(`
            importSource('A', false); importSource('B', false);
            worker.insertChannels([], 'A', true);
            clear.run('A');
            const surviving = channel();
            clear.run('B');
            process.stdout.write(JSON.stringify({surviving, remaining: channel() ?? null}));
        `)
        ).toEqual({
            surviving: expect.objectContaining({
                display_name: 'B News',
                source_url: 'B',
            }),
            remaining: null,
        });
    });

    it('removes an orphan whose original owner disappeared during refresh', () => {
        expect(
            runDatabaseScenario(`
            importSource('A', false); importSource('B', false);
            worker.insertChannels([], 'A', true);
            clear.run('B');
            process.stdout.write(JSON.stringify(channel() ?? null));
        `)
        ).toBeNull();
    });

    it('restores metadata before a refresh removes the last writer provenance', () => {
        expect(
            runDatabaseScenario(`
            importSource('A'); importSource('B');
            worker.insertChannels([], 'B', true);
            clear.run('B');
            process.stdout.write(JSON.stringify(channel()));
        `)
        ).toEqual(
            expect.objectContaining({
                display_name: 'A News',
                icon_url: 'A.png',
                source_url: 'A',
            })
        );
    });

    it('neutralizes ambiguous legacy metadata while preserving surviving programmes', () => {
        expect(
            runDatabaseScenario(`
            importSource('A'); importSource('B');
            sqlite.exec('DROP TABLE IF EXISTS epg_channel_sources');
            for (const sql of statements) sqlite.exec(sql);
            clear.run('B');
            process.stdout.write(JSON.stringify(channel()));
        `)
        ).toEqual(
            expect.objectContaining({
                display_name: 'shared',
                icon_url: null,
                url: null,
                source_url: 'A',
                updated_at: null,
            })
        );
    });

    it('clears all metadata and permits a clean reimport', () => {
        expect(
            runDatabaseScenario(`
            importSource('A'); importSource('B');
            new EpgDatabaseClearOperation(SharedDatabase).run();
            const count = sqlite.prepare('SELECT count(*) AS count FROM epg_channel_sources').get().count;
            importSource('C');
            clear.run('C');
            process.stdout.write(JSON.stringify({ count, remaining: channel() ?? null }));
        `)
        ).toEqual({ count: 0, remaining: null });
    });
});
