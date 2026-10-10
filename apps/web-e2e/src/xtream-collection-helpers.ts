import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type ContentType = 'movie' | 'series' | 'live';
type CatalogItem = {
    category_id: string | number;
    stream_id?: number;
    series_id?: number;
};
type Detail = {
    info: Record<string, unknown>;
    movie_data: Record<string, unknown>;
    episodes?: Record<string, Array<Record<string, unknown>>>;
};

export const collisionItems = [
    { type: 'movie', label: 'Movies', title: 'Collision Movie' },
    { type: 'series', label: 'Series', title: 'Collision Series' },
    { type: 'live', label: 'Live TV', title: 'Collision Live' },
] as const;

export type CollisionItem = (typeof collisionItems)[number];

/** Keep mock shapes, with colliding IDs and native-playable VOD extensions. */
export async function interceptCollidingXtreamItems(
    page: Page,
    request: APIRequestContext,
    mockServer: string
): Promise<Record<ContentType, string>> {
    async function fetchFixture<T>(
        action: string,
        parameters: Record<string, string> = {}
    ): Promise<T> {
        const url = new URL(`${mockServer}/player_api.php`);
        url.search = new URLSearchParams({
            username: 'minimal',
            password: 'minimal',
            action,
            ...parameters,
        }).toString();
        const response = await request.get(url.toString());
        expect(response.ok()).toBeTruthy();
        return response.json();
    }

    const [[movie], [series], [live]] = await Promise.all([
        fetchFixture<CatalogItem[]>('get_vod_streams'),
        fetchFixture<CatalogItem[]>('get_series'),
        fetchFixture<CatalogItem[]>('get_live_streams'),
    ]);
    const [movieDetails, seriesDetails] = await Promise.all([
        fetchFixture<Detail>('get_vod_info', {
            vod_id: String(movie.stream_id),
        }),
        fetchFixture<Detail>('get_series_info', {
            series_id: String(series.series_id),
        }),
    ]);
    for (const episodes of Object.values(seriesDetails.episodes ?? {})) {
        for (const episode of episodes) {
            episode['container_extension'] = 'mp4';
        }
    }
    const payloads: Record<string, unknown> = {
        get_vod_streams: [
            {
                ...movie,
                stream_id: 103,
                name: 'Collision Movie',
                container_extension: 'mp4',
            },
        ],
        get_series: [{ ...series, series_id: 103, name: 'Collision Series' }],
        get_live_streams: [{ ...live, stream_id: 103, name: 'Collision Live' }],
        get_vod_info: {
            ...movieDetails,
            info: { ...movieDetails.info, name: 'Collision Movie' },
            movie_data: {
                ...movieDetails.movie_data,
                stream_id: 103,
                name: 'Collision Movie',
                container_extension: 'mp4',
            },
        },
        get_series_info: {
            ...seriesDetails,
            info: { ...seriesDetails.info, name: 'Collision Series' },
        },
        get_short_epg: { epg_listings: [] },
        get_simple_data_table: { epg_listings: [] },
    };

    // Fixtures may include remote artwork. Keep this regression fully local.
    await page.route('https://**', (route) => route.abort());
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (!action || !(action in payloads)) {
            await route.fallback();
            return;
        }
        await route.fulfill({ json: { action, payload: payloads[action] } });
    });

    return {
        movie: String(movie.category_id),
        series: String(series.category_id),
        live: String(live.category_id),
    };
}

/** Fail initial attempts, then serve only repository-owned synthetic media. */
export async function routeCollisionMedia(
    page: Page,
    mockServer: string
): Promise<() => void> {
    let playable = false;
    const webm = readFileSync(
        join(__dirname, 'fixtures/playback/episode.webm')
    );
    const transportStream = readFileSync(
        join(__dirname, '../../xtream-mock-server/src/fixtures/live.mpegts')
    );
    await page.route(
        (url) =>
            url.origin === mockServer &&
            /^\/(live|movie|series)\//.test(url.pathname),
        async (route) => {
            if (!playable) {
                await route.fulfill({
                    status: 503,
                    body: 'Fixture unavailable',
                });
                return;
            }
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('.m3u8')) {
                await route.fulfill({
                    contentType: 'application/vnd.apple.mpegurl',
                    body: [
                        '#EXTM3U',
                        '#EXT-X-VERSION:3',
                        '#EXT-X-TARGETDURATION:6',
                        '#EXT-X-MEDIA-SEQUENCE:0',
                        '#EXTINF:6,',
                        `${mockServer}/live/collection-fixture.ts`,
                        '#EXT-X-ENDLIST',
                        '',
                    ].join('\n'),
                });
                return;
            }
            if (path.endsWith('.ts')) {
                await route.fulfill({
                    contentType: 'video/mp2t',
                    body: transportStream,
                });
                return;
            }
            // Native media reads use ranges, even when the clip is small.
            const range = /^bytes=(\d*)-(\d*)$/.exec(
                route.request().headers()['range'] ?? ''
            );
            const last = webm.length - 1;
            const start = range?.[1]
                ? Number(range[1])
                : range?.[2]
                  ? Math.max(0, webm.length - Number(range[2]))
                  : 0;
            const end =
                range?.[1] && range[2]
                    ? Math.min(Number(range[2]), last)
                    : last;
            await route.fulfill({
                status: range ? 206 : 200,
                headers: {
                    'accept-ranges': 'bytes',
                    'content-length': String(end - start + 1),
                    'content-type': 'video/webm',
                    ...(range
                        ? {
                              'content-range': `bytes ${start}-${end}/${webm.length}`,
                          }
                        : {}),
                },
                body: webm.subarray(start, end + 1),
            });
        }
    );
    return () => {
        playable = true;
    };
}

