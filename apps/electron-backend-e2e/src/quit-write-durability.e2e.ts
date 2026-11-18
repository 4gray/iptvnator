import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
    type LaunchedElectronApp,
} from './electron-test-fixtures';

/**
 * A write the renderer sends just before the app quits must reach SQLite.
 *
 * Quit used to terminate the database worker at once on 'will-quit',
 * rejecting whatever it had not answered yet: a write still in flight, and
 * the inline player's `pagehide` flush of its held resume position whenever
 * the worker was busy, were lost. Quit now waits, within a bounded budget,
 * for the worker to drain the writes it accepted and close SQLite.
 */

const playlistId = 'quit-durability';
const batchSize = 3000;
const pageHideContentId = 900001;

async function seedPlaylist(app: LaunchedElectronApp): Promise<void> {
    await app.mainWindow.evaluate(async (id) => {
        await window.electron.dbUpsertAppPlaylist({
            _id: id,
            title: 'Synthetic quit durability source',
            url: 'http://127.0.0.1:9/synthetic.m3u',
            count: 0,
            importDate: '2026-01-01',
            lastUsage: '2026-01-01',
            autoRefresh: false,
        });
    }, playlistId);
}

/** Queues a large write and a `pagehide` flush, then returns without waiting. */
async function queueWritesThenQuit(app: LaunchedElectronApp): Promise<void> {
    await app.mainWindow.evaluate(
        ({ id, batchSize, pageHideContentId }) => {
            // The inline player's held position is flushed the same way.
            window.addEventListener('pagehide', () => {
                void window.electron.dbSavePlaybackPosition(id, {
                    contentXtreamId: pageHideContentId,
                    contentType: 'vod',
                    positionSeconds: 1234,
                    durationSeconds: 7200,
                });
            });
            // Keeps the worker busy while the quit starts.
            void window.electron.dbSavePlaybackPositionsBatch(
                id,
                Array.from({ length: batchSize }, (_, index) => ({
                    contentXtreamId: index + 1,
                    contentType: 'vod' as const,
                    positionSeconds: 120,
                    durationSeconds: 7200,
                }))
            );
        },
        { id: playlistId, batchSize, pageHideContentId }
    );

    const exited = new Promise<void>((resolve) => {
        const child = app.electronApp.process();
        if (child.exitCode !== null) resolve();
        else child.once('exit', () => resolve());
    });
    await app.electronApp.evaluate(({ app: electronApp }) =>
        electronApp.quit()
    );
    await exited;
}

test.describe('Writes sent just before quitting', () => {
    test('@electron a write in flight and the pagehide flush survive an app quit', async ({
        dataDir,
    }) => {
        const first = await launchElectronApp(dataDir);
        await seedPlaylist(first);
        await queueWritesThenQuit(first);

        const relaunched = await launchElectronApp(dataDir);
        try {
            const saved = await relaunched.mainWindow.evaluate(
                async ({ id, pageHideContentId }) => {
                    const rows =
                        await window.electron.dbGetAllPlaybackPositions(id);
                    const flushed = await window.electron.dbGetPlaybackPosition(
                        id,
                        pageHideContentId,
                        'vod'
                    );
                    return {
                        rows: rows.length,
                        flushedSeconds: flushed?.positionSeconds ?? null,
                    };
                },
                { id: playlistId, pageHideContentId }
            );

            expect(saved).toEqual({
                rows: batchSize + 1,
                flushedSeconds: 1234,
            });
        } finally {
            await closeElectronApp(relaunched);
        }
    });
});
