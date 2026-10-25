import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { configureLiveFormat } from './xtream-live-format.fixture';
import {
    addXtreamPortal,
    DEFAULT_USERNAME,
    DEFAULT_PASSWORD,
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
    await page.goto('/workspace/dashboard');
    await expect(
        page.locator('[data-test-id="dashboard-page-heading"]')
    ).toBeVisible();
    await expect(
        page
            .locator('lib-workspace-dashboard-rails')
            .getByText('Saved absent favorite', { exact: true })
            .first()
    ).toBeVisible();
    await expect(
        page.locator('[data-test-id="dashboard-hero-skeleton"]')
    ).toHaveCount(0);
    await expect(
        page
            .locator('lib-dashboard-hero .hero__content')
            .filter({ hasText: 'Saved absent favorite' })
    ).toHaveCount(0);
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
        .poll(
            () =>
                page
                    .locator('video')
                    .first()
                    .evaluate((video: HTMLVideoElement) => video.currentTime),
            { timeout: 30_000 }
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
    await page.evaluate((id) => {
        const snapshots = JSON.parse(
            localStorage.getItem('xtream-collection-items') ?? '{}'
        );
        snapshots[id]['live:10000'].catalog_status = 'missing';
        snapshots[id]['live:10000'].catalog_missing_reason = 'absent';
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify(snapshots)
        );
        const recent = JSON.parse(
            localStorage.getItem('xtream-recent-items') ?? '{}'
        );
        recent[id][0].collectionItem.catalog_status = 'missing';
        recent[id].push({
            id: 'live:10001',
            viewedAt: '2020-01-02',
            collectionItem: {
                id: 10001,
                xtream_id: 10001,
                type: 'live',
                title: 'Another watched channel',
                tmdb_id: 300,
                catalog_status: 'present',
            },
        });
        localStorage.setItem('xtream-recent-items', JSON.stringify(recent));
    }, id);
    await page.reload();
    await expect(
        row.getByRole('button', { name: 'Played favorite B', exact: true })
    ).toHaveAttribute('aria-disabled', 'true');
    await row.click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveCount(1);
    await page
        .getByRole('menuitem', { name: 'Remove from history', exact: true })
        .click();
    await expect(row).toHaveCount(0);
    await expect(
        page.getByText('Another watched channel', { exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(row).toHaveCount(0);
    expect(
        await page.evaluate(
            (id) =>
                JSON.parse(localStorage.getItem('xtream-favorites') ?? '{}')[
                    id
                ],
            id
        )
    ).toEqual(['live:10000']);
    expect(
        await page.evaluate(
            (id) =>
                JSON.parse(localStorage.getItem('xtream-recent-items') ?? '{}')[
                    id
                ].map((item: { id: string }) => item.id),
            id
        )
    ).toEqual(['live:10001']);
});

test('@xtream @collections catalog hydration cannot replace pending backup identity or dates', async ({
    page,
}) => {
    test.setTimeout(60_000);
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        if (original.searchParams.get('action') !== 'get_vod_streams')
            return route.fallback();
        const mockUrl = new URL(`${MOCK_SERVER}/xtream`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') mockUrl.searchParams.set(key, value);
        });
        const response = await route.fetch({ url: mockUrl.toString() });
        const body = await response.json();
        body.payload.push({
            stream_id: 987655,
            name: 'Catalog replacement',
            category_id: body.payload[0].category_id,
            stream_type: 'movie',
            tmdb_id: 200,
        });
        await route.fulfill({ response, json: body });
    });
    await addXtreamPortal(page, { name: 'Hydration Retry Portal' });
    const playlistPath = new URL(page.url()).pathname.replace(/\/vod.*$/, '');
    const rawId = playlistPath.split('/').pop();
    if (!rawId) throw new Error('Missing playlist ID');
    const id = decodeURIComponent(rawId);
    await page.goto('/');
    await page.evaluate((id) => {
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({
                [id]: {
                    'movie:987656': {
                        xtream_id: 987656,
                        type: 'movie',
                        title: 'Older cached item',
                        tmdb_id: 300,
                        added_at: '2020-01-01',
                        position: 9,
                    },
                },
            })
        );
        localStorage.setItem(
            `xtream-restore-${id}`,
            JSON.stringify({
                favoritesRestoreId: 'hydration-race',
                hiddenCategories: [],
                favorites: [
                    {
                        contentType: 'movie',
                        xtreamId: 987655,
                        snapshot: { title: 'Archived original', tmdbId: 100 },
                    },
                    {
                        contentType: 'movie',
                        xtreamId: 987656,
                        addedAt: '2026-01-01',
                        position: 2,
                        snapshot: { title: 'Archived dated item', tmdbId: 300 },
                    },
                ],
                recentlyViewed: [],
                playbackPositions: [],
            })
        );
        sessionStorage.setItem('block-hydration-snapshot', '1');
    }, id);
    await page.addInitScript(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (this: Storage, key, value) {
            if (
                this === localStorage &&
                key === 'xtream-collection-items' &&
                sessionStorage.getItem('block-hydration-snapshot')
            ) {
                sessionStorage.setItem('hydration-snapshot-attempted', '1');
                throw new DOMException('full', 'QuotaExceededError');
            }
            return set.call(this, key, value);
        };
    });
    await page.goto(`${playlistPath}/vod`);
    await expect
        .poll(() =>
            page.evaluate(() =>
                sessionStorage.getItem('hydration-snapshot-attempted')
            )
        )
        .toBe('1');
    await page.goto('/workspace/settings/backup');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const path = await (await download).path();
    if (!path) throw new Error('Missing backup');
    const exported = JSON.parse(await readFile(path, 'utf8')).playlists.find(
        (entry: { exportedId: string }) => entry.exportedId === id
    );
    expect(
        exported.userState.favorites.find(
            (item: { xtreamId: number }) => item.xtreamId === 987656
        )
    ).toMatchObject({
        addedAt: '2026-01-01',
        position: 2,
        snapshot: { title: 'Archived dated item' },
    });
    await page.evaluate(() =>
        sessionStorage.removeItem('block-hydration-snapshot')
    );
    // Client-side navigation performs a collection read without restarting the pending import.
    await page
        .getByRole('link', { name: 'Global favorites', exact: true })
        .click();
    await expect
        .poll(() =>
            page.evaluate(
                (id) =>
                    JSON.parse(
                        localStorage.getItem('xtream-collection-items') ?? '{}'
                    )[id]?.['movie:987655']?.tmdb_id,
                id
            )
        )
        .toBe(200);
    expect(
        await page.evaluate(
            (id) => localStorage.getItem(`xtream-restore-${id}`),
            id
        )
    ).not.toBeNull();
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
    await expect(
        page.getByRole('button', { name: 'Archived original', exact: true })
    ).toBeVisible();
    await page.reload();
    expect(
        await page.evaluate(
            (id) =>
                JSON.parse(
                    localStorage.getItem('xtream-collection-items') ?? '{}'
                )[id]?.['movie:987655']?.tmdb_id,
            id
        )
    ).toBe(100);
});

