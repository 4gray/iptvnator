import type { CDPSession, Page } from '@playwright/test';

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
    openSettings,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
    workspaceRoot,
    type LaunchedElectronApp,
} from '../electron-test-fixtures';
import {
    addCurrentDetailToFavorites,
    goBackFromDetail,
    toggleFavoriteForChannel,
} from '../dashboard-e2e-flows';
import {
    captureTileMemory,
    collectCompositedLayers,
    describeLayerOwner,
    describeLayerSize,
    findOversizedClipMasks,
    layerDevicePixels,
    layerScale,
    measureContentArea,
    routeDeterministicArtwork,
    TILE_POOL_SETTLE_MS,
} from '../performance/compositing-probe';
import {
    COMPOSITING_SUMMARY_SCHEMA_VERSION,
    formatCompositingTable,
    resolveCompositingSummaryPath,
    writeCompositingSummary,
    type CompositingRouteReading,
    type CompositingSummary,
} from '../performance/compositing-report';
import {
    fetchXtreamLiveFixture,
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
    getXtreamTitle,
} from '../portal-mock-fixtures';

/**
 * Compositing report: the renderer's tile memory and composited layers on
 * the routes with the most artwork and effects, one fresh profile seeded
 * through the app's dialogs against the Xtream mock, at a fixed window size.
 * It measures, it does not assert; the deterministic guard is
 * `compositing.e2e.ts`. Contract:
 * docs/architecture/performance-journeys.md#compositing-budget.
 */
const WINDOW = { height: 1000, width: 1600 };
const LARGEST_LAYERS = 8;
/** The hero backdrop's zoom transition (`transform 8s` in its stylesheet). */
const HERO_ZOOM_MS = 8_000;
const TILE_WARNING = /tile memory limits exceeded/;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setWindowContentSize(app: LaunchedElectronApp): Promise<void> {
    await app.electronApp.evaluate(({ BrowserWindow }, size) => {
        const [window] = BrowserWindow.getAllWindows();
        window.setPosition(0, 0);
        window.setContentSize(size.width, size.height);
    }, WINDOW);
}

async function readGpuCompositing(app: LaunchedElectronApp): Promise<string> {
    const status = await app.electronApp.evaluate(({ app: electronApp }) =>
        electronApp.getGPUFeatureStatus()
    );
    return String(
        (status as unknown as Record<string, unknown>)['gpu_compositing']
    );
}

async function readRoute(
    cdp: CDPSession,
    page: Page,
    route: string
): Promise<CompositingRouteReading> {
    const area = await measureContentArea(page);
    const layers = await collectCompositedLayers(cdp, page);
    const largest = [...layers]
        .filter((layer) => layer.drawsContent)
        .sort((a, b) => layerDevicePixels(b) - layerDevicePixels(a))
        .slice(0, LARGEST_LAYERS);
    const largestLayers = [];
    for (const layer of largest) {
        largestLayers.push({
            devicePixelsMB: Number(
                ((layerDevicePixels(layer) * 4) / 1_048_576).toFixed(1)
            ),
            height: layer.height,
            owner: await describeLayerOwner(cdp, layer),
            reasons: layer.reasons,
            scale: Number(layerScale(layer).x.toFixed(3)),
            width: layer.width,
        });
    }
    const memory = await captureTileMemory(cdp);
    return {
        backdropFilterLayers: layers.filter((layer) =>
            layer.reasons.includes('BackdropFilter')
        ).length,
        clipMasks: findOversizedClipMasks(layers, area).map(describeLayerSize),
        drawingLayers: layers.filter((layer) => layer.drawsContent).length,
        imageMB: memory.imageMB,
        largestLayers,
        route,
        tileMB: memory.tileMB,
        tileResources: memory.resourceCount,
        tileWarnings: 0,
        totalLayers: layers.length,
        url: new URL(page.url()).pathname.replace(/^.*\/dist\/apps\/web/, ''),
    };
}

test.describe.configure({ mode: 'serial' });

