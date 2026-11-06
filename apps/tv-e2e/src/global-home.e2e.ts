import { expect, Page, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { addSource, nav, start } from './helpers';

const sourceA = 'Synthetic source A';
const sourceB = 'Synthetic source B';
async function watch(page: Page, name: string, episode = false, index = 0) {
    await addSource(page, 'xtream', {
        name,
        username: 'marketing',
        password: 'marketing',
    });
    await nav(page, episode ? 'Series' : 'Movies');
    await page.locator('.poster-card').nth(index).click();
    if (episode) await page.locator('.episode').first().click();
    else await page.getByRole('button', { name: 'Watch now' }).click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.readyState)
        )
        .toBeGreaterThan(1);
    await page.getByLabel('Playback position').fill('8');
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThanOrEqual(8);
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.keyboard.press('Escape');
    await nav(page, 'Home');
}
const resume = (page: Page, name: string) =>
    page
        .locator('.resume-card')
        .filter({ has: page.getByText(name, { exact: true }) });

for (const intent of ['details', 'resume'] as const)
    for (const direction of ['Next', 'Previous'] as const)
        test(`changing the featured title with ${direction} cancels delayed ${intent}`, async ({
            page,
        }) => {
            await start(page);
            await watch(page, sourceA);
            await watch(page, sourceB, false, 1);
            await addSource(page, 'xtream', {
                name: 'Synthetic source C',
                username: 'marketing',
                password: 'marketing',
            });
            await expect(page.locator('.hero .home-source-name')).toHaveText(
                sourceB
            );
            let held = 0;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => (release = resolve));
            await page.route('**/xtream?**', async (route) => {
                const action =
                    new URL(route.request().url()).searchParams.get('action') ??
                    '';
                if (!['get_account_info', '', 'get_profile'].includes(action))
                    return route.fallback();
                held++;
                await gate;
                try {
                    await route.fallback();
                } catch {
                    /* The retired source request can already be aborted. */
                }
            });
            try {
                await page
                    .locator(
                        intent === 'details'
                            ? '[data-focus="hero"]'
                            : '[data-focus="hero-resume"]'
                    )
                    .click();
                await expect.poll(() => held).toBeGreaterThan(0);
                await expect(
                    page.getByRole('button', { name: 'Cancel opening title' })
                ).toBeVisible();
                const control = page.getByRole('button', {
                    name: `${direction} unfinished title`,
                });
                await control.focus();
                await page.keyboard.press('Enter');
                await expect(
                    page.locator('.hero .home-source-name')
                ).toHaveText(sourceA);
                await expect(
                    page.getByRole('button', { name: 'Cancel opening title' })
                ).toBeHidden();
                release();
                await expect(page.locator('.loading')).toBeHidden();
                await expect(
                    page.locator('.hero .home-source-name')
                ).toHaveText(sourceA);
                await expect(control).toBeFocused();
                await expect(
                    page.locator(
                        '.detail-hero,.player-controls,video[src],video source'
                    )
                ).toHaveCount(0);
            } finally {
                release();
            }
        });
async function active(page: Page) {
    return page.evaluate(
        () =>
            new Promise<string>((resolve, reject) => {
                const request = indexedDB.open('iptvnator-tv-user-data', 1);
                request.onsuccess = () => {
                    const db = request.result;
                    const read = db
                        .transaction('state')
                        .objectStore('state')
                        .get('user');
                    read.onsuccess = () => {
                        resolve(read.result.data.activeId);
                        db.close();
                    };
                    read.onerror = () =>
                        reject(Error('Synthetic fixture read failed'));
                };
            })
    );
}

