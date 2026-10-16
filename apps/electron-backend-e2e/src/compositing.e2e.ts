import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    goToDashboard,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    addCurrentDetailToFavorites,
    goBackFromDetail,
    toggleFavoriteForChannel,
} from './dashboard-e2e-flows';
import {
    collectCompositedLayers,
    describeLayerSize,
    findOversizedClipMasks,
    measureContentArea,
    routeDeterministicArtwork,
} from './performance/compositing-probe';
import {
    fetchXtreamLiveFixture,
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
    getXtreamTitle,
} from './portal-mock-fixtures';

test.describe('Compositing budget', () => {
    // A `border-radius` on the content scroller made Blink clip every
    // composited effect inside it (the rail chevrons' and hero controls'
    // backdrop filters, running animations) through a synthesized mask layer
    // the size of the whole content area: ~24 MB of tile memory each at 2x,
    // a dozen on the dashboard, which took the renderer past Chromium's tile
    // budget ("tile memory limits exceeded") and left blank tiles while
    // scrolling. The corner is painted instead (workspace shell contract).
    // Blink synthesizes the masks while layerizing, before any GPU work:
    // under `--disable-gpu` (the Linux CI launch, software compositing and
    // raster) the controls are still composited and the old radius still
    // produced seven masks, so the check guards the same path everywhere.
    test('synthesizes no content-area-sized clip masks on the dashboard, the detail pages and Live TV', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120_000);
        await resetMockServers(request, ['xtream']);
        const credentials = {
            password: defaultXtreamPassword,
            username: defaultXtreamUsername,
        };
        const live = await fetchXtreamLiveFixture(request, credentials);
        const vod = await fetchXtreamVodFixture(request, credentials);
        const series = await fetchXtreamSeriesFixture(request, credentials);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;

        try {
            await routeDeterministicArtwork(page);
            const cdp = await app.electronApp.context().newCDPSession(page);
            const clipMasks = async () => {
                const area = await measureContentArea(page);
                const layers = await collectCompositedLayers(cdp, page);
                return {
                    backdropFilterLayers: layers.filter((layer) =>
                        layer.reasons.includes('BackdropFilter')
                    ).length,
                    masks: findOversizedClipMasks(layers, area).map(
                        describeLayerSize
                    ),
                };
            };

            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await openWorkspaceSection(page, 'Live TV');
            await clickCategoryByNameExact(page, live.categoryName);
            await toggleFavoriteForChannel(page, getXtreamTitle(live.items[0]));
            await expect(
                page.getByTestId('channel-item').first()
            ).toBeVisible();
            expect((await clipMasks()).masks, 'Live TV').toEqual([]);

            await page
                .getByRole('link', { exact: true, name: 'Movies' })
                .click();
            await clickCategoryByNameExact(page, vod.categoryName);
            await clickFirstGridListCard(page);
            await expect(
                page.locator('app-content-hero .hero__backdrop-image')
            ).toBeVisible({ timeout: 20_000 });
            await addCurrentDetailToFavorites(page);
            const movie = await clipMasks();
            // The detail actions' ghost surfaces are backdrop-filtered.
            expect(movie.backdropFilterLayers, 'movie detail').toBeGreaterThan(
                0
            );
            expect(movie.masks, 'movie detail').toEqual([]);
            await goBackFromDetail(page);

            await page
                .getByRole('link', { exact: true, name: 'Series' })
                .click();
            await clickCategoryByNameExact(page, series.categoryName);
            await clickFirstGridListCard(page);
            await expect(page.locator('app-content-hero')).toBeVisible({
                timeout: 20_000,
            });
            await addCurrentDetailToFavorites(page);
            expect((await clipMasks()).masks, 'series detail').toEqual([]);

            await goToDashboard(page);
            await expect(page.getByTestId('dashboard-hero')).toBeVisible({
                timeout: 20_000,
            });
            await expect(
                page.getByTestId('dashboard-xtream-recently-added-rail')
            ).toBeVisible({ timeout: 20_000 });
            const dashboard = await clipMasks();
            // The composited effects this guards: every rail has two
            // backdrop-filtered chevrons, the hero its controls. Without this
            // the mask check would pass on a page with nothing to clip.
            expect(dashboard.backdropFilterLayers, 'dashboard').toBeGreaterThan(
                0
            );
            expect(dashboard.masks, 'dashboard').toEqual([]);
            await cdp.detach();
        } finally {
            await closeElectronApp(app);
        }
    });
});
