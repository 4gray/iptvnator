import { createServer } from 'node:http';
import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    sourceRowByTitle,
    test,
    waitForXtreamCatalog,
    xtreamMockServer,
} from './electron-test-fixtures';
import { applyTheme, expectTextContrast } from './theme-contrast';

async function applySettledTheme(page: Page, theme: 'light' | 'dark') {
    await applyTheme(page, theme);
    // Contrast assertions can pass before the header's 150 ms theme
    // transition ends. Capture the settled theme, not an intermediate gray.
    await page.evaluate(async () => {
        await Promise.all(
            document
                .getAnimations()
                .filter((animation) => animation instanceof CSSTransition)
                .map((animation) => animation.finished.catch(() => undefined))
        );
    });
    await expect(
        page.getByRole('searchbox', { name: 'Search', exact: true })
    ).toBeEnabled();
    const searchColors = await page
        .locator('.search-field')
        .evaluate((field) => {
            const probe = document.createElement('div');
            probe.style.backgroundColor = 'var(--app-search-bg)';
            field.appendChild(probe);
            const expected = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return {
                expected,
                actual: getComputedStyle(field).backgroundColor,
            };
        });
    expect(searchColors.actual).toBe(searchColors.expected);
}

test('keeps cached portal statuses and scroll ownership consistent across all portal screens', async ({
    dataDir,
    request,
}, testInfo) => {
    test.setTimeout(180000);
    await resetMockServers(request, ['xtream']);
    let status: 'active' | 'unavailable' | 'expired' | 'inactive' = 'active';
    let catalogRequests = 0;
    let pendingCheck: Promise<void> | null = null;
    const server = createServer(async (incoming, response) => {
        try {
            const url = new URL(incoming.url ?? '/', xtreamMockServer);
            const action = url.searchParams.get('action');
            const account =
                !action || ['get_account_info', 'get_profile'].includes(action);
            if (account) {
                await pendingCheck;
                if (status === 'unavailable') {
                    response.writeHead(503).end('{}');
                    return;
                }
            } else {
                catalogRequests++;
            }
            // Incoming URLs supply query parameters only. Neither an absolute
            // URL nor a different path may choose the proxy's upstream target.
            const upstream = await request.get(
                `${xtreamMockServer}/player_api.php`,
                {
                    params: Object.fromEntries(url.searchParams),
                }
            );
            const payload = (await upstream.json()) as {
                user_info?: { status: string; exp_date: string; auth: number };
            };
            if (account && payload.user_info) {
                payload.user_info.status =
                    status === 'inactive' ? 'Disabled' : 'Active';
                payload.user_info.exp_date =
                    status === 'expired' ? '1' : '4102444800';
                payload.user_info.auth = 1;
            }
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(payload));
        } catch {
            response.writeHead(502).end('{}');
        }
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('No mock address');
    let app = await launchElectronApp(dataDir);
    try {
        let page = app.mainWindow;
        await addXtreamPortal(page, {
            name: 'Cached status portal',
            serverUrl: `http://127.0.0.1:${address.port}`,
        });
        await waitForXtreamCatalog(page);
        status = 'unavailable';
        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await openSources(page);
        await sourceRowByTitle(page, 'Cached status portal').first().click();
        await waitForXtreamCatalog(page);
        const strip = page.getByTestId('xtream-offline-warning');
        await expect(strip).toHaveAttribute('data-status', 'unavailable');
        await expect(strip).toContainText('Showing your saved catalog');

        for (const section of [
            'Movies',
            'Series',
            'Live TV',
            'Recently added',
        ]) {
            await openWorkspaceSection(page, section);
            await expect(strip).toBeVisible();
            await expect(
                page.getByRole('searchbox', { name: 'Search', exact: true })
            ).toBeEnabled();
            const pane = page.locator(
                'app-xtream-content-gate .xtream-route-content'
            );
            await expect(pane).toBeVisible();
            await expect
                .poll(() => pane.evaluate((el) => el.clientHeight))
                .toBeGreaterThan(100);
            for (const selector of [
                'main.workspace-content',
                'app-xtream-content-gate',
                '.xtream-route-content',
            ]) {
                await expect
                    .poll(
                        () =>
                            page
                                .locator(selector)
                                .first()
                                .evaluate(
                                    (el) => el.scrollHeight - el.clientHeight
                                ),
                        {
                            message: `${section}: ${selector} must not add an outer scroller`,
                        }
                    )
                    .toBeLessThanOrEqual(1);
            }
            const header = pane.locator('.category-content-header').first();
            if (await header.isVisible()) {
                const bannerBox = (await strip.boundingBox())!;
                const headerBox = (await header.boundingBox())!;
                expect(
                    Math.abs(headerBox.y - bannerBox.y - bannerBox.height)
                ).toBeLessThanOrEqual(1);
            }
            // Exercise a real route-owned vertical scroller and prove the
            // status stays in place while its content moves.
            const scroller = pane.locator('*').filter({ visible: true });
            const scrollableIndex = await scroller.evaluateAll((elements) =>
                elements.findIndex(
                    (el) =>
                        ['auto', 'scroll'].includes(
                            getComputedStyle(el).overflowY
                        ) && el.scrollHeight > el.clientHeight + 10
                )
            );
            expect(
                scrollableIndex,
                `${section}: expected a scrollable content pane`
            ).toBeGreaterThanOrEqual(0);
            const content = scroller.nth(scrollableIndex);
            const before = (await strip.boundingBox())!.y;
            await content.hover();
            await page.mouse.wheel(0, 400);
            await expect
                .poll(() => content.evaluate((el) => el.scrollTop))
                .toBeGreaterThan(0);
            expect((await strip.boundingBox())!.y).toBe(before);
            await page.screenshot({
                path: testInfo.outputPath(
                    `status-${section.replaceAll(' ', '-').toLowerCase()}.png`
                ),
            });
        }

        await openWorkspaceSection(page, 'Movies');
        await page.setViewportSize({ width: 360, height: 740 });
        await expect(strip).toBeVisible();
        await expect
            .poll(() =>
                page
                    .locator('main.workspace-content')
                    .evaluate((el) =>
                        Math.max(
                            el.scrollHeight - el.clientHeight,
                            el.scrollWidth - el.clientWidth
                        )
                    )
            )
            .toBeLessThanOrEqual(1);
        const narrowStrip = (await strip.boundingBox())!;
        const narrowButton = (await strip.getByRole('button').boundingBox())!;
        expect(narrowButton.x + narrowButton.width).toBeLessThanOrEqual(
            narrowStrip.x + narrowStrip.width
        );
        await page.screenshot({
            path: testInfo.outputPath('status-narrow.png'),
        });
        await page.setViewportSize({ width: 1280, height: 720 });
        const requestsBeforeChecks = catalogRequests;
        for (const next of ['expired', 'inactive', 'unavailable'] as const) {
            status = next;
            await strip
                .getByRole('button', { name: 'Check again', exact: true })
                .click();
            await expect(strip).toHaveAttribute('data-status', next);
            await expect(strip.getByRole('button')).toBeEnabled();
            for (const theme of ['light', 'dark'] as const) {
                await applySettledTheme(page, theme);
                await expectTextContrast(strip.locator('strong'));
                await expectTextContrast(
                    strip.locator('.xtream-cached-offline-notice__copy > span')
                );
                await expectTextContrast(strip.getByRole('button'));
                const expectedToken =
                    next === 'unavailable'
                        ? '--app-expiry-warn-text'
                        : '--app-danger-text';
                const colors = await strip.evaluate((el, token) => {
                    const probe = document.createElement('span');
                    probe.style.color = `var(${token})`;
                    el.appendChild(probe);
                    const expected = getComputedStyle(probe).color;
                    probe.remove();
                    return { expected, actual: getComputedStyle(el).color };
                }, expectedToken);
                expect(colors.actual).toBe(colors.expected);
                await page.screenshot({
                    path: testInfo.outputPath(`status-${next}-${theme}.png`),
                });
            }
        }

        let finishCheck!: () => void;
        const grid = page.locator('app-category-content-view app-grid-list');
        const cards = grid.locator('mat-card[role="button"]');
        const firstTitle = await cards.first().getAttribute('aria-label');
        // Recovery must preserve a real nonzero offset; a grid reset to the
        // top must not accidentally pass because the snapshot was already 0.
        await grid.evaluate((el) => {
            el.scrollTop = 400;
        });
        await expect
            .poll(() => grid.evaluate((el) => el.scrollTop))
            .toBeGreaterThan(100);
        const scrollBeforeRecovery = await grid.evaluate((el) => el.scrollTop);
        pendingCheck = new Promise<void>((resolve) => {
            finishCheck = resolve;
        });
        await strip
            .getByRole('button', { name: 'Check again', exact: true })
            .click();
        await expect(strip).toHaveAttribute('data-status', 'checking');
        await expect(strip.getByRole('button')).toBeDisabled();
        await expect(strip).toHaveAttribute('aria-busy', 'true');
        for (const theme of ['light', 'dark'] as const) {
            await applySettledTheme(page, theme);
            await expectTextContrast(strip.locator('strong'));
            await page.screenshot({
                path: testInfo.outputPath(`status-checking-${theme}.png`),
            });
        }
        status = 'active';
        finishCheck();
        pendingCheck = null;
        await expect(strip).toHaveCount(0);
        await expect(cards.first()).toHaveAttribute(
            'aria-label',
            firstTitle ?? ''
        );
        expect(await grid.evaluate((el) => el.scrollTop)).toBe(
            scrollBeforeRecovery
        );
        expect(catalogRequests).toBe(requestsBeforeChecks);
        await expect(page.locator('.workspace-loading-overlay')).toHaveCount(0);
        await expect
            .poll(() =>
                page
                    .locator('main.workspace-content')
                    .evaluate((el) => el.scrollHeight - el.clientHeight)
            )
            .toBeLessThanOrEqual(1);
    } finally {
        await closeElectronApp(app);
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
});
