import { ok } from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    channelItemByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    stalkerMockServer,
    test,
    waitForXtreamImportToFinish,
    workspaceRoot,
    xtreamMockServer,
} from './electron-test-fixtures';
import {
    createLocalMediaServer,
    getLatestSession,
    installEmbeddedMpvSessionCapture,
} from './embedded-mpv-frame-copy-packaged-fixtures';
import {
    fetchStalkerCategoryFixture,
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
} from './portal-mock-fixtures';
import { applyTheme, expectTextContrast } from './theme-contrast';

const credentials = { username: 'minimal', password: 'minimal' };
const sourceName = 'Synthetic Xtream';
const stalkerName = 'Synthetic Stalker';
const primaryName = 'Synthetic primary';
const movieTitle = 'Synthetic feature 1';
const seriesTitle = 'Synthetic series 1';
const episodeTitle = 'Synthetic episode 1';

test('@playback @xtream @stalker @electron second-stream VOD, history and positions', async ({
    dataDir,
    request,
}, testInfo) => {
    test.setTimeout(120_000);
    const [
        { items: stalkerMovies },
        { items: stalkerSeries },
        { items: movies },
        { items: series },
    ] = await Promise.all([
        fetchStalkerCategoryFixture(request, 'vod'),
        fetchStalkerCategoryFixture(request, 'series'),
        fetchXtreamVodFixture(request, credentials),
        fetchXtreamSeriesFixture(request, credentials),
    ]);
    const movie = movies[0];
    const show = series[0];
    const seriesId = Number(show.series_id);
    const details = await request.get(
        `${xtreamMockServer}/player_api.php?${new URLSearchParams({
            ...credentials,
            action: 'get_series_info',
            series_id: String(seriesId),
        })}`
    );
    expect(details.ok()).toBeTruthy();
    const info: { episodes: Record<string, { id: string; title: string }[]> } =
        await details.json();
    const episode = info.episodes['1'][0];
    const watchedEpisode = info.episodes['1'][1];
    const movieId = Number(movie.stream_id);
    const episodeId = Number(episode.id);

    const media = await createLocalMediaServer({
        body: readFileSync(
            join(
                workspaceRoot,
                'apps/xtream-mock-server/src/fixtures/episode.mkv'
            )
        ),
        resourcePath: '/sample.mkv',
        contentType: 'video/x-matroska',
    });
    const portal = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', xtreamMockServer);
        const artwork = `http://${req.headers.host}/synthetic-poster.svg`;
        if (
            url.pathname === '/synthetic-poster.svg' ||
            url.pathname === '/synthetic-still.svg'
        ) {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.end(
                '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="#304e66"/><circle cx="80" cy="80" r="38" fill="#a2bfd0"/><path d="M0 240L160 120V240Z" fill="#172b3e"/></svg>'
            );
            return;
        }
        const stalker =
            url.pathname === '/portal.php' ||
            url.pathname.endsWith('/server/load.php');
        if (stalker && url.searchParams.get('action') === 'create_link') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ js: { cmd: media.url } }));
            return;
        }
        if (/^\/(movie|series)\//.test(url.pathname)) {
            res.writeHead(302, { Location: media.url }).end();
            return;
        }
        if (!stalker && url.pathname !== '/player_api.php') {
            res.writeHead(404).end();
            return;
        }
        const upstream = stalker
            ? new URL('/portal.php', stalkerMockServer)
            : new URL('/player_api.php', xtreamMockServer);
        upstream.search = url.search;
        try {
            const headers = Object.fromEntries(
                Object.entries(req.headers).filter(
                    ([key, value]) =>
                        key !== 'host' && typeof value === 'string'
                )
            ) as Record<string, string>;
            const response = await fetch(upstream, {
                headers,
                redirect: 'error',
            });
            const action = url.searchParams.get('action');
            if (
                !stalker &&
                (action === 'get_vod_streams' || action === 'get_series')
            ) {
                const rows: {
                    name: string;
                    stream_icon?: string;
                    cover?: string;
                }[] = await response.json();
                rows.forEach((row, index) => {
                    row.name = `Synthetic ${action === 'get_series' ? 'series' : 'feature'} ${index + 1}`;
                    row.stream_icon = artwork;
                    row.cover = artwork;
                });
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(rows));
                return;
            }
            if (
                !stalker &&
                action === 'get_series_info' &&
                Number(url.searchParams.get('series_id')) === seriesId
            ) {
                const body = await response.json();
                body.info.cover = artwork;
                body.episodes['1'][0].title = episodeTitle;
                body.episodes['1'][1].title = 'Synthetic episode 2';
                body.episodes['1'][0].info = {
                    movie_image: artwork.replace('poster', 'still'),
                    plot: 'A synthetic crew follows a signal beyond the ridge.',
                    duration_secs: 60,
                };
                body.episodes['1'][1].info = {
                    movie_image: artwork.replace('poster.svg', 'missing.svg'),
                };
                body.episodes['1'][2].title = '';
                body.episodes['1'][2].info = [];
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(body));
                return;
            }
            if (
                url.searchParams.get('action') === 'get_vod_info' &&
                Number(url.searchParams.get('vod_id')) === movieId
            ) {
                const body = await response.json();
                delete body.movie_data;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(body));
                return;
            }
            res.writeHead(response.status, {
                'Content-Type':
                    response.headers.get('content-type') ?? 'application/json',
            }).end(Buffer.from(await response.arrayBuffer()));
        } catch {
            res.writeHead(502).end();
        }
    });
    try {
        await new Promise<void>((resolve) =>
            portal.listen(0, '127.0.0.1', resolve)
        );
        const address = portal.address();
        if (!address || typeof address === 'string')
            throw new Error('Missing mock portal address');
        const app = await launchElectronApp(dataDir, {
            env: {
                IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1',
                IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY: '1',
                IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW: '1',
            },
        });
        try {
            const page = app.mainWindow;
            const support = await page.evaluate(() =>
                window.electron.getEmbeddedMpvSupport()
            );
            test.skip(
                !support.supported || support.engine !== 'frame-copy',
                'Requires the frame-copy runtime'
            );
            await openSettings(page);
            await openSettingsSection(page, 'playback');
            await page.getByTestId('select-video-player').click();
            await page.getByTestId('embedded-mpv').click();
            await saveSettings(page);
            await goToDashboard(page);
            await addXtreamPortal(page, {
                ...credentials,
                name: sourceName,
                serverUrl: `http://127.0.0.1:${address.port}`,
            });
            await waitForXtreamImportToFinish(page);
            const playlistId = await page.evaluate(
                async (name) =>
                    (await window.electron.dbGetAppPlaylistMetas()).find(
                        (p) => p.title === name
                    )?._id,
                sourceName
            );
            if (!playlistId)
                throw new Error('Synthetic Xtream playlist not found');
            await page.evaluate(
                async ({
                    id,
                    movieId,
                    episodeId,
                    watchedEpisodeId,
                    seriesId,
                }) => {
                    await window.electron.dbSavePlaybackPosition(id, {
                        contentType: 'vod',
                        contentXtreamId: movieId,
                        positionSeconds: 18,
                        durationSeconds: 60,
                    });
                    await window.electron.dbSavePlaybackPosition(id, {
                        contentType: 'episode',
                        contentXtreamId: episodeId,
                        seriesXtreamId: seriesId,
                        seasonNumber: 1,
                        episodeNumber: 1,
                        positionSeconds: 23,
                        durationSeconds: 60,
                    });
                    await window.electron.dbSavePlaybackPosition(id, {
                        contentType: 'episode',
                        contentXtreamId: watchedEpisodeId,
                        seriesXtreamId: seriesId,
                        seasonNumber: 1,
                        episodeNumber: 2,
                        positionSeconds: 60,
                        durationSeconds: 60,
                    });
                },
                {
                    id: playlistId,
                    movieId,
                    episodeId,
                    watchedEpisodeId: Number(watchedEpisode.id),
                    seriesId,
                }
            );

            await page.evaluate(
                async ({ playlistId, movieId, seriesId }) => {
                    const movie = await window.electron.dbGetContentByXtreamId(
                        movieId,
                        playlistId,
                        'movie'
                    );
                    const series = await window.electron.dbGetContentByXtreamId(
                        seriesId,
                        playlistId,
                        'series'
                    );
                    if (!movie || !series)
                        throw new Error('Missing synthetic catalog rows');
                    await window.electron.dbAddRecentItem(movie.id, playlistId);
                    await window.electron.dbAddRecentItem(
                        series.id,
                        playlistId
                    );
                    await window.electron.dbAddFavorite(movie.id, playlistId);
                    await window.electron.dbAddFavorite(series.id, playlistId);
                },
                { playlistId, movieId, seriesId }
            );
            await goToDashboard(page);
            await addStalkerPortal(page, {
                name: stalkerName,
                portalUrl: `http://127.0.0.1:${address.port}/portal.php`,
            });
            await goToDashboard(page);
            await installEmbeddedMpvSessionCapture(app);
            const playlist = join(dataDir, 'synthetic-primary.m3u');
            writeFileSync(
                playlist,
                `#EXTM3U\n#EXTINF:-1,${primaryName}\n${media.url}\n`
            );
            await importM3uPlaylistFromNativeDialog(app, playlist);
            await channelItemByTitle(page, primaryName).click();
            const slot = (number: number) =>
                page.locator(`[data-multiview-slot="${number}"]`);
            const canvas = (number: number) =>
                slot(number).locator('canvas[data-embedded-mpv-frame]');
            const main = slot(1);
            const companion = canvas(2);
            const picker = page.getByRole('dialog', {
                name: /^Choose a stream for window [234]$/,
            });
            const openStreams = page.locator('.second-stream__strip');
            const multiview = page.getByRole('button', {
                name: 'Multiview',
                exact: true,
            });
            const addFromDock = async () => {
                await main.hover();
                await multiview.click();
                await page
                    .getByRole('menuitem', { name: 'Add stream' })
                    .click();
            };
            const addAnother = openStreams.getByRole('button', {
                name: 'Add stream',
                exact: true,
            });
            const exitMultiview = openStreams.getByRole('button', {
                name: 'Exit multiview, keeping window 1',
            });
            const tile = page.getByRole('group', {
                name: 'Small view',
                exact: true,
            });
            const selectSource = () =>
                picker
                    .getByLabel('Playlist', { exact: true })
                    .selectOption({ label: sourceName });
            const assertResume = async (
                video: Locator,
                minimum: number,
                previousId?: string
            ) => {
                await expect(picker).toBeHidden();
                await expect(video).toBeVisible();
                await expect(video).toHaveAttribute('data-session-id', /.+/);
                if (previousId)
                    await expect(video).not.toHaveAttribute(
                        'data-session-id',
                        previousId
                    );
                const id = await video.getAttribute('data-session-id');
                if (!id) throw new Error('Missing companion session');
                await expect
                    .poll(
                        async () =>
                            (await getLatestSession(app, id))?.positionSeconds
                    )
                    .toBeGreaterThanOrEqual(minimum);
                return id;
            };
            const pauseAndSeek = async (number: number, id: string) => {
                await openStreams
                    .locator(`[data-multiview-control="${number}"]`)
                    .click();
                await canvas(number).hover();
                await slot(number)
                    .getByRole('button', { name: 'Pause', exact: true })
                    .click();
                await expect
                    .poll(async () => (await getLatestSession(app, id))?.status)
                    .toBe('paused');
                const before = (await getLatestSession(app, id))
                    ?.positionSeconds;
                ok(before !== undefined);
                await slot(number)
                    .getByRole('button', { name: 'Forward 10 seconds' })
                    .click();
                await expect
                    .poll(
                        async () =>
                            (await getLatestSession(app, id))?.positionSeconds
                    )
                    .toBeGreaterThanOrEqual(before + 9);
                const after = (await getLatestSession(app, id))
                    ?.positionSeconds;
                ok(after !== undefined);
                return after;
            };
            const firstPosition = (id: string) =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions?.find(
                            (sample) =>
                                sample.id === id && sample.positionSeconds > 0
                        )?.positionSeconds,
                    id
                );

            await expect(openStreams).toHaveCount(0);
            await addFromDock();
            await expect(openStreams).toHaveCount(0);
            await picker
                .getByLabel('Playlist', { exact: true })
                .selectOption({ label: 'synthetic-primary' });
            const primaryRow = picker.getByRole('button', {
                name: /Synthetic primary.*open in window 1/,
            });
            await expect(primaryRow).toBeDisabled();
            await primaryRow.press('Enter');
            await expect(picker).toBeVisible();
            await picker
                .getByLabel('Playlist', { exact: true })
                .selectOption({ label: 'Recently viewed' });
            await picker
                .getByRole('button', { name: 'Movies', exact: true })
                .click();
            await expect(
                picker.getByRole('button').filter({
                    has: page.getByText(movieTitle, { exact: true }),
                })
            ).toBeVisible();
            await expect(
                picker.locator('.picker__poster img').first()
            ).toBeVisible();
            await picker
                .getByRole('button', { name: 'Series', exact: true })
                .click();
            await expect(
                picker.getByRole('button').filter({
                    has: page.getByText(seriesTitle, { exact: true }),
                })
            ).toBeVisible();
            await expect(
                picker.getByRole('button').filter({
                    has: page.getByText(movieTitle, { exact: true }),
                })
            ).toHaveCount(0);
            await picker
                .getByLabel('Playlist', { exact: true })
                .selectOption('');
            await picker
                .getByRole('button', { name: 'Series', exact: true })
                .click();
            const favoriteSeries = picker.getByRole('button').filter({
                has: page.getByText(seriesTitle, { exact: true }),
            });
            await expect(
                favoriteSeries.locator('.picker__poster img')
            ).toBeVisible();
            await expect
                .poll(() =>
                    favoriteSeries
                        .locator('img')
                        .evaluate(
                            (image: HTMLImageElement) => image.naturalWidth
                        )
                )
                .toBeGreaterThan(0);
            await expect(favoriteSeries).toContainText(sourceName);
            const movieRow = picker.getByRole('button').filter({
                has: page.getByText(movieTitle, { exact: true }),
            });
            const showMovies = async () => {
                await selectSource();
                await picker
                    .getByRole('button', { name: 'Movies', exact: true })
                    .click();
            };
            const chooseMovie = async () => {
                await showMovies();
                await movieRow.click();
            };
            await chooseMovie();
            const movieSessionId = await assertResume(companion, 17);
            await openStreams
                .getByRole('button', { name: 'Side by side' })
                .click();
            await expect(companion).toHaveAttribute(
                'data-session-id',
                movieSessionId
            );
            const movieAt = await pauseAndSeek(2, movieSessionId);
            await addAnother.click();
            await expect(
                openStreams.getByText(primaryName, { exact: true })
            ).toBeVisible();
            await expect(
                openStreams.getByText(movieTitle, { exact: true })
            ).toBeVisible();
            await showMovies();
            await expect(movieRow).toBeDisabled();
            await expect(movieRow).toContainText('already open in window 2');
            await expectTextContrast(movieRow.locator('.picker__opened'));
            await movieRow.press('Enter');
            await expect(picker).toBeVisible();
            await expect(canvas(3)).toHaveCount(0);
            const episodeRow = picker.getByRole('button').filter({
                has: page.getByText(episodeTitle, { exact: true }),
            });
            const chooseSeries = async () => {
                await selectSource();
                await picker
                    .getByRole('button', { name: 'Series', exact: true })
                    .click();
                await picker
                    .getByRole('button', {
                        name: seriesTitle,
                        exact: true,
                    })
                    .click();
            };
            await chooseSeries();
            await expect(episodeRow).toBeVisible();
            const watchedRow = picker.locator(
                `[data-episode-id="${watchedEpisode.id}"]`
            );
            await expect(
                watchedRow.locator('.picker__episode-watched')
            ).toBeVisible();
            await expect(watchedRow.locator('.picker__progress')).toHaveCount(
                0
            );
            await expect(
                watchedRow.locator('.picker__episode-thumb img')
            ).toHaveCount(0);
            await expect(episodeRow.locator('.picker__progress')).toBeVisible();
            await expect(
                episodeRow.locator('.picker__episode-thumb img')
            ).toBeVisible();
            await expect
                .poll(() =>
                    episodeRow
                        .locator('img')
                        .evaluate(
                            (image: HTMLImageElement) => image.naturalWidth
                        )
                )
                .toBeGreaterThan(0);
            await expect(
                picker.getByText('Episode 3', { exact: true }).first()
            ).toBeVisible();
            const originalViewport = page.viewportSize();
            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(page, theme);
                await expectTextContrast(
                    picker.locator('.picker__vod-text strong').first()
                );
                await expectTextContrast(openStreams.locator('li').first());
                await page.screenshot({
                    path: testInfo.outputPath(
                        `second-stream-episodes-${theme}.png`
                    ),
                });
                await page.setViewportSize({ width: 390, height: 760 });
                await expect(episodeRow).toBeVisible();
                await expectTextContrast(
                    episodeRow.locator('.picker__vod-text strong')
                );
                await expect
                    .poll(() =>
                        picker.evaluate(
                            (element) =>
                                element.scrollWidth <= element.clientWidth
                        )
                    )
                    .toBe(true);
                await picker.screenshot({
                    path: testInfo.outputPath(
                        `second-stream-episodes-narrow-${theme}.png`
                    ),
                });
                await page.setViewportSize(
                    originalViewport ?? { width: 1280, height: 720 }
                );
            }
            await picker
                .getByRole('button', { name: 'Back', exact: true })
                .click();
            const seriesRow = picker.getByRole('button', {
                name: seriesTitle,
                exact: true,
            });
            await expect(picker.getByRole('searchbox')).toBeFocused();
            await seriesRow.focus();
            await seriesRow.press('Enter');
            await expect(episodeRow).toBeVisible();
            await episodeRow.focus();
            await episodeRow.press('Space');
            const episodeSessionId = await assertResume(canvas(3), 22);
            await expect(
                openStreams.getByRole('button', { name: '2×2 grid' })
            ).toHaveAttribute('aria-pressed', 'true');
            const episodeAt = await pauseAndSeek(3, episodeSessionId);
            await addAnother.click();
            await chooseSeries();
            await expect(episodeRow).toBeDisabled();
            await expect(episodeRow).toContainText('already open in window 3');
            await expect(watchedRow).toBeEnabled();
            await page.setViewportSize({ width: 390, height: 760 });
            const occupiedLabel = episodeRow.locator('.picker__opened');
            await expectTextContrast(occupiedLabel);
            expect(
                await occupiedLabel.evaluate(
                    (label) => label.scrollWidth <= label.clientWidth
                )
            ).toBe(true);
            await picker.screenshot({
                path: testInfo.outputPath('second-stream-open-episode.png'),
            });
            await page.setViewportSize(
                originalViewport ?? { width: 1280, height: 720 }
            );
            await episodeRow.press('Space');
            await expect(picker).toBeVisible();
            await expect(canvas(4)).toHaveCount(0);
            await picker.press('Escape');
            await expect(picker).toBeHidden();
            await expect(companion).toHaveAttribute(
                'data-session-id',
                movieSessionId
            );
            expect(await getLatestSession(app, movieSessionId)).toMatchObject({
                status: 'paused',
                positionSeconds: movieAt,
            });
            const original = canvas(1);
            const originalSessionId =
                await original.getAttribute('data-session-id');
            if (!originalSessionId) throw new Error('Missing original session');
            await exitMultiview.click();
            await expect(companion).toHaveCount(0);
            await expect(canvas(3)).toHaveCount(0);
            await expect(openStreams).toHaveCount(0);
            await expect(original).toHaveAttribute(
                'data-session-id',
                originalSessionId
            );
            const position = (id: number, type: 'vod' | 'episode') =>
                page.evaluate(
                    ({ playlistId, id, type }) =>
                        window.electron.dbGetPlaybackPosition(
                            playlistId,
                            id,
                            type
                        ),
                    { playlistId, id, type }
                );
            await expect
                .poll(
                    async () =>
                        (await position(movieId, 'vod'))?.positionSeconds
                )
                .toBeGreaterThanOrEqual(movieAt - 1);
            await expect
                .poll(
                    async () =>
                        (await position(episodeId, 'episode'))?.positionSeconds
                )
                .toBeGreaterThanOrEqual(episodeAt - 1);
            expect(await position(episodeId, 'episode')).toMatchObject({
                seriesXtreamId: seriesId,
                seasonNumber: 1,
                episodeNumber: 1,
            });

            const movieSaved = (await position(movieId, 'vod'))
                ?.positionSeconds;
            const episodeSaved = (await position(episodeId, 'episode'))
                ?.positionSeconds;
            ok(movieSaved !== undefined && episodeSaved !== undefined);
            await addFromDock();
            await chooseMovie();
            const movieReopened = await assertResume(
                companion,
                movieSaved - 1,
                movieSessionId
            );
            expect(await firstPosition(movieReopened)).toBeGreaterThanOrEqual(
                movieSaved - 1
            );
            await addAnother.click();
            await chooseSeries();
            await episodeRow.click();
            const episodeReopened = await assertResume(
                canvas(3),
                episodeSaved - 1,
                episodeSessionId
            );
            expect(await firstPosition(episodeReopened)).toBeGreaterThanOrEqual(
                episodeSaved - 1
            );
            await exitMultiview.click();
            await expect
                .poll(
                    async () =>
                        (await getLatestSession(app, episodeReopened))?.status
                )
                .toBe('closed');
            expect(
                (await position(movieId, 'vod'))?.positionSeconds
            ).toBeGreaterThanOrEqual(movieSaved - 1);
            expect(
                (await position(episodeId, 'episode'))?.positionSeconds
            ).toBeGreaterThanOrEqual(episodeSaved - 1);

            await addFromDock();
            const source = picker.getByLabel('Playlist', { exact: true });
            await source.selectOption({ label: stalkerName });
            await picker
                .getByRole('button', { name: 'Movies', exact: true })
                .click();
            const stalkerMovie = stalkerMovies[0].name;
            if (!stalkerMovie)
                throw new Error('Missing synthetic Stalker movie');
            await picker.getByRole('searchbox').fill(stalkerMovie);
            await picker
                .getByRole('button', { name: stalkerMovie, exact: true })
                .click();
            const stalkerMovieSession = await assertResume(companion, 3);
            await tile.hover();
            await tile
                .getByRole('button', { name: 'Change second stream' })
                .click();
            await source.selectOption({ label: 'Recently viewed' });
            await picker
                .getByRole('button', { name: 'Movies', exact: true })
                .click();
            await expect(
                picker.getByRole('button').filter({
                    has: page.getByText(stalkerMovie, { exact: true }),
                })
            ).toBeVisible();
            await source.selectOption({ label: stalkerName });
            await picker
                .getByRole('button', { name: 'Series', exact: true })
                .click();
            const stalkerShow = stalkerSeries[0].name;
            if (!stalkerShow)
                throw new Error('Missing synthetic Stalker series');
            await picker.getByRole('searchbox').fill(stalkerShow);
            await picker
                .getByRole('button', { name: stalkerShow, exact: true })
                .click();
            await picker.locator('.picker__vod-row').first().click();
            await assertResume(companion, 2, stalkerMovieSession);
        } finally {
            await closeElectronApp(app);
        }
    } finally {
        portal.closeAllConnections();
        await new Promise<void>((resolve) => portal.close(() => resolve()));
        await media.close();
    }
});
