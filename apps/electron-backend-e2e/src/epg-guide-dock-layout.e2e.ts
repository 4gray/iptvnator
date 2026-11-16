import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { fetchXtreamLiveFixture } from './portal-mock-fixtures';

// The marketing fixture schedules 30-minute slots, which at the default zoom
// give ~117px blocks: the width where the ON NOW tag used to sit on the time.
const credentials = { username: 'marketing', password: 'marketing' };

interface NowBlockGeometry {
    readonly overlaps: boolean;
    readonly tagInside: boolean;
    readonly titleInside: boolean;
}

function nowBlockGeometry(page: Page): Promise<NowBlockGeometry[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll('.epg-guide-row__block.is-now')].map(
            (block) => {
                const box = block.getBoundingClientRect();
                const time = block
                    .querySelector('.epg-guide-row__time')
                    ?.getBoundingClientRect();
                const tag = block
                    .querySelector('.epg-guide-row__tag')
                    ?.getBoundingClientRect();
                const title = block
                    .querySelector('.epg-guide-row__title')
                    ?.getBoundingClientRect();
                if (!time || !tag || !title) {
                    throw new Error('A now block lost its time, tag or title.');
                }
                const overlaps =
                    time.left < tag.right &&
                    tag.left < time.right &&
                    time.top < tag.bottom &&
                    tag.top < time.bottom;
                return {
                    overlaps,
                    tagInside: tag.right <= box.right + 0.5,
                    // Inside on both axes: a tag wrapped onto a third line
                    // pushes the title out of the bottom of the block.
                    titleInside:
                        title.right <= box.right + 0.5 &&
                        title.bottom <= box.bottom + 0.5,
                };
            }
        )
    );
}

async function expectCompactGuideLayout(page: Page): Promise<void> {
    const dock = page.locator('app-live-stream-layout .video-player').first();
    const controls = dock.locator('app-player-controls');
    // The docked strip is a mini player: video and play/pause only.
    await expect(controls.locator('.player-controls__play')).toBeVisible();
    // The full dock is still rendered (and comes back when the guide closes);
    // it is only hidden in the strip, so these checks are not vacuous.
    await expect(controls.locator('app-player-timeline')).toHaveCount(1);
    for (const hidden of [
        'app-player-timeline',
        '.player-controls__left',
        '.player-controls__transport-side',
        '.player-controls__actions',
        '.player-controls__corner',
    ]) {
        for (const element of await controls.locator(hidden).all()) {
            await expect(element).toBeHidden();
        }
    }
    const dockBox = await dock.boundingBox();
    expect(dockBox?.height ?? 0).toBeLessThanOrEqual(128);

    await expect
        .poll(async () => (await nowBlockGeometry(page)).length)
        .toBeGreaterThan(0);
    for (const block of await nowBlockGeometry(page)) {
        expect(block).toEqual({
            overlaps: false,
            tagInside: true,
            titleInside: true,
        });
    }
}

test('@epg @xtream @electron docks a compact mini player and keeps ON NOW clear of the time', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(150000);
    await resetMockServers(request, ['xtream']);
    const live = await fetchXtreamLiveFixture(request, credentials);
    const first = live.items[0];
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const resize = (width: number, height: number) =>
        app.electronApp.evaluate(
            ({ BrowserWindow }, size) =>
                BrowserWindow.getAllWindows()[0].setContentSize(
                    size.width,
                    size.height
                ),
            { width, height }
        );
    try {
        await resize(1600, 1000);
        await addXtreamPortal(page, {
            name: 'Synthetic Mini Player Portal',
            ...credentials,
        });
        await waitForXtreamWorkspaceReady(page);
        await openWorkspaceSection(page, 'Live TV');
        await clickCategoryByNameExact(page, live.categoryName);
        await channelItemByTitle(page, first.name ?? '')
            .first()
            .click();
        await expect(
            page.locator('app-live-stream-layout app-player-controls')
        ).toHaveCount(1, { timeout: 30000 });
        await page.getByTestId('xtream-epg-guide').click();
        await expect(page.locator('app-epg-guide')).toBeVisible();

        await expectCompactGuideLayout(page);

        await resize(900, 700);
        await expectCompactGuideLayout(page);

        // Closing the guide restores the full controls dock.
        await resize(1600, 1000);
        await page.getByRole('button', { name: /close guide/i }).click();
        await expect(page.locator('app-epg-guide')).toHaveCount(0);
        await expect(
            page.locator(
                'app-live-stream-layout app-player-controls .player-controls__actions'
            )
        ).toBeVisible();
    } finally {
        await closeElectronApp(app);
    }
});
