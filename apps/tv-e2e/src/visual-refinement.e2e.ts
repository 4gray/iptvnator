import { expect, test } from '@playwright/test';
import { addSource, backend, nav, start } from './helpers';

test('compact page headers leave room for posters and remove prototype chrome at TV widths', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', {
        username: 'marketing',
        password: 'marketing',
    });
    await nav(page, 'Movies');
    await expect(page.locator('.poster-card').first()).toBeVisible();
    for (const width of [1920, 1280, 960]) {
        await page.setViewportSize({ width, height: 1080 });
        const geometry = await page.evaluate(() => {
            const heading = document
                .querySelector('h1')!
                .getBoundingClientRect();
            const count = document
                .querySelector('.catalog-count')!
                .getBoundingClientRect();
            const source = document
                .querySelector('[aria-label="Active source"]')!
                .getBoundingClientRect();
            const poster = document
                .querySelector('.poster-art')!
                .getBoundingClientRect();
            return {
                headingTop: heading.top,
                countTop: count.top,
                sourceLeft: source.left,
                headingRight: heading.right,
                posterTop: poster.top,
                ratio: poster.height / poster.width,
                overflow:
                    document.querySelector('main')!.scrollWidth >
                    document.querySelector('main')!.clientWidth,
            };
        });
        expect(geometry.headingTop).toBeLessThan(65);
        expect(geometry.countTop).toBeLessThan(110);
        expect(geometry.headingRight).toBeLessThan(geometry.sourceLeft);
        expect(geometry.posterTop).toBeLessThan(240);
        expect(geometry.ratio).toBeCloseTo(1.5, 1);
        expect(geometry.overflow).toBe(false);
    }
    await expect(page.locator('.brand-caption, footer')).toHaveCount(0);
    await expect(page.locator('.catalog-count')).not.toContainText('TV xtream');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('.detail-hero')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(
        'THE EVENING IS YOURS'
    );
    await expect(page.locator('main')).not.toContainText(
        'IPTVnator TV · Prototype'
    );
    await expect(page.locator('main')).not.toContainText('Arrows · OK · Back');
    await expect(page.locator('[data-focus="detail-back"]')).toBeVisible();
});

test('favorites separate movies, series and compact TV cards, preserving detail focus and saved data', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', {
        username: 'marketing',
        password: 'marketing',
    });
    for (const view of ['Movies', 'Series']) {
        await nav(page, view);
        await page.locator('.poster-card').first().click();
        await page.getByRole('button', { name: 'Add to favorites' }).click();
        await expect(
            page.getByRole('button', { name: 'Saved', exact: false }).first()
        ).toBeVisible();
    }
    await nav(page, 'TV');
    await page.locator('.channel').first().focus();
    await page.getByRole('button', { name: 'Favorite channel' }).click();
    await nav(page, 'Favorites');
    const types = page.getByRole('group', { name: 'Favorite type' });
    await expect(
        types.getByRole('button', { name: 'Movies 1' })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.poster-card')).toHaveCount(1);
    await expect(page.locator('.channel-card')).toHaveCount(0);
    await types.getByRole('button', { name: 'Series 1' }).click();
    const card = page.locator('.poster-card').first();
    await card.click();
    await expect(page.locator('.detail-hero')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toBeFocused();
    await expect(
        types.getByRole('button', { name: 'Series 1' })
    ).toHaveAttribute('aria-pressed', 'true');
    await types.getByRole('button', { name: 'TV 1' }).click();
    await expect(page.locator('.catalog-count')).toHaveText('1 channel');
    await expect(page.locator('.poster-card')).toHaveCount(0);
    await expect(page.locator('.channel-card')).toHaveCount(1);
    expect(
        (await page.locator('.channel-card').boundingBox())!.height
    ).toBeLessThan(130);
    await page.locator('.channel-card').hover();
    await expect(page.locator('.channel-card')).toBeFocused();
    await expect(page.locator('video[src], video source')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.loading')).toBeHidden();
    await nav(page, 'Favorites');
    await expect(types.getByRole('button', { name: 'TV 1' })).toBeVisible();
    await expect(types.getByRole('button', { name: 'Movies 1' })).toBeVisible();
    await expect(types.getByRole('button', { name: 'Series 1' })).toBeVisible();
});

test('continue watching includes a loaded poster, real progress and the same resume action after relaunch', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', {
        username: 'marketing',
        password: 'marketing',
    });
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.getByRole('button', { name: 'Watch now' }).click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((e: HTMLVideoElement) => e.readyState)
        )
        .toBeGreaterThan(1);
    await page.getByLabel('Playback position').fill('8');
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.keyboard.press('Escape');
    await page.reload();
    const resume = page.locator('.resume-card').first();
    await expect(resume).toBeVisible();
    await expect
        .poll(() =>
            resume
                .locator('img')
                .evaluate((e: HTMLImageElement) => e.naturalWidth)
        )
        .toBeGreaterThan(0);
    await expect
        .poll(() =>
            resume
                .locator('progress')
                .evaluate((e: HTMLProgressElement) => e.value)
        )
        .toBeGreaterThan(7);
    await expect(resume).toContainText('Resume');
    await resume.click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((e: HTMLVideoElement) => e.currentTime)
        )
        .toBeGreaterThan(7);
    await page.keyboard.press('Escape');
    await expect(resume).toBeFocused();
});

