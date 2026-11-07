import { expect, test, type Page } from '@playwright/test';
import type { UserData } from '@iptvnator/tv/util';
import { addSource, backend, chooseTv, nav, start } from './helpers';
import { playLive, prepareLiveMedia } from './live-media';

async function saved(page: Page): Promise<UserData> {
    return page.evaluate(
        () =>
            new Promise<UserData>((resolve, reject) => {
                const open = indexedDB.open('iptvnator-tv-user-data', 1);
                open.onsuccess = () => {
                    const db = open.result;
                    const read = db
                        .transaction('state')
                        .objectStore('state')
                        .get('user');
                    read.onsuccess = () => {
                        db.close();
                        resolve(read.result.data);
                    };
                    read.onerror = () => {
                        db.close();
                        reject(read.error);
                    };
                };
                open.onerror = () => reject(open.error);
            })
    );
}

async function drawerChannel(page: Page, index: number) {
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Channel browser' });
    const row = drawer.locator('.channel').nth(index);
    const id = (await row.getAttribute('data-focus'))!;
    await row.click();
    await expect
        .poll(async () => (await saved(page)).history[0]?.item.id)
        .toBe(id);
    await page.keyboard.press('Escape');
    return id;
}

for (const control of ['player-back', 'player-playlist']) {
    test(`TV daily comfort ${control} retires a pending Previous before leaving fullscreen`, async ({
        page,
    }) => {
        await start(page);
        await addSource(page, 'stalker', { name: 'Synthetic Live' });
        const video = await playLive(page);
        await drawerChannel(page, 0);
        const current = await drawerChannel(page, 1);
        const loads = await video.getAttribute('data-loads');
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        let requests = 0;
        await page.route(`${backend}/stalker?**`, async (route) => {
            if (
                new URL(route.request().url()).searchParams.get('action') !==
                'create_link'
            )
                return route.fallback();
            requests++;
            const response = await route.fetch();
            await held;
            try {
                await route.fulfill({ response });
            } catch {
                /* Canceled request. */
            }
        });
        try {
            await page.locator('[data-focus="player-previous"]').click();
            await expect.poll(() => requests).toBe(1);
            await page.locator(`[data-focus="${control}"]`).click();
            await expect(page.locator('.native-player.preview')).toBeVisible();
            release();
            await page.waitForTimeout(500);
            await expect(page.locator('.native-player.preview')).toBeVisible();
            await expect(video).toHaveAttribute('data-loads', loads!);
            expect((await saved(page)).history[0].item.id).toBe(current);
        } finally {
            release();
        }
    });
}

