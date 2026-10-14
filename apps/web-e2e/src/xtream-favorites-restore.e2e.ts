import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    DEFAULT_PASSWORD,
    DEFAULT_USERNAME,
    interceptXtreamRequests,
    MOCK_SERVER,
    routeMovieClip,
    selectWebPlayer,
} from './xtream-series-playback.fixture';

test.beforeEach(async ({ page, request }) => {
    await request.post(`${MOCK_SERVER}/reset`);
    await page.goto('/');
    await interceptXtreamRequests(page);
});

for (const identity of ['missing', 'conflicting'] as const) {
    test(`@xtream @collections ${identity} catalog identity preserves saved favorites through reload and export`, async ({
        page,
        request,
    }) => {
        test.setTimeout(60_000);
        if (identity === 'conflicting') {
            await routeMovieClip(page);
            await selectWebPlayer(page, 'HTML5 video player');
        }
        const response = await request.get(`${MOCK_SERVER}/player_api.php`, {
            params: {
                username: DEFAULT_USERNAME,
                password: DEFAULT_PASSWORD,
                action: 'get_vod_streams',
            },
        });
        expect(response.ok()).toBeTruthy();
        const movie = (await response.json())[0];
        let detailRequests = 0;
        let catalogOffline = false;
        page.on('request', (request) => {
            if (
                new URL(request.url()).searchParams.get('action') ===
                'get_vod_info'
            )
                detailRequests++;
        });
        await page.route('**/localhost:3000/xtream**', async (route) => {
            const original = new URL(route.request().url());
            const action = original.searchParams.get('action');
            if (
                action !== 'get_vod_streams' &&
                !(action === 'get_vod_info' && identity === 'conflicting')
            ) {
                await route.fallback();
                return;
            }
            if (catalogOffline && action === 'get_vod_streams') {
                await route.abort();
                return;
            }
            const mockUrl = new URL(`${MOCK_SERVER}/xtream`);
            original.searchParams.forEach((value, key) => {
                if (key !== 'targetId') mockUrl.searchParams.set(key, value);
            });
            const response = await route.fetch({ url: mockUrl.toString() });
            const body = await response.json();
            if (action === 'get_vod_info') {
                // Give the local WebM bytes to Chromium's native media path.
                body.payload.movie_data.container_extension = 'mp4';
                Object.assign(body.payload.info, {
                    tmdb_id: 999,
                    releasedate: '2026-01-01',
                });
                await route.fulfill({ response, json: body });
                return;
            }
            for (const item of body.payload) {
                delete item['tmdb_id'];
                delete item['release_year'];
                if (identity === 'conflicting') {
                    item['tmdb_id'] = 999;
                    item['release_year'] = 2026;
                }
            }
            await route.fulfill({ response, json: body });
        });
        await addXtreamPortal(page, { name: 'Saved Metadata Portal' });
        const playlistPath = new URL(page.url()).pathname.replace(
            /\/vod.*$/,
            ''
        );
        const rawId = playlistPath.split('/').pop();
        if (!rawId) throw new Error('Missing playlist ID in the portal route');
        const playlistId = decodeURIComponent(rawId);
        const favorite = {
            contentType: 'movie',
            xtreamId: movie.stream_id,
            addedAt: '2026-01-02T12:00:00.000Z',
            position: 3,
            snapshot: {
                title: 'Saved original favorite',
                posterUrl: '/assets/icons/icon-192x192.png',
                tmdbId: 949,
                releaseYear: 1995,
                originalTitle: 'Saved original title',
            },
        };
        const exportedFavorite = {
            ...favorite,
            snapshot: {
                ...favorite.snapshot,
                ...(identity === 'conflicting'
                    ? {
                          catalogStatus: 'missing',
                          catalogMissingReason: 'identity_conflict',
                      }
                    : {}),
            },
        };
        await page.evaluate(
            ({ playlistId, favorite }) =>
                localStorage.setItem(
                    `xtream-restore-${playlistId}`,
                    JSON.stringify({
                        hiddenCategories: [],
                        favorites: [favorite],
                        recentlyViewed: [
                            {
                                contentType: favorite.contentType,
                                xtreamId: favorite.xtreamId,
                                viewedAt: '2026-01-02T12:00:00.000Z',
                            },
                        ],
                        playbackPositions: [],
                    })
                ),
            { playlistId, favorite }
        );
        await page.reload();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    playlistId
                )
            )
            .toBeNull();
        await page
            .locator(`[data-category-id="${movie.category_id}"]`)
            .first()
            .click();
        await expect(
            page.getByText(movie.name, { exact: true }).first()
        ).toBeVisible();
        // Keep the catalog in memory while opening Favorites, exercising the merge.
        await page
            .getByRole('link', { name: 'Global favorites', exact: true })
            .click();
        await expect(
            page.getByText(favorite.snapshot.title, { exact: true }).first()
        ).toBeVisible();
        await page.reload();
        await expect(
            page.getByText(favorite.snapshot.title, { exact: true }).first()
        ).toBeVisible();
        expect(
            await page.evaluate(
                ({ playlistId, key }) =>
                    JSON.parse(
                        localStorage.getItem('xtream-collection-items') ?? '{}'
                    )[playlistId]?.[key],
                { playlistId, key: `movie:${movie.stream_id}` }
            )
        ).toMatchObject({
            title: favorite.snapshot.title,
            poster_url: favorite.snapshot.posterUrl,
            tmdb_id: 949,
            release_year: 1995,
            original_title: 'Saved original title',
            added_at: favorite.addedAt,
            position: 3,
        });
        if (identity === 'conflicting') {
            const card = page.getByRole('button', {
                name: favorite.snapshot.title,
                exact: true,
            });
            await expect(card).toHaveAttribute('aria-disabled', 'true');
            await card.dispatchEvent('click');
            await card.focus();
            await page.keyboard.press('Enter');
            await expect(page.locator('app-content-hero')).toHaveCount(0);
            expect(detailRequests).toBe(0);
        }
        await page.goto('/workspace/settings/backup');
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        const downloaded = await (await downloadPromise).path();
        if (!downloaded) throw new Error('Backup download is missing');
        const backup = JSON.parse(await readFile(downloaded, 'utf8'));
        expect(
            backup.playlists.find(
                (entry: { exportedId: string }) =>
                    entry.exportedId === playlistId
            ).userState.favorites
        ).toEqual([exportedFavorite]);
        if (identity === 'conflicting') {
            await page.goto('/workspace/global-recent');
            const recent = page.getByRole('button', {
                name: favorite.snapshot.title,
                exact: true,
            });
            await expect(recent).toHaveAttribute('aria-disabled', 'true');
            await recent.dispatchEvent('click');
            await recent.focus();
            await page.keyboard.press('Enter');
            await expect(page.locator('app-content-hero')).toHaveCount(0);
            expect(detailRequests).toBe(0);
            // Opening the actual replacement from its catalog must not expose a
            // Remove heart that could delete the retained, incompatible favorite.
            await page.goto(`${playlistPath}/vod`);
            await page
                .locator(`[data-category-id="${movie.category_id}"]`)
                .first()
                .click();
            await page.getByText(movie.name, { exact: true }).first().click();
            const add = page
                .getByRole('button', { name: 'Add to favorites', exact: true })
                .first();
            await expect(add).toBeVisible();
            await add.click();
            await expect(
                page.getByText(
                    'This source replaced an item you saved. Remove the older entry from Favorites before adding this one.',
                    { exact: true }
                )
            ).toBeVisible();
            await expect(add).toBeVisible();
            await page
                .getByRole('button', { name: /^Play / })
                .first()
                .click();
            await expect
                .poll(() =>
                    page.evaluate(
                        (id) =>
                            JSON.parse(
                                localStorage.getItem('xtream-recent-items') ??
                                    '{}'
                            )[id]?.[0]?.collectionItem?.title,
                        playlistId
                    )
                )
                .toBe(movie.name);
            catalogOffline = true;
            await page.goto('/workspace/global-recent');
            await page.reload();
            const replacement = page.getByRole('button', {
                name: movie.name,
                exact: true,
            });
            await expect(replacement).toBeVisible();
            await expect(replacement).not.toHaveAttribute(
                'aria-disabled',
                'true'
            );
            await replacement.click();
            const coldDetailAdd = page
                .getByRole('button', { name: 'Add to favorites', exact: true })
                .first();
            await expect(coldDetailAdd).toBeVisible();
            await coldDetailAdd.click();
            await expect(
                page.getByText(
                    'This source replaced an item you saved. Remove the older entry from Favorites before adding this one.',
                    { exact: true }
                )
            ).toBeVisible();
            await expect(coldDetailAdd).toBeVisible();
            await page.goto('/workspace/settings/backup');
            const playedDownload = page.waitForEvent('download');
            await page
                .getByRole('button', { name: 'Export', exact: true })
                .click();
            const playedPath = await (await playedDownload).path();
            if (!playedPath) throw new Error('Played backup is missing');
            const playedEntry = JSON.parse(
                await readFile(playedPath, 'utf8')
            ).playlists.find(
                (entry: { exportedId: string }) =>
                    entry.exportedId === playlistId
            );
            expect(playedEntry.userState.favorites).toEqual([exportedFavorite]);
            expect(
                playedEntry.userState.recentlyViewed[0].collectionItem
            ).toMatchObject({ title: movie.name, tmdb_id: 999 });
            await page.goto('/workspace/global-favorites');
            const card = page
                .locator('app-content-card')
                .filter({ hasText: favorite.snapshot.title });
            await card
                .getByRole('button', {
                    name: 'Remove from favorites',
                    exact: true,
                })
                .click();
            await expect(card).toHaveCount(0);
            expect(
                await page.evaluate(
                    (id) =>
                        JSON.parse(
                            localStorage.getItem('xtream-favorites') ?? '{}'
                        )[id],
                    playlistId
                )
            ).toEqual([]);
        }
    });
}