test('Home combines sources and resumes the selected movie with its own provider and focus', async ({
    page,
}) => {
    await start(page);
    await watch(page, sourceA);
    const cardA = resume(page, sourceA);
    const idA = await cardA.getAttribute('data-focus');
    await watch(page, sourceB, false, 1);
    await expect(page.locator('.resume-card')).toHaveCount(2);
    await expect(cardA).toBeVisible();
    await expect(resume(page, sourceB)).toBeVisible();
    expect(await active(page)).not.toBe(JSON.parse(idA!)[0]);
    await cardA.hover();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
    const scroll = await page.locator('main').evaluate((e) => e.scrollTop);
    const output = join(workspaceRoot, 'dist/tv-home-verification');
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, 'global-home.png') });
    await cardA.click();
    await expect(page.locator('.player-controls')).toBeVisible();
    await expect.poll(() => active(page)).toBe(JSON.parse(idA!)[0]);
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(7);
    await page.keyboard.press('Escape');
    await expect(cardA).toBeFocused();
    expect(
        Math.abs(
            (await page.locator('main').evaluate((e) => e.scrollTop)) - scroll
        )
    ).toBeLessThan(5);
    await page.reload();
    await expect(page.locator('.resume-card')).toHaveCount(2);
});

test('a featured episode opens its exact parent in another source and returns Home', async ({
    page,
}) => {
    await start(page);
    await watch(page, sourceA, true);
    const id = await resume(page, sourceA).getAttribute('data-focus');
    await addSource(page, 'xtream', {
        name: sourceB,
        username: 'marketing',
        password: 'marketing',
    });
    await expect(page.locator('.hero .home-source-name')).toHaveText(sourceA);
    await page.locator('[data-focus="hero"]').click();
    await expect(
        page.getByRole('heading', { name: 'Episodes', exact: true })
    ).toBeVisible();
    expect(await active(page)).toBe(JSON.parse(id!)[0]);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="hero"]')).toBeFocused();
    await expect(resume(page, sourceA)).toBeVisible();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
});

for (const exit of ['Back', 'Settings'] as const)
    test(`a delayed foreign source cannot play after ${exit}`, async ({
        page,
    }) => {
        await start(page);
        await watch(page, sourceA);
        await addSource(page, 'xtream', {
            name: sourceB,
            username: 'marketing',
            password: 'marketing',
        });
        let held = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        await page.route('**/xtream?**', async (route) => {
            if (
                !['get_account_info', '', 'get_profile'].includes(
                    new URL(route.request().url()).searchParams.get('action') ??
                        ''
                )
            )
                return route.fallback();
            held++;
            await gate;
            try {
                await route.fallback();
            } catch {
                /* Cancellation retires the old request. */
            }
        });
        try {
            await resume(page, sourceA).click();
            await expect.poll(() => held).toBeGreaterThan(0);
            await expect(
                page.getByRole('button', { name: 'Cancel opening title' })
            ).toBeVisible();
            if (exit === 'Back') await page.keyboard.press('Escape');
            else
                await page
                    .getByRole('navigation')
                    .getByRole('button', { name: 'Settings', exact: true })
                    .click();
            await expect(
                page.getByRole('button', { name: 'Cancel opening title' })
            ).toBeHidden();
            release();
            await expect(page.locator('.loading')).toBeHidden();
            if (exit === 'Back')
                await expect(resume(page, sourceA)).toBeFocused();
            else
                await expect(
                    page.getByRole('heading', { name: 'Settings', exact: true })
                ).toBeVisible();
            await expect(page.locator('video[src],video source')).toHaveCount(
                0
            );
        } finally {
            release();
        }
    });

test('navigation during the source save cannot return to Home or launch playback', async ({
    page,
}) => {
    await start(page);
    await watch(page, sourceA);
    const target = JSON.parse(
        (await resume(page, sourceA).getAttribute('data-focus'))!
    )[0];
    await addSource(page, 'xtream', {
        name: sourceB,
        username: 'marketing',
        password: 'marketing',
    });
    await page.evaluate((sourceId) => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
            if (key === 'user' && value.data.activeId === sourceId) {
                IDBObjectStore.prototype.put = original;
                document
                    .querySelector<HTMLButtonElement>(
                        '[data-focus="nav:settings"]'
                    )
                    ?.click();
            }
            return original.call(this, value, key);
        };
    }, target);
    await resume(page, sourceA).click();
    await expect(
        page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible();
    await expect(page.locator('.loading')).toBeHidden();
    await expect(
        page.getByRole('button', { name: 'Cancel opening title' })
    ).toBeHidden();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
});

