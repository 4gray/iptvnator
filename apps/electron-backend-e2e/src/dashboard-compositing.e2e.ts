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

type CompositedLayerWithReasons = CompositedLayer & {
    /** `LayerTree.compositingReasons` ids, e.g. `BackdropFilter`. */
    reasons: string[];
};

/**
 * The composited layers of the page with their compositing reasons. Blink
 * fills the layer debug info (reasons, owner nodes) in its first
 * layerization after the domain is enabled, so the snapshot is retried
 * until a layer reports a reason.
 */
async function compositedLayers(
    cdp: CDPSession,
    page: Page
): Promise<CompositedLayerWithReasons[]> {
    let layers: CompositedLayer[] = [];
    const onChange = (event: { layers?: CompositedLayer[] }) => {
        layers = event.layers ?? [];
    };
    cdp.on('LayerTree.layerTreeDidChange', onChange);
    let withReasons: CompositedLayerWithReasons[] = [];
    const snapshot = async () => {
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
        );
        const result: CompositedLayerWithReasons[] = [];
        for (const layer of layers) {
            let reasons: string[] = [];
            try {
                const answer = (await cdp.send('LayerTree.compositingReasons', {
                    layerId: layer.layerId,
                })) as { compositingReasonIds?: string[] };
                reasons = answer.compositingReasonIds ?? [];
            } catch {
                // The layer went away between the snapshot and the query.
            }
            result.push({ ...layer, reasons });
        }
        return result;
    };
    try {
        await cdp.send('LayerTree.enable');
        await expect
            .poll(async () => {
                withReasons = await snapshot();
                return withReasons.filter((layer) => layer.reasons.length > 0)
                    .length;
            })
            .toBeGreaterThan(0);
        await cdp.send('LayerTree.disable');
    } finally {
        cdp.off('LayerTree.layerTreeDidChange', onChange);
    }
    return withReasons;
}

test.describe('Dashboard compositing', () => {
    // A `border-radius` on the content scroller made Blink clip every
    // composited effect inside it (the rail chevrons' and hero controls'
    // backdrop filters, running animations) through a synthesized mask layer
    // the size of the whole content area: ~24 MB of tile memory each at 2x,
    // a dozen on the dashboard, which took the renderer past Chromium's tile
    // budget ("tile memory limits exceeded") and left blank tiles while
    // scrolling. The corner is painted instead. A mask layer is synthesized,
    // not painted for an element: it has no owner node and no compositing
    // reason, unlike every content layer (a content layer's owner node can
    // also be missing when its first paint chunk belongs to an anonymous
    // box, so the node alone does not identify a mask). Blink synthesizes
    // them while layerizing, before any GPU work: under `--disable-gpu` (the
    // Linux CI launch, software compositing and raster) the controls are
    // still composited and the old radius still produced seven masks, so the
    // check guards the same path everywhere.
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

            // The effects really are composited here: without this the
            // mask check below would pass on a page with nothing to clip.
            expect(
                layers.filter((layer) =>
                    layer.reasons.includes('BackdropFilter')
                ).length
            ).toBeGreaterThan(0);

            const contentArea = content.width * content.height;
            const clipMasks = layers.filter(
                (layer) =>
                    layer.drawsContent &&
                    !layer.backendNodeId &&
                    layer.reasons.length === 0 &&
                    layer.width * layer.height >= contentArea / 2
            );
            expect(
                clipMasks.map(
                    (layer) =>
                        `${layer.layerId}: ${layer.width}x${layer.height}`
                )
            ).toEqual([]);
        } finally {
            await closeElectronApp(app);
        }
    });
});
