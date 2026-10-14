import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    DEFAULT_PASSWORD,
    DEFAULT_USERNAME,
    interceptXtreamRequests,
    MOCK_SERVER,
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
        page.on('request', (request) => {
            if (
                new URL(request.url()).searchParams.get('action') ===
                'get_vod_info'
            )
                detailRequests++;
        });
        await page.route('**/localhost:3000/xtream**', async (route) => {
            const original = new URL(route.request().url());
            if (original.searchParams.get('action') !== 'get_vod_streams') {
                await route.fallback();
                return;
            }
            const mockUrl = new URL(`${MOCK_SERVER}/xtream`);
            original.searchParams.forEach((value, key) => {
                if (key !== 'targetId') mockUrl.searchParams.set(key, value);
            });
            const response = await route.fetch({ url: mockUrl.toString() });
            const body = (await response.json()) as {
                payload: Record<string, unknown>[];
            };
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
        ).toEqual([favorite]);
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

test('@xtream @collections PWA retries retain saved favorite metadata when snapshot storage is full', async ({
    page,
}) => {
    await addXtreamPortal(page, { name: 'Pending Favorites Portal' });
    const playlistPath = new URL(page.url()).pathname.replace(/\/vod.*$/, '');
    const rawId = playlistPath.split('/').pop();
    if (!rawId) throw new Error('Missing playlist ID in the portal route');
    const playlistId = decodeURIComponent(rawId);
    const favorite = {
        contentType: 'movie',
        xtreamId: 987654,
        addedAt: '2026-01-02T12:00:00.000Z',
        position: 3,
        snapshot: {
            title: 'Saved offline movie',
            posterUrl: '/assets/icons/icon-192x192.png',
            tmdbId: 949,
            releaseYear: 1995,
        },
    };
    await page.goto('/');
    await page.evaluate(
        ({ playlistId, favorite }) => {
            localStorage.setItem(
                `xtream-restore-${playlistId}`,
                JSON.stringify({
                    hiddenCategories: [],
                    favorites: [favorite],
                    recentlyViewed: [],
                    playbackPositions: [],
                })
            );
            sessionStorage.setItem('block-favorite-snapshot', '1');
        },
        { playlistId, favorite }
    );
    await page.addInitScript(() => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (this: Storage, key, value) {
            if (
                this === localStorage &&
                key === 'xtream-collection-items' &&
                sessionStorage.getItem('block-favorite-snapshot') === '1'
            ) {
                sessionStorage.setItem('favorite-snapshot-attempted', '1');
                throw new DOMException('full', 'QuotaExceededError');
            }
            return setItem.call(this, key, value);
        };
    });
    await page.goto(`${playlistPath}/vod`);
    await expect
        .poll(() =>
            page.evaluate(() =>
                sessionStorage.getItem('favorite-snapshot-attempted')
            )
        )
        .toBe('1');
    expect(
        await page.evaluate(
            (id) => localStorage.getItem(`xtream-restore-${id}`),
            playlistId
        )
    ).not.toBeNull();
    await page.evaluate(() =>
        sessionStorage.removeItem('block-favorite-snapshot')
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
    await page.goto(`${playlistPath}/favorites`);
    await expect(
        page.getByText(favorite.snapshot.title, { exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(
        page.getByText(favorite.snapshot.title, { exact: true })
    ).toBeVisible();
    expect(
        await page.evaluate(
            (id) =>
                JSON.parse(
                    localStorage.getItem('xtream-collection-items') ?? '{}'
                )[id]?.['movie:987654'],
            playlistId
        )
    ).toMatchObject({
        title: favorite.snapshot.title,
        poster_url: favorite.snapshot.posterUrl,
        tmdb_id: 949,
        release_year: 1995,
        added_at: favorite.addedAt,
        position: 3,
    });
});