test('a newer Home resume supersedes a delayed source activation', async ({
    page,
}) => {
    await start(page);
    await watch(page, sourceA);
    await watch(page, sourceB, false, 1);
    const expected = await active(page);
    let held = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/xtream?**', async (route) => {
        if (
            !held &&
            new URL(route.request().url()).searchParams.get('action') ===
                'get_account_info'
        ) {
            held = true;
            await gate;
        }
        try {
            await route.fallback();
        } catch {
            /* The superseded request may already be aborted. */
        }
    });
    try {
        await resume(page, sourceA).click();
        await expect.poll(() => held).toBe(true);
        await resume(page, sourceB).click();
        await expect(page.locator('.player-controls')).toBeVisible();
        expect(await active(page)).toBe(expected);
        release();
        await expect
            .poll(() =>
                page
                    .locator('video')
                    .evaluate((v: HTMLVideoElement) => v.currentTime)
            )
            .toBeGreaterThan(7);
        await page.keyboard.press('Escape');
        await expect(resume(page, sourceB)).toBeFocused();
        await expect(page.locator('.error')).toBeHidden();
    } finally {
        release();
    }
});

test('a failed foreign source retries only the requested Home title', async ({
    page,
}) => {
    await start(page);
    await watch(page, sourceA);
    await addSource(page, 'xtream', {
        name: sourceB,
        username: 'marketing',
        password: 'marketing',
    });
    let offline = true;
    let attempts = 0;
    await page.route('**/xtream?**', async (route) => {
        if (
            offline &&
            ['get_account_info', '', 'get_profile'].includes(
                new URL(route.request().url()).searchParams.get('action') ?? ''
            )
        ) {
            attempts++;
            return route.fulfill({
                status: 503,
                json: { error: 'Synthetic source offline' },
            });
        }
        return route.fallback();
    });
    await resume(page, sourceA).click();
    const retry = page.getByRole('button', {
        name: 'Retry Home title',
        exact: true,
    });
    await expect(retry).toBeVisible();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
    await expect.poll(() => attempts).toBeGreaterThanOrEqual(6);
    await expect(page.locator('.loading')).toBeHidden();
    await expect(retry).toBeVisible();
    offline = false;
    await retry.click();
    await expect(page.locator('.player-controls')).toBeVisible();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(7);
});

test('a removed source retains visible history and cannot use a different provider', async ({
    page,
}) => {
    await start(page);
    await watch(page, sourceA);
    await addSource(page, 'xtream', {
        name: sourceB,
        username: 'marketing',
        password: 'marketing',
    });
    // A shared-library removal retains activity; explicit local Remove erases it.
    const oldId = JSON.parse(
        (await resume(page, sourceA).getAttribute('data-focus'))!
    )[0];
    await page.evaluate(
        (sourceId) =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open('iptvnator-tv-user-data', 1);
                request.onsuccess = () => {
                    const db = request.result;
                    const tx = db.transaction('state', 'readwrite');
                    const store = tx.objectStore('state');
                    const read = store.get('user');
                    read.onsuccess = () => {
                        const saved = read.result;
                        saved.data.sources = saved.data.sources.filter(
                            (s: { id: string }) => s.id !== sourceId
                        );
                        store.put(saved, 'user');
                    };
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () =>
                        reject(Error('Synthetic library removal failed'));
                };
            }),
        oldId
    );
    await page.reload();
    await nav(page, 'Home');
    const missing = resume(page, 'Source unavailable');
    await expect(missing).toBeVisible();
    await missing.click();
    await expect(page.getByRole('alert')).toContainText('no longer available');
    await expect(page.locator('video[src],video source')).toHaveCount(0);
});