export async function openCollisionCatalogItem(
    page: Page,
    item: CollisionItem,
    categoryId: string
): Promise<void> {
    await page.getByRole('link', { name: item.label, exact: true }).click();
    await page
        .locator(
            `app-workspace-context-panel .category-item[data-category-id="${categoryId}"]:visible`
        )
        .click();
    if (item.type !== 'live') {
        await page
            .locator('.category-content-layout mat-card')
            .filter({ hasText: item.title })
            .click();
        await expect(
            page.getByRole('heading', { name: item.title, exact: true })
        ).toBeVisible();
    }
}

export function collisionCollectionItem(page: Page, item: CollisionItem) {
    return item.type === 'live'
        ? page.locator('app-channel-list-item').filter({
              has: page.locator('.channel-name', { hasText: item.title }),
          })
        : page.locator('app-content-card').filter({
              has: page.getByRole('heading', { name: item.title, exact: true }),
          });
}

export async function addCollisionFavorite(
    page: Page,
    item: CollisionItem,
    categoryId: string
): Promise<void> {
    await openCollisionCatalogItem(page, item, categoryId);
    if (item.type === 'live') {
        const channel = collisionCollectionItem(page, item);
        const favorite = channel.locator('.favorite-button').first();
        // Other content sharing this ID must not preselect the channel.
        await expect(favorite.locator('mat-icon')).toHaveText('star_outline');
        await channel.hover();
        await favorite.click();
        await expect(favorite.locator('mat-icon')).toHaveText('star');
        return;
    }
    const addButton = page.getByRole('button', { name: /add to favorites/i });
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(
        page.getByRole('button', { name: /remove from favorites/i })
    ).toBeVisible();
}

export async function playCollisionItem(
    page: Page,
    item: CollisionItem,
    categoryId: string,
    confirmPlayback = true
): Promise<void> {
    await openCollisionCatalogItem(page, item, categoryId);
    if (item.type === 'live') {
        await collisionCollectionItem(page, item).click();
    } else {
        await page
            .getByTestId(
                item.type === 'movie'
                    ? 'vod-primary-action'
                    : 'series-quick-start'
            )
            .click();
    }
    await expect(page.locator('app-web-player-view')).toBeVisible();
    if (confirmPlayback) {
        const video = page.locator('app-web-player-view video').first();
        await expect
            .poll(
                () =>
                    video.evaluate(
                        (media: HTMLVideoElement) =>
                            !media.paused && media.readyState >= 2
                    ),
                { timeout: 15_000 }
            )
            .toBe(true);
        const start = await video.evaluate(
            (media: HTMLVideoElement) => media.currentTime
        );
        // Observe real decoder progress beyond the two-second history gate.
        await expect
            .poll(
                () =>
                    video.evaluate(
                        (media: HTMLVideoElement, initial) =>
                            media.paused ? 0 : media.currentTime - initial,
                        start
                    ),
                { timeout: 15_000 }
            )
            .toBeGreaterThanOrEqual(2.5);
    }
}

export async function removeCollisionFavorite(
    page: Page,
    item: CollisionItem,
    remainingTypeCount: number
): Promise<void> {
    if (remainingTypeCount > 1) {
        await selectCollectionType(page, item);
    }
    const row = collisionCollectionItem(page, item);
    await row.hover();
    await row
        .locator(item.type === 'live' ? '.favorite-button' : '.remove-button')
        .first()
        .click();
}

export async function selectCollectionType(
    page: Page,
    item: CollisionItem
): Promise<void> {
    await page.getByRole('radio', { name: item.label, exact: true }).click();
}

export async function expectCollisionCollection(
    page: Page,
    items: readonly CollisionItem[]
): Promise<void> {
    // Full navigation/reload passes the startup splash before mounting the list.
    await expect(page.locator('app-unified-collection-page')).toBeAttached({
        timeout: 15_000,
    });
    const toggles = page.getByRole('radio', {
        name: /^(Movies|Series|Live TV)$/,
    });
    await expect(toggles).toHaveCount(items.length > 1 ? items.length : 0);
    for (const item of items) {
        if (items.length > 1) {
            await selectCollectionType(page, item);
        }
        await expect(collisionCollectionItem(page, item)).toBeVisible();
    }
    for (const removed of collisionItems.filter(
        (item) => !items.includes(item)
    )) {
        await expect(collisionCollectionItem(page, removed)).toHaveCount(0);
        await expect(toggles.filter({ hasText: removed.label })).toHaveCount(0);
    }
    if (items.length === 0) {
        await expect(page.locator('app-empty-state')).toBeVisible();
    }
}

export async function expectCollectionDetailRoundTrip(
    page: Page,
    item: CollisionItem
): Promise<void> {
    await selectCollectionType(page, item);
    const collectionUrl = page.url();
    await collisionCollectionItem(page, item).click();
    await expect(
        page.getByRole('heading', { name: item.title, exact: true })
    ).toBeVisible();
    await expect(page).toHaveURL(collectionUrl);
    await page.locator('[data-test-id="workspace-header-back"]').click();
    await expect(page).toHaveURL(collectionUrl);
    await expect(collisionCollectionItem(page, item)).toBeVisible();
}