test('@xtream @collections importing partial favorite identity rejects conflicting optional cache fields', async ({
    page,
}) => {
    const id = 'partial-import-source';
    const favorite = {
        contentType: 'movie',
        xtreamId: 987655,
        addedAt: '2020-01-02',
        position: 4,
        snapshot: { title: 'Partial saved original', tmdbId: 100 },
    };
    const manifest = {
        kind: 'iptvnator-playlist-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        includeSecrets: true,
        playlists: [
            {
                portalType: 'xtream',
                exportedId: id,
                title: 'Partial Backup Portal',
                autoRefresh: false,
                connection: {
                    serverUrl: MOCK_SERVER,
                    username: DEFAULT_USERNAME,
                    password: DEFAULT_PASSWORD,
                },
                userState: {
                    hiddenCategories: [],
                    favorites: [favorite],
                    recentlyViewed: [],
                    playbackPositions: [],
                    collectionItems: [
                        {
                            id: 987655,
                            xtream_id: 987655,
                            type: 'movie',
                            title: 'Cached replacement',
                            tmdb_id: 200,
                            release_year: 2026,
                            poster_url: '/replacement.jpg',
                        },
                    ],
                },
            },
        ],
    };
    await page.goto('/workspace/settings/backup');
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await (
        await choosing
    ).setFiles({
        name: 'partial-favorite.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(manifest)),
    });
    await expect(
        page.getByText(/Backup import finished: .*0 failed/)
    ).toBeVisible();
    await page.goto('/workspace/global-favorites');
    await expect(
        page.getByRole('button', { name: favorite.snapshot.title, exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(
        page.getByRole('button', { name: favorite.snapshot.title, exact: true })
    ).toBeVisible();
    await page.goto('/workspace/settings/backup');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const path = await (await downloading).path();
    if (!path) throw new Error('Missing exported backup');
    const exported = JSON.parse(await readFile(path, 'utf8'));
    const saved = exported.playlists.find(
        (entry: { exportedId: string }) => entry.exportedId === id
    ).userState.favorites[0];
    expect(saved).toMatchObject(favorite);
    expect(saved.snapshot.releaseYear).toBeUndefined();
    expect(saved.snapshot.posterUrl).not.toBe('/replacement.jpg');
});

test('@xtream @collections unavailable watched series retain history without requesting replacement episodes', async ({
    page,
}) => {
    await addXtreamPortal(page, { name: 'Unavailable series discovery' });
    const rawId = /\/xtreams\/([^/]+)/.exec(new URL(page.url()).pathname)?.[1];
    if (!rawId) throw new Error('Missing playlist ID');
    const id = decodeURIComponent(rawId);
    await page.goto('/workspace/global-recent');
    await page.evaluate((id) => {
        const items = [
            {
                id: 987651,
                xtream_id: 987651,
                type: 'series',
                title: 'Retained missing series',
                catalog_status: 'missing',
                catalog_missing_reason: 'identity_conflict',
                tmdb_id: 100,
            },
            {
                id: 987652,
                xtream_id: 987652,
                type: 'series',
                title: 'Retained unknown series',
                catalog_status: 'unknown',
                tmdb_id: 200,
            },
        ];
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                [id]: items.map((item) => ({
                    id: `series:${item.id}`,
                    viewedAt: '2026-10-15',
                    collectionItem: item,
                })),
            })
        );
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({
                [id]: Object.fromEntries(
                    items.map((item) => [`series:${item.id}`, item])
                ),
            })
        );
        localStorage.setItem(
            'xtream-playback-positions',
            JSON.stringify({
                [id]: items.map((item) => ({
                    playlistId: id,
                    contentXtreamId: item.id + 10,
                    seriesXtreamId: item.id,
                    contentType: 'episode',
                    seasonNumber: 1,
                    episodeNumber: 1,
                    positionSeconds: 990,
                    durationSeconds: 1000,
                    updatedAt: '2026-10-15',
                })),
            })
        );
    }, id);
    let requests = 0;
    page.on('request', (request) => {
        if (
            new URL(request.url()).searchParams.get('action') ===
            'get_series_info'
        )
            requests++;
    });
    await page.reload();
    for (const title of [
        'Retained missing series',
        'Retained unknown series',
    ]) {
        await expect(
            page.getByRole('button', { name: title, exact: true })
        ).toHaveAttribute('aria-disabled', 'true');
    }
    await page.goto('/workspace/dashboard');
    await expect(
        page.locator('[data-test-id="dashboard-page-heading"]')
    ).toBeVisible();
    await expect(
        page.locator('[data-test-id="dashboard-hero-skeleton"]')
    ).toHaveCount(0);
    await expect(
        page
            .locator('lib-workspace-dashboard-rails')
            .getByText('Retained missing series', { exact: true })
            .first()
    ).toBeVisible();
    await expect(page.locator('lib-dashboard-hero')).not.toContainText(
        'Retained missing series'
    );
    expect(requests).toBe(0);
    expect(
        await page.evaluate(
            (id) =>
                JSON.parse(
                    localStorage.getItem('xtream-playback-positions') ?? '{}'
                )[id].length,
            id
        )
    ).toBe(2);
    await page.goto('/workspace/global-recent');
    await expect(
        page.getByRole('button', {
            name: 'Retained missing series',
            exact: true,
        })
    ).toBeVisible();
    expect(requests).toBe(0);
});

