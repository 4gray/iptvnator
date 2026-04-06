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
    xtreamMockServer,
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

function xtreamBlockedStateTitle(page: Parameters<typeof addXtreamPortal>[0]) {
    return page.locator('.xtream-content-gate .error-view__title');
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

            const overlay = app.mainWindow.locator(
                '.workspace-loading-overlay'
            );
            await expect(overlay).toBeVisible({ timeout: 15000 });
            await expect(
                overlay.getByRole('button', {
                    name: /stop sync|cancel import/i,
                })
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
                        (await app.mainWindow.evaluate(
                            () =>
                                (window.__dbOperationEvents ?? []).filter(
                                    (event) =>
                                        event.operation === 'save-content' &&
                                        event.status === 'progress'
                                ).length
                        )) > 2,
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

    test('stops importing after cancel until the user explicitly retries', async ({
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

            const overlay = app.mainWindow.locator(
                '.workspace-loading-overlay'
            );
            const cancelButton = overlay.getByRole('button', {
                name: /stop sync|cancel import/i,
            });

            await expect(overlay).toBeVisible({ timeout: 15000 });
            await expect(cancelButton).toBeVisible({ timeout: 20000 });

            await waitForDbOperationEvent(app.mainWindow, {
                operation: 'save-content',
                predicate: (event) =>
                    event.status === 'progress' &&
                    (event.current ?? 0) > 0 &&
                    (event.total ?? 0) > 0,
                timeoutMs: 30000,
            });

            await cancelButton.click();

            await expect(overlay).toHaveCount(0, { timeout: 20000 });
            await expect(xtreamBlockedStateTitle(app.mainWindow)).toHaveText(
                'Import cancelled',
                { timeout: 20000 }
            );

            await app.mainWindow.waitForTimeout(1200);
            await expect(overlay).toHaveCount(0);

            const retryButton = app.mainWindow.getByRole('button', {
                name: 'Retry',
                exact: true,
            });
            await retryButton.click();

            await waitForXtreamCatalog(app.mainWindow);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('blocks expired and inactive Xtream accounts before import starts', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Expired Xtream Portal',
                password: 'expired',
                username: 'expired',
            });

            await expect(xtreamBlockedStateTitle(app.mainWindow)).toHaveText(
                'Account expired',
                { timeout: 20000 }
            );
            await expect(
                app.mainWindow.locator('.workspace-loading-overlay')
            ).toHaveCount(0);

            await openSources(app.mainWindow);

            await addXtreamPortal(app.mainWindow, {
                name: 'Inactive Xtream Portal',
                password: 'inactive',
                username: 'inactive',
            });

            await expect(xtreamBlockedStateTitle(app.mainWindow)).toHaveText(
                'Account inactive',
                { timeout: 20000 }
            );
            await expect(
                app.mainWindow.locator('.workspace-loading-overlay')
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('blocks unreachable Xtream portals immediately without an import loop', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Unavailable Xtream Portal',
                password: stressXtreamPassword,
                serverUrl: xtreamMockServer.replace(/:\d+$/, ':65530'),
                username: stressXtreamUsername,
            });

            await expect(xtreamBlockedStateTitle(app.mainWindow)).toHaveText(
                'Portal unavailable',
                { timeout: 20000 }
            );
            await expect(
                app.mainWindow.locator('.workspace-loading-overlay')
            ).toHaveCount(0);
            await app.mainWindow.waitForTimeout(1200);
            await expect(
                app.mainWindow.locator('.workspace-loading-overlay')
            ).toHaveCount(0);
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

            const confirmDialog = app.mainWindow.locator(
                'mat-dialog-container'
            );
            await expect(confirmDialog).toBeVisible();
            await confirmDialog
                .getByRole('button', { name: 'Yes', exact: true })
                .click();

            await waitForDbOperationEvent(app.mainWindow, {
                operation: 'delete-playlist',
                status: 'started',
                timeoutMs: 20000,
            });

            await expect(
                playlistRow.locator('.busy-state__message')
            ).toBeVisible({ timeout: 20000 });
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
