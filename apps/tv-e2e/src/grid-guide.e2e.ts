import { expect, Page, test } from '@playwright/test';
import { addSource, backend, nav, start } from './helpers';
import { playLive, prepareLiveMedia } from './live-media';

const guide = (page: Page) =>
    page.getByRole('dialog', { name: 'Multi-channel programme guide' });
const epg = (prefix: string, stream: string) => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return {
        payload: {
            epg_listings: Array.from({ length: 96 }, (_, index) => ({
                id: `${stream}-${index}`,
                title: btoa(`${prefix} ${stream} show ${index}`),
                description: btoa(
                    `${prefix} description for channel ${stream}, show ${index}`
                ),
                start_timestamp: String(
                    midnight.getTime() / 1000 + index * 1800
                ),
                stop_timestamp: String(
                    midnight.getTime() / 1000 + (index + 1) * 1800
                ),
            })),
        },
    };
};

test('guide details never retain a selected programme outside the visible time window', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/xtream?**`, (route) => {
        const params = new URL(route.request().url()).searchParams;
        const today = epg('Today only', params.get('stream_id') ?? '');
        today.payload.epg_listings = today.payload.epg_listings.slice(0, 48);
        return params.get('action') === 'get_short_epg'
            ? route.fulfill({
                  json: today,
              })
            : route.fallback();
    });
    await addSource(page, 'xtream');
    await playLive(page);
    await page.locator('[data-focus="player-grid"]').click();
    const grid = guide(page);
    await expect(grid.locator('[data-focus="grid-close"]')).toBeFocused();
    const programme = grid.locator('.grid-program[data-grid-row="0"]').first();
    await programme.click();
    await expect(grid.locator('.grid-details h2')).toContainText('Today only');
    await grid.getByRole('button', { name: 'Next day', exact: true }).click();
    await expect(grid.locator('.grid-empty').first()).toContainText(
        'No programme supplied'
    );
    await expect(grid.locator('.grid-details h2')).toHaveText('Live TV');
    await grid
        .getByRole('button', { name: 'Previous day', exact: true })
        .click();
    await expect(grid.locator('.grid-details h2')).toContainText('Today only');
});

for (const provider of ['xtream', 'stalker', 'm3u'] as const) {
    test(`${provider} grid browses without replacing video and Watch live switches explicitly`, async ({
        page,
    }) => {
        await start(page);
        await addSource(page, provider);
        const video = await playLive(page);
        const loads = await video.getAttribute('data-loads');
        await video.evaluate((element) => {
            element.dataset.gridProbe = 'same-node';
        });
        await page.locator('[data-focus="player-grid"]').click();
        const grid = guide(page);
        await expect(grid).toBeVisible();
        await expect(grid.locator('[data-focus="grid-close"]')).toBeFocused();
        const channels = grid.locator('.grid-channel');
        await expect(channels.nth(1)).toBeVisible();
        await channels.first().focus();
        await page.keyboard.press('ArrowDown');
        await expect(channels.nth(1)).toBeFocused();
        const nextTitle = await channels.nth(1).getAttribute('aria-label');
        await page.keyboard.press('ArrowRight');
        await expect(grid.locator('[data-grid-row="1"]:focus')).toHaveClass(
            /grid-(program|empty)/
        );
        await expect(video).toHaveAttribute('data-loads', loads ?? '');
        await expect(video).toHaveAttribute('data-grid-probe', 'same-node');
        expect(
            await video.evaluate((element: HTMLVideoElement) => element.paused)
        ).toBe(false);
        if (provider === 'm3u')
            await expect(grid).toContainText(
                'This source does not supply a programme guide.'
            );
        await page.keyboard.press('Enter');
        await expect(grid.locator('[data-focus="grid-watch"]')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(grid).toBeHidden();
        await expect
            .poll(() => video.getAttribute('data-loads'))
            .not.toBe(loads);
        await expect
            .poll(() =>
                video.evaluate(
                    (element: HTMLVideoElement) =>
                        !element.paused && element.readyState >= 2
                )
            )
            .toBe(true);
        await expect(video).toHaveAttribute('data-grid-probe', 'same-node');
        await expect(page.locator('video')).toHaveCount(1);
        await page.locator('[data-focus="player-grid"]').click();
        await expect(grid.locator('.grid-channel.is-playing')).toHaveAttribute(
            'aria-label',
            nextTitle ?? ''
        );
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-focus="player-grid"]')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('.native-player.preview')).toBeVisible();
        await expect(
            page.locator('[data-focus="live-grid-guide"]')
        ).toBeFocused();
        await page.locator('[data-focus="live-grid-guide"]').click();
        await expect(grid).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(
            page.locator('[data-focus="live-grid-guide"]')
        ).toBeFocused();
        await expect(video).toHaveAttribute('data-grid-probe', 'same-node');
    });
}

test('grid remote moves across supplied programmes, rows and time windows with details and category Back', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/xtream?**`, (route) => {
        const params = new URL(route.request().url()).searchParams;
        return params.get('action') === 'get_short_epg'
            ? route.fulfill({
                  json: epg('Schedule', params.get('stream_id') ?? ''),
              })
            : route.fallback();
    });
    await addSource(page, 'xtream');
    const video = await playLive(page);
    const loads = await video.getAttribute('data-loads');
    await page.locator('[data-focus="player-grid"]').click();
    const grid = guide(page);
    await expect(
        grid.locator('.grid-program[data-grid-row="1"]').first()
    ).toBeVisible();
    await grid.locator('.grid-channel').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(grid.locator('.grid-program:focus')).toHaveAttribute(
        'data-grid-row',
        '0'
    );
    const originalKey = await grid
        .locator('.grid-program:focus')
        .getAttribute('data-grid-key');
    const originalDate = await grid.locator('.grid-date').innerText();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await expect(grid.locator('.grid-program:focus')).not.toHaveAttribute(
        'data-grid-key',
        originalKey ?? ''
    );
    await expect(grid.locator('.grid-date')).not.toHaveText(originalDate);
    await page.keyboard.press('ArrowDown');
    await expect(grid.locator('.grid-program:focus')).toHaveAttribute(
        'data-grid-row',
        '1'
    );
    const secondTitle = await grid
        .locator('.grid-program:focus strong')
        .innerText();
    await expect(grid.locator('.grid-details h2')).toHaveText(secondTitle);
    await expect(grid.locator('.grid-description')).toContainText(
        'description for channel'
    );
    await grid.locator('[data-focus="grid-now"]').click();
    await expect(grid.locator('.grid-date')).toHaveText(originalDate);
    await page.screenshot({
        path: '../../dist/tv-verification/grid-guide-1920.png',
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(grid.locator('[data-focus="grid-watch"]')).toBeInViewport();
    await page.screenshot({
        path: '../../dist/tv-verification/grid-guide-1280.png',
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await grid.locator('[data-focus="grid-category"]').click();
    await expect(grid.locator('.grid-categories')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(grid).toBeVisible();
    await expect(grid.locator('.grid-categories')).toBeHidden();
    await expect(grid.locator('[data-focus="grid-category"]')).toBeFocused();
    await expect(video).toHaveAttribute('data-loads', loads ?? '');
});

test('grid failed initial Watch live stays usable and retries the requested channel', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker');
    const video = await prepareLiveMedia(page);
    let fail = true;
    let attempts = 0;
    await page.route(`${backend}/stalker?**`, (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'create_link'
        )
            return route.fallback();
        attempts++;
        return fail
            ? route.fulfill({ status: 503, body: 'Unavailable' })
            : route.fallback();
    });
    await page.locator('[data-focus="live-grid-guide"]').click();
    const grid = guide(page);
    await grid.locator('.grid-channel').nth(1).focus();
    const title = await grid
        .locator('.grid-channel')
        .nth(1)
        .getAttribute('aria-label');
    await grid.locator('[data-focus="grid-watch"]').click();
    await expect(grid.getByRole('alert')).toContainText(
        'could not be resolved'
    );
    await expect(grid).toBeVisible();
    await expect(grid.locator('[data-focus="grid-watch"]')).toBeEnabled();
    expect(
        await video.evaluate((element: HTMLVideoElement) => element.currentSrc)
    ).toBe('');
    fail = false;
    await grid.locator('[data-focus="grid-watch"]').click();
    await expect(grid).toBeHidden();
    await expect(page.locator('.native-player.fullscreen')).toBeVisible();
    await expect
        .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.currentTime)
        )
        .toBeGreaterThan(0.1);
    expect(attempts).toBe(2);
    await page.locator('[data-focus="player-grid"]').click();
    await expect(grid.locator('.grid-channel.is-playing')).toHaveAttribute(
        'aria-label',
        title ?? ''
    );
});

