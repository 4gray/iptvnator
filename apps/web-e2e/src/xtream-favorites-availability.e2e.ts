import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { configureLiveFormat } from './xtream-live-format.fixture';
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

test('@xtream @collections absent saved items recover on sparse return without losing legacy backup identity', async ({
    page,
}) => {
    const loaded = new Set<string>();
    let detailRequests = 0;
    page.on('response', (response) => {
        const action = new URL(response.url()).searchParams.get('action');
        if (action && response.ok()) loaded.add(action);
    });
    page.on('request', (request) => {
        if (
            new URL(request.url()).searchParams.get('action') === 'get_vod_info'
        )
            detailRequests++;
    });
    await addXtreamPortal(page, { name: 'Absent Favorites Portal' });
    const playlistPath = new URL(page.url()).pathname.replace(/\/vod.*$/, '');
    const rawId = playlistPath.split('/').pop();
    if (!rawId) throw new Error('Missing playlist ID');
    const playlistId = decodeURIComponent(rawId);
    await page.evaluate((playlistId) => {
        const key = 'movie:99999';
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ [playlistId]: [key] })
        );
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                [playlistId]: [{ id: key, viewedAt: '2026-01-03' }],
            })
        );
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({
                [playlistId]: {
                    [key]: {
                        id: 99999,
                        xtream_id: 99999,
                        type: 'movie',
                        title: 'Saved absent favorite',
                        poster_url: '/assets/icons/icon-192x192.png',
                        tmdb_id: '949',
                        release_year: '1995',
                        added_at: '2026-01-02',
                        position: 3,
                        catalog_status: 'present',
                    },
                },
            })
        );
    }, playlistId);
    await page.getByRole('link', { name: 'Series', exact: true }).click();
    await expect.poll(() => loaded.has('get_series')).toBe(true);
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await expect.poll(() => loaded.has('get_live_streams')).toBe(true);
    await expect.poll(() => loaded.has('get_vod_streams')).toBe(true);
    await page
        .getByRole('link', { name: 'Global favorites', exact: true })
        .click();
    const card = page.getByRole('button', {
        name: 'Saved absent favorite',
        exact: true,
    });
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    await card.dispatchEvent('click');
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('app-content-hero')).toHaveCount(0);
    expect(detailRequests).toBe(0);
    await page.reload();
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    await page.goto('/workspace/global-recent');
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    await card.dispatchEvent('click');
    await expect(page.locator('app-content-hero')).toHaveCount(0);
    expect(detailRequests).toBe(0);
    await page.goto('/workspace/settings/backup');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const path = await (await download).path();
    if (!path) throw new Error('Backup download is missing');
    const backup = JSON.parse(await readFile(path, 'utf8'));
    const entry = backup.playlists.find(
        (item: { exportedId: string }) => item.exportedId === playlistId
    );
    expect(entry.userState.favorites[0]).toMatchObject({
        contentType: 'movie',
        xtreamId: 99999,
        addedAt: '2026-01-02',
        position: 3,
        snapshot: {
            title: 'Saved absent favorite',
            tmdbId: 949,
            releaseYear: 1995,
        },
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
        const body = await response.json();
        body.payload.push({
            stream_id: 99999,
            name: 'Sparse returning movie',
            category_id: body.payload[0].category_id,
            stream_type: 'movie',
            container_extension: 'mp4',
        });
        await route.fulfill({ response, json: body });
    });
    await page.goto(`${playlistPath}/vod`);
    await page
        .getByRole('link', { name: 'Global favorites', exact: true })
        .click();
    await expect(card).not.toHaveAttribute('aria-disabled', 'true');
    await page.reload();
    await expect(card).not.toHaveAttribute('aria-disabled', 'true');
    await page.goto('/workspace/global-recent');
    await expect(card).not.toHaveAttribute('aria-disabled', 'true');
    await card.click();
    await expect.poll(() => detailRequests).toBeGreaterThan(0);
});

test('@xtream @collections PWA retries retain saved favorite metadata when snapshot storage is full', async ({
    page,
}) => {
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        if (original.searchParams.get('action') !== 'get_vod_streams')
            return route.fallback();
        const url = new URL(`${MOCK_SERVER}/xtream`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') url.searchParams.set(key, value);
        });
        const response = await route.fetch({ url: url.toString() });
        const body = await response.json();
        body.payload.push({
            stream_id: 987654,
            name: 'Sparse replacement',
            category_id: body.payload[0].category_id,
            stream_type: 'movie',
        });
        await route.fulfill({ response, json: body });
    });
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
            catalogStatus: 'missing',
            catalogMissingReason: 'identity_conflict',
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
        catalog_status: 'missing',
        catalog_missing_reason: 'identity_conflict',
    });
    await page.goto('/workspace/global-favorites');
    const card = page.getByRole('button', {
        name: favorite.snapshot.title,
        exact: true,
    });
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    await card.dispatchEvent('click');
    await expect(page.locator('app-content-hero')).toHaveCount(0);
});

