import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    clickGridListCardByTitle,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    launchElectronApp,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    sourceRowByTitle,
    test,
    waitForXtreamImportToFinish,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { fetchXtreamSeriesFixture } from './portal-mock-fixtures';

// ---------------------------------------------------------------------------
// Season-level watched toggle on the Electron serial details page
//
// The season header exposes a bulk toggle carrying `data-test-id` (this
// suite's testIdAttribute, so getByTestId matches it), while the per-episode
// toggles carry `data-testid` and need raw attribute locators. In Electron
// the toggle routes every unwatched episode of the selected season through
// the DB_SAVE_PLAYBACK_POSITIONS_BATCH IPC (preload → main → database worker
// → one SQLite transaction) and the unmark path through
// DB_CLEAR_PLAYBACK_POSITIONS_BATCH. The runtime bridge has no per-episode
// fallback for these calls (`PlaybackPositionRuntimeBridgeService` throws
// when the batch methods are missing), so the rows asserted below via
// `dbGetAllPlaybackPositions` prove the batch IPC executed end to end.
// Durability is proven with a full app relaunch: the renderer and the main
// process restart, so the watched state can only come from SQLite on disk.
// ---------------------------------------------------------------------------

// The default `user1:pass1` mock scenario generates 3 seasons × 8 episodes
// per series (season/episode numbers starting at 1), matching the PWA spec.
const seasonCount = 3;
const seasonEpisodeCount = 8;
const expectedEpisodeNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
const portalName = 'Season Watched Toggle';

const watchedEpisodeToggleSelector =
    '[data-testid="episode-watched-toggle"].episode-card__watched-toggle--watched';

type EpisodePositionRow = {
    episodeNumber: number | null;
    positionSeconds: number;
    seasonNumber: number | null;
};

/** Reads the persisted episode positions straight from SQLite over IPC. */
async function readEpisodePositions(
    page: Page,
    playlistId: string
): Promise<EpisodePositionRow[]> {
    return page.evaluate(async (id) => {
        const positions =
            (await window.electron?.dbGetAllPlaybackPositions?.(id)) ?? [];
        return positions
            .filter((position) => position.contentType === 'episode')
            .map((position) => ({
                episodeNumber: position.episodeNumber ?? null,
                positionSeconds: position.positionSeconds,
                seasonNumber: position.seasonNumber ?? null,
            }));
    }, playlistId);
}

function extractPlaylistId(page: Page): string {
    const match = new URL(page.url()).pathname.match(
        /\/workspace\/xtreams\/([^/]+)\//
    );
    if (!match) {
        throw new Error(`Expected an Xtream route, got ${page.url()}`);
    }
    return match[1];
}

/**
 * Opens the given category's series grid and clicks into a series detail.
 * Without `seriesTitle` it clicks the first card (the grid sorts by date, so
 * fixture order is not grid order) and returns the clicked title so the
 * post-restart navigation can target the exact same series.
 */
async function openSeriesDetail(
    page: Page,
    categoryName: string,
    seriesTitle?: string
): Promise<string> {
    await openWorkspaceSection(page, 'Series');
    await clickCategoryByNameExact(page, categoryName);

    let clickedTitle: string;
    if (seriesTitle === undefined) {
        clickedTitle = await clickFirstGridListCard(page);
    } else {
        await clickGridListCardByTitle(page, seriesTitle);
        clickedTitle = seriesTitle;
    }

    await page.waitForURL(/\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+$/);
    return clickedTitle;
}

