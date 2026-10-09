import type { CDPSession, Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

type CompositedLayer = {
    backendNodeId?: number;
    drawsContent: boolean;
    height: number;
    layerId: string;
    width: number;
};

/** The composited layers of the page after the next two frames. */
async function compositedLayers(
    cdp: CDPSession,
    page: Page
): Promise<CompositedLayer[]> {
    let layers: CompositedLayer[] = [];
    const onChange = (event: { layers?: CompositedLayer[] }) => {
        layers = event.layers ?? [];
    };
    cdp.on('LayerTree.layerTreeDidChange', onChange);
    try {
        await cdp.send('LayerTree.enable');
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(resolve)
                    )
                )
        );
        await expect.poll(() => layers.length).toBeGreaterThan(0);
        await cdp.send('LayerTree.disable');
    } finally {
        cdp.off('LayerTree.layerTreeDidChange', onChange);
    }
    return layers;
}

test.describe('Dashboard compositing', () => {
    // A `border-radius` on the content scroller made Blink clip every
    // composited effect inside it (the rail chevrons' and hero controls'
    // backdrop filters, running animations) through a synthesized mask layer
    // the size of the whole content area: ~24 MB of tile memory each at 2x,
    // a dozen on the dashboard, which took the renderer past Chromium's tile
    // budget ("tile memory limits exceeded") and left blank tiles while
    // scrolling. The corner is painted instead. Mask layers have no DOM node,
    // so a drawing layer without one that spans half the content area is
    // one of them.
    test('does not synthesize content-area-sized clip masks for the composited rail and hero controls', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;

        try {
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await goToDashboard(page);
            await expect(page.getByTestId('dashboard-hero')).toBeVisible({
                timeout: 20_000,
            });
            await expect(
                page.getByTestId('dashboard-xtream-recently-added-rail')
            ).toBeVisible({ timeout: 20_000 });
            // The composited effects this guards: every rail has two
            // backdrop-filtered chevrons, the hero its controls.
            expect(await page.locator('.rail__chev').count()).toBeGreaterThan(
                0
            );
            await expect(page.locator('.hero__controls')).toBeVisible();

            const content = await page
                .locator('main.workspace-content')
                .evaluate((element) => ({
                    width: element.clientWidth * window.devicePixelRatio,
                    height: element.clientHeight * window.devicePixelRatio,
                }));
            const cdp = await app.electronApp.context().newCDPSession(page);
            const layers = await compositedLayers(cdp, page);
            await cdp.detach();

            const contentArea = content.width * content.height;
            const clipMasks = layers.filter(
                (layer) =>
                    layer.drawsContent &&
                    !layer.backendNodeId &&
                    layer.width * layer.height >= contentArea / 2
            );
            expect(
                clipMasks.map(
                    (layer) => `${layer.layerId}: ${layer.width}x${layer.height}`
                )
            ).toEqual([]);
        } finally {
            await closeElectronApp(app);
        }
    });
});