test('@xtream @collections detail identity protects a sparse PWA favorite from a reused provider ID', async ({
    page,
    request,
}) => {
    const response = await request.get(`${MOCK_SERVER}/player_api.php`, {
        params: {
            username: DEFAULT_USERNAME,
            password: DEFAULT_PASSWORD,
            action: 'get_vod_streams',
        },
    });
    const movie = (await response.json())[0];
    let replaced = false;
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        const action = original.searchParams.get('action');
        if (action !== 'get_vod_streams' && action !== 'get_vod_info') {
            await route.fallback();
            return;
        }
        const url = new URL(`${MOCK_SERVER}/xtream`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') url.searchParams.set(key, value);
        });
        const response = await route.fetch({ url: url.toString() });
        const body = await response.json();
        if (action === 'get_vod_streams') {
            for (const item of body.payload) {
                delete item.tmdb_id;
                delete item.release_year;
                if (replaced && item.stream_id === movie.stream_id)
                    Object.assign(item, {
                        name: 'Reused provider entry',
                        tmdb_id: 999,
                        release_year: 2026,
                    });
            }
        } else {
            Object.assign(body.payload.info, {
                tmdb_id: 949,
                releasedate: '1995-12-15',
                o_name: 'Original detail identity',
            });
        }
        await route.fulfill({ response, json: body });
    });
    await addXtreamPortal(page, { name: 'Detail Identity Portal' });
    const rawId = new URL(page.url()).pathname
        .replace(/\/vod.*$/, '')
        .split('/')
        .pop();
    if (!rawId) throw new Error('Missing playlist ID');
    const playlistId = decodeURIComponent(rawId);
    await page
        .locator(`[data-category-id="${movie.category_id}"]`)
        .first()
        .click();
    await page.getByText(movie.name, { exact: true }).first().click();
    await page
        .getByRole('button', { name: 'Add to favorites', exact: true })
        .first()
        .click();
    await expect
        .poll(() =>
            page.evaluate(
                ({ playlistId, key }) =>
                    JSON.parse(
                        localStorage.getItem('xtream-collection-items') ?? '{}'
                    )[playlistId]?.[key]?.tmdb_id,
                { playlistId, key: `movie:${movie.stream_id}` }
            )
        )
        .toBe(949);
    replaced = true;
    await page.goto(`/workspace/xtreams/${rawId}/vod`);
    await page
        .locator(`[data-category-id="${movie.category_id}"]`)
        .first()
        .click();
    await expect(
        page.getByText('Reused provider entry', { exact: true }).first()
    ).toBeVisible();
    await page
        .getByRole('link', { name: 'Global favorites', exact: true })
        .click();
    const originalCard = page.getByRole('button', {
        name: movie.name,
        exact: true,
    });
    await expect(originalCard).toBeVisible();
    await expect(originalCard).toHaveAttribute('aria-disabled', 'true');
    await page.goto('/workspace/settings/backup');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const path = await (await download).path();
    if (!path) throw new Error('Backup download is missing');
    const entry = JSON.parse(await readFile(path, 'utf8')).playlists.find(
        (entry: { exportedId: string }) => entry.exportedId === playlistId
    );
    expect(entry.userState.favorites[0].snapshot).toMatchObject({
        title: movie.name,
        tmdbId: 949,
        releaseYear: 1995,
    });
});

