import { playLive } from './live-media';
import { expect, test } from '@playwright/test';
import { addSource, backend, start } from './helpers';

for (const provider of ['xtream', 'stalker', 'm3u'] as const) {
    test(`${provider} fullscreen channels keep native playback, switch only on OK and restore focus`, async ({
        page,
    }) => {
        await start(page);
        await addSource(page, provider);
        const video = await playLive(page);
        const loads = await video.getAttribute('data-loads');
        await page
            .getByRole('button', { name: 'Channels', exact: true })
            .click();
        const drawer = page.getByRole('dialog', { name: 'Channel browser' });
        await expect(drawer).toBeVisible();
        await expect(drawer.locator('.channel.is-playing')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(drawer.locator('.channel').nth(1)).toBeFocused();
        await expect(video).toHaveAttribute('data-loads', loads!);
        expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(
            false
        );
        await page.keyboard.press('Enter');
        await expect(drawer.locator('.channel').nth(1)).toHaveClass(
            /is-playing/
        );
        const playingKey = await drawer
            .locator('.channel.is-playing')
            .getAttribute('data-focus');
        const switchedLoads = await video.getAttribute('data-loads');
        await drawer
            .getByRole('button', { name: 'Back to categories' })
            .click();
        await expect(drawer.locator('.live-category').first()).toBeVisible();
        await expect(video).toHaveAttribute('data-loads', switchedLoads!);
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await expect(
            page.locator('[data-focus="player-channels"]')
        ).toBeFocused();
        await page
            .getByRole('button', { name: 'Channels', exact: true })
            .click();
        await expect(
            drawer.locator('[data-focus=' + JSON.stringify(playingKey) + ']')
        ).toBeFocused();
        await expect(video).toHaveAttribute('data-loads', switchedLoads!);
        expect(await page.locator('video').count()).toBe(1);
        expect(await drawer.locator('.channel').count()).toBeLessThanOrEqual(
            20
        );
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(page.locator('.native-player.preview')).toBeVisible();
    });
}

test('expanded guide shows supplied days and descriptions, windows rows and keeps playback', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/xtream?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_short_epg'
        )
            return route.continue();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        await route.fulfill({
            json: {
                payload: {
                    epg_listings: Array.from({ length: 96 }, (_, i) => ({
                        id: String(i),
                        title: btoa(`Programme ${i}`),
                        description: btoa(`Details ${i}. `.repeat(240)),
                        start_timestamp: String(
                            midnight.getTime() / 1000 + i * 1800
                        ),
                        stop_timestamp: String(
                            midnight.getTime() / 1000 + (i + 1) * 1800
                        ),
                    })),
                },
            },
        });
    });
    await addSource(page, 'xtream');
    const video = await playLive(page);
    const loads = await video.getAttribute('data-loads');
    await page.getByRole('button', { name: 'Programme', exact: true }).click();
    const guide = page.getByRole('dialog', {
        name: 'Expanded programme guide',
    });
    await expect(guide).toBeVisible();
    await expect(guide.locator('[data-focus="guide-close"]')).toBeFocused();
    await expect(guide.locator('[data-focus^="guide-day-"]')).toHaveCount(2);
    await guide.getByRole('button', { name: 'Now', exact: true }).click();
    await expect(
        guide.locator('.programme-guide-row[aria-pressed="true"]')
    ).toBeFocused();
    await expect(
        guide.getByRole('region', { name: 'Programme description' })
    ).toContainText('Details');
    await guide.locator('[data-focus^="guide-day-"]').last().click();
    await guide.locator('.programme-guide-row').first().focus();
    for (let i = 0; i < 28; i++) await page.keyboard.press('ArrowDown');
    await expect(guide.locator('[data-programme-index="28"]')).toBeFocused();
    expect(
        await guide.locator('.programme-guide-row').count()
    ).toBeLessThanOrEqual(21);
    await page.keyboard.press('ArrowRight');
    await expect(
        guide.getByRole('region', { name: 'Programme description' })
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    expect(
        await guide
            .locator('.programme-guide-details')
            .evaluate((e) => e.scrollTop)
    ).toBeGreaterThan(0);
    await guide.getByRole('button', { name: 'Now', exact: true }).click();
    await expect(guide.locator('.programme-guide-state')).toHaveText(
        'Now playing'
    );
    await page.screenshot({
        path: '../../dist/tv-verification/overlay-guide-1920.png',
    });
    await expect(video).toHaveAttribute('data-loads', loads!);
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="player-guide"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Expand guide' }).click();
    await expect(guide).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
        page.locator('[data-focus="live-expand-guide"]')
    ).toBeFocused();
    await expect(video).toHaveAttribute('data-loads', loads!);
});

