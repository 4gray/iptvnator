import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    m3uFixturePath,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
    resetMockServers,
    saveSettings,
    setSwitch,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { toggleFavoriteForChannel } from './dashboard-e2e-flows';
import {
    holdIpcChannel,
    launchElectronWithChannelHolds,
} from './ipc-channel-hold';
import { fetchXtreamLiveFixture, getXtreamTitle } from './portal-mock-fixtures';
import {
    expectRendererReloadedOnRoute,
    reloadFromMainProcess,
} from './renderer-reload.support';
import {
    expectSameEdge,
    measureBoxes,
    observeLayoutShifts,
    readLayoutShifts,
    waitForContentQuiet,
} from './skeleton-geometry.e2e-support';

// ---------------------------------------------------------------------------
// A skeleton must hold the place of what it precedes: the same header
// heights, the same first-row position and the same rail heights, so content
// arrives without moving anything. Each loading state is kept on screen by
// holding the IPC channel that answers it, measured, then released and
// compared with what replaced it. The M3U skeleton swaps the whole channel
// list subtree, which the browser does not count as a layout shift at all,
// so its positions are compared directly; on the dashboard a rail that
// changes height moves the rails below it, which the layout-shift score
// catches as well.
// ---------------------------------------------------------------------------

const viewport = { width: 1280, height: 700 };
const playlistChannel = 'DB_GET_APP_PLAYLIST';
const favoritesChannel = 'DB_GET_ALL_GLOBAL_FAVORITES';
const recentlyAddedChannel = 'DB_GET_GLOBAL_RECENTLY_ADDED';
const maxDashboardShiftScore = 0.01;

const loadingState = 'app-channel-list-loading-state';
const firstSkeletonRow = `${loadingState} app-channel-list-item-skeleton`;
const firstChannelRow = 'app-channel-list-item';

async function openM3uFromDashboard(page: Page): Promise<void> {
    await page
        .getByTestId('dashboard-recent-sources-rail-card-link')
        .first()
        .click();
}

