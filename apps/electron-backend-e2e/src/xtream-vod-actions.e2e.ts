import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { createSparseVodPortal } from './support/sparse-vod-portal';

for (const mode of ['catalog', 'missing', 'direct'] as const) {
    test(`Xtream VOD null extension keeps actions and resolves ${mode}`, async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const portal = await createSparseVodPortal(mode);
        const app = await launchElectronApp(dataDir);
        try {
            const page = app.mainWindow;
            await addXtreamPortal(page, {
                serverUrl: portal.origin,
                username: 'minimal',
                password: 'minimal',
            });
            await waitForXtreamWorkspaceReady(page);
            await page
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await page.locator('app-grid-list mat-card').first().click();
            await page.waitForURL(/\/vod\/[^/]+\/[^/]+$/);
            const detailUrl = page.url();
            // SQLite's catalog rows omit the extension, so this first detail
            // must recover a provider source independently of persisted data.
            const primary = page.locator('[data-testid="vod-primary-action"]');
            const favorite = page.locator(
                '[data-testid="vod-favorite-toggle"]'
            );
            const watched = page.locator('[data-testid="vod-watched-toggle"]');
            await expect(favorite).toBeVisible();
            await expect(watched).toBeEnabled();
            await watched.click();
            await expect(watched).toHaveAttribute('aria-pressed', 'true');
            await favorite.click();
            await expect(favorite).toHaveAttribute('aria-pressed', 'true');
            if (mode === 'missing') {
                await expect(primary).toBeDisabled();
                await expect(
                    page.locator('app-portal-detail-shell [role="status"]')
                ).toContainText('the provider did not supply');
                expect(portal.mediaRequests).toEqual([]);
            } else {
                await watched.click();
                await expect(watched).toHaveAttribute('aria-pressed', 'false');
                await expect(primary).toBeEnabled();
                await expect(
                    page.locator('[data-testid="vod-download-start"]')
                ).toBeVisible();
                await primary.click();
                const video = page
                    .locator('app-portal-inline-player video')
                    .first();
                await expect
                    .poll(() =>
                        video.evaluate((el: HTMLVideoElement) => el.currentTime)
                    )
                    .toBeGreaterThan(0);
                const streamId = new URL(detailUrl).pathname.split('/').pop();
                expect(portal.mediaRequests).toContain(
                    mode === 'direct'
                        ? `/movie/direct/${streamId}.mp4`
                        : `/movie/minimal/minimal/${streamId}.mp4`
                );
            }
        } finally {
            await closeElectronApp(app);
            await portal.close();
        }
    });
}