test('Left opens hidden live controls directly into channels; absent EPG remains usable', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'm3u');
    const video = await playLive(page);
    await page.mouse.move(1800, 500);
    await expect(page.locator('.player-controls')).toHaveClass(/dormant/, {
        timeout: 10000,
    });
    await page.keyboard.press('ArrowLeft');
    const drawer = page.getByRole('dialog', { name: 'Channel browser' });
    await expect(drawer).toBeVisible();
    await drawer
        .getByRole('button', { name: 'Programme', exact: true })
        .click();
    const guide = page.getByRole('dialog', {
        name: 'Expanded programme guide',
    });
    await expect(guide).toContainText('No programme information supplied.');
    await page.keyboard.press('Escape');
    await expect(guide).toBeHidden();
    await expect(page.locator('.native-player.fullscreen')).toBeVisible();
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
});

test('returning to playing channel cancels a delayed switch; failed switch retry targets the requested channel', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker');
    const video = await playLive(page);
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Channel browser' });
    const first = drawer.locator('.channel').first();
    const second = drawer.locator('.channel').nth(1);
    const originalKey = await first.getAttribute('data-focus');
    const nextKey = await second.getAttribute('data-focus');
    const loads = await video.getAttribute('data-loads');
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
        release = resolve;
    });
    let requests = 0;
    let mode: 'hold' | 'fail' | 'success' = 'hold';
    await page.route(`${backend}/stalker?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'create_link'
        )
            return route.fallback();
        requests++;
        if (mode === 'fail')
            return route.fulfill({ status: 503, body: 'Unavailable' });
        const response = await route.fetch();
        if (mode === 'hold') await hold;
        try {
            await route.fulfill({ response });
        } catch {
            /* Latest selection aborts the old request. */
        }
    });
    await second.click();
    await expect.poll(() => requests).toBe(1);
    await first.click();
    release();
    await page.waitForTimeout(300);
    await expect(drawer.locator('.channel.is-playing')).toHaveAttribute(
        'data-focus',
        originalKey!
    );
    await expect(video).toHaveAttribute('data-loads', loads!);
    mode = 'fail';
    await second.click();
    await expect(drawer.getByRole('alert')).toContainText(
        'could not be resolved'
    );
    await expect(drawer.locator('.channel.is-playing')).toHaveAttribute(
        'data-focus',
        originalKey!
    );
    mode = 'success';
    await drawer.getByRole('button', { name: 'Retry playback' }).click();
    await expect(drawer.locator('.channel.is-playing')).toHaveAttribute(
        'data-focus',
        nextKey!
    );
    await expect(drawer.getByRole('alert')).toHaveCount(0);
});

test('channel drawer restores a playing row beyond its first window and preserves category browsing', async ({
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
    const video = await playLive(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="live-fullscreen"]')).toBeFocused();
    await page.locator('.channel').first().focus();
    for (let i = 0; i < 75; i++) await page.keyboard.press('ArrowDown');
    const distant = page.locator('.channel:focus');
    await expect(distant).toContainText('Channel 75');
    const key = await distant.getAttribute('data-focus');
    await page.keyboard.press('Enter');
    await expect(page.locator('.channel.is-playing')).toHaveAttribute(
        'data-focus',
        key!
    );
    await page.getByRole('button', { name: 'Open fullscreen' }).click();
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Channel browser' });
    await expect(drawer.locator('.channel:focus')).toHaveAttribute(
        'data-focus',
        key!
    );
    expect(
        await drawer.locator('.channel:focus').evaluate((e) => {
            const r = e.getBoundingClientRect(),
                pane = e.closest('.channels')!.getBoundingClientRect();
            return r.top >= pane.top && r.bottom <= pane.bottom;
        })
    ).toBe(true);
    expect(await drawer.locator('.channel').count()).toBeLessThanOrEqual(20);
    const loads = await video.getAttribute('data-loads');
    await drawer.getByRole('button', { name: 'Back to categories' }).click();
    await drawer.locator('.live-category').nth(1).click();
    await expect(drawer.locator('.channel').first()).toBeFocused();
    await expect(video).toHaveAttribute('data-loads', loads!);
    await page.screenshot({
        path: '../../dist/tv-verification/overlay-drawer-1920.png',
    });
});
