import { expect, Page, test } from '@playwright/test';
import { addSource, cardAction, chooseTv, nav, start } from './helpers';

async function editSaved(
    page: Page,
    edit: 'complete' | 'historical' | 'historical-complete'
) {
    await page.evaluate(
        (action) =>
            new Promise<void>((resolve, reject) => {
                const r = indexedDB.open('iptvnator-tv-user-data', 1);
                r.onsuccess = () => {
                    const db = r.result;
                    const tx = db.transaction('state', 'readwrite');
                    const store = tx.objectStore('state');
                    const read = store.get('user');
                    read.onsuccess = () => {
                        const saved = read.result;
                        saved.data.retainedExtension = { synthetic: 7 };
                        for (const p of [
                            ...saved.data.history,
                            ...Object.values(saved.data.positions),
                        ] as {
                            seconds: number;
                            duration: number;
                            item: Record<string, unknown>;
                        }[]) {
                            p.seconds = action === 'historical' ? 600 : 3240;
                            p.duration = 3600;
                            if (action !== 'complete')
                                delete p.item.parentSeries;
                            if (action === 'historical-complete')
                                delete p.item.seriesTitle;
                        }
                        store.put(saved, 'user');
                    };
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(Error('Synthetic save failed'));
                    };
                };
            }),
        edit
    );
}
async function watchMovie(page: Page) {
    await start(page);
    await addSource(page, 'xtream');
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.locator('[data-focus="detail-play"]').click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(0.1);
    await page.keyboard.press('Escape');
}
test('TV VOD comfort completed movie never says Resume after historical schema-1 reload', async ({
    page,
}) => {
    await watchMovie(page);
    await editSaved(page, 'complete');
    await page.reload();
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('[data-focus="detail-play"]')).toContainText(
        'Watch again'
    );
    await expect(page.locator('.watch-status').first()).toContainText(
        'Watched'
    );
});

async function syntheticSeries(page: Page) {
    await page.route('**/xtream?**', async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (action === 'get_series_info')
            return route.fulfill({
                json: {
                    payload: {
                        info: {
                            plot: 'An invented journey between two seasons.',
                        },
                        episodes: {
                            '0': [
                                {
                                    id: '80000',
                                    season: 0,
                                    episode_num: 1,
                                    title: 'Synthetic extra',
                                    container_extension: 'mp4',
                                },
                            ],
                            '1': [
                                {
                                    id: '81001',
                                    season: 1,
                                    episode_num: 1,
                                    title: 'Departure',
                                    container_extension: 'mp4',
                                },
                                {
                                    id: '81007',
                                    season: 1,
                                    episode_num: 4,
                                    title: 'The crossing',
                                    container_extension: 'mp4',
                                },
                            ],
                            '2': [
                                {
                                    id: '99003',
                                    season: 2,
                                    episode_num: 1,
                                    title: 'Arrival',
                                    container_extension: 'mp4',
                                },
                            ],
                        },
                    },
                },
            });
        if (action !== 'get_series') return route.fallback();
        const response = await route.fetch();
        const json = await response.json();
        json.payload.forEach((r: Record<string, unknown>, i: number) => {
            r.name = `Synthetic Journey ${i + 1}`;
            r.cover = '';
        });
        await route.fulfill({ response, json });
    });
}
async function endedUnknown(page: Page) {
    await page.locator('video').evaluate((v: HTMLVideoElement) => {
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
}

test('TV VOD comfort manual marks commit before display, recover from quota and preserve schema-1 data', async ({
    page,
}) => {
    await watchMovie(page);
    await editSaved(page, 'historical');
    await page.reload();
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        window.addEventListener(
            'release-quota',
            () => {
                IDBObjectStore.prototype.put = put;
            },
            { once: true }
        );
        IDBObjectStore.prototype.put = function () {
            throw new DOMException('Synthetic quota', 'QuotaExceededError');
        };
    });
    await page
        .getByRole('button', { name: 'Mark watched', exact: true })
        .click();
    await expect(
        page.getByRole('button', { name: 'Retry viewing status' })
    ).toBeVisible();
    await expect(page.locator('[data-focus="detail-play"]')).toContainText(
        'Resume'
    );
    await page.evaluate(() => window.dispatchEvent(new Event('release-quota')));
    await page.getByRole('button', { name: 'Retry viewing status' }).click();
    await expect(page.locator('[data-focus="detail-play"]')).toContainText(
        'Watch again'
    );
    await page
        .getByRole('button', { name: 'Reset progress', exact: true })
        .click();
    await expect(page.locator('[data-focus="detail-play"]')).toBeFocused();
    await expect(page.locator('[data-focus="detail-play"]')).toContainText(
        'Watch now'
    );
    await page.reload();
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('[data-focus="detail-play"]')).toContainText(
        'Watch now'
    );
    await expect(
        page.getByRole('button', { name: 'Saved', exact: false }).first()
    ).toBeVisible();
    const retained = await page.evaluate(
        () =>
            new Promise<boolean>((resolve) => {
                const r = indexedDB.open('iptvnator-tv-user-data', 1);
                r.onsuccess = () => {
                    const db = r.result;
                    const read = db
                        .transaction('state')
                        .objectStore('state')
                        .get('user');
                    read.onsuccess = () => {
                        const saved = read.result;
                        const p = Object.values(saved.data.positions)[0] as {
                            seconds: number;
                            reset: boolean;
                        };
                        resolve(
                            saved.version === 1 &&
                                saved.data.retainedExtension.synthetic === 7 &&
                                p.seconds === 600 &&
                                p.reset
                        );
                        db.close();
                    };
                };
            })
    );
    expect(retained).toBe(true);
});

