import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForM3uCatalog,
    waitForStalkerCatalog,
    waitForXtreamWorkspaceReady,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';
import {
    fetchStalkerCategoryFixture,
    fetchXtreamLiveFixture,
} from './portal-mock-fixtures';

/**
 * UI-67: at the desktop window's minimum width (900 px, `minWidth` in
 * `apps/electron-backend/src/app/app.ts`) the live view used to give the
 * player about 117 px — the 300 px categories rail and the 400 px channel
 * list took the rest, and the controls dock ran past the right edge. Below
 * the compact breakpoint the categories rail folds into the channel header's
 * dropdown and the channel list narrows, so the player keeps a usable share.
 *
 * Measured at 900 px on purpose: below that the window cannot go, and an
 * emulated narrower viewport measures a layout no desktop user sees.
 */

const WIDTH = 900;
const HEIGHT = 700;
/** The player's minimum share of the window width. */
const MIN_PLAYER_SHARE = 0.45;

const M3U_CHANNELS = [
    {
        groupTitle: 'News',
        name: 'Compact Alpha',
        url: 'https://streams.example.test/compact-alpha.webm',
    },
    {
        groupTitle: 'Sports',
        name: 'Compact Beta',
        url: 'https://streams.example.test/compact-beta.webm',
    },
];

const M3U_STREAM_MEDIA = readFileSync(
    join(__dirname, '../../web-e2e/src/fixtures/playback/episode.webm')
);
const MPEG_TS_CLIP = readFileSync(
    join(__dirname, '../../xtream-mock-server/src/fixtures/live.mpegts')
);
const CLIP_URL = 'https://media.example.test/compact-clip.ts';
const CLIP_PLAYLIST = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXTINF:10.0,',
    CLIP_URL,
    '#EXT-X-ENDLIST',
].join('\n');

/**
 * Blocks the network and serves every player a real clip: a failed stream
 * replaces the control bar with the error panel, and the bar is what the
 * width checks measure. The mocks' own live links point at public HLS
 * (Stalker) or a zero-filled download (Xtream), so HLS manifests get a
 * one-segment playlist of the Xtream mock's MPEG-TS clip, `.ts` URLs the
 * clip itself, and the M3U fixture's `.webm` channels a WebM clip.
 */
async function routePlayableStreams(page: Page): Promise<void> {
    await page.route('https://**', (route) => route.abort());
    await page.route(
        (url) => /\.m3u8$/.test(url.pathname),
        (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/vnd.apple.mpegurl',
                body: CLIP_PLAYLIST,
            })
    );
    await page.route(
        (url) => /\.ts$/.test(url.pathname),
        (route) =>
            route.fulfill({
                status: 200,
                contentType: 'video/mp2t',
                body: MPEG_TS_CLIP,
            })
    );
    await page.route('https://streams.example.test/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'video/webm',
            body: M3U_STREAM_MEDIA,
        })
    );
}

async function resizeWindow(
    app: Awaited<ReturnType<typeof launchElectronApp>>,
    width: number,
    height: number
): Promise<void> {
    await app.electronApp.evaluate(
        ({ BrowserWindow }, size) => {
            const window = BrowserWindow.getAllWindows()[0];
            window.setContentSize(size.width, size.height);
        },
        { width, height }
    );
    await expect
        .poll(() => app.mainWindow.evaluate(() => window.innerWidth))
        .toBe(width);
}

/** The player's box against the window, once the layout has settled. */
async function expectUsablePlayer(page: Page): Promise<void> {
    const player = page.locator('app-web-player-view').first();
    await expect(player).toBeVisible({ timeout: 20000 });
    // The rails animate their width (180 ms); poll until the box settles.
    await expect
        .poll(
            async () => {
                const box = await player.boundingBox();
                return box ? Math.round(box.width) : 0;
            },
            { timeout: 10000 }
        )
        .toBeGreaterThanOrEqual(Math.round(WIDTH * MIN_PLAYER_SHARE));
    const box = await player.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(WIDTH + 1);

    // The served clip decodes, so no playback error hides the control bar.
    await expect
        .poll(
            () =>
                player
                    .locator('video')
                    .first()
                    .evaluate(
                        (video: HTMLVideoElement) =>
                            video.readyState >=
                            HTMLMediaElement.HAVE_CURRENT_DATA
                    ),
            { timeout: 15000 }
        )
        .toBe(true);
    // Overflowing controls do not widen the player's own box, so the
    // control bar's buttons are measured one by one against it.
    await player.hover();
    const bar = player.locator('app-player-controls .player-controls__bar');
    await expect(bar).toBeVisible();
    const buttons = await bar
        .locator('button:visible')
        .evaluateAll((elements) =>
            elements.map((element) => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right };
            })
        );
    expect(buttons.length).toBeGreaterThan(0);
    const left = box?.x ?? 0;
    const right = Math.min(left + (box?.width ?? 0), WIDTH);
    for (const button of buttons) {
        expect(button.left).toBeGreaterThanOrEqual(left - 1);
        expect(button.right).toBeLessThanOrEqual(right + 1);
    }
}