test('Home restores the exact card placement and bounds saved-title previews', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', {
        name: sourceA,
        username: 'marketing',
        password: 'marketing',
    });
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await nav(page, 'Home');
    const section = (name: string) =>
        page
            .locator('section')
            .filter({ has: page.getByRole('heading', { name, exact: true }) });
    const saved = section('Saved films').locator('.poster-card').first();
    const catalog = section(`Films · ${sourceA}`)
        .locator('.poster-card')
        .first();
    expect(await saved.getAttribute('data-focus')).not.toBe(
        await catalog.getAttribute('data-focus')
    );
    await catalog.click();
    await expect(page.locator('.detail-hero')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(catalog).toBeFocused();
    await expect(saved).not.toBeFocused();
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
                        const state = read.result;
                        const template = state.data.favorites[0];
                        state.data.favorites = ['movie', 'series'].flatMap(
                            (kind) =>
                                Array.from({ length: 80 }, (_, i) => ({
                                    ...template,
                                    kind,
                                    providerId: `synthetic-${kind}-${i}`,
                                    id: JSON.stringify([
                                        template.sourceId,
                                        'xtream',
                                        kind,
                                        `synthetic-${kind}-${i}`,
                                    ]),
                                    title: `Synthetic saved ${kind} ${i}`,
                                }))
                        );
                        store.put(state, 'user');
                    };
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () =>
                        reject(Error('Synthetic favorites write failed'));
                };
            })
    );
    await page.reload();
    await expect(section('Saved films').locator('.poster-card')).toHaveCount(
        12
    );
    await expect(section('Saved series').locator('.poster-card')).toHaveCount(
        12
    );
    await expect(
        section('Saved films').locator('.poster-card').first()
    ).toContainText('Synthetic saved movie 79');
    const keys = await page
        .locator('main [data-focus]')
        .evaluateAll((nodes) =>
            nodes.map((n) => (n as HTMLElement).dataset.focus)
        );
    expect(new Set(keys).size).toBe(keys.length);
});

test('cross-source playback retry restores the complete Home origin', async ({
    page,
}) => {
    await start(page);
    await watch(page, sourceA, false, 1);
    const mediaId = await resume(page, sourceA).getAttribute('data-focus');
    const [sourceId, , , providerId] = JSON.parse(mediaId!);
    await addSource(page, 'xtream', {
        name: sourceB,
        username: 'marketing',
        password: 'marketing',
    });
    await page.evaluate(
        (id) =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open('iptvnator-tv-user-data', 1);
                request.onsuccess = () => {
                    const db = request.result;
                    const tx = db.transaction('state', 'readwrite');
                    const store = tx.objectStore('state');
                    const read = store.get('user');
                    read.onsuccess = () => {
                        const state = read.result;
                        for (const p of [
                            ...state.data.history,
                            ...Object.values(state.data.positions),
                        ] as { item: { id: string; raw: object } }[])
                            if (p.item.id === id) p.item.raw = {};
                        store.put(state, 'user');
                    };
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () =>
                        reject(Error('Synthetic sparse progress write failed'));
                };
            }),
        mediaId!
    );
    await page.reload();
    await expect(resume(page, sourceA)).toBeVisible();
    let fail = true;
    await page.route('**/xtream?**', async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (
            fail &&
            params.get('action') === 'get_vod_info' &&
            params.get('vod_id') === providerId
        )
            return route.fulfill({
                status: 503,
                json: { error: 'Synthetic resolution failure' },
            });
        return route.fallback();
    });
    await page.locator('main').evaluate((e) => (e.scrollTop = 400));
    await resume(page, sourceA).focus();
    const scroll = await page.locator('main').evaluate((e) => e.scrollTop);
    expect(scroll).toBeGreaterThan(0);
    await resume(page, sourceA).click();
    const retry = page.getByRole('button', {
        name: 'Retry playback',
        exact: true,
    });
    await expect(retry).toBeVisible();
    expect(await active(page)).toBe(sourceId);
    fail = false;
    await retry.click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(7);
    await page.keyboard.press('Escape');
    await expect(resume(page, sourceA)).toBeFocused();
    expect(
        Math.abs(
            (await page.locator('main').evaluate((e) => e.scrollTop)) - scroll
        )
    ).toBeLessThan(5);
});