test('@xtream @collections a cold Recent heart cannot remove a different saved favorite', async ({
    page,
}) => {
    await addXtreamPortal(page, { name: 'Cold Recent Portal' });
    const rawId = new URL(page.url()).pathname
        .replace(/\/vod.*$/, '')
        .split('/')
        .pop();
    if (!rawId) throw new Error('Missing playlist ID');
    const playlistId = decodeURIComponent(rawId);
    await page.evaluate((id) => {
        const original = {
            id: 42,
            xtream_id: 42,
            type: 'live',
            title: 'Original saved channel',
            poster_url: '',
            category_id: '1',
            tmdb_id: 100,
        };
        const replacement = {
            ...original,
            title: 'Viewed replacement channel',
            tmdb_id: 200,
        };
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ [id]: ['live:42'] })
        );
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({ [id]: { 'live:42': original } })
        );
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                [id]: [
                    {
                        id: 'live:42',
                        viewedAt: '2026-10-01T12:00:00.000Z',
                        collectionItem: replacement,
                    },
                ],
            })
        );
    }, playlistId);
    await page.goto('/workspace/global-recent');
    await page.reload();
    const recent = page
        .locator('app-channel-list-item')
        .filter({ hasText: 'Viewed replacement channel' });
    await expect(recent).toBeVisible();
    await recent.hover();
    const heart = recent.locator('.favorite-button');
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    await heart.click();
    await expect(
        page.getByText(
            'This source replaced an item you saved. Remove the older entry from Favorites before adding this one.',
            { exact: true }
        )
    ).toBeVisible();
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    expect(
        await page.evaluate(
            (id) =>
                JSON.parse(localStorage.getItem('xtream-favorites') ?? '{}')[
                    id
                ],
            playlistId
        )
    ).toEqual(['live:42']);
    await page.goto('/workspace/global-favorites');
    const original = page
        .locator('app-channel-list-item')
        .filter({ hasText: 'Original saved channel' });
    await expect(original).toBeVisible();
    await original.hover();
    await original.locator('.favorite-button').click();
    await expect(original).toHaveCount(0);
    await page.goto('/workspace/global-recent');
    await page.reload();
    await expect(recent).toBeVisible();
    await recent.hover();
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/workspace/global-favorites');
    await expect(
        page
            .locator('app-channel-list-item')
            .filter({ hasText: 'Viewed replacement channel' })
    ).toBeVisible();
    await expect(original).toHaveCount(0);
});

