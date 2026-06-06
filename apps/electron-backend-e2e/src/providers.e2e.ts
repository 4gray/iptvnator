import type { Page } from '@playwright/test';

import {
    addStalkerPortal,
    addXtreamPortal,
    closeElectronApp,
    defaultStalkerPortalName,
    defaultXtreamPortalName,
    expect,
    expectPortalDebugSuccess,
    goToDashboard,
    launchElectronApp,
    resetMockServers,
    stalkerMockServer,
    test,
    waitForXtreamImportToFinish,
    waitForStalkerCatalog,
    waitForXtreamCatalog,
} from './electron-test-fixtures';

test.describe('Electron Provider Smoke Tests', () => {
    test('@xtream @electron loads Xtream content through the Electron IPC path', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamCatalog(app.mainWindow);
            await expectPortalDebugSuccess(app.mainWindow, 'xtream');

            await goToDashboard(app.mainWindow);
            await expectRecentSourceCard(
                app.mainWindow,
                defaultXtreamPortalName
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@stalker @electron loads Stalker content through the Electron IPC path', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);

        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow, {
                portalUrl: `${stalkerMockServer}/portal.php`,
            });
            await waitForStalkerCatalog(app.mainWindow);
            await expectPortalDebugSuccess(app.mainWindow, 'stalker');

            await goToDashboard(app.mainWindow);
            await expectRecentSourceCard(
                app.mainWindow,
                defaultStalkerPortalName
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@xtream @electron shows refresh overlay immediately from the dashboard Xtream source menu', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamCatalog(app.mainWindow);
            await expectPortalDebugSuccess(app.mainWindow, 'xtream');

            await goToDashboard(app.mainWindow);
            await refreshRecentXtreamSourceFromDashboard(
                app.mainWindow,
                defaultXtreamPortalName
            );
            await waitForXtreamImportToFinish(app.mainWindow);
        } finally {
            await closeElectronApp(app);
        }
    });
});

async function expectRecentSourceCard(
    page: Page,
    title: string
): Promise<void> {
    await expect(page.getByTestId('dashboard-recent-sources-rail')).toBeVisible(
        {
            timeout: 20000,
        }
    );

    await expect(
        page
            .getByTestId('dashboard-recent-sources-rail-card')
            .filter({
                hasText: title,
            })
            .first()
    ).toBeVisible({
        timeout: 20000,
    });
}

async function refreshRecentXtreamSourceFromDashboard(
    page: Page,
    title: string
): Promise<void> {
    const sourceCard = page
        .getByTestId('dashboard-recent-sources-rail-card')
        .filter({
            hasText: title,
        })
        .first();

    await expect(sourceCard).toBeVisible({ timeout: 20000 });
    await sourceCard.hover();
    await sourceCard
        .getByTestId('dashboard-recent-sources-rail-card-actions')
        .click();
    await page
        .getByRole('menuitem', {
            name: 'Refresh Xtream playlist from remote',
            exact: true,
        })
        .click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click();

    const refreshOverlay = page.locator('app-workspace-shell-import-overlay');
    await expect(refreshOverlay).toBeVisible({ timeout: 5000 });
    await expect(
        refreshOverlay.getByRole('heading', {
            name: 'Refreshing playlist',
            exact: true,
        })
    ).toBeVisible();
    await expect(refreshOverlay).toContainText(/Local library/);
    await expect(refreshOverlay).toContainText(
        /Preserving your library data|Removing cached streams|Removing cached categories/
    );

    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
}
