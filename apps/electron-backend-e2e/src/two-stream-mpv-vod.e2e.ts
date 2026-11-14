import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
    installEmbeddedMpvSessionCapture,
} from './embedded-mpv-frame-copy-packaged-fixtures';
import {
    fetchStalkerCategoryFixture,
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
    getXtreamTitle,
} from './portal-mock-fixtures';
import { applyTheme, expectTextContrast } from './theme-contrast';

const credentials = { username: 'minimal', password: 'minimal' };
const sourceName = 'Synthetic Xtream';
const stalkerName = 'Synthetic Stalker';
const primaryName = 'Synthetic primary';

test('@playback @xtream @stalker @electron second-stream VOD, history and positions', async ({
    dataDir,
    request,
}, testInfo) => {
    test.setTimeout(100_000);
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
        const stalker =
            url.pathname === '/portal.php' ||
            url.pathname.endsWith('/server/load.php');
        if (stalker && url.searchParams.get('action') === 'create_link') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ js: { cmd: media.url } }));
            return;
        }
        const upstream = stalker
            ? new URL(`/portal.php${url.search}`, stalkerMockServer)
            : url;
        if (/^\/(movie|series)\//.test(url.pathname)) {
            res.writeHead(302, { Location: media.url }).end();
            return;
        }
        try {
            const headers = Object.fromEntries(
                Object.entries(req.headers).filter(
                    ([key, value]) =>
                        key !== 'host' && typeof value === 'string'
                )
            ) as Record<string, string>;
            const response = await fetch(upstream, { headers });
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
                async ({ id, movieId, episodeId, seriesId }) => {
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
                },
                { id: playlistId, movieId, episodeId, seriesId }
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
            const main = page.locator(
                '.embedded-mpv-pair > app-embedded-mpv-player'
            );
            const companion = page.locator(
                'app-second-stream canvas[data-embedded-mpv-frame]'
            );
            const picker = page.getByRole('dialog', {
                name: 'Choose a second stream',
            });
            const openStreams = page.locator('ul.second-stream__strip');
            const tile = page.getByRole('group', {
                name: 'Small view',
                exact: true,
            });
            const selectSource = () =>
                picker
                    .getByLabel('Playlist', { exact: true })
                    .selectOption({ label: sourceName });
            const assertResume = async (
                minimum: number,
                previousId?: string
            ) => {
                await expect(picker).toBeHidden();
                await expect(companion).toBeVisible();
                await expect(companion).toHaveAttribute(
                    'data-session-id',
                    /.+/
                );
                if (previousId)
                    await expect(companion).not.toHaveAttribute(
                        'data-session-id',
                        previousId
                    );
                const id = await companion.getAttribute('data-session-id');
                if (!id) throw new Error('Missing companion session');
                await expect
                    .poll(
                        () =>
                            page.evaluate(
                                (id) =>
                                    window.__packagedEmbeddedMpvSessions
                                        ?.filter((s) => s.id === id)
                                        .at(-1)?.positionSeconds ?? 0,
                                id
                            ),
                        { timeout: 10_000 }
                    )
                    .toBeGreaterThanOrEqual(minimum);
                return id;
            };
            const seek = async (id: string, seconds: number) => {
                await page.evaluate(
                    ({ id, seconds }) =>
                        window.electron.seekEmbeddedMpv(id, seconds),
                    { id, seconds }
                );
                await expect
                    .poll(() =>
                        page.evaluate(
                            (id) =>
                                window.__packagedEmbeddedMpvSessions
                                    ?.filter((s) => s.id === id)
                                    .at(-1)?.positionSeconds ?? 0,
                            id
                        )
                    )
                    .toBeGreaterThanOrEqual(seconds - 1);
            };

            await expect(openStreams.locator('li')).toHaveCount(1);
            await expect
                .poll(async () => {
                    const video = await main.boundingBox();
                    const strip = await openStreams.boundingBox();
                    if (!video || !strip) return -Infinity;
                    return strip.y - (video.y + video.height);
                })
                .toBeGreaterThanOrEqual(-1);
            await main.hover();
            await page
                .getByTestId('player-controls-second-stream-button')
                .click();
            await expect(
                openStreams.getByText(primaryName, { exact: true })
            ).toBeVisible();
            await picker
                .getByLabel('Playlist', { exact: true })
                .selectOption({ label: 'Recently viewed' });
            await picker
                .getByRole('button', { name: 'Movies', exact: true })
                .click();
            await expect(
                picker.getByRole('button').filter({
                    has: page.getByText(getXtreamTitle(movie), { exact: true }),
                })
            ).toBeVisible();
            await picker
                .getByRole('button', { name: 'Series', exact: true })
                .click();
            await expect(
                picker.getByRole('button').filter({
                    has: page.getByText(getXtreamTitle(show), { exact: true }),
                })
            ).toBeVisible();
            await expect(
                picker.getByRole('button').filter({
                    has: page.getByText(getXtreamTitle(movie), { exact: true }),
                })
            ).toHaveCount(0);
            await selectSource();
            await picker
                .getByRole('button', { name: 'Movies', exact: true })
                .click();
            const movieTitle = getXtreamTitle(movie);
            const movieRow = picker.getByRole('button', {
                name: movieTitle,
                exact: true,
            });
            await expect(movieRow).toBeVisible();
            await movieRow.click();
            const movieSessionId = await assertResume(17);
            await seek(movieSessionId, 34);

            await tile.hover();
            await tile
                .getByRole('button', { name: 'Change second stream' })
                .click();
            await expect(
                openStreams.getByText(primaryName, { exact: true })
            ).toBeVisible();
            await expect(
                openStreams.getByText(movieTitle, { exact: true })
            ).toBeVisible();
            await selectSource();
            await picker
                .getByRole('button', { name: 'Series', exact: true })
                .click();
            await picker
                .getByRole('button', {
                    name: getXtreamTitle(show),
                    exact: true,
                })
                .click();
            const episodeRow = picker.getByRole('button').filter({
                has: page.getByText(episode.title, { exact: true }),
            });
            await expect(episodeRow).toBeVisible();
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
            }
            await episodeRow.click();
            const episodeSessionId = await assertResume(22, movieSessionId);
            await seek(episodeSessionId, 38);
            await tile.hover();
            await tile
                .getByRole('button', { name: 'Close second stream and return' })
                .click();
            await expect(companion).toHaveCount(0);
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
                .toBeGreaterThanOrEqual(33);
            await expect
                .poll(
                    async () =>
                        (await position(episodeId, 'episode'))?.positionSeconds
                )
                .toBeGreaterThanOrEqual(37);
            expect(await position(episodeId, 'episode')).toMatchObject({
                seriesXtreamId: seriesId,
                seasonNumber: 1,
                episodeNumber: 1,
            });

            await main.hover();
            await page
                .getByTestId('player-controls-second-stream-button')
                .click();
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
            const stalkerMovieSession = await assertResume(3);
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
            await assertResume(2, stalkerMovieSession);
        } finally {
            await closeElectronApp(app);
        }
    } finally {
        portal.closeAllConnections();
        await new Promise<void>((resolve) => portal.close(() => resolve()));
        await media.close();
    }
});