test('a ready-source resume waits behind an earlier source save', async ({
    page,
}) => {
    await start(page);
    await watch(page, sourceA);
    const target = JSON.parse(
        (await resume(page, sourceA).getAttribute('data-focus'))!
    )[0];
    await watch(page, sourceB, false, 1);
    const expected = await active(page);
    await page.evaluate((sourceId) => {
        const state = window as unknown as {
            sourceSaveHeld?: boolean;
            releaseSourceSave?: () => void;
        };
        const original = IDBObjectStore.prototype.put;
        const assign = Object.getOwnPropertyDescriptor(
            IDBTransaction.prototype,
            'oncomplete'
        )?.set;
        if (!assign) throw Error('Synthetic source-save gate unavailable');
        IDBObjectStore.prototype.put = function (value, key) {
            if (key === 'user' && value.data.activeId === sourceId) {
                IDBObjectStore.prototype.put = original;
                Object.defineProperty(this.transaction, 'oncomplete', {
                    configurable: true,
                    set(callback: (event: Event) => void) {
                        assign.call(this, (event: Event) => {
                            state.sourceSaveHeld = true;
                            state.releaseSourceSave = () => {
                                state.releaseSourceSave = undefined;
                                callback.call(this, event);
                            };
                        });
                    },
                });
            }
            return original.call(this, value, key);
        };
    }, target);
    try {
        await resume(page, sourceA).click();
        await expect
            .poll(() =>
                page.evaluate(() =>
                    Boolean(
                        (window as unknown as { sourceSaveHeld?: boolean })
                            .sourceSaveHeld
                    )
                )
            )
            .toBe(true);
        await resume(page, sourceB).click();
        await expect(
            page.getByRole('button', { name: 'Cancel opening title' })
        ).toBeVisible();
        await expect(page.locator('video[src],video source')).toHaveCount(0);
        await page.evaluate(() =>
            (
                window as unknown as { releaseSourceSave?: () => void }
            ).releaseSourceSave?.()
        );
        await expect(page.locator('.player-controls')).toBeVisible();
        await expect.poll(() => active(page)).toBe(expected);
        await expect
            .poll(() =>
                page
                    .locator('video')
                    .evaluate((v: HTMLVideoElement) => v.currentTime)
            )
            .toBeGreaterThan(7);
        await page.keyboard.press('Escape');
        await expect(resume(page, sourceB)).toBeFocused();
        await expect(page.locator('.error')).toBeHidden();
    } finally {
        await page.evaluate(() =>
            (
                window as unknown as { releaseSourceSave?: () => void }
            ).releaseSourceSave?.()
        );
    }
});