test('grid keeps a distant opening channel pinned when lazy pages later contain that channel', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/parse?**`, (route) =>
        route.fulfill({
            json: {
                playlist: {
                    items: Array.from({ length: 180 }, (_, n) => ({
                        name: `Pinned channel ${n}`,
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
    for (let index = 0; index < 75; index++) {
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.channel:focus')).toContainText(
            `Pinned channel ${index + 1}`
        );
    }
    await expect(page.locator('.channel:focus')).toContainText(
        'Pinned channel 75'
    );
    await page.keyboard.press('Enter');
    await expect(page.locator('.channel.is-playing')).toContainText(
        'Pinned channel 75'
    );
    await page.getByRole('button', { name: 'Open fullscreen' }).click();
    await page.locator('[data-focus="player-grid"]').click();
    const grid = guide(page);
    const pinned = grid.locator('.grid-channel[data-grid-row="0"]');
    await expect(grid.locator('[data-focus="grid-close"]')).toBeFocused();
    await expect(pinned).toHaveAttribute('aria-label', 'Pinned channel 75');
    await pinned.focus();
    const loads = await video.getAttribute('data-loads');
    await grid.locator('.grid-scroll').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await expect
        .poll(() =>
            grid
                .locator('.grid-row-space')
                .evaluate((element) => element.clientHeight)
        )
        .toBeGreaterThanOrEqual(120 * 88);
    await expect(pinned).toHaveAttribute('aria-label', 'Pinned channel 75');
    await expect(pinned).toBeFocused();
    await expect(
        grid.getByRole('button', { name: 'Pinned channel 75', exact: true })
    ).toHaveCount(1);
    expect(await grid.locator('.grid-channel-row').count()).toBeLessThanOrEqual(
        13
    );
    await expect(video).toHaveAttribute('data-loads', loads ?? '');
});

test('grid lazily reaches distant channels with bounded DOM and switches category without playback', async ({
    page,
}) => {
    await start(page);
    await page.route(`${backend}/parse?**`, (route) =>
        route.fulfill({
            json: {
                playlist: {
                    items: Array.from({ length: 180 }, (_, n) => ({
                        name: `Grid channel ${n}`,
                        url: `http://localhost:3421/live/${n}.m3u8`,
                        group: { title: n % 2 ? 'Sports' : 'News' },
                    })),
                },
            },
        })
    );
    await addSource(page, 'm3u');
    await nav(page, 'TV');
    await page.locator('[data-focus="live-grid-guide"]').click();
    const grid = guide(page);
    await grid.locator('.grid-channel').first().focus();
    for (let index = 0; index < 75; index++) {
        await page.keyboard.press('ArrowDown');
        await expect(grid.locator('.grid-channel:focus')).toHaveAttribute(
            'data-grid-row',
            String(index + 1)
        );
    }
    await expect(grid.locator('.grid-channel:focus')).toHaveAttribute(
        'aria-label',
        'Grid channel 75'
    );
    expect(await grid.locator('.grid-channel-row').count()).toBeLessThanOrEqual(
        13
    );
    await grid.locator('[data-focus="grid-category"]').click();
    await grid.getByRole('button', { name: 'Sports', exact: true }).click();
    await expect(grid.locator('.grid-channel').first()).toHaveAttribute(
        'aria-label',
        'Grid channel 1'
    );
    await expect(grid.locator('[data-focus="grid-category"]')).toContainText(
        'Sports'
    );
    expect(await grid.locator('.grid-channel-row').count()).toBeLessThanOrEqual(
        13
    );
    expect(
        await page
            .locator('video')
            .evaluate((video: HTMLVideoElement) => video.currentSrc)
    ).toBe('');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="live-grid-guide"]')).toBeFocused();
});

