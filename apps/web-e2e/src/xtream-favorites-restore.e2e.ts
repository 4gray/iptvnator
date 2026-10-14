import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';

test.beforeEach(async ({ page, request }) => {
    await request.post(`${MOCK_SERVER}/reset`);
    await page.goto('/');
    await interceptXtreamRequests(page);
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