for (const collection of ['Recent', 'Favorites'] as const) {
    test(`@xtream @collections cold ${collection} details retain sparse identity for an explicit favorite save`, async ({
        page,
        request,
    }) => {
        const response = await request.get(`${MOCK_SERVER}/player_api.php`, {
            params: {
                username: DEFAULT_USERNAME,
                password: DEFAULT_PASSWORD,
                action: 'get_vod_streams',
            },
        });
        const movie = (await response.json())[0];
        let cold = false;
        await page.route('**/localhost:3000/xtream**', async (route) => {
            const original = new URL(route.request().url());
            const action = original.searchParams.get('action');
            if (cold && action === 'get_vod_streams') {
                await route.abort();
                return;
            }
            if (action !== 'get_vod_info') {
                await route.fallback();
                return;
            }
            const url = new URL(`${MOCK_SERVER}/xtream`);
            original.searchParams.forEach((value, key) => {
                if (key !== 'targetId') url.searchParams.set(key, value);
            });
            const response = await route.fetch({ url: url.toString() });
            const body = await response.json();
            Object.assign(body.payload.info, {
                tmdb_id: 949,
                releasedate: '1995-12-15',
            });
            await route.fulfill({ response, json: body });
        });
        await addXtreamPortal(page, { name: 'Cold Detail Metadata Portal' });
        const rawId = new URL(page.url()).pathname
            .replace(/\/vod.*$/, '')
            .split('/')
            .pop();
        if (!rawId) throw new Error('Missing playlist ID');
        const playlistId = decodeURIComponent(rawId);
        await page.evaluate(
            ({ id, movie, collection }) => {
                if (collection === 'Favorites') {
                    localStorage.setItem(
                        'xtream-favorites',
                        JSON.stringify({ [id]: [`movie:${movie.stream_id}`] })
                    );
                    localStorage.setItem(
                        'xtream-collection-items',
                        JSON.stringify({
                            [id]: {
                                [`movie:${movie.stream_id}`]: {
                                    id: movie.stream_id,
                                    xtream_id: movie.stream_id,
                                    type: 'movie',
                                    title: movie.name,
                                    poster_url: movie.stream_icon,
                                    category_id: movie.category_id,
                                },
                            },
                        })
                    );
                    localStorage.removeItem('xtream-recent-items');
                    return;
                }
                localStorage.setItem(
                    'xtream-recent-items',
                    JSON.stringify({
                        [id]: [
                            {
                                id: `movie:${movie.stream_id}`,
                                viewedAt: '2026-10-01T12:00:00.000Z',
                                collectionItem: {
                                    id: movie.stream_id,
                                    xtream_id: movie.stream_id,
                                    type: 'movie',
                                    title: movie.name,
                                    poster_url: movie.stream_icon,
                                    category_id: movie.category_id,
                                },
                            },
                        ],
                    })
                );
            },
            { id: playlistId, movie, collection }
        );
        cold = true;
        await page.goto(
            collection === 'Recent'
                ? '/workspace/global-recent'
                : '/workspace/global-favorites'
        );
        await page.reload();
        await page
            .locator('app-content-card')
            .filter({ hasText: movie.name })
            .first()
            .click();
        if (collection === 'Favorites') {
            const remove = page.getByRole('button', {
                name: 'Remove from favorites',
                exact: true,
            });
            await expect(remove).toBeVisible();
            await remove.click();
            await expect(remove).not.toBeVisible();
        }
        const heart = page.getByRole('button', {
            name: 'Add to favorites',
            exact: true,
        });
        await expect(heart).toBeVisible();
        await heart.click();
        await expect(
            page.getByRole('button', {
                name: 'Remove from favorites',
                exact: true,
            })
        ).toBeVisible();
        await page.reload();
        const saved = await page.evaluate(
            (id) => ({
                favorites: JSON.parse(
                    localStorage.getItem('xtream-collection-items') ?? '{}'
                )[id],
                recent: JSON.parse(
                    localStorage.getItem('xtream-recent-items') ?? '{}'
                )[id]?.[0],
            }),
            playlistId
        );
        expect(saved.favorites[`movie:${movie.stream_id}`]).toMatchObject({
            title: movie.name,
            tmdb_id: 949,
            release_year: 1995,
        });
        if (collection === 'Recent') {
            expect(saved.recent.viewedAt).toBe('2026-10-01T12:00:00.000Z');
            expect(saved.recent.collectionItem).toMatchObject({
                tmdb_id: 949,
                release_year: 1995,
            });
        } else {
            expect(saved.recent).toBeUndefined();
            await expect(
                page.getByRole('button', {
                    name: 'Remove from favorites',
                    exact: true,
                })
            ).toBeVisible();
            await page
                .getByRole('button', { name: 'Back', exact: true })
                .click();
            await expect(
                page
                    .locator('app-content-card')
                    .filter({ hasText: movie.name })
                    .first()
            ).toBeVisible();
        }
    });
}