test('TV daily comfort an older delayed launch cannot borrow a newer manual watched revision', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { name: 'Synthetic Movies' });
    await prepareLiveMedia(page);
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    let requests = 0;
    await page.route(`${backend}/stalker?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'create_link'
        )
            return route.fallback();
        requests++;
        const response = await route.fetch();
        await held;
        try {
            await route.fulfill({ response });
        } catch {
            /* Retired playback. */
        }
    });
    try {
        await page.locator('[data-focus="detail-play"]').click();
        await expect.poll(() => requests).toBe(1);
        await page
            .getByRole('button', { name: 'Mark watched', exact: true })
            .click();
        await expect(page.locator('.watch-status').first()).toContainText(
            'Watched'
        );
        const marked = Object.values((await saved(page)).positions)[0];
        expect(marked.watched).toBe(true);
        release();
        await expect
            .poll(() =>
                page
                    .locator('video')
                    .evaluate((v: HTMLVideoElement) => v.currentTime)
            )
            .toBeGreaterThan(0.1);
        await page.getByRole('button', { name: 'Pause', exact: false }).click();
        await expect
            .poll(
                async () =>
                    (await saved(page)).positions[marked.item.id]?.watched
            )
            .toBe(true);
        expect((await saved(page)).positions[marked.item.id].revision).toBe(
            marked.revision
        );
    } finally {
        release();
    }
});

test('TV daily comfort VOD resume ended Next and Live Previous share one player and preserve saved state', async ({
    page,
}) => {
    await start(page);
    await page.route('**/xtream?**', async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_series_info'
        )
            return route.fallback();
        return route.fulfill({
            json: {
                payload: {
                    info: { plot: 'An invented two-season journey.' },
                    episodes: {
                        '1': [
                            {
                                id: '71001',
                                season: 1,
                                episode_num: 1,
                                title: 'Opening',
                                container_extension: 'mp4',
                            },
                        ],
                        '2': [
                            {
                                id: '79003',
                                season: 2,
                                episode_num: 1,
                                title: 'New shore',
                                container_extension: 'mp4',
                            },
                        ],
                    },
                },
            },
        });
    });
    await addSource(page, 'xtream', { name: 'Synthetic Home' });
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    const primary = page.locator('[data-focus="detail-play"]');
    const firstEpisode = (await page
        .locator('.episode')
        .first()
        .getAttribute('data-focus'))!;
    await page
        .getByRole('button', { name: 'Add to favorites', exact: false })
        .click();
    await primary.click();
    const video = page.locator('video');
    const original = await video.elementHandle();
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
    await page.getByLabel('Playback position').fill('8');
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.keyboard.press('Escape');
    await expect(primary).toContainText('Resume');
    await primary.click();
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThanOrEqual(7.5);
    await video.evaluate((v: HTMLVideoElement) => {
        v.pause();
        Object.defineProperty(v, 'duration', {
            configurable: true,
            value: Infinity,
        });
        Object.defineProperty(v, 'ended', { configurable: true, value: true });
        v.dispatchEvent(new Event('ended'));
        v.addEventListener(
            'loadstart',
            () => {
                Reflect.deleteProperty(v, 'duration');
                Reflect.deleteProperty(v, 'ended');
            },
            { once: true }
        );
    });
    await expect(page.locator('[data-focus="player-next"]')).toBeFocused();
    await page.screenshot({
        path: test.info().outputPath('episode-complete.png'),
    });
    await page.locator('[data-focus="player-next"]').click();
    await expect(page.locator('.player-bottom')).toContainText('New shore');
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.keyboard.press('Escape');
    await nav(page, 'Home');
    await expect(page.locator('.resume-card')).toHaveCount(1);
    const favorites = (await saved(page)).favorites.map((item) => item.id);

    await playLive(page);
    const firstChannel = await drawerChannel(page, 0);
    await drawerChannel(page, 1);
    await page.locator('[data-focus="player-previous"]').click();
    await expect
        .poll(async () => (await saved(page)).history[0]?.item.id)
        .toBe(firstChannel);
    expect(
        await original!.evaluate(
            (node) => node === document.querySelector('video')
        )
    ).toBe(true);
    await page.keyboard.press('Escape');
    await nav(page, 'Home');
    const recents = page.getByRole('region', {
        name: 'Recent channels',
        exact: true,
    });
    await expect(recents.locator('.channel-card')).toHaveCount(2);
    await expect(page.locator('.resume-card')).toHaveCount(1);
    expect((await saved(page)).positions[firstEpisode].watched).toBe(true);
    await page.screenshot({ path: test.info().outputPath('home-comfort.png') });

    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await chooseTv(page, 'Season', '2');
    const watchActions = page
        .locator('.episode-entry [role="combobox"]')
        .first();
    const actionLabel = (await watchActions.getAttribute('aria-label'))!;
    await chooseTv(page, actionLabel, 'reset');
    await expect(primary).toContainText('Continue · S2 · E1');
    await nav(page, 'Home');
    await page.reload();
    await expect(recents.locator('.channel-card')).toHaveCount(2);
    await expect(page.locator('.resume-card')).toContainText('New shore');
    expect((await saved(page)).favorites.map((item) => item.id)).toEqual(
        favorites
    );
    expect((await saved(page)).positions[firstEpisode].watched).toBe(true);
    await expect(page.locator('video[src],video source')).toHaveCount(0);
});
