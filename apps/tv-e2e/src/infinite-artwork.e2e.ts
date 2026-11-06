import { expect, test } from '@playwright/test';
import { addSource, backend, nav, start } from './helpers';

test('Stalker relative screenshots render as 2:3 posters and scrolling appends provider pages', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/stalker?**`, async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        function relative(value: unknown) {
            if (!value || typeof value !== 'object') return;
            const item = value as Record<string, unknown>;
            if (
                typeof item.screenshot_uri === 'string' &&
                item.screenshot_uri.includes('/assets/marketing/poster/')
            ) {
                item.cover = '';
                item.screenshot_uri = new URL(item.screenshot_uri).pathname;
            }
            Object.values(item).forEach(relative);
        }
        relative(data);
        await route.fulfill({ response, json: data });
    });
    await addSource(page, 'stalker', { mac: '00:1A:79:00:00:07' });
    await nav(page, 'Movies');
    await expect
        .poll(() =>
            page
                .locator('.poster-art img')
                .first()
                .evaluate((e: HTMLImageElement) => e.naturalWidth)
        )
        .toBeGreaterThan(0);
    for (const width of [1920, 1280, 960]) {
        await page.setViewportSize({ width, height: 1080 });
        const ratio = await page
            .locator('.poster-art')
            .first()
            .evaluate((e) => e.clientHeight / e.clientWidth);
        expect(ratio).toBeCloseTo(1.5, 1);
    }
    await page.locator('main').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
    });
    await expect
        .poll(() =>
            page.locator('.virtual-collection').getAttribute('data-loaded')
        )
        .toBe('35');
    await expect(page.locator('.pager')).toHaveCount(0);
});

test('M3U live scroll loads beyond sixty channels without starting playback', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/parse?**`, (route) =>
        route.fulfill({
            json: {
                playlist: {
                    items: Array.from({ length: 180 }, (_, n) => ({
                        name: `Channel ${n}`,
                        url: `http://localhost:3421/live/${n}.m3u8`,
                        group: { title: 'All' },
                    })),
                },
            },
        })
    );
    await addSource(page, 'm3u');
    await nav(page, 'TV');
    await expect(page.locator('.virtual-collection')).toHaveAttribute(
        'data-loaded',
        '60'
    );
    await page.locator('.channels').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
    });
    await expect(page.locator('.virtual-collection')).toHaveAttribute(
        'data-loaded',
        '120'
    );
    expect(await page.locator('.channel').count()).toBeLessThanOrEqual(20);
    expect(
        await page
            .locator('video')
            .evaluate((e: HTMLVideoElement) => !!e.currentSrc)
    ).toBe(false);
});

test('Stalker append errors keep loaded titles and offer a retry', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { mac: '00:1A:79:00:00:01' });
    let fail = true;
    await page.route(`${backend}/stalker?**`, async (route) => {
        const url = new URL(route.request().url());
        if (
            url.searchParams.get('action') === 'get_ordered_list' &&
            url.searchParams.get('p') === '2' &&
            fail
        ) {
            fail = false;
            await route.abort();
        } else await route.continue();
    });
    await nav(page, 'Movies');
    await page.locator('main').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
    });
    await expect(
        page.getByRole('button', { name: 'Retry loading' })
    ).toBeVisible();
    const before = Number(
        await page.locator('.virtual-collection').getAttribute('data-loaded')
    );
    expect(before).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Retry loading' }).click();
    await expect
        .poll(async () =>
            Number(
                await page
                    .locator('.virtual-collection')
                    .getAttribute('data-loaded')
            )
        )
        .toBeGreaterThan(before);
});

test('remote arrows continue through a loaded boundary without paging controls', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', { username: 'large', password: 'large' });
    await nav(page, 'Movies');
    await page.locator('[data-virtual-index="59"]').focus();
    await page.keyboard.press('ArrowDown');
    await expect
        .poll(async () =>
            Number(
                await page
                    .locator('.virtual-collection')
                    .getAttribute('data-loaded')
            )
        )
        .toBeGreaterThanOrEqual(120);
    await expect
        .poll(() =>
            page.evaluate(() =>
                Number(
                    (document.activeElement as HTMLElement).dataset.virtualIndex
                )
            )
        )
        .toBeGreaterThanOrEqual(60);
    expect(await page.locator('.poster-card').count()).toBeLessThanOrEqual(60);
});

test('a query change cancels an in-flight append and its late result cannot repopulate the list', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', { username: 'large', password: 'large' });
    await nav(page, 'Movies');
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
        const url = new URL(route.request().url());
        if (url.searchParams.get('action') === 'get_vod_categories' && once) {
            once = false;
            const response = await route.fetch();
            started();
            await held;
            await route.fulfill({ response }).catch(() => undefined);
        } else await route.continue();
    });
    try {
        await page.locator('main').evaluate((e) => {
            e.scrollTop = e.scrollHeight;
        });
        await pending;
        await page
            .getByLabel('Search this source')
            .fill('no-title-with-this-exact-phrase');
        await expect(page.locator('.virtual-collection')).toHaveAttribute(
            'data-loaded',
            '0'
        );
        release();
        await expect(
            page.getByText('No titles in this category', { exact: false })
        ).toBeVisible();
        await expect(page.locator('.poster-card')).toHaveCount(0);
    } finally {
        release();
    }
});