test('@xtream @collections sparse favorite playback uses the current category while retaining saved metadata', async ({
    page,
    request,
}) => {
    await routeMovieClip(page);
    await selectWebPlayer(page, 'HTML5 video player');
    const response = await request.get(`${MOCK_SERVER}/player_api.php`, {
        params: {
            username: DEFAULT_USERNAME,
            password: DEFAULT_PASSWORD,
            action: 'get_vod_streams',
        },
    });
    const movie = (await response.json())[0];
    let detailOpened = false;
    const recoveryCategories: string[] = [];
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        const action = original.searchParams.get('action');
        if (action !== 'get_vod_streams' && action !== 'get_vod_info')
            return route.fallback();
        const url = new URL(`${MOCK_SERVER}/xtream`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') url.searchParams.set(key, value);
        });
        const response = await route.fetch({ url: url.toString() });
        const body = await response.json();
        if (action === 'get_vod_info') {
            detailOpened = true;
            delete body.payload.movie_data.stream_id;
            delete body.payload.movie_data.container_extension;
            Object.assign(body.payload.info, {
                tmdb_id: 949,
                releasedate: '1995-12-15',
            });
        } else {
            const category = original.searchParams.get('category_id');
            if (detailOpened && category) recoveryCategories.push(category);
            for (const item of body.payload) {
                delete item.tmdb_id;
                delete item.release_year;
                if (detailOpened && category === String(movie.category_id))
                    item.container_extension = 'mp4';
                else delete item.container_extension;
            }
        }
        await route.fulfill({ response, json: body });
    });
    await addXtreamPortal(page, { name: 'Sparse Category Portal' });
    const rawId = new URL(page.url()).pathname
        .replace(/\/vod.*$/, '')
        .split('/')
        .pop();
    if (!rawId) throw new Error('Missing playlist ID');
    const playlistId = decodeURIComponent(rawId);
    await page
        .locator(`[data-category-id="${movie.category_id}"]`)
        .first()
        .click();
    await expect(
        page.getByText(movie.name, { exact: true }).first()
    ).toBeVisible();
    await page.evaluate(
        ({ id, movie }) => {
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ [id]: [`movie:${movie.stream_id}`] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({
                    [id]: {
                        [`movie:${movie.stream_id}`]: {
                            id: movie.stream_id,
                            xtream_id: movie.stream_id,
                            type: 'movie',
                            title: 'Saved sparse favorite',
                            poster_url: movie.stream_icon,
                            category_id: '999999',
                            tmdb_id: 949,
                            release_year: 1995,
                        },
                    },
                })
            );
        },
        { id: playlistId, movie }
    );
    await page
        .getByRole('link', { name: 'Global favorites', exact: true })
        .click();
    await page
        .locator('app-content-card')
        .filter({ hasText: 'Saved sparse favorite' })
        .click();
    await expect
        .poll(() => recoveryCategories)
        .toContain(String(movie.category_id));
    await page
        .getByRole('button', { name: /^Play / })
        .first()
        .click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .first()
                .evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeGreaterThan(0);
});

