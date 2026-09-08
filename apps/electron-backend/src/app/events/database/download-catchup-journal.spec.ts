import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function runReservationScenario(scenario: string): {
    row: { file_path: string | null; file_name: string };
    proofs: { download_id: number; proof: string }[];
    error?: string;
} {
    const journalUrl = pathToFileURL(
        resolve(__dirname, 'download-catchup-journal.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const { recordArchiveReservation } = await import(${JSON.stringify(journalUrl)});
        const sqlite = new Database(':memory:');
        sqlite.exec(\`
            CREATE TABLE downloads (id INTEGER PRIMARY KEY, file_path TEXT, file_name TEXT, updated_at TEXT);
            CREATE TABLE download_archive_finalizations (download_id INTEGER PRIMARY KEY REFERENCES downloads(id), proof TEXT NOT NULL);
            INSERT INTO downloads (id, file_name) VALUES (1, 'show.ts');
        \`);
        const db = drizzle(sqlite);
        const identity = { dev: 1, ino: 2, birthtimeMs: 1000 };
        let error;
        ${scenario}
        console.log(JSON.stringify({ error,
            row: sqlite.prepare('SELECT file_path, file_name FROM downloads WHERE id=1').get(),
            proofs: sqlite.prepare('SELECT * FROM download_archive_finalizations').all()
        }));
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

it('commits the reservation path and ownership together before transfer setup', () => {
    const result = runReservationScenario(`
        await recordArchiveReservation(db, 1, '/archive/show (1).ts', identity, 'show (1).ts');
    `);
    expect(result.row).toEqual({
        file_path: '/archive/show (1).ts',
        file_name: 'show (1).ts',
    });
    expect(JSON.parse(result.proofs[0].proof)).toMatchObject({
        phase: 'transfer',
        filePath: result.row.file_path,
        partialIdentity: { dev: '1', ino: '2', birthtimeMs: 1000 },
    });
});

it('rolls back the row path when the ownership write fails', () => {
    const result = runReservationScenario(`
        sqlite.exec("CREATE TRIGGER reject_proof BEFORE INSERT ON download_archive_finalizations BEGIN SELECT RAISE(ABORT, 'journal unavailable'); END");
        try { await recordArchiveReservation(db, 1, '/archive/new.ts', identity, 'new.ts'); }
        catch (failure) { error = failure.message; }
    `);
    expect(result.error).toContain('journal unavailable');
    expect(result.row).toEqual({ file_path: null, file_name: 'show.ts' });
    expect(result.proofs).toEqual([]);
});

it('rejects a reservation whose download row disappeared', () => {
    const result = runReservationScenario(`
        try { await recordArchiveReservation(db, 2, '/archive/new.ts', identity, 'new.ts'); }
        catch (failure) { error = failure.message; }
    `);
    expect(result.error).toContain('row is unavailable');
    expect(result.proofs).toEqual([]);
    expect(result.row.file_path).toBeNull();
});
