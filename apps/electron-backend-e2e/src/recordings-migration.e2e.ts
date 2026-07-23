import { _electron as electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
    workspaceRoot,
} from './electron-test-fixtures';

type MigrationInspection = {
    error?: string;
    indexes: string[];
    legacyTableCount: number;
    streamUrl: string | null;
    streamUrlNotNull: number;
    success: boolean;
};

const fixtureMainPath = join(
    workspaceRoot,
    'apps/electron-backend-e2e/src/fixtures/sqlite-recording-migration.cjs'
);

test.describe('recordings database migration', () => {
    test('@electron makes legacy recording playback snapshots nullable', async ({
        dataDir,
    }) => {
        const databasePath = join(dataDir, 'databases', 'iptvnator.db');
        await runSqliteFixture('create', databasePath, dataDir);

        const app = await launchElectronApp(dataDir);
        try {
            const result = await app.mainWindow.evaluate(async () => {
                const before = await window.electron.recordingsGetList();
                const canceled =
                    await window.electron.recordingsCancel('legacy-recording');
                const after = await window.electron.recordingsGetList();
                return { before, canceled, after };
            });
            expect(result.before).toEqual([
                expect.objectContaining({
                    id: 'legacy-recording',
                    status: 'scheduled',
                }),
            ]);
            expect(result.canceled).toEqual({ success: true });
            expect(result.after).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: 'legacy-recording',
                        status: 'canceled',
                    }),
                ])
            );
        } finally {
            await closeElectronApp(app);
        }

        const inspection = await runSqliteFixture(
            'inspect',
            databasePath,
            dataDir
        );
        expect(inspection).toEqual(
            expect.objectContaining({
                success: true,
                legacyTableCount: 0,
                streamUrl: null,
                streamUrlNotNull: 0,
            })
        );
        expect(inspection.indexes).toEqual(
            expect.arrayContaining([
                'recordings_completed_idx',
                'recordings_playlist_idx',
                'recordings_status_start_idx',
            ])
        );
    });
});

async function runSqliteFixture(
    mode: 'create' | 'inspect',
    databasePath: string,
    dataDir: string
): Promise<MigrationInspection> {
    const resultPath = join(dataDir, `recording-migration-${mode}.json`);
    const args = [fixtureMainPath];
    if (process.platform === 'linux' && process.env['CI']) {
        args.unshift('--no-sandbox', '--disable-gpu');
    }
    const fixtureApp = await electron.launch({
        args,
        env: {
            ...process.env,
            ELECTRON_IS_DEV: '0',
            IPTVNATOR_E2E_MIGRATION_DATABASE_PATH: databasePath,
            IPTVNATOR_E2E_MIGRATION_MODE: mode,
            IPTVNATOR_E2E_MIGRATION_RESULT_PATH: resultPath,
            NODE_ENV: 'test',
        },
    });
    try {
        const readyWindow = await fixtureApp.firstWindow();
        await expect(readyWindow).toHaveTitle('sqlite-fixture-ready');
    } finally {
        await fixtureApp.close();
    }

    const result = JSON.parse(
        readFileSync(resultPath, 'utf8')
    ) as MigrationInspection;
    if (!result.success) {
        throw new Error(result.error || `SQLite fixture ${mode} failed`);
    }
    return result;
}