test('@xtream @collections favoriting an unwatched replacement preserves shared Recent metadata and backup', async ({
    page,
    request,
}) => {
    const response = await request.get(`${MOCK_SERVER}/player_api.php`, {
        params: {
            username: DEFAULT_USERNAME,
            password: DEFAULT_PASSWORD,
            action: 'get_live_streams',
        },
    });
    const channel = (await response.json())[0];
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        if (original.searchParams.get('action') !== 'get_live_streams')
            return route.fallback();
        const url = new URL(`${MOCK_SERVER}/xtream`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') url.searchParams.set(key, value);
        });
        const response = await route.fetch({ url: url.toString() });
        const body = await response.json();
        for (const item of body.payload)
            if (item.stream_id === channel.stream_id) {
                item.name = 'Unwatched replacement channel';
                item.tmdb_id = 200;
            }
        await route.fulfill({ response, json: body });
    });
    await addXtreamPortal(page, { name: 'Unwatched Replacement Portal' });
    const playlistPath = new URL(page.url()).pathname.replace(/\/vod.*$/, '');
    const rawId = playlistPath.split('/').pop();
    if (!rawId) throw new Error('Missing playlist ID');
    const playlistId = decodeURIComponent(rawId);
    await page.evaluate(
        ({ id, channel }) => {
            const key = `live:${channel.stream_id}`;
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ [id]: [key] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({
                    [id]: {
                        [key]: {
                            id: channel.stream_id,
                            xtream_id: channel.stream_id,
                            type: 'live',
                            title: 'Watched original channel',
                            poster_url: '',
                            category_id: channel.category_id,
                            tmdb_id: 100,
                        },
                    },
                })
            );
            localStorage.setItem(
                'xtream-recent-items',
                JSON.stringify({
                    [id]: [{ id: key, viewedAt: '2026-10-01T12:00:00.000Z' }],
                })
            );
        },
        { id: playlistId, channel }
    );
    await page.goto('/workspace/global-favorites');
    const original = page
        .locator('app-channel-list-item')
        .filter({ hasText: 'Watched original channel' });
    await expect(original).toBeVisible();
    await original.hover();
    await original.locator('.favorite-button').click();
    await expect(original).toHaveCount(0);
    await page.goto(`${playlistPath}/live`);
    await page
        .locator(`[data-category-id="${channel.category_id}"]`)
        .first()
        .click();
    const replacement = page
        .locator('app-channel-list-item')
        .filter({ hasText: 'Unwatched replacement channel' });
    await expect(replacement).toBeVisible();
    await replacement.hover();
    await replacement.locator('.favorite-button').click();
    await expect(replacement.locator('.favorite-button')).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await page.goto('/workspace/global-recent');
    await page.reload();
    await expect(original).toBeVisible();
    await expect(replacement).toHaveCount(0);
    await page.goto('/workspace/settings/backup');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const path = await (await download).path();
    if (!path) throw new Error('Missing backup');
    const backup = JSON.parse(await readFile(path, 'utf8'));
    const state = backup.playlists.find(
        (entry: { exportedId: string }) => entry.exportedId === playlistId
    ).userState;
    expect(state.favorites[0].snapshot).toMatchObject({
        title: 'Unwatched replacement channel',
        tmdbId: 200,
    });
    expect(state.recentlyViewed[0]).toMatchObject({
        viewedAt: '2026-10-01T12:00:00.000Z',
        collectionItem: { title: 'Watched original channel', tmdb_id: 100 },
    });
});