test('TV VOD comfort series Start, ended, explicit Next and Home advance across actual supplied seasons', async ({
    page,
}) => {
    await start(page);
    await syntheticSeries(page);
    await addSource(page, 'xtream');
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    const primary = page.locator('[data-focus="detail-play"]');
    await expect(primary).toContainText('Start · S1 · E1');
    await expect(primary).toBeFocused();
    await primary.click();
    const video = page.locator('video');
    const element = await video.elementHandle();
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
    await expect(page.locator('[data-focus="player-next"]')).toContainText(
        'S1 · E4'
    );
    const firstUrl = await video.getAttribute('src');
    await endedUnknown(page);
    await expect(page.locator('.player-bottom')).toContainText(
        'Episode finished'
    );
    await expect(video).toHaveAttribute('src', firstUrl!);
    await page.keyboard.press('Escape');
    await expect(primary).toContainText('Continue · S1 · E4');
    await nav(page, 'Home');
    await expect(page.locator('.resume-card')).toHaveCount(1);
    await expect(page.locator('.resume-card')).toContainText('The crossing');
    await expect(page.locator('.resume-card')).toContainText('Next episode');
    await cardAction(page, page.locator('.resume-card'), 'Next episode');
    await expect(page.locator('[data-focus="player-next"]')).toContainText(
        'S2 · E1'
    );
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
    await endedUnknown(page);
    await page.locator('[data-focus="player-next"]').click();
    await expect(page.locator('.player-bottom')).toContainText('Arrival');
    await expect(page.locator('[data-focus="player-next"]')).toHaveCount(0);
    expect(
        await element!.evaluate((v) => v === document.querySelector('video'))
    ).toBe(true);
    await expect(video).toHaveCount(1);
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
    await endedUnknown(page);
    await expect(page.locator('.player-bottom')).toContainText(
        'No next episode was supplied'
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('.resume-card')).toHaveCount(0);
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await expect(primary).toContainText('Caught up');
    await page.screenshot({
        path: test.info().outputPath('synthetic-series-completed.png'),
    });
});

test('TV VOD comfort Home finds the successor of an old unnamed episode when its catalog parent arrives', async ({
    page,
}) => {
    await start(page);
    await syntheticSeries(page);
    await addSource(page, 'xtream');
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await page.locator('[data-focus="detail-play"]').click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeGreaterThan(0.1);
    await page.keyboard.press('Escape');
    await editSaved(page, 'historical-complete');
    let held = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/xtream?**', async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') ===
            'get_series'
        ) {
            held = true;
            await gate;
        }
        return route.fallback();
    });
    try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect.poll(() => held).toBe(true);
        await expect(page.locator('.resume-card')).toHaveCount(0);
        release();
        await expect(page.locator('.resume-card')).toContainText(
            'The crossing'
        );
        await expect(page.locator('[data-focus="hero-resume"]')).toContainText(
            'Next episode'
        );
    } finally {
        release();
    }
});