test.describe('Electron Season Watched Toggle', () => {
    test('@xtream @persistence @electron marks a season watched via the batch IPC, survives an app restart, and clears again', async ({
        dataDir,
        request,
    }) => {
        // Full app relaunch mid-test: startup alone can eat half the default
        // 60s budget on a real Electron app.
        test.setTimeout(120_000);

        await resetMockServers(request, ['xtream']);
        const seriesFixture = await fetchXtreamSeriesFixture(request, {
            password: defaultXtreamPassword,
            username: defaultXtreamUsername,
        });

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, { name: portalName });
            await waitForXtreamImportToFinish(app.mainWindow);

            const seriesTitle = await openSeriesDetail(
                app.mainWindow,
                seriesFixture.categoryName
            );
            const playlistId = extractPlaylistId(app.mainWindow);

            // Season 1 auto-selects fully unwatched: the toggle offers to mark
            // all 8 episodes and neither the DOM nor SQLite knows any watched
            // episode yet.
            const seasonToggle = app.mainWindow.getByTestId(
                'toggle-season-watched'
            );
            await expect(seasonToggle).toBeVisible({ timeout: 20_000 });
            await expect(seasonToggle).toContainText(
                `Mark season as watched (${seasonEpisodeCount})`
            );

            const episodeCards = app.mainWindow.locator('.episode-card');
            const watchedCards = app.mainWindow.locator(
                '.episode-card--watched'
            );
            await expect(episodeCards).toHaveCount(seasonEpisodeCount, {
                timeout: 10_000,
            });
            await expect(watchedCards).toHaveCount(0);
            expect(
                await readEpisodePositions(app.mainWindow, playlistId)
            ).toEqual([]);

            await seasonToggle.click();

            // The batch save flips the button, marks every card, and fills
            // the per-episode toggles; the untouched second season stays
            // unmarked while the selected season's tab shows the check.
            await expect(seasonToggle).toContainText(
                'Mark season as unwatched',
                { timeout: 15_000 }
            );
            await expect(watchedCards).toHaveCount(seasonEpisodeCount);
            await expect(
                app.mainWindow.locator(watchedEpisodeToggleSelector)
            ).toHaveCount(seasonEpisodeCount);

            const seasonTabs = app.mainWindow.locator('.season-tabs__pill');
            await expect(seasonTabs).toHaveCount(seasonCount);
            await expect(
                seasonTabs.first().locator('.season-tabs__done')
            ).toBeVisible();
            await expect(
                seasonTabs.nth(1).locator('.season-tabs__done')
            ).toHaveCount(0);

            // The single batch transaction landed 8 full-progress episode
            // rows for season 1 in SQLite.
            await expect
                .poll(() => readEpisodePositions(app.mainWindow, playlistId), {
                    timeout: 20_000,
                })
                .toHaveLength(seasonEpisodeCount);
            const savedRows = await readEpisodePositions(
                app.mainWindow,
                playlistId
            );
            expect(
                savedRows
                    .map((row) => row.episodeNumber)
                    .sort((left, right) => (left ?? 0) - (right ?? 0))
            ).toEqual(expectedEpisodeNumbers);
            expect(
                savedRows.every(
                    (row) => row.seasonNumber === 1 && row.positionSeconds > 0
                )
            ).toBe(true);

            // Relaunch the whole app: the watched state must be re-read from
            // the SQLite database file, not from any renderer memory.
            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, portalName).first().click();
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openSeriesDetail(
                app.mainWindow,
                seriesFixture.categoryName,
                seriesTitle
            );

            const restartedToggle = app.mainWindow.getByTestId(
                'toggle-season-watched'
            );
            const restartedWatchedCards = app.mainWindow.locator(
                '.episode-card--watched'
            );
            await expect(restartedToggle).toBeVisible({ timeout: 20_000 });
            await expect(restartedToggle).toContainText(
                'Mark season as unwatched'
            );
            await expect(restartedWatchedCards).toHaveCount(
                seasonEpisodeCount,
                { timeout: 10_000 }
            );
            await expect(
                app.mainWindow
                    .locator('.season-tabs__pill')
                    .first()
                    .locator('.season-tabs__done')
            ).toBeVisible();

            // Unmark: the clear batch removes every row again, in the DOM and
            // in SQLite.
            await restartedToggle.click();
            await expect(restartedToggle).toContainText(
                `Mark season as watched (${seasonEpisodeCount})`,
                { timeout: 15_000 }
            );
            await expect(restartedWatchedCards).toHaveCount(0);
            await expect(
                app.mainWindow.locator(watchedEpisodeToggleSelector)
            ).toHaveCount(0);
            await expect(
                app.mainWindow.locator('.season-tabs__done')
            ).toHaveCount(0);
            await expect
                .poll(() => readEpisodePositions(app.mainWindow, playlistId), {
                    timeout: 20_000,
                })
                .toEqual([]);

            // Series scope: the header ⋮ menu routes EVERY season through
            // the same batch IPC — one action, 24 full-progress rows across
            // seasons 1–3 (no second restart: durability of the channel is
            // already proven above).
            const seriesMenuTrigger =
                app.mainWindow.getByTestId('series-watch-menu');
            await expect(seriesMenuTrigger).toBeVisible();
            await seriesMenuTrigger.click();
            const seriesToggle = app.mainWindow.getByTestId(
                'toggle-series-watched'
            );
            await expect(seriesToggle).toBeVisible();
            await expect(seriesToggle).toContainText(
                `Mark series as watched (${seasonCount * seasonEpisodeCount})`
            );
            await seriesToggle.click();

            await expect(
                app.mainWindow.locator('.season-tabs__done')
            ).toHaveCount(seasonCount, { timeout: 15_000 });
            await expect
                .poll(() => readEpisodePositions(app.mainWindow, playlistId), {
                    timeout: 20_000,
                })
                .toHaveLength(seasonCount * seasonEpisodeCount);
            const seriesRows = await readEpisodePositions(
                app.mainWindow,
                playlistId
            );
            expect(
                new Set(seriesRows.map((row) => row.seasonNumber))
            ).toEqual(new Set([1, 2, 3]));
            expect(
                seriesRows.every((row) => row.positionSeconds > 0)
            ).toBe(true);

            // Unwatch-all clears all 24 rows again through the clear batch.
            await seriesMenuTrigger.click();
            await expect(seriesToggle).toContainText(
                'Mark series as unwatched'
            );
            await seriesToggle.click();
            await expect(
                app.mainWindow.locator('.season-tabs__done')
            ).toHaveCount(0, { timeout: 15_000 });
            await expect
                .poll(() => readEpisodePositions(app.mainWindow, playlistId), {
                    timeout: 20_000,
                })
                .toEqual([]);
        } finally {
            await closeElectronApp(app);
        }
    });
});