test('@xtream @collections sparse detail hearts cannot delete a retained conflicting favorite', async ({
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
        if (action === 'get_vod_streams') {
            for (const row of body.payload) {
                delete row.tmdb_id;
                delete row.tmdb;
                delete row.release_year;
                delete row.release_date;
            }
        } else {
            Object.assign(body.payload.info, {
                tmdb_id: null,
                tmdb: null,
                release_year: null,
                releasedate: null,
                release_date: null,
            });
        }
        await route.fulfill({ response, json: body });
    });
    await addXtreamPortal(page, { name: 'Sparse detail conflict' });
    const portal = new URL(page.url()).pathname;
    const rawId = /\/xtreams\/([^/]+)/.exec(portal)?.[1];
    if (!rawId) throw new Error('Missing playlist ID');
    const id = decodeURIComponent(rawId);
    await page.evaluate(
        ({ id, movie }) => {
            const key = `movie:${movie.stream_id}`;
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ [id]: [key] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({
                    [id]: {
                        [key]: {
                            id: movie.stream_id,
                            xtream_id: movie.stream_id,
                            type: 'movie',
                            title: 'Older saved original',
                            tmdb_id: 100,
                            release_year: 1995,
                            catalog_status: 'missing',
                            catalog_missing_reason: 'identity_conflict',
                        },
                    },
                })
            );
        },
        { id, movie }
    );
    await page.reload();
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
    expect(
        await page.evaluate(
            (id) =>
                JSON.parse(
                    localStorage.getItem('xtream-collection-items') ?? '{}'
                )[id][
                    Object.keys(
                        JSON.parse(
                            localStorage.getItem('xtream-collection-items') ??
                                '{}'
                        )[id]
                    )[0]
                ].tmdb_id,
            id
        )
    ).toBe(100);
    await page.goto('/workspace/global-favorites');
    await expect(
        page.getByRole('button', { name: 'Older saved original', exact: true })
    ).toBeVisible();
    await page
        .getByRole('button', { name: 'Remove from favorites', exact: true })
        .click();
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
