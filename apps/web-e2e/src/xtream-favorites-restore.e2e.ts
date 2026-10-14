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

test('@xtream @collections catalog browsing preserves imported favorite metadata after reload', async ({
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
    await addXtreamPortal(page, { name: 'Saved Metadata Portal' });
    const playlistPath = new URL(page.url()).pathname.replace(/\/vod.*$/, '');
    const rawId = playlistPath.split('/').pop();
    if (!rawId) throw new Error('Missing playlist ID in the portal route');
    const playlistId = decodeURIComponent(rawId);
    const favorite = {
        contentType: 'movie',
        xtreamId: movie.stream_id,
        addedAt: '2026-01-02T12:00:00.000Z',
        position: 3,
        snapshot: {
            title: movie.name,
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
                    recentlyViewed: [],
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
    await page.getByRole('link', { name: 'Global favorites', exact: true }).click();
    await expect(
        page.getByText(movie.name, { exact: true }).first()
    ).toBeVisible();
    await page.reload();
    await expect(
        page.getByText(movie.name, { exact: true }).first()
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
        tmdb_id: 949,
        release_year: 1995,
        original_title: 'Saved original title',
        added_at: favorite.addedAt,
        position: 3,
    });
});

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