test('compositing report', async ({ dataDir, request }) => {
    await resetMockServers(request, ['xtream']);
    const credentials = {
        password: defaultXtreamPassword,
        username: defaultXtreamUsername,
    };
    const live = await fetchXtreamLiveFixture(request, credentials);
    const vod = await fetchXtreamVodFixture(request, credentials);
    const series = await fetchXtreamSeriesFixture(request, credentials);

    const app = await launchElectronApp(dataDir, {
        env: { ELECTRON_ENABLE_LOGGING: '1' },
    });
    const page = app.mainWindow;
    let tileWarnings = 0;
    app.electronApp.process().stderr?.on('data', (chunk: Buffer) => {
        tileWarnings += chunk
            .toString()
            .split('\n')
            .filter((line) => TILE_WARNING.test(line)).length;
    });
    const routes: CompositingRouteReading[] = [];

    try {
        await routeDeterministicArtwork(page);
        // The same motion on every machine: with the OS set to reduced
        // motion the hero neither rotates nor renders its pause button, and
        // the crossfade reading would measure a different animation set.
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await setWindowContentSize(app);
        await sleep(500);
        const cdp = await app.electronApp.context().newCDPSession(page);
        let warningsAtLastReading = 0;
        const measure = async (route: string, settleMs: number) => {
            await sleep(settleMs);
            const reading = await readRoute(cdp, page, route);
            // One boundary for the delta and the checkpoint, taken after the
            // sampling: a warning logged while the layers or the dump were
            // read belongs to this route, not to no route.
            const warningsNow = tileWarnings;
            reading.tileWarnings = warningsNow - warningsAtLastReading;
            warningsAtLastReading = warningsNow;
            routes.push(reading);
            console.log(
                `[compositing] ${route}: tile ${reading.tileMB ?? '-'} MB, ${reading.drawingLayers}/${reading.totalLayers} layers, ${reading.clipMasks.length} masks, ${reading.tileWarnings} warnings`
            );
        };

        await addXtreamPortal(page);
        await waitForXtreamWorkspaceReady(page);
        await openWorkspaceSection(page, 'Live TV');
        await clickCategoryByNameExact(page, live.categoryName);
        await toggleFavoriteForChannel(page, getXtreamTitle(live.items[0]));
        await measure('live-tv', TILE_POOL_SETTLE_MS);

        await page.getByRole('link', { exact: true, name: 'Movies' }).click();
        await clickCategoryByNameExact(page, vod.categoryName);
        await clickFirstGridListCard(page);
        await expect(
            page.locator('app-content-hero .hero__backdrop-image')
        ).toBeVisible({ timeout: 20_000 });
        await measure('movie-detail', TILE_POOL_SETTLE_MS);
        await addCurrentDetailToFavorites(page);
        await goBackFromDetail(page);

        await page.getByRole('link', { exact: true, name: 'Series' }).click();
        await clickCategoryByNameExact(page, series.categoryName);
        await clickFirstGridListCard(page);
        await expect(page.locator('app-content-hero')).toBeVisible({
            timeout: 20_000,
        });
        await measure('series-detail', TILE_POOL_SETTLE_MS);
        await addCurrentDetailToFavorites(page);

        await goToDashboard(page);
        await expect(page.getByTestId('dashboard-hero')).toBeVisible({
            timeout: 20_000,
        });
        await expect
            .poll(() => page.getByTestId('dashboard-hero-dot').count(), {
                timeout: 20_000,
            })
            .toBeGreaterThanOrEqual(2);
        // Idle means no motion: rotation paused (it would advance after 8 s,
        // into another slide's zoom), the current slide's zoom finished and
        // the tile pool settled. The pointer stays off the hero.
        const pause = page.getByTestId('dashboard-hero-pause');
        await pause.click();
        await expect(pause).toHaveAttribute('aria-pressed', 'true');
        await page.mouse.move(1, 1);
        await measure('dashboard', HERO_ZOOM_MS + TILE_POOL_SETTLE_MS);

        const dots = page.getByTestId('dashboard-hero-dot');
        const active = await dots.evaluateAll((all) =>
            all.findIndex((dot) => dot.getAttribute('aria-current') === 'true')
        );
        // Deliberately mid-motion: the outgoing and incoming slides are
        // both composited while the crossfade and the zoom run.
        await dots.nth((active + 1) % (await dots.count())).click();
        await page.mouse.move(1, 1);
        await measure('dashboard-crossfade', 0);

        await page.mouse.move(WINDOW.width / 2, WINDOW.height / 2);
        for (let step = 0; step < 8; step += 1) {
            await page.mouse.wheel(0, 250);
            await sleep(100);
        }
        await page.mouse.move(1, 1);
        await measure('dashboard-scrolled', TILE_POOL_SETTLE_MS);

        await openSettings(page);
        await measure('settings', TILE_POOL_SETTLE_MS);

        const summary: CompositingSummary = {
            generatedAt: new Date().toISOString(),
            harness: {
                arch: process.arch,
                electronVersion: await app.electronApp.evaluate(
                    () => process.versions['electron'] ?? 'unknown'
                ),
                gpuCompositing: await readGpuCompositing(app),
                platform: process.platform,
                window: {
                    ...WINDOW,
                    dpr: await page.evaluate(() => window.devicePixelRatio),
                },
            },
            routes,
            schemaVersion: COMPOSITING_SUMMARY_SCHEMA_VERSION,
        };
        const summaryPath = resolveCompositingSummaryPath(workspaceRoot);
        await writeCompositingSummary(summaryPath, summary);
        console.log(formatCompositingTable(summary));
        console.log(`[compositing] summary: ${summaryPath}`);
        expect(routes.length).toBeGreaterThan(0);
    } finally {
        await closeElectronApp(app);
    }
});
