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
import { fetchXtreamEpgFixture } from './portal-mock-fixtures';

const CHANNEL = 'Timezone News';
const PAST_PROGRAM = 'Earlier Bulletin';

/**
 * Catch-up playback draws the EPG programmes of its archive window on the
 * shared controls' seek bar (`timelineSegments`); live playback draws none.
 * The `epg` mock user serves a playable MPEG-TS clip for timeshift URLs.
 */
test('@epg @xtream @electron draws the catch-up programme on the seek bar', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(180000);
    const credentials = { username: 'epg', password: 'epg' };
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, credentials);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;

    try {
        await addXtreamPortal(page, {
            name: 'Catch-up timeline',
            ...credentials,
        });
        await waitForXtreamWorkspaceReady(page);
        await openWorkspaceSection(page, 'Live TV');
        await clickCategoryByNameExact(page, fixture.categoryName);
        const row = channelItemByTitle(page, CHANNEL).first();
        await expect(row).toBeVisible({ timeout: 20000 });
        await row.click();

        const player = page.locator('app-web-player-view');
        const titledSegments = player.locator(
            '.player-controls__timeline-segment--titled'
        );
        await expect(player).toBeVisible({ timeout: 20000 });
        await expect(titledSegments).toHaveCount(0);

        const block = page
            .locator('app-epg-timeline .epg-timeline__block')
            .filter({ hasText: PAST_PROGRAM })
            .first();
        await expect(block).toBeVisible({ timeout: 20000 });
        await block.click();

        const segment = player.locator(
            `.player-controls__timeline-segment[data-segment-title="${PAST_PROGRAM}"]`
        );
        await expect(segment).toHaveCount(1, { timeout: 30000 });

        const bar = player.locator('.player-controls__timeline-bar');
        await bar.hover();
        await expect(
            player.locator('[data-test-id="player-controls-timeline-label"]')
        ).toContainText(`${PAST_PROGRAM} ·`);

        await row.click();
        await expect(titledSegments).toHaveCount(0, { timeout: 20000 });
    } finally {
        await closeElectronApp(app);
    }
});
