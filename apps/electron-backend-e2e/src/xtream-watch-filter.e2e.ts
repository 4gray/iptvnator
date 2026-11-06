import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    sourceRowByTitle,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { applyTheme, expectTextContrast } from './theme-contrast';
import {
    expectRendererReloadedOnRoute,
    reloadFromMainProcess,
} from './renderer-reload.support';

async function chooseWatchStatus(page: Page, status: string): Promise<void> {
    await page.getByRole('button', { name: 'Refine', exact: true }).click();
    const trigger = page.getByRole('menuitem', { name: /Watch status/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page
        .getByRole('menuitemradio', { name: status, exact: true })
        .click();
    await expect(
        page.locator('.cdk-overlay-pane .mat-mdc-menu-panel')
    ).toHaveCount(0);
}

test('@electron @xtream @persistence filters movies with durable SQLite history', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    let app = await launchElectronApp(dataDir);
    try {
        let page = app.mainWindow;
        await addXtreamPortal(page, {
            username: 'minimal',
            password: 'minimal',
        });
        await waitForXtreamWorkspaceReady(page);
        await openWorkspaceSection(page, 'Movies');
        let cards = page.locator('app-grid-list mat-card');
        await expect(cards.first()).toBeVisible();
        const title = await cards.first().locator('.title').innerText();
        const catalogUrl = page.url();
        await cards.first().click();
        let watched = page.locator('[data-testid="vod-watched-toggle"]');
        await expect(watched).toBeEnabled();
        const movieId = Number(new URL(page.url()).pathname.split('/').pop());
        const playlistId = new URL(catalogUrl).pathname.match(
            /xtreams\/([^/]+)/
        )?.[1];
        expect(playlistId).toBeTruthy();
        await watched.click();
        await expect(watched).toHaveAttribute('aria-pressed', 'true');
        await page.locator('[data-test-id="workspace-header-back"]').click();
        await expect(page).toHaveURL(catalogUrl);
        await chooseWatchStatus(page, 'Watched');
        await expect(cards).toHaveCount(1);
        await expect(cards.first()).toContainText(title);

        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            await expectTextContrast(
                page.locator('.watch-refinement-chip .refinement-chip-label')
            );
            await page.screenshot({
                path: test.info().outputPath(`watch-filter-${theme}.png`),
            });
        }

        await closeElectronApp(app);
        app = await launchElectronApp(dataDir);
        page = app.mainWindow;
        await openSources(page);
        await sourceRowByTitle(page, 'Mock Xtream Portal').first().click();
        await waitForXtreamWorkspaceReady(page);
        await openWorkspaceSection(page, 'Movies');
        cards = page.locator('app-grid-list mat-card');
        await expect(cards.first()).toBeVisible();
        await expect(
            page.getByRole('button', {
                name: 'Clear watch status filter: Watched',
                exact: true,
            })
        ).toHaveCount(0);
        await chooseWatchStatus(page, 'Watched');
        await expect(cards).toHaveCount(1);
        await expect(cards.first()).toContainText(title);
        await cards.first().click();
        watched = page.locator('[data-testid="vod-watched-toggle"]');
        await expect(watched).toHaveAttribute('aria-pressed', 'true');
        await watched.click();
        await expect(watched).toHaveAttribute('aria-pressed', 'false');
        await page.locator('[data-test-id="workspace-header-back"]').click();
        await expect(page).toHaveURL(catalogUrl);
        await expect(
            page.getByText('No movies match this watch status', { exact: true })
        ).toBeVisible();
        await page
            .getByRole('button', { name: 'Clear watch status', exact: true })
            .click();
        await expect(cards.first()).toContainText(title);
        await chooseWatchStatus(page, 'Unwatched');
        await expect(cards.first()).toContainText(title);
        await page.evaluate(
            async ({ id, contentId }) => {
                if (!window.electron)
                    throw new Error(
                        'Expected Electron playback-position bridge'
                    );
                await window.electron.dbSavePlaybackPosition(id, {
                    contentType: 'vod',
                    contentXtreamId: contentId,
                    positionSeconds: 30,
                    durationSeconds: 100,
                });
            },
            { id: playlistId!, contentId: movieId }
        );
        await reloadFromMainProcess(app);
        await expectRendererReloadedOnRoute(page, /\/xtreams\/[^/]+\/vod$/);
        await expect(cards.first()).toBeVisible();
        await chooseWatchStatus(page, 'In progress');
        await expect(cards).toHaveCount(1);
        await expect(cards.first()).toContainText(title);
        await openWorkspaceSection(page, 'Series');
        await expect(
            page.getByRole('button', {
                name: /Clear watch status filter/,
            })
        ).toHaveCount(0);
        await page.getByRole('button', { name: 'Refine', exact: true }).click();
        await expect(
            page.getByRole('menuitem', { name: /Watch status/ })
        ).toHaveCount(0);
    } finally {
        await closeElectronApp(app);
    }
});