test('@xtream @collections removing a readable favorite during failed restore survives retry and export', async ({
    page,
}) => {
    await addXtreamPortal(page, { name: 'Removal Retry Portal' });
    const playlistPath = new URL(page.url()).pathname.replace(/\/vod.*$/, '');
    const rawId = playlistPath.split('/').pop();
    if (!rawId) throw new Error('Missing playlist ID');
    const id = decodeURIComponent(rawId);
    await page.goto('/');
    await page.evaluate((id) => {
        const item = {
            id: 987654,
            xtream_id: 987654,
            type: 'movie',
            title: 'Readable saved movie',
            tmdb_id: 949,
            poster_url: '/assets/icons/icon-192x192.png',
            catalog_status: 'missing',
            catalog_missing_reason: 'absent',
        };
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({ [id]: { 'movie:987654': item } })
        );
        localStorage.setItem(
            `xtream-restore-${id}`,
            JSON.stringify({
                favoritesRestoreId: 'removal-test',
                hiddenCategories: [],
                favorites: [
                    {
                        contentType: 'movie',
                        xtreamId: 987654,
                        snapshot: { title: item.title, tmdbId: 949 },
                    },
                ],
                recentlyViewed: [],
                playbackPositions: [],
            })
        );
        sessionStorage.setItem('block-removal-snapshot', '1');
    }, id);
    await page.addInitScript(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (this: Storage, key, value) {
            if (
                this === localStorage &&
                key === 'xtream-collection-items' &&
                sessionStorage.getItem('block-removal-snapshot')
            ) {
                sessionStorage.setItem('removal-snapshot-attempted', '1');
                throw new DOMException('full', 'QuotaExceededError');
            }
            return set.call(this, key, value);
        };
    });
    await page.goto(`${playlistPath}/vod`);
    await expect
        .poll(() =>
            page.evaluate(() =>
                sessionStorage.getItem('removal-snapshot-attempted')
            )
        )
        .toBe('1');
    await page.goto('/workspace/global-favorites');
    const card = page
        .locator('app-content-card')
        .filter({ hasText: 'Readable saved movie' });
    await expect(card).toBeVisible();
    await card
        .getByRole('button', { name: 'Remove from favorites', exact: true })
        .click();
    await expect(card).toHaveCount(0);
    await page.goto('/workspace/settings/backup');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const path = await (await download).path();
    if (!path) throw new Error('Missing backup');
    const archived = JSON.parse(await readFile(path, 'utf8')).playlists.find(
        (entry: { exportedId: string }) => entry.exportedId === id
    );
    expect(archived.userState.favorites).toEqual([]);
    await page.evaluate(() =>
        sessionStorage.removeItem('block-removal-snapshot')
    );
    await page.goto(`${playlistPath}/vod`);
    await expect
        .poll(() =>
            page.evaluate(
                (id) => localStorage.getItem(`xtream-restore-${id}`),
                id
            )
        )
        .toBeNull();
    await page.goto('/workspace/global-favorites');
    await page.reload();
    await expect(card).toHaveCount(0);
    expect(
        await page.evaluate(
            (id) =>
                JSON.parse(localStorage.getItem('xtream-favorites') ?? '{}')[
                    id
                ],
            id
        )
    ).toEqual([]);
});

test('@xtream @collections cold shared live playback records the selected favorite identity', async ({
    page,
}) => {
    test.setTimeout(60_000);
    await configureLiveFormat(page, 'html5', 'ts');
    await addXtreamPortal(page, {
        name: 'Shared Live Identity Portal',
        username: 'live-fallback',
        password: 'live-fallback',
    });
    const rawId = new URL(page.url()).pathname
        .replace(/\/vod.*$/, '')
        .split('/')
        .pop();
    if (!rawId) throw new Error('Missing playlist ID');
    const id = decodeURIComponent(rawId);
    await page.goto('/workspace/global-favorites');
    await page.evaluate((id) => {
        const played = {
            id: 10000,
            xtream_id: 10000,
            type: 'live',
            title: 'Played favorite B',
            tmdb_id: 200,
            category_id: '1',
            poster_url: '',
            catalog_status: 'present',
        };
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ [id]: ['live:10000'] })
        );
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({ [id]: { 'live:10000': played } })
        );
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                [id]: [
                    {
                        id: 'live:10000',
                        viewedAt: '2020-01-01',
                        collectionItem: {
                            ...played,
                            title: 'Earlier watched A',
                            tmdb_id: 100,
                        },
                    },
                ],
            })
        );
    }, id);
    await page.route('**/localhost:3000/xtream**', async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') ===
            'get_live_streams'
        )
            return route.abort();
        await route.fallback();
    });
    await page.reload();
    const row = page
        .locator('app-channel-list-item')
        .filter({ hasText: 'Played favorite B' });
    await expect(row).toBeVisible();
    await row.click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .first()
                .evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeGreaterThan(2);
    await expect
        .poll(() =>
            page.evaluate(
                (id) =>
                    JSON.parse(
                        localStorage.getItem('xtream-recent-items') ?? '{}'
                    )[id]?.[0]?.collectionItem?.tmdb_id,
                id
            )
        )
        .toBe(200);
    await page.goto('/workspace/global-recent');
    await page.reload();
    await expect(
        page
            .locator('app-channel-list-item')
            .filter({ hasText: 'Played favorite B' })
    ).toBeVisible();
    await expect(
        page
            .locator('app-channel-list-item')
            .filter({ hasText: 'Earlier watched A' })
    ).toHaveCount(0);
    expect(
        await page.evaluate(
            (id) =>
                JSON.parse(
                    localStorage.getItem('xtream-collection-items') ?? '{}'
                )[id]['live:10000'].tmdb_id,
            id
        )
    ).toBe(200);
});