test('TV VOD comfort pending sequence lookup is canceled by Back and late results cannot navigate', async ({
    page,
}) => {
    await start(page);
    await syntheticSeries(page);
    await addSource(page, 'xtream');
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await page.locator('[data-focus="detail-play"]').click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(0.1);
    // Direct candidates resolve synchronously; hold the fresh provider detail request instead.
    let held = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route('**/xtream?**', async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (action !== 'get_series_info') return route.fallback();
        const response = await route.fetch();
        held++;
        await gate;
        await route.fulfill({ response });
    });
    // Re-enter playback after clearing the sequence's cache through a reload.
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.locator('.resume-card')).toBeVisible();
    await cardAction(page, page.locator('.resume-card'));
    await expect.poll(() => held).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    release();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
    await expect(page.locator('.detail-hero')).toHaveCount(0);
});

test('TV VOD comfort lazy Ministra Next crosses seasons, resolves on demand and Back cancels held create_link', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { mac: '00:1a:79:00:00:0b' });
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await chooseTv(page, 'Season', '2');
    await page.locator('.episode').last().click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(0.1);
    const next = page.locator('[data-focus="player-next"]');
    await expect(next).toContainText('S3 · E1');
    let links = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route('**/stalker?**', async (route) => {
        const q = new URL(route.request().url()).searchParams;
        if (q.get('action') !== 'create_link') return route.fallback();
        links++;
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
    });
    try {
        await endedUnknown(page);
        await expect(next).toBeFocused();
        expect(links).toBe(0);
        await next.click();
        await expect.poll(() => links).toBe(1);
        await page.keyboard.press('Escape');
        release();
        await expect(page.locator('video[src],video source')).toHaveCount(0);
        await expect(page.locator('.episode').last()).toBeFocused();
        await page.screenshot({
            path: test
                .info()
                .outputPath('synthetic-ministra-watch-actions.png'),
        });
    } finally {
        release();
    }
});

test('TV VOD comfort failed sequence lookup keeps playback and Retry finds the actual successor', async ({
    page,
}) => {
    await start(page);
    await syntheticSeries(page);
    await addSource(page, 'xtream');
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('[data-focus="detail-play"]')).toContainText(
        'Start'
    );
    await page.locator('[data-focus="detail-play"]').click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(0.1);
    await page.keyboard.press('Escape');
    let fail = true;
    await page.route('**/xtream?**', (route) => {
        if (
            fail &&
            new URL(route.request().url()).searchParams.get('action') ===
                'get_series_info'
        )
            return route.abort();
        return route.fallback();
    });
    // A relaunched Home entry has no loaded detail episode list to fall back to.
    await page.reload();
    await expect(page.locator('.resume-card')).toBeVisible();
    await cardAction(page, page.locator('.resume-card'));
    await expect(
        page.getByRole('button', { name: 'Retry next episode', exact: true })
    ).toBeVisible();
    await expect(page.locator('[data-focus="player-next"]')).toHaveCount(0);
    const url = await page.locator('video').getAttribute('src');
    fail = false;
    await page
        .getByRole('button', { name: 'Retry next episode', exact: true })
        .click();
    await expect(page.locator('[data-focus="player-next"]')).toContainText(
        'S1 · E4'
    );
    await expect(page.locator('video')).toHaveAttribute('src', url!);
});

