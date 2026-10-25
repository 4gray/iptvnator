import { expect, test } from '@playwright/test';
import { addSource, backend, nav, start } from './helpers';
import { playLive } from './live-media';

test('remote Stop tears down fullscreen live playback instead of returning to preview', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    const video = await playLive(page);
    await page.evaluate(() =>
        document.dispatchEvent(
            new KeyboardEvent('keydown', { keyCode: 413, bubbles: true })
        )
    );
    await expect(page.locator('video[src], video source')).toHaveCount(0);
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
        .toBe(true);
    await expect(page.locator('.native-player')).toBeHidden();
    await expect(page.locator('.channel').first()).toBeFocused();
});

test('delayed catalog append does not steal focus after moving to search', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', { username: 'large', password: 'large' });
    await nav(page, 'Movies');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    let requested = false;
    await page.route(`${backend}/xtream?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') ===
            'get_vod_categories'
        ) {
            requested = true;
            await held;
        }
        await route.continue();
    });
    try {
        await page.locator('.poster-card[data-virtual-index="59"]').focus();
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => requested).toBe(true);
        const search = page.getByLabel('Search this source');
        await search.focus();
        await expect(search).toBeInViewport();
        release();
        await expect(page.locator('.virtual-collection')).toHaveAttribute(
            'data-loaded',
            '120'
        );
        await expect(search).toBeFocused();
        await expect(search).toBeInViewport();
    } finally {
        release();
    }
});

test('native playback error retries the currently playing channel', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker');
    const video = await playLive(page);
    const original = await page
        .locator('video[src], video source')
        .getAttribute('src');
    const loads = await video.getAttribute('data-loads');
    await video.evaluate((v) => v.dispatchEvent(new Event('error')));
    const controls = page.locator('.player-controls');
    await expect(controls.getByRole('alert')).toContainText(
        'could not be played'
    );
    await controls.getByRole('button', { name: 'Retry playback' }).click();
    await expect.poll(() => video.getAttribute('data-loads')).not.toBe(loads);
    await expect(page.locator('video[src], video source')).toHaveAttribute(
        'src',
        original!
    );
    await expect
        .poll(() =>
            video.evaluate(
                (v: HTMLVideoElement) => !v.paused && v.readyState >= 2
            )
        )
        .toBe(true);
    await expect(controls.getByRole('alert')).toHaveCount(0);
});

test('HLS source rejection exposes retry and replaces the failed source', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    const video = await playLive(page);
    const source = page.locator('video source');
    await expect(source).toHaveCount(1);
    const loads = await video.getAttribute('data-loads');
    await source.evaluate((s) => s.dispatchEvent(new Event('error')));
    const controls = page.locator('.player-controls');
    await expect(controls.getByRole('alert')).toContainText(
        'could not be played'
    );
    await controls.getByRole('button', { name: 'Retry playback' }).click();
    await expect.poll(() => video.getAttribute('data-loads')).not.toBe(loads);
    await expect(source).toHaveCount(1);
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
    await expect(controls.getByRole('alert')).toHaveCount(0);
});

for (const exit of ['close', 'categories'] as const) {
    test(`abandoning grid through ${exit} cancels a pending channel resolution`, async ({
        page,
    }) => {
        await start(page);
        await addSource(page, 'stalker');
        const video = await playLive(page);
        const original = await page
            .locator('video[src], video source')
            .getAttribute('src');
        const loads = await video.getAttribute('data-loads');
        await page.locator('[data-focus="player-grid"]').click();
        const grid = page.getByRole('dialog', {
            name: 'Multi-channel programme guide',
        });
        await expect(grid.locator('[data-focus="grid-close"]')).toBeFocused();
        await grid.locator('.grid-channel').first().focus();
        await page.keyboard.press('ArrowDown');
        await expect(grid.locator('.grid-channel').nth(1)).toBeFocused();
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        let received = false;
        let settled = false;
        await page.route(`${backend}/stalker?**`, async (route) => {
            if (
                new URL(route.request().url()).searchParams.get('action') !==
                'create_link'
            )
                return route.fallback();
            const response = await route.fetch();
            received = true;
            await held;
            try {
                await route.fulfill({ response });
            } catch {
                /* Aborted by leaving the guide. */
            }
            settled = true;
        });
        try {
            await grid.locator('[data-focus="grid-watch"]').click();
            await expect.poll(() => received).toBe(true);
            await grid
                .locator(
                    `[data-focus="grid-${exit === 'close' ? 'close' : 'category'}"]`
                )
                .click();
            if (exit === 'close') await expect(grid).toBeHidden();
            else await expect(grid.locator('.grid-categories')).toBeVisible();
            release();
            await expect.poll(() => settled).toBe(true);
            await page.waitForTimeout(250);
            await expect(video).toHaveAttribute('data-loads', loads!);
            await expect(
                page.locator('video[src], video source')
            ).toHaveAttribute('src', original!);
            expect(
                await video.evaluate((v: HTMLVideoElement) => v.paused)
            ).toBe(false);
        } finally {
            release();
        }
    });
}

test('a failed fullscreen retry keeps recovery controls available for another attempt', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker');
    const video = await playLive(page);
    let failed = true;
    await page.route(`${backend}/stalker?**`, (route) =>
        failed &&
        new URL(route.request().url()).searchParams.get('action') ===
            'create_link'
            ? route.fulfill({ status: 503, body: 'Unavailable' })
            : route.fallback()
    );
    await video.evaluate((v) => v.dispatchEvent(new Event('error')));
    const controls = page.locator('.player-controls');
    await controls.getByRole('button', { name: 'Retry playback' }).click();
    await expect(controls.getByRole('alert')).toContainText(
        'could not be restarted'
    );
    await expect(page.locator('.native-player.fullscreen')).toBeVisible();
    await expect(
        controls.getByRole('button', { name: 'Retry playback' })
    ).toBeVisible();
    failed = false;
    await controls.getByRole('button', { name: 'Retry playback' }).click();
    await expect
        .poll(() =>
            video.evaluate(
                (v: HTMLVideoElement) => !v.paused && v.readyState >= 2
            )
        )
        .toBe(true);
    await expect(controls.getByRole('alert')).toHaveCount(0);
});
