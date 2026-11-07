import { createServer, type Server } from 'node:http';
import { navigationPortalResponse } from '@iptvnator/shared/testing';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openGlobalFavorites,
    switchUnifiedCollectionContent,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { applyTheme } from './theme-contrast';

let server: Server;
let serverUrl: string;

test.beforeAll(async () => {
    server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://synthetic.invalid');
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify(navigationPortalResponse(url.searchParams))
        );
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Fixture port missing');
    serverUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const type of ['movie', 'series'] as const) {
    test(`@electron @xtream ${type} More menu stays pointer-accessible at viewport edges`, async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await addXtreamPortal(page, {
                serverUrl,
                name: 'Synthetic Menu Source',
                username: 'synthetic-a',
                password: 'synthetic-only',
            });
            await waitForXtreamWorkspaceReady(page);
            const playlistId = /xtreams\/([^/]+)/.exec(page.url())?.[1];
            if (!playlistId) throw new Error('Synthetic source missing');
            await page.evaluate(async (playlistId) => {
                for (const kind of ['movie', 'series'] as const) {
                    const [item] = await window.electron.dbGetContent(
                        playlistId,
                        kind
                    );
                    await window.electron.dbAddFavorite(item.id, playlistId);
                }
            }, playlistId);
            if (type === 'series') {
                await page.evaluate(
                    (id) =>
                        window.electron.dbSavePlaybackPosition(id, {
                            contentXtreamId: 50001,
                            contentType: 'episode',
                            seriesXtreamId: 30001,
                            seasonNumber: 1,
                            episodeNumber: 1,
                            positionSeconds: 60,
                            durationSeconds: 1500,
                        }),
                    playlistId
                );
            }
            await openGlobalFavorites(page);
            await switchUnifiedCollectionContent(
                page,
                type === 'movie' ? 'Movies' : 'Series'
            );
            await page.locator('app-content-card').first().click();
            await expect(
                page.locator('app-portal-detail-shell h1')
            ).toBeVisible();
            await page.setViewportSize({ width: 640, height: 400 });
            const trigger = page.locator(
                `[data-testid="${type === 'movie' ? 'vod' : 'series'}-more-menu"]`
            );
            const panel = page.getByTestId('vod-more-menu');
            const portal = page.getByRole('menuitem', {
                name: 'Open in Synthetic Menu Source',
                exact: true,
            });
            if (type === 'series') {
                const hide = page.getByRole('menuitem', {
                    name: 'Hide from Continue Watching',
                    exact: true,
                });
                await trigger.click();
                await expect(hide).toHaveCount(0);
                const rowId = await page.evaluate(async (id) => {
                    const [row] = await window.electron.dbGetContent(
                        id,
                        'series'
                    );
                    await window.electron.dbAddRecentItem(row.id, id);
                    window.dispatchEvent(
                        new Event('iptvnator-history-changed')
                    );
                    return row.id;
                }, playlistId);
                await expect(hide).toBeVisible();
                await page.evaluate(
                    async ({ id, rowId }) => {
                        await window.electron.dbRemoveRecentItem(rowId, id);
                        window.dispatchEvent(
                            new Event('iptvnator-history-changed')
                        );
                    },
                    { id: playlistId, rowId }
                );
                await expect(hide).toHaveCount(0);
                await page.keyboard.press('Escape');
            }
            // Keep the real component and overlay, but isolate their geometry from hero layout.
            for (const position of [
                { top: 200, left: 400 },
                { top: 124, left: 12 },
                { top: 344, left: 584 },
                null,
            ]) {
                await trigger.locator('..').evaluate((host, position) => {
                    const style = (host as HTMLElement).style;
                    if (!position) {
                        style.cssText = '';
                        return;
                    }
                    Object.assign(style, {
                        position: 'fixed',
                        zIndex: '1',
                        top: '0',
                        left: '0',
                    });
                    // Size containers establish a containing block for fixed descendants.
                    const origin = host.getBoundingClientRect();
                    style.top = `${position.top - origin.top}px`;
                    style.left = `${position.left - origin.left}px`;
                }, position);
                if (!position) {
                    const scroller = page.locator('app-portal-detail-shell');
                    await scroller.evaluate((element) => {
                        element.scrollTop = element.scrollHeight;
                    });
                    if (type === 'series') {
                        await expect
                            .poll(() =>
                                scroller.evaluate(
                                    (element) => element.scrollTop
                                )
                            )
                            .toBeGreaterThan(0);
                    }
                }
                await trigger.scrollIntoViewIfNeeded();
                await trigger.click();
                await expect(portal).toBeFocused();
                for (const theme of ['light', 'dark'] as const) {
                    await applyTheme(page, theme);
                    await expect(panel).toBeVisible();
                    const bounds = await panel.evaluate((element) => {
                        const rect = element.getBoundingClientRect();
                        return {
                            top: rect.top,
                            left: rect.left,
                            right: rect.right,
                            bottom: rect.bottom,
                            width: innerWidth,
                            height: innerHeight,
                        };
                    });
                    expect(bounds.top).toBeGreaterThanOrEqual(12);
                    expect(bounds.left).toBeGreaterThanOrEqual(12);
                    expect(bounds.right).toBeLessThanOrEqual(bounds.width - 12);
                    expect(bounds.bottom).toBeLessThanOrEqual(
                        bounds.height - 12
                    );
                    await portal.click({ trial: true });
                    if (position?.top === 200) {
                        await test.info().attach(`more-menu-${type}-${theme}`, {
                            body: await page.screenshot(),
                            contentType: 'image/png',
                        });
                    }
                }
                await page.keyboard.press('End');
                const last = panel
                    .locator('[role="menuitem"]:not([disabled])')
                    .last();
                await expect(last).toBeFocused();
                await expect(last).toBeInViewport({ ratio: 1 });
                await page.keyboard.press('Home');
                await expect(portal).toBeFocused();
                await expect(portal).toBeInViewport({ ratio: 1 });
                await page.keyboard.press('ArrowDown');
                await expect(
                    panel.locator('[role="menuitem"]:not([disabled])').nth(1)
                ).toBeFocused();
                await page.keyboard.press('ArrowUp');
                await expect(portal).toBeFocused();
                await page.keyboard.press('Escape');
                await expect(panel).toHaveCount(0);
                await expect(trigger).toBeFocused();
                await trigger.click();
                await portal.click();
                await expect(page).toHaveURL(
                    type === 'movie'
                        ? /\/vod\/[^/]+\/[^/]+$/
                        : /\/series\/[^/]+\/[^/]+$/
                );
                await page.getByTestId('workspace-header-back').click();
                await expect(page).toHaveURL(/\/workspace\/global-favorites$/);
                await expect(trigger).toBeVisible();
            }
        } finally {
            await closeElectronApp(app);
        }
    });
}
