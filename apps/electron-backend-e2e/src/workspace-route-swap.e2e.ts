import { Page } from '@playwright/test';
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

/**
 * Leaving a portal section for the dashboard must replace the routed page
 * in one task. With the @angular/animations renderer the router inserted the
 * dashboard at once but the old page (and the context panel) left only at
 * the end of the next, rAF-coalesced change detection: in between Chromium
 * laid out the dashboard below the portal page, at y=720 in a 720 px window,
 * and scored its jump into view as a layout shift of 0.337 at 1280 px.
 */

type RouteSwapProbe = {
    overlaps: string[][];
    shiftSources: string[];
};

declare global {
    interface Window {
        __routeSwapProbe?: RouteSwapProbe;
    }
}

/** Sources whose shift the old page's late removal caused. */
const SWAP_SHIFT_SOURCES = [
    'lib-workspace-dashboard-rails',
    'main.workspace-content',
];

async function armRouteSwapProbe(page: Page): Promise<void> {
    await page.evaluate(() => {
        const content = document.querySelector('main.workspace-content');
        if (!content) {
            throw new Error('workspace content pane is missing');
        }
        const probe: RouteSwapProbe = { overlaps: [], shiftSources: [] };
        window.__routeSwapProbe = probe;
        // Mutation callbacks run at the microtask checkpoint after the
        // router's activation, before any frame or deferred change detection.
        new MutationObserver(() => {
            const pages = [...content.children]
                .filter((child) => child.tagName !== 'ROUTER-OUTLET')
                .map((child) => child.tagName.toLowerCase());
            if (pages.length > 1) {
                probe.overlaps.push(pages);
            }
        }).observe(content, { childList: true });
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const sources =
                    (entry as PerformanceEntry & {
                        sources?: { node?: Node | null }[];
                    }).sources ?? [];
                for (const { node } of sources) {
                    if (node instanceof Element) {
                        const className = node.classList.contains(
                            'workspace-content'
                        )
                            ? '.workspace-content'
                            : '';
                        probe.shiftSources.push(
                            node.tagName.toLowerCase() + className
                        );
                    }
                }
            }
        }).observe({ type: 'layout-shift' });
    });
}

async function waitForTwoFrames(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => setTimeout(resolve, 0))
                )
            )
    );
}

test.describe('Workspace route swap', () => {
    test('replaces a portal page with the dashboard without a frame showing both', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;

        try {
            await app.electronApp.evaluate(({ BrowserWindow }) => {
                BrowserWindow.getAllWindows()[0].setContentSize(1280, 720);
            });
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await expect(page).toHaveURL(/\/workspace\/xtreams\/[^/]+\/vod/);
            await expect(
                page.locator('app-workspace-shell-context-sidebar')
            ).toBeVisible();

            await armRouteSwapProbe(page);
            await goToDashboard(page);
            await expect(
                page.locator('lib-workspace-dashboard-rails')
            ).toBeVisible();
            await expect(
                page.locator('app-workspace-shell-context-sidebar')
            ).toHaveCount(0);
            await waitForTwoFrames(page);

            const probe = await page.evaluate(() => window.__routeSwapProbe);
            expect(probe?.overlaps).toEqual([]);
            expect(
                probe?.shiftSources.filter((source) =>
                    SWAP_SHIFT_SOURCES.includes(source)
                )
            ).toEqual([]);
        } finally {
            await closeElectronApp(app);
        }
    });
});
