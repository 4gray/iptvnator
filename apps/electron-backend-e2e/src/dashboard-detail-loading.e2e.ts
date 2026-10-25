import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    goToDashboard,
    openGlobalRecent,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    holdIpcChannel,
    launchElectronWithChannelHolds,
} from './ipc-channel-hold';
import { applyTheme } from './theme-contrast';
import { xtreamPlaylistIdFromUrl } from './xtream-import-wait';

const recentChannel = 'DB_GET_RECENTLY_VIEWED';
const playlistRecentChannel = 'DB_GET_RECENT_ITEMS';

for (const contentType of ['movie', 'series'] as const) {
    test(`dashboard ${contentType} details keep the detail skeleton through collection loading`, async ({
        dataDir,
        request,
    }, testInfo) => {
        test.setTimeout(120_000);
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronWithChannelHolds(dataDir, [
            recentChannel,
            playlistRecentChannel,
        ]);
        const page = app.mainWindow;
        try {
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            const playlistId = xtreamPlaylistIdFromUrl(page.url());
            if (!playlistId)
                throw new Error('Xtream playlist route is missing');
            const title = await page.evaluate(
                async ({ id, type }) => {
                    const [item] = await window.electron.dbGetContent(id, type);
                    if (!item) throw new Error('Mock catalog has no title');
                    await window.electron.dbAddRecentItem(item.id, id);
                    if (type === 'movie') {
                        await window.electron.dbSavePlaybackPosition(id, {
                            contentXtreamId: item.xtream_id,
                            contentType: 'vod',
                            positionSeconds: 120,
                            durationSeconds: 7200,
                        });
                    }
                    return item.title;
                },
                { id: playlistId, type: contentType }
            );
            await applyTheme(page, contentType === 'movie' ? 'light' : 'dark');

            const entries = [
                {
                    name: 'hero',
                    action: page.getByTestId('dashboard-hero-primary-action'),
                },
                {
                    name: 'rail',
                    action: page
                        .getByTestId('dashboard-continue-watching-rail-card')
                        .filter({ hasText: title })
                        .getByRole('link')
                        .first(),
                },
            ];
            for (const entry of entries) {
                await goToDashboard(page);
                await expect(entry.action).toHaveAttribute(
                    'href',
                    /\/global-recent$/
                );
                await entry.action.hover();
                const hold = await holdIpcChannel(app, recentChannel);
                await entry.action.click();
                await page.waitForURL(/\/workspace\/global-recent$/);
                await hold.waitUntilHeld();
                await expect(page.getByTestId('hero-skeleton')).toBeVisible();
                await expect(page.getByTestId('hero-skeleton')).toHaveCSS(
                    'opacity',
                    '1'
                );
                await expect(
                    page.locator(
                        '.skeleton-list, .skeleton-grid, .collection-header'
                    )
                ).toHaveCount(0);
                await testInfo.attach(`${contentType}-${entry.name}-loading`, {
                    body: await page.screenshot(),
                    contentType: 'image/png',
                });
                await hold.release();
                await expect(page.getByTestId('hero-skeleton')).toHaveCount(0);
                await expect(page.locator('app-content-hero')).toContainText(
                    title
                );
                await page.goBack();
                await page.waitForURL(/\/workspace\/dashboard$/);
            }

            // Opening the collection itself still uses its list/grid loader.
            const hold = await holdIpcChannel(app, playlistRecentChannel);
            await openGlobalRecent(page);
            await hold.waitUntilHeld();
            await expect(
                page.locator('.skeleton-list, .skeleton-grid')
            ).toBeVisible();
            await expect(page.getByTestId('hero-skeleton')).toHaveCount(0);
            await hold.release();
        } finally {
            await closeElectronApp(app);
        }
    });
}