test('grid EPG failure can refresh and a closed guide cannot publish a delayed old response', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    const video = await playLive(page);
    const loads = await video.getAttribute('data-loads');
    let mode: 'fail' | 'hold' | 'ready' = 'fail';
    let requests = 0;
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(`${backend}/xtream?**`, async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (params.get('action') !== 'get_short_epg') return route.fallback();
        requests++;
        const requestMode = mode;
        if (requestMode === 'fail')
            return route.fulfill({ status: 503, body: 'Unavailable' });
        if (requestMode === 'hold') await hold;
        try {
            await route.fulfill({
                json: epg(
                    requestMode === 'hold' ? 'STALE' : 'Current',
                    params.get('stream_id') ?? ''
                ),
            });
        } catch {
            /* Closing the guide aborts its own requests. */
        }
    });
    await page.locator('[data-focus="player-grid"]').click();
    const grid = guide(page);
    await expect(grid.locator('.grid-empty').first()).toContainText(
        'Programme unavailable'
    );
    mode = 'ready';
    await grid.getByRole('button', { name: 'Refresh guide' }).click();
    await expect(grid.locator('.grid-program').first()).toContainText(
        'Current'
    );
    mode = 'hold';
    const before = requests;
    await grid.getByRole('button', { name: 'Refresh guide' }).click();
    await expect.poll(() => requests).toBeGreaterThan(before);
    await page.keyboard.press('Escape');
    mode = 'ready';
    await page.locator('[data-focus="player-grid"]').click();
    await expect(grid.locator('.grid-program').first()).toContainText(
        'Current'
    );
    release();
    await page.waitForTimeout(250);
    await expect(grid).not.toContainText('STALE');
    await expect(video).toHaveAttribute('data-loads', loads ?? '');
    expect(
        await video.evaluate((element: HTMLVideoElement) => element.paused)
    ).toBe(false);
});