test('channel logos fall back to an SVG for missing and broken images in live TV and favorites', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/xtream?**`, async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        if (
            new URL(route.request().url()).searchParams.get('action') ===
            'get_live_streams'
        ) {
            data.payload[0].stream_icon = '';
            data.payload[1].stream_icon =
                'http://127.0.0.1:3421/missing-channel-logo.png';
        }
        await route.fulfill({ response, json: data });
    });
    await addSource(page, 'xtream');
    await nav(page, 'TV');
    const channels = page.locator('.channel');
    await expect(channels.nth(0).locator('.channel-logo svg')).toBeVisible();
    await expect(channels.nth(1).locator('.channel-logo img')).toBeHidden();
    await expect(channels.nth(1).locator('.channel-logo svg')).toBeVisible();
    for (const n of [0, 1]) {
        await channels.nth(n).focus();
        await page.getByRole('button', { name: 'Favorite channel' }).click();
        await expect(
            page.getByRole('button', { name: 'Favorite channel' })
        ).toContainText('Saved');
    }
    await nav(page, 'Favorites');
    await page
        .getByRole('group', { name: 'Favorite type' })
        .getByRole('button', { name: 'TV 2' })
        .click();
    await expect(page.locator('.channel-card')).toHaveCount(2);
    await expect(page.locator('.channel-card img')).toBeHidden();
    await expect(page.locator('.channel-card svg')).toHaveCount(2);
    await page.locator('.channel-card').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.channel-card').nth(1)).toBeFocused();
});

test('historical Stalker favorites and progress recover raw covers without rewriting playback data', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { mac: '00:1A:79:00:00:07' });
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(
        page.getByRole('button', { name: 'Saved', exact: false }).first()
    ).toBeVisible();
    await page.evaluate(
        () =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open('iptvnator-tv-user-data', 1);
                request.onsuccess = () => {
                    const db = request.result;
                    const tx = db.transaction('state', 'readwrite');
                    const store = tx.objectStore('state');
                    const read = store.get('user');
                    read.onsuccess = () => {
                        const saved = read.result;
                        const item = saved.data.favorites[0];
                        // Reproduce a historical snapshot from before the artwork mapper fix.
                        item.raw.cover = '';
                        item.raw.screenshot_uri = new URL(item.poster).pathname;
                        delete item.poster;
                        const progress = {
                            item,
                            seconds: 90,
                            duration: 600,
                            updated: Date.now(),
                        };
                        saved.data.history = [progress];
                        saved.data.positions[item.id] = progress;
                        store.put(saved, 'user');
                    };
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(new Error('Fixture write failed'));
                    };
                };
            })
    );
    await page.reload();
    const resume = page.locator('.resume-card');
    await expect(resume.locator('img')).toHaveAttribute(
        'src',
        /\/assets\/marketing\/poster\//
    );
    await expect(resume.locator('progress')).toHaveAttribute('value', '90');
    await expect(resume.locator('progress')).toHaveAttribute('max', '600');
    await expect
        .poll(() =>
            resume
                .locator('img')
                .evaluate((e: HTMLImageElement) => e.naturalWidth)
        )
        .toBeGreaterThan(0);
    await nav(page, 'Favorites');
    await expect(page.locator('.poster-card img')).toHaveAttribute(
        'src',
        /\/assets\/marketing\/poster\//
    );
});
