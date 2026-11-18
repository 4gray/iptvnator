import type { Locator, Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import sharp = require('sharp');
import {
    addXtreamPortal,
    buildM3uContent,
    clickFirstGridListCard,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForM3uCatalog,
    waitForXtreamWorkspaceReady,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    applyTheme,
    expectTextContrast,
    measureBackdropTextContrast,
    themePresets,
} from './theme-contrast';

// ---------------------------------------------------------------------------
// Secondary text that used to fall under 4.5:1: the M3U "no programme"
// placeholder (dimmed with opacity), the Sources row metadata on a hovered
// or current row, and the detail rating chip over a light backdrop (a
// translucent chip let the artwork through). Every preset is measured from
// the rendered page.
// ---------------------------------------------------------------------------

const minimumContrast = 4.5;

/** Moves the pointer away so a hover state does not leak into the next
 * measurement, then onto `target` when one is given. */
async function hover(page: Page, target?: Locator): Promise<void> {
    await page.mouse.move(1, 1);
    if (target) await target.hover();
}

async function whiteArtwork(): Promise<Buffer> {
    return sharp({
        create: {
            width: 1280,
            height: 720,
            channels: 3,
            background: '#ffffff',
        },
    })
        .png()
        .toBuffer();
}

/** Waits until nothing on the page is still animating in, so an entrance
 * fade is not measured as low contrast. */
async function settle(page: Page): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    document
                        .getAnimations()
                        .filter(
                            (animation) =>
                                animation.playState === 'running' &&
                                animation.effect?.getTiming().iterations !==
                                    Infinity
                        ).length
            )
        )
        .toBe(0);
}

/** An XMLTV guide with no programmes: the playlist declares a guide, so
 * rows show the "no programme" placeholder. */
let guide: Server;
let guideUrl: string;
test.beforeAll(async () => {
    guide = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/xml' });
        response.end('<?xml version="1.0"?><tv></tv>');
    });
    await new Promise<void>((resolve) => guide.listen(0, '127.0.0.1', resolve));
    const address = guide.address();
    if (!address || typeof address === 'string')
        throw new Error('Guide fixture port missing');
    guideUrl = `http://127.0.0.1:${address.port}/guide.xml`;
});
test.afterAll(async () => {
    guide.closeAllConnections();
    await new Promise<void>((resolve) => guide.close(() => resolve()));
});

test.describe('Secondary text contrast', () => {
    test('@electron @a11y @theme M3U no-programme placeholder meets 4.5:1 in every preset', async ({
        dataDir,
    }) => {
        const file = join(dataDir, 'synthetic-contrast.m3u');
        writeFileSync(
            file,
            buildM3uContent([
                {
                    name: 'Synthetic Channel One',
                    tvgId: 'synthetic-one',
                    groupTitle: 'Synthetic Group',
                    url: 'http://127.0.0.1:9/one.m3u8',
                },
                {
                    name: 'Synthetic Channel Two',
                    tvgId: 'synthetic-two',
                    groupTitle: 'Synthetic Group',
                    url: 'http://127.0.0.1:9/two.m3u8',
                },
            ]).replace('#EXTM3U', `#EXTM3U x-tvg-url="${guideUrl}"`)
        );
        const app = await launchElectronApp(dataDir, { appArgs: [file] });
        const page = app.mainWindow;
        try {
            await waitForM3uCatalog(page);
            const placeholders = page.locator('.epg-placeholder');
            await expect(placeholders).toHaveCount(2, { timeout: 20_000 });
            const rows = page.locator('button.channel-content');
            for (const preset of themePresets) {
                await applyTheme(page, preset);
                await hover(page);
                await expectTextContrast(placeholders.first(), minimumContrast);
                await hover(page, rows.nth(1));
                await expectTextContrast(placeholders.nth(1), minimumContrast);
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron @a11y @theme Sources row metadata meets 4.5:1 on idle, hovered and current rows', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const file = writeTemporaryM3uFile(dataDir, 'synthetic-sources.m3u', [
            {
                name: 'Synthetic Channel',
                groupTitle: 'Synthetic Group',
                url: 'http://127.0.0.1:9/one.m3u8',
            },
        ]);
        const app = await launchElectronApp(dataDir, { appArgs: [file] });
        const page = app.mainWindow;
        try {
            await waitForM3uCatalog(page);
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await openSources(page);
            const rows = page.locator('.source-row:not(.source-row--compact)');
            await expect(rows).toHaveCount(2, { timeout: 20_000 });
            const current = page.locator('.source-row--current');
            await expect(current).toHaveCount(1);
            const idle = rows.and(
                page.locator('.source-row:not(.source-row--current)')
            );
            const texts = (row: Locator) =>
                row.locator(
                    '.source-row__meta .source-row__part:not(.source-row__part--url)'
                );
            for (const preset of themePresets) {
                await applyTheme(page, preset);
                for (const [state, row] of [
                    ['idle', idle],
                    ['hovered', idle],
                    ['current', current],
                ] as const) {
                    await hover(page, state === 'hovered' ? row : undefined);
                    const parts = texts(row);
                    expect(
                        await parts.count(),
                        `${preset} ${state} row has metadata`
                    ).toBeGreaterThan(0);
                    for (const part of await parts.all()) {
                        await expectTextContrast(part, minimumContrast);
                    }
                }
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron @a11y @theme detail rating chip meets 4.5:1 over a white backdrop in every preset', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            const image = await whiteArtwork();
            await page.route(
                (url) => url.hostname === 'picsum.photos',
                (route) =>
                    route.fulfill({
                        status: 200,
                        contentType: 'image/png',
                        body: image,
                    })
            );
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await openWorkspaceSection(page, 'Movies');
            await clickFirstGridListCard(page);
            const rating = page.locator('app-meta-chip.meta-chip--rating');
            await expect(rating.first()).toBeVisible({ timeout: 20_000 });
            // The white artwork is painted, not still loading over the page
            // background, so a translucent chip would show it through.
            const backdrop = page.locator('.hero__backdrop-image').first();
            await expect
                .poll(() =>
                    backdrop.evaluate(async (image: HTMLImageElement) => {
                        if (!image.complete || !image.naturalWidth)
                            return false;
                        await image.decode();
                        return true;
                    })
                )
                .toBe(true);
            await hover(page);
            await settle(page);
            const results: string[] = [];
            for (const preset of themePresets) {
                await applyTheme(page, preset);
                const ratio = await measureBackdropTextContrast(
                    page,
                    rating.first()
                );
                results.push(`${preset} ${ratio.toFixed(2)}`);
                expect(ratio, `${preset} rating chip`).toBeGreaterThanOrEqual(
                    minimumContrast
                );
            }
            test.info().annotations.push({
                type: 'contrast',
                description: results.join(', '),
            });
        } finally {
            await closeElectronApp(app);
        }
    });
});