for (const action of ['resume', 'Back', 'Next', 'Previous'] as const)
    test(`episode-details persistence cannot navigate after ${action}`, async ({
        page,
    }) => {
        await start(page);
        await watch(page, sourceA, true);
        const episodeId = await resume(page, sourceA).getAttribute(
            'data-focus'
        );
        const sourceId = JSON.parse(episodeId!)[0];
        await watch(page, sourceB, false, 1);
        const expected = await active(page);
        await page.evaluate(
            (id) =>
                new Promise<void>((resolve, reject) => {
                    const request = indexedDB.open('iptvnator-tv-user-data', 1);
                    request.onsuccess = () => {
                        const db = request.result;
                        const tx = db.transaction('state', 'readwrite');
                        const store = tx.objectStore('state');
                        const read = store.get('user');
                        read.onsuccess = () => {
                            const state = read.result;
                            for (const p of [
                                ...state.data.history,
                                ...Object.values(state.data.positions),
                            ] as {
                                item: { id: string; parentSeries?: unknown };
                            }[])
                                if (p.item.id === id)
                                    delete p.item.parentSeries;
                            store.put(state, 'user');
                        };
                        tx.oncomplete = () => {
                            db.close();
                            resolve();
                        };
                        tx.onerror = () =>
                            reject(
                                Error('Synthetic episode context write failed')
                            );
                    };
                }),
            episodeId!
        );
        await page.reload();
        await expect(resume(page, sourceB)).toBeVisible();
        await page
            .getByRole('button', { name: 'Next unfinished title' })
            .click();
        await expect(page.locator('.hero .home-source-name')).toHaveText(
            sourceA
        );
        await page.evaluate(
            ({ sourceId, episodeId }) => {
                const state = window as unknown as {
                    seriesSaveHeld?: boolean;
                    releaseSeriesSave?: () => void;
                };
                const original = IDBObjectStore.prototype.put;
                const assign = Object.getOwnPropertyDescriptor(
                    IDBTransaction.prototype,
                    'oncomplete'
                )?.set;
                if (!assign)
                    throw Error('Synthetic episode-save gate unavailable');
                IDBObjectStore.prototype.put = function (value, key) {
                    if (
                        key === 'user' &&
                        value.data.activeId === sourceId &&
                        value.data.history.some(
                            (p: {
                                item: { id: string; parentSeries?: unknown };
                            }) => p.item.id === episodeId && p.item.parentSeries
                        )
                    ) {
                        IDBObjectStore.prototype.put = original;
                        Object.defineProperty(this.transaction, 'oncomplete', {
                            configurable: true,
                            set(callback: (event: Event) => void) {
                                assign.call(this, (event: Event) => {
                                    state.seriesSaveHeld = true;
                                    state.releaseSeriesSave = () => {
                                        state.releaseSeriesSave = undefined;
                                        callback.call(this, event);
                                    };
                                });
                            },
                        });
                    }
                    return original.call(this, value, key);
                };
            },
            { sourceId, episodeId }
        );
        try {
            await page.locator('[data-focus="hero"]').click();
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        Boolean(
                            (window as unknown as { seriesSaveHeld?: boolean })
                                .seriesSaveHeld
                        )
                    )
                )
                .toBe(true);
            if (action === 'Back') await page.keyboard.press('Escape');
            else if (action === 'resume') await resume(page, sourceB).click();
            else {
                const control = page.getByRole('button', {
                    name: `${action} unfinished title`,
                });
                await control.focus();
                await page.keyboard.press('Enter');
            }
            await page.evaluate(() =>
                (
                    window as unknown as { releaseSeriesSave?: () => void }
                ).releaseSeriesSave?.()
            );
            if (action === 'Back') {
                await expect(page.locator('[data-focus="hero"]')).toBeFocused();
                await expect(
                    page.locator('video[src],video source')
                ).toHaveCount(0);
            } else if (action === 'resume') {
                await expect(page.locator('.player-controls')).toBeVisible();
                expect(await active(page)).toBe(expected);
                await expect
                    .poll(() =>
                        page
                            .locator('video')
                            .evaluate((v: HTMLVideoElement) => v.currentTime)
                    )
                    .toBeGreaterThan(7);
                await page.keyboard.press('Escape');
                await expect(resume(page, sourceB)).toBeFocused();
            } else {
                await expect(
                    page.locator('.hero .home-source-name')
                ).toHaveText(sourceB);
                await expect(
                    page.getByRole('button', {
                        name: `${action} unfinished title`,
                    })
                ).toBeFocused();
                await expect(
                    page.locator('video[src],video source')
                ).toHaveCount(0);
            }
            await expect(page.locator('.detail-hero')).toHaveCount(0);
        } finally {
            await page.evaluate(() =>
                (
                    window as unknown as { releaseSeriesSave?: () => void }
                ).releaseSeriesSave?.()
            );
        }
    });