/**
 * The header search keeps its scope chip readable, the command trigger (the
 * shortcut hint) stays inside the field, and the field stays clear of the
 * header's actions.
 */
async function expectHeaderSearchFits(page: Page): Promise<void> {
    // Windows and Linux give the window controls 196px of the header; apply
    // that padding on every platform so macOS runs check the tightest case.
    // Actions that no longer fit move into "More actions", so whatever stays
    // inline must fit beside the search.
    await page.evaluate(() =>
        document.body.classList.add('frameless-platform')
    );
    await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
        const header = document.querySelector('app-workspace-shell-header');
        const box = (selector: string) => {
            const element = header?.querySelector<HTMLElement>(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width };
        };
        const cluster = header?.querySelector('.header-actions-cluster');
        return {
            scopeLabel: box('.search-chip--scope .search-chip__label'),
            field: box('.search-field'),
            input: box('.search-field input'),
            trigger: box('.command-trigger'),
            actions: box('.header-actions-cluster'),
            actionButtons: Array.from(
                cluster?.querySelectorAll<HTMLElement>('button') ?? []
            ).map((button) => {
                const rect = button.getBoundingClientRect();
                return { left: rect.left, right: rect.right };
            }),
            headerContentRight: (() => {
                const element =
                    header?.querySelector<HTMLElement>('.workspace-header');
                if (!element) return 0;
                const rect = element.getBoundingClientRect();
                const padding = parseFloat(
                    getComputedStyle(element).paddingRight
                );
                return rect.right - padding;
            })(),
        };
    });
    // The scope chip and the input share the field: a long scope ellipsizes,
    // but neither squeezes the other out. Before the fixes the input's
    // intrinsic width cut the chip to "L…", and then a long chip left the
    // input only its padding.
    expect(layout.scopeLabel?.width ?? 0).toBeGreaterThanOrEqual(28);
    expect(layout.input?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(layout.actions).not.toBeNull();
    expect(layout.actionButtons.length).toBeGreaterThan(0);
    expect(layout.field?.right ?? Infinity).toBeLessThanOrEqual(
        (layout.actions?.left ?? 0) + 1
    );
    expect(layout.trigger?.right ?? Infinity).toBeLessThanOrEqual(
        (layout.field?.right ?? 0) + 1
    );
    // Every inline action stays clear of the space kept for the window
    // controls.
    for (const button of layout.actionButtons) {
        expect(button.left).toBeGreaterThanOrEqual(
            (layout.actions?.left ?? 0) - 1
        );
        expect(button.right).toBeLessThanOrEqual(layout.headerContentRight + 1);
    }
}

/** The categories rail folded away; the channel header offers it back. */
async function expectCategoriesFolded(page: Page): Promise<void> {
    const rail = page.locator(
        'app-workspace-shell-context-sidebar .context-panel--route'
    );
    await expect(rail).toHaveClass(/context-panel--collapsed/);
    await expect
        .poll(async () => (await rail.boundingBox())?.width ?? -1)
        .toBeLessThanOrEqual(1);
    await expect(
        page.locator('[data-test-id="live-category-dropdown"]').first()
    ).toBeVisible();
}