test('@xtream @collections detail enrichment retains both category listings of one provider ID', async ({
    page,
    request,
}) => {
    let conflictingDuplicate = false;
    const params = { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD };
    const movies = await request.get(`${MOCK_SERVER}/player_api.php`, {
        params: { ...params, action: 'get_vod_streams' },
    });
    const movie = (await movies.json())[0];
    const categories = await request.get(`${MOCK_SERVER}/player_api.php`, {
        params: { ...params, action: 'get_vod_categories' },
    });
    const second = (await categories.json()).find(
        (category: { category_id: string }) =>
            String(category.category_id) !== String(movie.category_id)
    );
    if (!second) throw new Error('Missing second mock category');
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        const action = original.searchParams.get('action');
        if (action !== 'get_vod_streams' && action !== 'get_vod_info')
            return route.fallback();
        const url = new URL(`${MOCK_SERVER}/xtream`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') url.searchParams.set(key, value);
        });
        const response = await route.fetch({ url: url.toString() });
        const body = await response.json();
        if (action === 'get_vod_info') {
            Object.assign(body.payload.info, {
                tmdb_id: 949,
                releasedate: '1995-12-15',
            });
        } else {
            for (const item of body.payload)
                if (item.stream_id === movie.stream_id) item.tmdb_id = 949;
            const category = original.searchParams.get('category_id');
            if (!category || category === String(second.category_id))
                body.payload.push({
                    ...movie,
                    name: 'Duplicate category listing',
                    category_id: second.category_id,
                    tmdb_id: conflictingDuplicate ? 999 : 949,
                });
        }
        await route.fulfill({ response, json: body });
    });
    await addXtreamPortal(page, { name: 'Duplicate Categories Portal' });
    await page
        .locator(`[data-category-id="${movie.category_id}"]`)
        .first()
        .click();
    await page.getByText(movie.name, { exact: true }).first().click();
    await page
        .getByRole('button', { name: 'Add to favorites', exact: true })
        .click();
    await expect(
        page.getByRole('button', { name: 'Remove from favorites', exact: true })
    ).toBeVisible();
    await page.getByRole('link', { name: 'Movies', exact: true }).click();
    await page
        .locator(`[data-category-id="${movie.category_id}"]`)
        .first()
        .click();
    await expect(
        page.getByText(movie.name, { exact: true }).first()
    ).toBeVisible();
    await page
        .locator(`[data-category-id="${second.category_id}"]`)
        .first()
        .click();
    await expect(
        page.getByText('Duplicate category listing', { exact: true })
    ).toBeVisible();
    const savedTitle = await page.evaluate((id) => {
        const snapshots: Record<
            string,
            Record<string, { title: string }>
        > = JSON.parse(localStorage.getItem('xtream-collection-items') ?? '{}');
        return Object.values(snapshots)
            .map(
                (items: Record<string, { title: string }>) =>
                    items[`movie:${id}`]?.title
            )
            .find(Boolean);
    }, movie.stream_id);
    if (!savedTitle) throw new Error('Missing saved favorite');
    conflictingDuplicate = true;
    await page.reload();
    await expect(
        page.getByText('Duplicate category listing', { exact: true })
    ).toBeVisible();
    await page
        .getByRole('link', { name: 'Global favorites', exact: true })
        .click();
    const card = page.getByRole('button', { name: savedTitle, exact: true });
    await expect(card).not.toHaveAttribute('aria-disabled', 'true');
    await card.click();
    await expect(page.locator('app-content-hero')).toBeVisible();
    const remove = page.getByRole('button', {
        name: 'Remove from favorites',
        exact: true,
    });
    await expect(remove).toBeVisible();
    await remove.click();
    await page
        .getByRole('button', { name: 'Add to favorites', exact: true })
        .click();
    await expect(remove).toBeVisible();
    // The hero can render before the detail response rewrite finishes.
    await page.unrouteAll({ behavior: 'wait' });
});