test.describe('Skeleton geometry', () => {
    test('M3U channel list skeletons put the headers and the first row where the list lands', async ({
        dataDir,
    }) => {
        test.setTimeout(120_000);
        const app = await launchElectronWithChannelHolds(dataDir, [
            playlistChannel,
        ]);
        const page = app.mainWindow;

        try {
            await page.setViewportSize(viewport);
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
            await goToDashboard(page);

            // All channels, the default view.
            let hold = await holdIpcChannel(app, playlistChannel);
            await openM3uFromDashboard(page);
            await hold.waitUntilHeld();
            await expect(
                page.locator(`${loadingState} .channels-loading-header`)
            ).toBeVisible();
            const allSkeleton = await measureBoxes(page, {
                header: `${loadingState} .channels-loading-header`,
                divider: `${loadingState} .channels-loading-divider`,
                row: firstSkeletonRow,
            });
            await observeLayoutShifts(page);
            await hold.release();
            await expect(page.locator(firstChannelRow).first()).toBeVisible();
            await waitForContentQuiet(page);
            const all = await measureBoxes(page, {
                header: '.all-channels-header',
                divider: '.all-channels-divider',
                row: firstChannelRow,
            });
            const allEvidence = { skeleton: allSkeleton, loaded: all };
            expectSameEdge(
                'All channels header top',
                all.header.top,
                allSkeleton.header.top,
                allEvidence
            );
            expectSameEdge(
                'All channels header height',
                all.header.height,
                allSkeleton.header.height,
                allEvidence
            );
            expectSameEdge(
                'All channels divider',
                all.divider.bottom,
                allSkeleton.divider.bottom,
                allEvidence
            );
            expectSameEdge(
                'All channels first row',
                all.row.top,
                allSkeleton.row.top,
                allEvidence
            );
            expect((await readLayoutShifts(page)).score).toBe(0);

            // Groups: entering the section again from the dashboard reloads
            // the playlist, so the skeleton shows once more.
            await openWorkspaceSection(page, 'Groups');
            await expect(page.locator('.groups-content-header')).toBeVisible();
            await goToDashboard(page);
            hold = await holdIpcChannel(app, playlistChannel);
            await page.goBack();
            await hold.waitUntilHeld();
            await expect(
                page.locator(`${loadingState} .groups-loading-content__header`)
            ).toBeVisible();
            const groupsSkeleton = await measureBoxes(page, {
                navHeader: `${loadingState} .groups-loading-nav__header`,
                // The second item: the selected first one is lifted by 1px.
                navItem: `${loadingState} .groups-loading-nav__item:nth-child(2)`,
                header: `${loadingState} .groups-loading-content__header`,
                row: firstSkeletonRow,
            });
            await observeLayoutShifts(page);
            await hold.release();
            await expect(page.locator(firstChannelRow).first()).toBeVisible();
            await waitForContentQuiet(page);
            const groups = await measureBoxes(page, {
                navHeader: '.groups-nav-header',
                navItem: '.group-nav-item:nth-child(2)',
                header: '.groups-content-header',
                row: firstChannelRow,
            });
            const groupsEvidence = { skeleton: groupsSkeleton, loaded: groups };
            expectSameEdge(
                'Groups rail header height',
                groups.navHeader.height,
                groupsSkeleton.navHeader.height,
                groupsEvidence
            );
            expectSameEdge(
                'Groups rail second item',
                groups.navItem.top,
                groupsSkeleton.navItem.top,
                groupsEvidence
            );
            expectSameEdge(
                'Groups rail item height',
                groups.navItem.height,
                groupsSkeleton.navItem.height,
                groupsEvidence
            );
            expectSameEdge(
                'Group header top',
                groups.header.top,
                groupsSkeleton.header.top,
                groupsEvidence
            );
            expectSameEdge(
                'Group header height',
                groups.header.height,
                groupsSkeleton.header.height,
                groupsEvidence
            );
            expectSameEdge(
                'Group first row',
                groups.row.top,
                groupsSkeleton.row.top,
                groupsEvidence
            );
            expect((await readLayoutShifts(page)).score).toBe(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('dashboard rail skeletons have the height of the rails that replace them', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120_000);
        await resetMockServers(request, ['xtream']);
        const live = await fetchXtreamLiveFixture(request, {
            password: defaultXtreamPassword,
            username: defaultXtreamUsername,
        });
        const app = await launchElectronWithChannelHolds(dataDir, [
            favoritesChannel,
            recentlyAddedChannel,
        ]);
        const page = app.mainWindow;

        try {
            await page.setViewportSize(viewport);
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await openWorkspaceSection(page, 'Live TV');
            await clickCategoryByNameExact(page, live.categoryName);
            await toggleFavoriteForChannel(page, getXtreamTitle(live.items[0]));

            // A skeleton never shows above a rail that already has cards, and
            // the sources rail is ready first: without it, the live
            // favorites skeleton (channel cards) sits right above the
            // recently-added one (posters), both in the viewport.
            await openSettings(page);
            await openSettingsSection(page, 'dashboard');
            await setSwitch(
                page
                    .getByTestId('toggle-dashboard-rail-recent-sources')
                    .locator('[role="switch"]'),
                false
            );
            await saveSettings(page);
            await goToDashboard(page);
            await expect(
                page.getByTestId('dashboard-xtream-recently-added-rail')
            ).toBeVisible({ timeout: 20_000 });

            // Recently added is asked for once the favorites have loaded, so
            // it is held only after the favorites are.
            const favorites = await holdIpcChannel(app, favoritesChannel);
            await reloadFromMainProcess(app);
            await expectRendererReloadedOnRoute(
                page,
                /\/workspace\/dashboard$/
            );
            await page.setViewportSize(viewport);
            await favorites.waitUntilHeld();
            const recentlyAdded = await holdIpcChannel(
                app,
                recentlyAddedChannel
            );
            const liveSkeletonRail =
                '[data-test-id="dashboard-live-favorites-rail-skeleton"]';
            const addedSkeletonRail =
                '[data-test-id="dashboard-xtream-recently-added-rail-skeleton"]';
            await expect(page.locator(liveSkeletonRail)).toBeVisible({
                timeout: 20_000,
            });
            await expect(page.locator(addedSkeletonRail)).toBeVisible();
            await waitForContentQuiet(page);
            const skeleton = await measureBoxes(page, {
                liveRail: liveSkeletonRail,
                liveHeader: `${liveSkeletonRail} .rail-skeleton__header`,
                liveCard: `${liveSkeletonRail} .rail-skeleton__card`,
                addedRail: addedSkeletonRail,
                addedHeader: `${addedSkeletonRail} .rail-skeleton__header`,
                addedCard: `${addedSkeletonRail} .rail-skeleton__card`,
            });

            await observeLayoutShifts(page);
            await favorites.release();
            const liveRail = '[data-test-id="dashboard-live-favorites-rail"]';
            await expect(page.locator(liveRail)).toBeVisible();
            await recentlyAdded.waitUntilHeld();
            await waitForContentQuiet(page);
            const afterLive = await measureBoxes(page, {
                liveRail,
                liveHeader: `${liveRail} .rail__header`,
                liveCard: `${liveRail} .rail__card`,
                addedRail: addedSkeletonRail,
            });

            await recentlyAdded.release();
            const addedRail =
                '[data-test-id="dashboard-xtream-recently-added-rail"]';
            await expect(page.locator(addedRail)).toBeVisible();
            await waitForContentQuiet(page);
            const loaded = await measureBoxes(page, {
                addedRail,
                addedHeader: `${addedRail} .rail__header`,
                addedCard: `${addedRail} .rail__card`,
            });
            const shifts = await readLayoutShifts(page);
            const evidence = { skeleton, afterLive, loaded, shifts };

            expectSameEdge(
                'live favorites rail height',
                afterLive.liveRail.height,
                skeleton.liveRail.height,
                evidence
            );
            expectSameEdge(
                'live favorites header height',
                afterLive.liveHeader.height,
                skeleton.liveHeader.height,
                evidence
            );
            expectSameEdge(
                'channel card width',
                afterLive.liveCard.width,
                skeleton.liveCard.width,
                evidence
            );
            expectSameEdge(
                'channel card height',
                afterLive.liveCard.height,
                skeleton.liveCard.height,
                evidence
            );
            // Relative to the rail above it: the hero may still grow past its
            // floor when its slides arrive, which moves both rails alike.
            expectSameEdge(
                'recently added skeleton stays below the live rail',
                afterLive.addedRail.top - afterLive.liveRail.bottom,
                skeleton.addedRail.top - skeleton.liveRail.bottom,
                evidence
            );
            expectSameEdge(
                'recently added rail height',
                loaded.addedRail.height,
                skeleton.addedRail.height,
                evidence
            );
            expectSameEdge(
                'recently added header height',
                loaded.addedHeader.height,
                skeleton.addedHeader.height,
                evidence
            );
            expectSameEdge(
                'poster card width',
                loaded.addedCard.width,
                skeleton.addedCard.width,
                evidence
            );
            expectSameEdge(
                'poster card height',
                loaded.addedCard.height,
                skeleton.addedCard.height,
                evidence
            );
            expect(
                shifts.score,
                JSON.stringify(evidence, null, 1)
            ).toBeLessThanOrEqual(maxDashboardShiftScore);
        } finally {
            await closeElectronApp(app);
        }
    });
});