test.describe('Live layout at the minimum window width (UI-67)', () => {
    test('@electron @xtream the Xtream player keeps its share at 900 px', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const credentials = { username: 'marketing', password: 'marketing' };
        const fixture = await fetchXtreamLiveFixture(request, credentials);
        const channelName = fixture.items[0]?.name;
        if (!channelName) {
            throw new Error('Xtream fixture returned no named first channel.');
        }
        const app = await launchElectronApp(dataDir);
        try {
            await routePlayableStreams(app.mainWindow);
            await addXtreamPortal(app.mainWindow, {
                name: 'Compact Xtream',
                ...credentials,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(
                app.mainWindow,
                fixture.categoryName
            );
            await channelItemByTitle(app.mainWindow, channelName)
                .first()
                .click();

            await resizeWindow(app, WIDTH, HEIGHT);
            await expectCategoriesFolded(app.mainWindow);
            await expectUsablePlayer(app.mainWindow);
            await expectHeaderSearchFits(app.mainWindow);

            // Back above the breakpoint the stored level returns: the rail
            // was never hidden by the user, so it unfolds again.
            await resizeWindow(app, 1400, 900);
            const rail = app.mainWindow.locator(
                'app-workspace-shell-context-sidebar .context-panel--route'
            );
            await expect(rail).not.toHaveClass(/context-panel--collapsed/);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron @stalker the Stalker player keeps its share at 900 px', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const fixture = await fetchStalkerCategoryFixture(request, 'itv');
        const item = fixture.items[0];
        const app = await launchElectronApp(dataDir);
        try {
            await routePlayableStreams(app.mainWindow);
            await addStalkerPortal(app.mainWindow, { name: 'Compact Stalker' });
            await waitForStalkerCatalog(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(
                app.mainWindow,
                fixture.categoryName
            );
            await channelItemByTitle(
                app.mainWindow,
                item.o_name || item.name || ''
            )
                .first()
                .click();

            await resizeWindow(app, WIDTH, HEIGHT);
            await expectCategoriesFolded(app.mainWindow);
            await expectUsablePlayer(app.mainWindow);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron @m3u the M3U player keeps its share at 900 px', async ({
        dataDir,
    }) => {
        const filePath = writeTemporaryM3uFile(
            dataDir,
            'compact-width.m3u',
            M3U_CHANNELS
        );
        const app = await launchElectronApp(dataDir);
        try {
            await routePlayableStreams(app.mainWindow);
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);
            await channelItemByTitle(app.mainWindow, 'Compact Alpha')
                .first()
                .click();

            await resizeWindow(app, WIDTH, HEIGHT);
            await expectUsablePlayer(app.mainWindow);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron @m3u a saved wide Groups rail leaves the M3U channel pane usable at 900 px', async ({
        dataDir,
    }) => {
        const filePath = writeTemporaryM3uFile(
            dataDir,
            'compact-width-groups.m3u',
            M3U_CHANNELS
        );
        const app = await launchElectronApp(dataDir);
        try {
            await routePlayableStreams(app.mainWindow);
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);
            // The widest rail the Groups view lets a user save.
            await app.mainWindow.evaluate(() => {
                localStorage.setItem('m3u-groups-nav-width', '320');
                localStorage.setItem('m3u-groups-sidebar-width', '600');
            });
            await openWorkspaceSection(app.mainWindow, 'Groups');
            await app.mainWindow
                .locator('app-groups-view .group-nav-item', {
                    hasText: 'News',
                })
                .first()
                .click();
            await channelItemByTitle(app.mainWindow, 'Compact Alpha')
                .first()
                .click();

            await resizeWindow(app, WIDTH, HEIGHT);
            const pane = app.mainWindow.locator(
                'app-groups-view .groups-content-panel'
            );
            // About 150 px: the rail's 164 px minimum wins over the 160 px
            // the cap reserves; before the cap the pane got 0 px.
            await expect
                .poll(async () => (await pane.boundingBox())?.width ?? 0)
                .toBeGreaterThanOrEqual(140);
            const title = channelItemByTitle(
                app.mainWindow,
                'Compact Alpha'
            ).first();
            await expect(title).toBeVisible();
            expect((await title.boundingBox())?.width ?? 0).toBeGreaterThan(60);
            await expectUsablePlayer(app.mainWindow);

            // A click on the capped rail's handle is not a resize: neither
            // the rail's nor the sidebar's saved width changes.
            const handle = app.mainWindow.locator(
                'app-groups-view .groups-nav-panel > .resize-handle'
            );
            const handleBox = await handle.boundingBox();
            expect(handleBox).not.toBeNull();
            await app.mainWindow.mouse.click(
                (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
                (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2
            );
            expect(
                await app.mainWindow.evaluate(() => [
                    localStorage.getItem('m3u-groups-nav-width'),
                    localStorage.getItem('m3u-groups-sidebar-width'),
                ])
            ).toEqual(['320', '600']);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron @m3u a quick Groups rail drag saves the width it settles at, not a frame of the sidebar animation', async ({
        dataDir,
    }) => {
        const filePath = writeTemporaryM3uFile(
            dataDir,
            'quick-groups-drag.m3u',
            M3U_CHANNELS
        );
        const app = await launchElectronApp(dataDir);
        try {
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);
            await app.mainWindow.evaluate(() => {
                localStorage.setItem('m3u-groups-nav-width', '208');
                localStorage.setItem('m3u-groups-sidebar-width', '400');
            });
            await openWorkspaceSection(app.mainWindow, 'Groups');
            const rail = app.mainWindow.locator(
                'app-groups-view .groups-nav-panel'
            );
            await expect
                .poll(async () =>
                    Math.round((await rail.boundingBox())?.width ?? 0)
                )
                .toBe(208);
            const handle = rail.locator('> .resize-handle');
            const box = await handle.boundingBox();
            expect(box).not.toBeNull();
            // The handle straddles the rail's edge and the channel pane covers
            // its outer half, so the drag starts on the half inside the rail.
            const x = (box?.x ?? 0) + 3;
            const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;

            // Released within the outer sidebar's 150 ms width transition:
            // the rail's cap follows the still-narrow sidebar mid-animation.
            const mouse = app.mainWindow.mouse;
            await mouse.move(x, y);
            await mouse.down();
            await mouse.move(x + 80, y, { steps: 8 });
            await mouse.up();

            await expect
                .poll(async () =>
                    Math.round((await rail.boundingBox())?.width ?? 0)
                )
                .toBe(288);
            expect(
                await app.mainWindow.evaluate(() =>
                    localStorage.getItem('m3u-groups-nav-width')
                )
            ).toBe('288');
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron @m3u an outward drag on a capped Groups rail never leaves it narrower', async ({
        dataDir,
    }) => {
        const filePath = writeTemporaryM3uFile(
            dataDir,
            'capped-groups-drag.m3u',
            M3U_CHANNELS
        );
        const app = await launchElectronApp(dataDir);
        try {
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);
            // The sidebar's cap (100% - 160px) holds the 280px rail narrower.
            await app.mainWindow.evaluate(() => {
                localStorage.setItem('m3u-groups-nav-width', '280');
                localStorage.setItem('m3u-groups-sidebar-width', '400');
            });
            await openWorkspaceSection(app.mainWindow, 'Groups');
            const rail = app.mainWindow.locator(
                'app-groups-view .groups-nav-panel'
            );
            const railWidth = async () =>
                Math.round((await rail.boundingBox())?.width ?? 0);
            // The rail animates down to its cap; measure it, and the handle,
            // only once two reads 250ms apart agree.
            let previous = -1;
            await expect
                .poll(async () => {
                    const width = await railWidth();
                    await app.mainWindow.waitForTimeout(250);
                    const now = await railWidth();
                    previous = now;
                    return width === now && now < 280;
                })
                .toBe(true);
            const initial = previous;
            const box = await rail.locator('> .resize-handle').boundingBox();
            expect(box).not.toBeNull();
            const x = (box?.x ?? 0) + 3;
            const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;

            const mouse = app.mainWindow.mouse;
            await mouse.move(x, y);
            await mouse.down();
            await mouse.move(x + 10, y, { steps: 4 });
            await app.mainWindow.waitForTimeout(300);
            await mouse.up();

            // The rail ends where the pointer left it (Playwright rounds the
            // pointer, so the edge moves about 8px), keeps that width once
            // the sidebar settles, and saves the width it shows. Before the
            // fix the commit took the sidebar's 9px of padding and border
            // from the capped rail, leaving it narrower than at the start.
            await expect.poll(railWidth).toBeGreaterThan(initial + 5);
            await app.mainWindow.waitForTimeout(300);
            const settled = (await rail.boundingBox())?.width ?? 0;
            expect(settled).toBeGreaterThan(initial + 5);
            const saved = Number(
                await app.mainWindow.evaluate(() =>
                    localStorage.getItem('m3u-groups-nav-width')
                )
            );
            expect(Math.abs(saved - settled)).toBeLessThanOrEqual(1);
        } finally {
            await closeElectronApp(app);
        }
    });
});