test('@xtream @collections cold replacement playback records its own Recent identity', async ({
    page,
    request,
}) => {
    test.setTimeout(60_000);
    await routeMovieClip(page);
    await selectWebPlayer(page, 'HTML5 video player');
    const response = await request.get(`${MOCK_SERVER}/player_api.php`, {
        params: {
            username: DEFAULT_USERNAME,
            password: DEFAULT_PASSWORD,
            action: 'get_vod_streams',
        },
    });
    const movie = (await response.json())[0];
    let cold = false;
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        const action = original.searchParams.get('action');
        if (cold && action === 'get_vod_streams') return route.abort();
        if (action !== 'get_vod_info') return route.fallback();
        const url = new URL(`${MOCK_SERVER}/xtream`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') url.searchParams.set(key, value);
        });
        const response = await route.fetch({ url: url.toString() });
        const body = await response.json();
        Object.assign(body.payload.info, {
            tmdb_id: 200,
            releasedate: '2026-01-01',
            name: movie.name,
        });
        body.payload.movie_data.container_extension = 'mp4';
        await route.fulfill({ response, json: body });
    });
    await addXtreamPortal(page, { name: 'Cold Played Identity Portal' });
    const rawId = new URL(page.url()).pathname
        .replace(/\/vod.*$/, '')
        .split('/')
        .pop();
    if (!rawId) throw new Error('Missing playlist ID');
    const playlistId = decodeURIComponent(rawId);
    await page.evaluate(
        ({ id, movie }) => {
            const key = `movie:${movie.stream_id}`;
            const item = {
                id: movie.stream_id,
                xtream_id: movie.stream_id,
                type: 'movie',
                title: movie.name,
                poster_url: movie.stream_icon,
                category_id: movie.category_id,
                tmdb_id: 200,
            };
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ [id]: [key] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({ [id]: { [key]: item } })
            );
            localStorage.setItem(
                'xtream-recent-items',
                JSON.stringify({
                    [id]: [
                        {
                            id: key,
                            viewedAt: '2026-10-01T12:00:00.000Z',
                            collectionItem: {
                                ...item,
                                title: 'Previously watched original',
                                tmdb_id: 100,
                            },
                        },
                    ],
                })
            );
        },
        { id: playlistId, movie }
    );
    cold = true;
    await page.goto('/workspace/global-favorites');
    await page.reload();
    await page
        .locator('app-content-card')
        .filter({ hasText: movie.name })
        .first()
        .click();
    await page.getByRole('button', { name: /^Play / }).click();
    await expect
        .poll(() =>
            page.evaluate(
                (id) =>
                    JSON.parse(
                        localStorage.getItem('xtream-recent-items') ?? '{}'
                    )[id]?.[0]?.collectionItem?.tmdb_id,
                playlistId
            )
        )
        .toBe(200);
    await page.goto('/workspace/global-recent');
    await page.reload();
    await expect(
        page.locator('app-content-card').filter({ hasText: movie.name }).first()
    ).toBeVisible();
    await expect(
        page.getByText('Previously watched original', { exact: true })
    ).toHaveCount(0);
    await page.goto('/workspace/settings/backup');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const path = await (await download).path();
    if (!path) throw new Error('Missing backup');
    const backup = JSON.parse(await readFile(path, 'utf8'));
    const state = backup.playlists.find(
        (entry: { exportedId: string }) => entry.exportedId === playlistId
    ).userState;
    expect(state.favorites[0].snapshot).toMatchObject({
        title: movie.name,
        tmdbId: 200,
    });
    expect(state.recentlyViewed[0].collectionItem).toMatchObject({
        title: movie.name,
        tmdb_id: 200,
    });
    expect(state.recentlyViewed[0].viewedAt).not.toBe(
        '2026-10-01T12:00:00.000Z'
    );
    await page.unrouteAll({ behavior: 'wait' });
});
