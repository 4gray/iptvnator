import { expect, Page, test } from '@playwright/test';
import { addSource, backend, nav, start } from './helpers';

async function geometry(page: Page) {
    return page.evaluate(() => {
        const rect = (s: string) => {
            const r = document.querySelector(s)!.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, bottom: r.bottom };
        };
        const main = document.querySelector('main')!;
        return {
            preview: rect('.preview-placeholder'),
            guide: rect('.programme-list'),
            channels: rect('.channels'),
            overflow: main.scrollHeight > main.clientHeight,
            horizontal: main.scrollWidth > main.clientWidth,
        };
    });
}

test('Live categories use large rows, remote Back restores category/channel focus and browsing keeps preview', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await nav(page, 'TV', false);
    await expect(page.getByLabel('Category', { exact: true })).toHaveCount(0);
    const category = page.locator('.live-category').nth(1);
    const categoryKey = await category.getAttribute('data-focus');
    const categoryName = await category.locator('strong').innerText();
    expect((await category.boundingBox())!.height).toBeGreaterThanOrEqual(80);
    await category.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.channel').first()).toBeFocused();
    await expect(
        page.getByRole('button', { name: 'Back to categories' })
    ).toContainText(categoryName);
    await page.keyboard.press('ArrowDown');
    const channel = page.locator('.channel').nth(1);
    await expect(channel).toBeFocused();
    const channelKey = await channel.getAttribute('data-focus');
    await page.keyboard.press('Enter');
    await expect(page.locator('.native-player.preview')).toBeVisible();
    const src = await page
        .locator('video[src], video source')
        .getAttribute('src');
    await page.keyboard.press('Escape');
    await expect(
        page.locator('[data-focus=' + JSON.stringify(categoryKey) + ']')
    ).toBeFocused();
    await expect(page.locator('video[src], video source')).toHaveAttribute(
        'src',
        src!
    );
    await page.keyboard.press('Enter');
    await expect(
        page.locator('[data-focus=' + JSON.stringify(channelKey) + ']')
    ).toBeFocused();
    await page.getByRole('button', { name: 'Open fullscreen' }).click();
    await expect(page.locator('.fullscreen')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
        page.getByRole('button', { name: 'Open fullscreen' })
    ).toBeFocused();
    await expect(page.locator('.channel')).not.toHaveCount(0);
    await page.getByRole('button', { name: 'Back to categories' }).click();
    await page.locator('[data-focus="live-category:"]').click();
    await expect(page.locator('.channel').first()).toBeFocused();
    await expect(page.locator('video[src], video source')).toHaveAttribute(
        'src',
        src!
    );
});

test('Live uses remaining screen height and EPG scroll never moves the preview or columns', async ({
    page,
}) => {
    await start(page);
    let populated = true;
    await page.route(`${backend}/xtream?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_short_epg'
        )
            return route.continue();
        const now = Math.floor(Date.now() / 1000);
        await route.fulfill({
            json: {
                payload: {
                    epg_listings: populated
                        ? Array.from({ length: 12 }, (_, i) => ({
                              id: String(i),
                              title: btoa(
                                  `Programme ${i} with a longer programme title`
                              ),
                              description: '',
                              start_timestamp: String(now + i * 3600),
                              stop_timestamp: String(now + (i + 1) * 3600),
                          }))
                        : [],
                },
            },
        });
    });
    await addSource(page, 'xtream');
    await nav(page, 'TV');
    await page.locator('.channel').first().focus();
    await expect(page.locator('.programme')).toHaveCount(12);
    for (const viewport of [
        { width: 1920, height: 1080 },
        { width: 1280, height: 720 },
        { width: 960, height: 720 },
    ]) {
        await page.setViewportSize(viewport);
        const before = await geometry(page);
        expect(before.channels.bottom).toBeGreaterThan(viewport.height - 40);
        expect(before.guide.bottom).toBeGreaterThan(viewport.height - 40);
        expect(before.overflow).toBe(false);
        expect(before.horizontal).toBe(false);
        await page.getByRole('region', { name: 'Programme guide' }).focus();
        await page.keyboard.press('ArrowDown');
        await expect
            .poll(() =>
                page.locator('.programme-list').evaluate((e) => e.scrollTop)
            )
            .toBeGreaterThan(0);
        expect((await geometry(page)).preview).toEqual(before.preview);
        populated = false;
        await page.locator('.channel').nth(1).focus();
        await expect(page.locator('.programme')).toHaveCount(0);
        expect(await geometry(page)).toEqual(before);
        populated = true;
        await page.locator('.channel').first().focus();
        await expect(page.locator('.programme')).toHaveCount(12);
    }
    await page.screenshot({
        path: '../../dist/tv-verification/live-browser-960.png',
    });
});

test('many Live categories are windowed and restore a distant category; empty groups allow Back', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/xtream?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_live_categories'
        )
            return route.continue();
        await route.fulfill({
            json: {
                payload: Array.from({ length: 180 }, (_, n) => ({
                    category_id: String(10000 + n),
                    category_name: `Category ${n}`,
                })),
            },
        });
    });
    await addSource(page, 'xtream');
    await nav(page, 'TV', false);
    await expect(page.locator('.virtual-collection')).toHaveAttribute(
        'data-loaded',
        '181'
    );
    expect(await page.locator('.live-category').count()).toBeLessThanOrEqual(
        20
    );
    await page.locator('.channels').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
    });
    const last = page.locator('[data-focus="live-category:10179"]');
    await expect(last).toBeVisible();
    await last.click();
    await expect(page.locator('.empty')).toContainText('No channels');
    await expect(
        page.getByRole('button', { name: 'Back to categories' })
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(last).toBeFocused();
    expect(await page.locator('.live-category').count()).toBeLessThanOrEqual(
        20
    );
    await expect(page.locator('video[src], video source')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.hero')).toBeVisible();
});

test('Live category round trip restores a scrolled channel window without starting a stream', async ({
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
                        group: { title: 'News' },
                    })),
                },
            },
        })
    );
    await addSource(page, 'm3u');
    await nav(page, 'TV');
    await page.locator('.channels').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
    });
    await expect(page.locator('.virtual-collection')).toHaveAttribute(
        'data-loaded',
        '120'
    );
    // Capture a visible card's identity; the rendered window may move on append.
    const id = await page.locator('.channels').evaluate((root) => {
        const viewport = root.getBoundingClientRect();
        return Array.from(root.querySelectorAll('.channel'))
            .find((card) => {
                const r = card.getBoundingClientRect();
                return (
                    r.top >= viewport.top + 100 && r.bottom <= viewport.bottom
                );
            })
            ?.getAttribute('data-focus');
    });
    expect(id).toBeTruthy();
    const last = page.locator('[data-focus=' + JSON.stringify(id) + ']');
    await last.focus();
    await expect(last).toBeFocused();
    const scroll = await page.locator('.channels').evaluate((e) => e.scrollTop);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="live-category:"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
        page.locator('[data-focus=' + JSON.stringify(id) + ']')
    ).toBeFocused();
    await expect
        .poll(() => page.locator('.channels').evaluate((e) => e.scrollTop))
        .toBeGreaterThan(scroll - 120);
    expect(await page.locator('.channel').count()).toBeLessThanOrEqual(20);
    await expect(page.locator('video[src], video source')).toHaveCount(0);
});
