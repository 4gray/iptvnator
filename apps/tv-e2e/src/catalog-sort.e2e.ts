import { expect, Page, test } from '@playwright/test';
import { addSource, backend, nav, start } from './helpers';
async function xtreamCatalog(page: Page) {
    await start(page);
    await page.route(`${backend}/xtream?**`, async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (action === 'get_vod_streams' || action === 'get_series') {
            await route.fulfill({
                json: {
                    payload: Array.from({ length: 125 }, (_, i) => ({
                        stream_id: i + 1,
                        series_id: i + 1,
                        name: `Title ${String(i).padStart(3, '0')}`,
                        ...(action === 'get_series'
                            ? { last_modified: String(1700000000 + i) }
                            : { added: String(1700000000 + i) }),
                        category_id: '1',
                        container_extension: 'mp4',
                    })),
                },
            });
        } else await route.continue();
    });
    await addSource(page, 'xtream');
    await nav(page, 'Movies');
}
const title = (page: Page) => page.locator('.poster-card strong').first();
test('movie and series sorting defaults to recent, survives append/detail/relaunch and saves separately', async ({
    page,
}) => {
    await xtreamCatalog(page);
    await expect(page.getByLabel('Sort by')).toHaveValue('recent');
    await expect(title(page)).toHaveText('Title 124');
    await expect(page.locator('.poster-card').first()).toBeVisible();
    await page.locator('main').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
    });
    await expect(page.locator('.virtual-collection')).toHaveAttribute(
        'data-loaded',
        '120'
    );
    const card = page.locator('.poster-card[data-virtual-index="80"]');
    await expect(card.locator('strong')).toHaveText('Title 044');
    await card.click();
    await expect(page.locator('.detail-hero')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toBeFocused();
    await page.getByLabel('Sort by').focus();
    await page.getByLabel('Sort by').selectOption('title');
    await expect(title(page)).toHaveText('Title 000');
    await expect(page.getByLabel('Sort by')).toBeFocused();
    await page.getByLabel('Search this source').fill('Title 01');
    await expect(title(page)).toHaveText('Title 010');
    await nav(page, 'Series');
    await expect(page.getByLabel('Sort by')).toHaveValue('recent');
    await expect(title(page)).toHaveText('Title 124');
    await expect(
        page.getByText('Uses update dates when added dates are unavailable.')
    ).toBeVisible();
    await page.getByLabel('Sort by').selectOption('provider');
    await expect(title(page)).toHaveText('Title 000');
    await page.reload();
    await expect(page.locator('.loading')).toBeHidden();
    await nav(page, 'Movies');
    await expect(page.getByLabel('Sort by')).toHaveValue('title');
    await expect(title(page)).toHaveText('Title 000');
    await nav(page, 'Series');
    await expect(page.getByLabel('Sort by')).toHaveValue('provider');
    await nav(page, 'TV');
    await expect(page.getByLabel('Sort by')).toHaveCount(0);
});
test('Stalker sends server sort through append and changing order starts again at page one', async ({
    page,
}) => {
    await start(page);
    const calls: {
        sort: string | null;
        page: string | null;
        type: string | null;
    }[] = [];
    page.on('request', (request) => {
        const u = new URL(request.url());
        if (
            u.pathname === '/stalker' &&
            u.searchParams.get('action') === 'get_ordered_list'
        )
            calls.push({
                sort: u.searchParams.get('sortby'),
                page: u.searchParams.get('p'),
                type: u.searchParams.get('type'),
            });
    });
    await addSource(page, 'stalker', { mac: '00:1A:79:00:00:01' });
    await nav(page, 'Movies');
    await expect(page.getByLabel('Sort by')).toHaveValue('recent');
    await expect
        .poll(async () => {
            // Each appended page extends the list; keep browsing its new end.
            await page.locator('main').evaluate((e) => {
                e.scrollTop = e.scrollHeight;
            });
            return calls.some(
                (c) => c.type === 'vod' && c.sort === 'added' && c.page === '3'
            );
        })
        .toBe(true);
    await page.getByLabel('Sort by').selectOption('title');
    await expect
        .poll(() =>
            calls.some(
                (c) => c.type === 'vod' && c.sort === 'name' && c.page === '1'
            )
        )
        .toBe(true);
    await expect(page.locator('.loading')).toBeHidden();
    await expect(page.locator('main')).toHaveJSProperty('scrollTop', 0);
    await nav(page, 'Series');
    await expect(page.getByLabel('Sort by')).toHaveValue('recent');
    await expect
        .poll(() =>
            calls.some((c) => c.type === 'series' && c.sort === 'added')
        )
        .toBe(true);
});
test('changing sort cancels an old append and a late reply cannot mix catalog orders', async ({
    page,
}) => {
    await xtreamCatalog(page);
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((r) => {
        release = r;
    });
    const pending = new Promise<void>((r) => {
        started = r;
    });
    let once = true;
    await page.route(`${backend}/xtream?**`, async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (action === 'get_vod_categories' && once) {
            once = false;
            const response = await route.fetch();
            started();
            await held;
            await route.fulfill({ response }).catch(() => undefined);
        } else await route.fallback();
    });
    try {
        await page.locator('main').evaluate((e) => {
            e.scrollTop = e.scrollHeight;
        });
        await pending;
        await page.getByLabel('Sort by').selectOption('title');
        await expect(title(page)).toHaveText('Title 000');
        release();
        await expect(page.locator('.virtual-collection')).toHaveAttribute(
            'data-loaded',
            '60'
        );
        await expect(page.locator('.poster-card strong').last()).toHaveText(
            'Title 059'
        );
    } finally {
        release();
    }
});
test('failed sort persistence leaves the previous order active and exposes the failure', async ({
    page,
}) => {
    await xtreamCatalog(page);
    await page.evaluate(() => {
        IDBObjectStore.prototype.put = () => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        };
    });
    await page.getByLabel('Sort by').selectOption('title');
    await expect(page.getByRole('alert')).toContainText(
        'Sort order was not saved'
    );
    await expect(page.getByLabel('Sort by')).toHaveValue('recent');
    await expect(title(page)).toHaveText('Title 124');
});
test('M3U explains the missing recency dates and offers alphabetical movies', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/parse?**`, (route) =>
        route.fulfill({
            json: {
                playlist: {
                    items: [
                        {
                            name: 'Z movie',
                            url: 'http://127.0.0.1:3421/movie/z.mp4',
                        },
                        {
                            name: 'A movie',
                            url: 'http://127.0.0.1:3421/movie/a.mp4',
                        },
                    ],
                },
            },
        })
    );
    await addSource(page, 'm3u');
    await nav(page, 'Movies');
    await expect(title(page)).toHaveText('Z movie');
    await expect(
        page.getByText('No added dates in M3U; playlist order is used.')
    ).toBeVisible();
    await page.getByLabel('Sort by').selectOption('title');
    await expect(title(page)).toHaveText('A movie');
});
