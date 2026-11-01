import {
    addStalkerPortal,
    closeElectronApp,
    expect,
    expectPathname,
    launchElectronApp,
    openWorkspaceSection,
    test,
} from './electron-test-fixtures';

test('@electron @stalker @persistence hide watched follows SQLite marks and external-player progress events', async ({
    dataDir,
}) => {
    test.setTimeout(120_000);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await addStalkerPortal(page, {
            name: 'Stalker hide watched',
            macAddress: '00:1A:79:AF:10:03',
        });
        const cards = page.locator('app-grid-list mat-card');
        await expect(cards.first()).toBeVisible();
        await expect(cards.first()).toHaveAttribute('aria-label', /\S/);
        const title = (await cards
            .first()
            .getAttribute('aria-label')) as string;
        const playlistId = new URL(page.url()).pathname.match(
            /stalker\/([^/]+)/
        )?.[1];
        expect(playlistId).toBeTruthy();
        await page.getByRole('button', { name: 'Refine', exact: true }).click();
        await page
            .getByRole('menuitemcheckbox', {
                name: 'Hide watched',
                exact: true,
            })
            .click();
        await cards.first().click();
        const watched = page.locator('[data-testid="vod-watched-toggle"]');
        await expect(watched).toBeEnabled();
        await watched.click();
        await expect(watched).toHaveAttribute('aria-pressed', 'true');
        const positions = await page.evaluate(
            async (id) => window.electron.dbGetAllPlaybackPositions(id),
            playlistId as string
        );
        const marked = positions.find(
            (row) =>
                row.contentType === 'vod' &&
                row.positionSeconds >= (row.durationSeconds ?? Infinity)
        );
        expect(marked).toBeTruthy();
        await page.getByTestId('workspace-header-back').click();
        await expect(cards.first()).toBeVisible();
        await expect(
            page
                .locator('app-grid-list')
                .getByRole('button', { name: title, exact: true })
        ).toHaveCount(0);

        // Exercise the real main -> preload -> runtime bridge subscription used
        // by external players, while retaining the normal database save path.
        await app.electronApp.evaluate(({ BrowserWindow }, row) => {
            for (const window of BrowserWindow.getAllWindows()) {
                window.webContents.send('playback-position-update', {
                    ...row,
                    positionSeconds: 0,
                });
            }
        }, marked);
        await expect(
            page
                .locator('app-grid-list')
                .getByRole('button', { name: title, exact: true })
        ).toHaveCount(1);
        await expect
            .poll(() =>
                page.evaluate(
                    async ({ id, contentId }) => {
                        const rows =
                            await window.electron.dbGetAllPlaybackPositions(id);
                        return rows.find(
                            (row) =>
                                row.contentType === 'vod' &&
                                row.contentXtreamId === contentId
                        )?.positionSeconds;
                    },
                    {
                        id: playlistId as string,
                        contentId: marked?.contentXtreamId,
                    }
                )
            )
            .toBe(0);
        await app.electronApp.evaluate(({ BrowserWindow }, row) => {
            for (const window of BrowserWindow.getAllWindows())
                window.webContents.send('playback-position-update', row);
        }, marked);
        await expect(
            page
                .locator('app-grid-list')
                .getByRole('button', { name: title, exact: true })
        ).toHaveCount(0);
        await page
            .getByRole('button', {
                name: 'Clear hide watched filter',
                exact: true,
            })
            .click();
        await expect(
            page
                .locator('app-grid-list')
                .getByRole('button', { name: title, exact: true })
        ).toHaveCount(1);
    } finally {
        await closeElectronApp(app);
    }
});

test('@electron @stalker @persistence refreshes hide watched after marking and unmarking a favorite', async ({
    dataDir,
}) => {
    test.setTimeout(120_000);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await addStalkerPortal(page, {
            name: 'Stalker favorite watch changes',
            macAddress: '00:1A:79:AF:10:06',
        });
        const grid = page.locator('app-grid-list');
        const cards = grid.locator('mat-card');
        await expect(cards.first()).toBeVisible();
        await expect(cards.first()).toHaveAttribute('aria-label', /\S/);
        const title = (await cards
            .first()
            .getAttribute('aria-label')) as string;
        await cards.first().click();
        await page.getByRole('button', { name: 'Add to favorites' }).click();
        await expect(
            page.getByRole('button', { name: 'Remove from favorites' })
        ).toBeVisible();
        await page.getByTestId('workspace-header-back').click();
        await page.getByRole('button', { name: 'Refine', exact: true }).click();
        await page
            .getByRole('menuitemcheckbox', {
                name: 'Hide watched',
                exact: true,
            })
            .click();

        for (const watched of [true, false]) {
            await openWorkspaceSection(page, 'Favorites');
            await page
                .getByRole('button', { name: title, exact: true })
                .click();
            const toggle = page.locator('[data-testid="vod-watched-toggle"]');
            await expect(toggle).toBeEnabled();
            await expect(toggle).toHaveAttribute(
                'aria-pressed',
                String(!watched)
            );
            await toggle.click();
            await expect(toggle).toHaveAttribute(
                'aria-pressed',
                String(watched)
            );
            await openWorkspaceSection(page, 'Movies');
            await expectPathname(page, /\/vod$/);
            await expect(
                page.getByRole('button', {
                    name: 'Clear hide watched filter',
                    exact: true,
                })
            ).toBeVisible();
            await expect(
                grid.getByRole('button', { name: title, exact: true })
            ).toHaveCount(watched ? 0 : 1);
        }
    } finally {
        await closeElectronApp(app);
    }
});
