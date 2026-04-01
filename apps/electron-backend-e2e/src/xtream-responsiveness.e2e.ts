import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    expectPortalDebugSuccess,
    expectRendererFramesAdvance,
    launchElectronApp,
    resetMockServers,
    test,
    waitForDbOperationEvent,
    waitForXtreamCatalog,
} from './electron-test-fixtures';

const stressPortalName = 'Stress Xtream Portal';
const stressXtreamUsername = 'stress';
const stressXtreamPassword = 'stress';
const dbWorkerBatchDelayMs = '20';

function playlistRowByName(name: string) {
    return `app-playlist-item:has-text("${name}")`;
}

async function openSources(page: Parameters<typeof addXtreamPortal>[0]) {
    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await page.waitForURL(/\/workspace\/sources$/);
}

test.describe('Electron Xtream Responsiveness', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120000);

    test('keeps the UI responsive during large Xtream imports', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);

        const app = await launchElectronApp(dataDir, {
            env: {
                IPTVNATOR_DB_WORKER_BATCH_DELAY_MS: dbWorkerBatchDelayMs,
            },
        });

        try {
            await addXtreamPortal(app.mainWindow, {
                name: stressPortalName,
                password: stressXtreamPassword,
                username: stressXtreamUsername,
            });

            const overlay = app.mainWindow.locator('.workspace-loading-overlay');
            await expect(overlay).toBeVisible({ timeout: 15000 });
            await expect(
                overlay.getByRole('button', { name: /cancel import/i })
            ).toBeVisible({ timeout: 20000 });

            await waitForDbOperationEvent(app.mainWindow, {
                operation: 'save-content',
                predicate: (event) =>
                    event.status === 'progress' &&
                    (event.current ?? 0) > 0 &&
                    (event.total ?? 0) > 0,
                timeoutMs: 30000,
            });

            await expect
                .poll(
                    async () =>
                        (
                            await app.mainWindow.evaluate(() =>
                                (window.__dbOperationEvents ?? []).filter(
                                    (event) =>
                                        event.operation === 'save-content' &&
                                        event.status === 'progress'
                                ).length
                            )
                        ) > 2,
                    { timeout: 30000 }
                )
                .toBeTruthy();

            await expectRendererFramesAdvance(app.mainWindow, {
                minimumDelta: 5,
                sampleMs: 400,
            });

            await expect
                .poll(
                    async () =>
                        (await overlay.locator('p').allInnerTexts()).some(
                            (text) => /\d+\s*\/\s*\d+/.test(text)
                        ),
                    { timeout: 30000 }
                )
                .toBeTruthy();

            await waitForXtreamCatalog(app.mainWindow);
            await expectPortalDebugSuccess(app.mainWindow, 'xtream');
        } finally {
            await closeElectronApp(app);
        }
    });

    test('keeps the UI responsive during large Xtream playlist deletion', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);

        const app = await launchElectronApp(dataDir, {
            env: {
                IPTVNATOR_DB_WORKER_BATCH_DELAY_MS: dbWorkerBatchDelayMs,
            },
        });

        try {
            await addXtreamPortal(app.mainWindow, {
                name: stressPortalName,
                password: stressXtreamPassword,
                username: stressXtreamUsername,
            });
            await waitForXtreamCatalog(app.mainWindow);
            await openSources(app.mainWindow);

            const playlistRow = app.mainWindow.locator(
                playlistRowByName(stressPortalName)
            );
            await expect(playlistRow).toBeVisible({ timeout: 20000 });

            await playlistRow.locator('.delete-btn').click();

            const confirmDialog = app.mainWindow.locator('mat-dialog-container');
            await expect(confirmDialog).toBeVisible();
            await confirmDialog
                .getByRole('button', { name: 'Yes', exact: true })
                .click();

            await waitForDbOperationEvent(app.mainWindow, {
                operation: 'delete-playlist',
                status: 'started',
                timeoutMs: 20000,
            });

            await expect(playlistRow.locator('.busy-state__message')).toBeVisible(
                { timeout: 20000 }
            );
            await expect(playlistRow.locator('.cancel-btn')).toBeVisible();

            await waitForDbOperationEvent(app.mainWindow, {
                operation: 'delete-playlist',
                predicate: (event) =>
                    event.status === 'progress' &&
                    (event.current ?? 0) > 0 &&
                    (event.total ?? 0) > 0,
                timeoutMs: 30000,
            });

            await expectRendererFramesAdvance(app.mainWindow, {
                minimumDelta: 5,
                sampleMs: 400,
            });

            await expect(playlistRow).toHaveCount(0, { timeout: 60000 });
            await expect(
                app.mainWindow.locator(playlistRowByName(stressPortalName))
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });
});
