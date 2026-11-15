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

/**
 * Blocks the network, then serves the M3U channels a real clip: a failed
 * stream replaces the control bar with the error panel, and the bar is what
 * the width checks measure.
 */
async function routeM3uStreams(page: Page): Promise<void> {
    await page.route('https://**', (route) => route.abort());
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
 * The header search keeps its scope chip readable, and the command trigger
 * (the shortcut hint) stays clear of the keyboard-shortcuts button.
 */
async function expectHeaderSearchFits(page: Page): Promise<void> {
    const layout = await page.evaluate(() => {
        const header = document.querySelector('app-workspace-shell-header');
        const box = (selector: string) => {
            const element = header?.querySelector<HTMLElement>(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width };
        };
        return {
            scopeLabel: box('.search-chip--scope .search-chip__label'),
            field: box('.search-field'),
            trigger: box('.command-trigger'),
            shortcuts: box('.shortcuts-trigger'),
        };
    });
    // A long scope may still ellipsize at the chip's own cap; before the fix
    // the input's intrinsic width squeezed it to a single letter ("L…").
    expect(layout.scopeLabel?.width ?? 0).toBeGreaterThanOrEqual(64);
    expect(layout.field?.right ?? 0).toBeLessThanOrEqual(
        (layout.shortcuts?.left ?? 0) + 1
    );
    expect(layout.trigger?.right ?? 0).toBeLessThanOrEqual(
        (layout.field?.right ?? 0) + 1
    );
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
        const app = await launchElectronApp(dataDir);
        try {
            await app.mainWindow.route('https://**', (route) => route.abort());
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
            await channelItemByTitle(app.mainWindow, fixture.items[0].name)
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
            await app.mainWindow.route('https://**', (route) => route.abort());
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
            await routeM3uStreams(app.mainWindow);
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
            await routeM3uStreams(app.mainWindow);
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);
            // The widest rail the Groups view lets a user save.
            await app.mainWindow.evaluate(() =>
                localStorage.setItem('m3u-groups-nav-width', '320')
            );
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
            // Resizing the window never rewrote the saved rail width.
            expect(
                await app.mainWindow.evaluate(() =>
                    localStorage.getItem('m3u-groups-nav-width')
                )
            ).toBe('320');
        } finally {
            await closeElectronApp(app);
        }
    });
});