test('TV VOD comfort Next resolution failure preserves the current episode and repeated activation resolves once', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { mac: '00:1a:79:00:00:0b' });
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.locator('[data-focus="detail-play"]').click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(0.1);
    const next = page.locator('[data-focus="player-next"]');
    await expect(next).toContainText('S1 · E2');
    let attempts = 0;
    let fail = true;
    await page.route('**/stalker?**', (route) => {
        const q = new URL(route.request().url()).searchParams;
        if (q.get('action') !== 'create_link') return route.fallback();
        attempts++;
        if (fail) return route.abort();
        return route.fallback();
    });
    await next.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
    });
    await expect(
        page.getByRole('button', { name: 'Retry playback', exact: true })
    ).toBeVisible();
    await expect(page.locator('.player-bottom')).toContainText('Episode 1');
    expect(attempts).toBe(1);
    fail = false;
    await page
        .getByRole('button', { name: 'Retry playback', exact: true })
        .click();
    await expect(page.locator('.player-bottom')).toContainText('Episode 2');
    await expect(next).toContainText('S1 · E3');
    expect(attempts).toBe(2);
    await expect(page.locator('video')).toHaveCount(1);
});

test('TV VOD comfort remote arrows reach early-row episode watch actions and return focus after marking', async ({
    page,
}) => {
    await start(page);
    await syntheticSeries(page);
    await addSource(page, 'xtream');
    await page.route('**/xtream?**', (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_series_info'
        )
            return route.fallback();
        return route.fulfill({
            json: {
                payload: {
                    info: {},
                    episodes: {
                        '1': Array.from({ length: 9 }, (_, i) => ({
                            id: String(88000 + i * 7),
                            season: 1,
                            episode_num: i + 1,
                            title: `Synthetic chapter ${i + 1}`,
                            container_extension: 'mp4',
                        })),
                    },
                },
            },
        });
    });
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await page.locator('.episode').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(
        page.locator('.episode-entry .tv-select').first()
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
        page.getByRole('option', { name: 'Mark watched', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('.episode').first()).toContainText('Watched');
    await expect(
        page.locator('.episode-entry .tv-select').first()
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.episode').nth(3)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.episode').first()).toBeFocused();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
    await page.screenshot({
        path: test.info().outputPath('synthetic-episode-actions.png'),
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'Start over', exact: true }).click();
    await expect(page.locator('[data-focus="player-toggle"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.episode').first()).toBeFocused();
});

for (const replay of [
    'button',
    'remote Play',
    'Samsung Play/Pause',
    'storage retry',
] as const)
    test(`TV VOD comfort ${replay} replay after ended resets only that episode and preserves originating focus`, async ({
        page,
    }) => {
        await start(page);
        await syntheticSeries(page);
        await addSource(page, 'xtream');
        await nav(page, 'Series');
        await page.locator('.poster-card').first().click();
        await chooseTv(page, 'Season', '1');
        const origin = page.locator('.episode').nth(1);
        await origin.click();
        await expect
            .poll(() =>
                page
                    .locator('video')
                    .evaluate((v: HTMLVideoElement) => v.currentTime)
            )
            .toBeGreaterThan(0.1);
        await endedUnknown(page);
        if (replay === 'storage retry') {
            await page.evaluate(() => {
                const put = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function (value, key) {
                    const positions = value?.data?.positions as
                        Record<string, { reset?: boolean }> | undefined;
                    if (
                        key === 'user' &&
                        positions &&
                        Object.values(positions).some((p) => p.reset)
                    ) {
                        IDBObjectStore.prototype.put = put;
                        throw new DOMException(
                            'Synthetic quota failure',
                            'QuotaExceededError'
                        );
                    }
                    return put.call(this, value, key);
                };
            });
            await page.locator('[data-focus="player-toggle"]').click();
            await page
                .getByRole('button', {
                    name: /^(Retry viewing status|Retry start over)$/,
                })
                .click();
        } else if (replay === 'button')
            await page.locator('[data-focus="player-toggle"]').click();
        else
            await page.evaluate(
                (keyCode) =>
                    document.dispatchEvent(
                        new KeyboardEvent('keydown', { keyCode, bubbles: true })
                    ),
                replay === 'remote Play' ? 415 : 10252
            );
        await expect
            .poll(() =>
                page
                    .locator('video')
                    .evaluate(
                        (v: HTMLVideoElement) => !v.ended && v.currentTime > 0.1
                    )
            )
            .toBe(true);
        await page.keyboard.press('Escape');
        await expect(origin).toBeFocused();
        await expect(origin).toContainText('Resume');
    });
