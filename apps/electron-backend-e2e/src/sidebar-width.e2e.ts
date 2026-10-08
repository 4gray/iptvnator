import { Locator, Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

/**
 * The workspace context panels share one stored width but clamp it to their
 * own limits. Opening a narrower panel used to save its clamped width, so a
 * categories panel widened past Settings' 400px maximum came back at 400.
 * The drag also lands on 520 only if the padded panel does not jump wider
 * when the drag starts.
 */

const SHARED_WIDTH_KEY = 'sidebar-width';

/** The CSS width the directive sets; the panels are content-box. */
function renderedWidth(panel: Locator): Promise<number> {
    return panel.evaluate((el) => parseFloat(getComputedStyle(el).width));
}

function storedWidth(page: Page): Promise<string | null> {
    return page.evaluate((key) => localStorage.getItem(key), SHARED_WIDTH_KEY);
}

async function dragPanelTo(
    page: Page,
    panel: Locator,
    width: number
): Promise<void> {
    const handle = panel.locator(':scope > .resize-handle');
    const box = await handle.boundingBox();
    if (!box) throw new Error('The panel has no resize handle');
    const startX = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    // A drag starts from the CSS width, so the panel's padding and border
    // must not count toward the distance.
    const delta = width - (await renderedWidth(panel));

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + delta, y, { steps: 10 });
    await page.mouse.up();
}

test.describe('Electron shared sidebar width', () => {
    test('@persistence @electron keeps a widened categories panel after Settings clamps it', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        try {
            const page = app.mainWindow;
            await page.setViewportSize({ width: 1440, height: 900 });
            await addXtreamPortal(page);
            await openWorkspaceSection(page, 'Movies');
            await waitForXtreamWorkspaceReady(page);
            const categories = page.locator('aside.context-panel--route');
            await expect(categories).toBeVisible();
            const categoriesUrl = page.url();

            await dragPanelTo(page, categories, 520);
            await expect.poll(() => renderedWidth(categories)).toBe(520);
            await expect.poll(() => storedWidth(page)).toBe('520');

            await openSettings(page);
            const settings = page.locator('aside.context-panel--settings');
            await expect(settings).toBeVisible();
            await expect.poll(() => renderedWidth(settings)).toBe(400);
            expect(await storedWidth(page)).toBe('520');

            await page.goBack();
            await page.waitForURL(categoriesUrl);
            await expect(categories).toBeVisible();
            await expect.poll(() => renderedWidth(categories)).toBe(520);
            expect(await storedWidth(page)).toBe('520');
        } finally {
            await closeElectronApp(app);
        }
    });
});
