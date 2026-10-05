import type { APIRequestContext, Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    expectVisibleContentCardTitle,
    goToDashboard,
    launchElectronApp,
    openGlobalRecent,
    openSources,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
    xtreamMockServer,
} from './electron-test-fixtures';
import {
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
} from './portal-mock-fixtures';
import {
    routePlayableStreams,
    startAndConfirmPlayback,
} from './playable-stream-fixture';

// ---------------------------------------------------------------------------
// Continue Watching lists only unfinished titles
//
// A title counts as watched once its saved position reaches 90% of the
// runtime (PORTAL_WATCHED_PROGRESS_PERCENT), so a movie stopped during its end
// credits leaves the dashboard's Continue Watching rail, as does one the user
// marks watched from the card menu. Both stay in the watch history. The
// positions are written through the real SQLite bridge: the clip the tests
// stream lasts seconds, far from any real runtime.
// ---------------------------------------------------------------------------

const RAIL = 'dashboard-continue-watching-rail';

type MoviePick = { title: string; playlistId: string; vodId: number };

async function playMovieAt(page: Page, index: number): Promise<MoviePick> {
    const card = page.locator('.category-content-layout mat-card').nth(index);
    await expect(card).toBeVisible({ timeout: 20_000 });
    let title = '';
    await expect(async () => {
        title = ((await card.locator('.title').textContent()) ?? '').trim();
        expect(title.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
    await card.click();
    await page.waitForURL(/\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/);
    const [, playlistId, vodId] =
        new URL(page.url()).pathname.match(
            /\/workspace\/xtreams\/([^/]+)\/vod\/[^/]+\/([^/]+)$/
        ) ?? [];

    // Recorded as recently viewed once it has really played.
    await startAndConfirmPlayback(page, async () => {
        const playButton = page.locator('button.play-btn').first();
        await expect(playButton).toBeVisible({ timeout: 20_000 });
        await playButton.click();
    });
    const backButton = page.getByTestId('workspace-header-back');
    await expect(backButton).toBeVisible({ timeout: 20_000 });
    await backButton.click();
    await expect(page.locator('app-web-player-view')).toHaveCount(0, {
        timeout: 20_000,
    });
    return { title, playlistId, vodId: Number(vodId) };
}

async function saveMoviePosition(
    page: Page,
    movie: MoviePick,
    positionSeconds: number,
    durationSeconds: number
): Promise<void> {
    await page.evaluate(
        ({ playlistId, data }) =>
            window.electron.dbSavePlaybackPosition(playlistId, data),
        {
            playlistId: movie.playlistId,
            data: {
                contentXtreamId: movie.vodId,
                contentType: 'vod' as const,
                positionSeconds,
                durationSeconds,
            },
        }
    );
}

function railCard(page: Page, title: string) {
    return page
        .locator(`[data-test-id="${RAIL}-card"]`)
        .filter({ hasText: title });
}

/** The ids of a mock series' season 1 episodes, in episode order. */
async function fetchSeasonOneEpisodeIds(
    request: APIRequestContext,
    seriesId: number
): Promise<number[]> {
    const params = new URLSearchParams({
        action: 'get_series_info',
        username: defaultXtreamUsername,
        password: defaultXtreamPassword,
        series_id: String(seriesId),
    });
    const response = await request.get(
        `${xtreamMockServer}/player_api.php?${params}`
    );
    expect(response.ok()).toBeTruthy();
    const info = (await response.json()) as {
        episodes?: Record<string, { id: string; episode_num: number }[]>;
    };
    return [...(info.episodes?.['1'] ?? [])]
        .sort((a, b) => a.episode_num - b.episode_num)
        .map((episode) => Number(episode.id));
}

async function playFirstEpisode(page: Page): Promise<void> {
    const seasonCard = page.locator('.season-card').first();
    const episodeCard = page
        .locator('.episode-card, .episode-list-item')
        .first();
    await expect
        .poll(
            async () =>
                (await seasonCard.count()) + (await episodeCard.count()),
            { timeout: 20_000 }
        )
        .toBeGreaterThan(0);
    if ((await seasonCard.count()) > 0) {
        await seasonCard.click();
    }
    await episodeCard.click();
}

test.describe('Dashboard Continue Watching', () => {
    test('@dashboard @persistence @electron leaves finished movies off Continue Watching and keeps them in the history', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120_000);
        await resetMockServers(request, ['xtream']);
        const vodFixture = await fetchXtreamVodFixture(request, {
            username: defaultXtreamUsername,
            password: defaultXtreamPassword,
        });
        const app = await launchElectronApp(dataDir);
        await routePlayableStreams(app.mainWindow);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Continue Watching Source',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            const finished = await playMovieAt(app.mainWindow, 0);
            const halfway = await playMovieAt(app.mainWindow, 1);
            expect(halfway.title).not.toBe(finished.title);

            // Stopped while the end credits rolled: 61 s of 59 min left.
            await saveMoviePosition(app.mainWindow, finished, 3491, 3552);
            await saveMoviePosition(app.mainWindow, halfway, 2700, 5400);

            await goToDashboard(app.mainWindow);
            await expect(railCard(app.mainWindow, halfway.title)).toHaveCount(
                1,
                { timeout: 20_000 }
            );
            await expect(railCard(app.mainWindow, finished.title)).toHaveCount(
                0
            );

            await railCard(app.mainWindow, halfway.title)
                .locator(`[data-test-id="${RAIL}-card-actions"]`)
                .click();
            await app.mainWindow
                .getByRole('menuitem', { name: /mark as watched/i })
                .click();

            // Nothing unfinished is left, so the rail itself goes away.
            await expect(
                app.mainWindow.locator(`[data-test-id="${RAIL}"]`)
            ).toHaveCount(0, { timeout: 20_000 });
            await expect
                .poll(() =>
                    app.mainWindow.evaluate(
                        async ({ playlistId, vodId }) =>
                            (
                                await window.electron.dbGetAllPlaybackPositions(
                                    playlistId
                                )
                            ).find(
                                (row) =>
                                    row.contentType === 'vod' &&
                                    row.contentXtreamId === vodId
                            ),
                        halfway
                    )
                )
                .toMatchObject({
                    positionSeconds: 5400,
                    durationSeconds: 5400,
                });

            // The page lists only movies here, so it shows no content toggle.
            await openGlobalRecent(app.mainWindow);
            await expectVisibleContentCardTitle(app.mainWindow, finished.title);
            await expectVisibleContentCardTitle(app.mainWindow, halfway.title);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@dashboard @xtream @electron keeps a series on Continue Watching with the episode after the one watched last', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(180_000);
        await resetMockServers(request, ['xtream']);
        const seriesFixture = await fetchXtreamSeriesFixture(request, {
            username: defaultXtreamUsername,
            password: defaultXtreamPassword,
        });
        const app = await launchElectronApp(dataDir);
        await routePlayableStreams(app.mainWindow);
        const page = app.mainWindow;

        try {
            await addXtreamPortal(page, { name: 'Continue Watching Series' });
            await waitForXtreamWorkspaceReady(page);
            await page
                .getByRole('link', { name: 'Series', exact: true })
                .click();
            await clickCategoryByNameExact(page, seriesFixture.categoryName);
            const seriesTitle = await clickFirstGridListCard(page);
            const playlistId = new URL(page.url()).pathname.match(
                /\/workspace\/xtreams\/([^/]+)\//
            )?.[1];
            expect(playlistId).toBeTruthy();
            await startAndConfirmPlayback(page, () => playFirstEpisode(page));

            const episodeRow = () =>
                page.evaluate(
                    async (id) =>
                        (
                            await window.electron.dbGetAllPlaybackPositions(id)
                        ).find((row) => row.contentType === 'episode') ?? null,
                    playlistId as string
                );
            await expect.poll(episodeRow).not.toBeNull();
            const played = await episodeRow();
            if (!played) {
                throw new Error('expected the played episode to be saved');
            }
            expect(played).toMatchObject({ seasonNumber: 1, episodeNumber: 1 });

            const backButton = page.getByTestId('workspace-header-back');
            await expect(backButton).toBeVisible({ timeout: 20_000 });
            await backButton.click();
            await expect(page.locator('app-web-player-view')).toHaveCount(0, {
                timeout: 20_000,
            });
            // Stopped during the end credits.
            await page.evaluate(
                ({ id, row }) =>
                    window.electron.dbSavePlaybackPosition(id, {
                        contentXtreamId: row.contentXtreamId,
                        contentType: 'episode',
                        seriesXtreamId: row.seriesXtreamId,
                        seasonNumber: row.seasonNumber,
                        episodeNumber: row.episodeNumber,
                        positionSeconds: 3491,
                        durationSeconds: 3552,
                    }),
                { id: playlistId as string, row: played }
            );

            await goToDashboard(page);
            const card = railCard(page, seriesTitle);
            await expect(card).toHaveCount(1, { timeout: 20_000 });
            await expect(card).toContainText('S1·E2');

            await card.locator(`[data-test-id="${RAIL}-card-actions"]`).click();
            await page
                .getByRole('menuitem', { name: /resume episode/i })
                .click();
            await expect(
                page.locator('.player-shell__episode-meta')
            ).toContainText('S01E02', { timeout: 30_000 });

            // Skipping ahead: episode 3 is finished after episode 2 was
            // left. The series goes on after the episode watched last, not
            // back to the one left behind.
            await backButton.click();
            await expect(page.locator('app-web-player-view')).toHaveCount(0, {
                timeout: 20_000,
            });
            const seasonOne = await fetchSeasonOneEpisodeIds(
                request,
                Number(played.seriesXtreamId)
            );
            expect(seasonOne.length).toBeGreaterThanOrEqual(4);
            expect(seasonOne[0]).toBe(played.contentXtreamId);
            await page.evaluate(
                ({ id, row, episodeId }) =>
                    window.electron.dbSavePlaybackPosition(id, {
                        contentXtreamId: episodeId,
                        contentType: 'episode',
                        seriesXtreamId: row.seriesXtreamId,
                        seasonNumber: 1,
                        episodeNumber: 3,
                        positionSeconds: 3491,
                        durationSeconds: 3552,
                    }),
                {
                    id: playlistId as string,
                    row: played,
                    episodeId: seasonOne[2],
                }
            );

            // Back from the player returned to the dashboard, which read the
            // positions before episode 3 was saved: open it anew.
            await openSources(page);
            await goToDashboard(page);
            await expect(card).toContainText('S1·E4', { timeout: 20_000 });
            await card.locator(`[data-test-id="${RAIL}-card-actions"]`).click();
            await page
                .getByRole('menuitem', { name: /resume episode/i })
                .click();
            await expect(
                page.locator('.player-shell__episode-meta')
            ).toContainText('S01E04', { timeout: 30_000 });
        } finally {
            await closeElectronApp(app);
        }
    });
});
