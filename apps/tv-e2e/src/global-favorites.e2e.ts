import { expect, Page, test } from '@playwright/test';
import { tvBackCodes } from '@iptvnator/tv/util';
import { addSource, chooseTv, nav, start } from './helpers';
import { prepareLiveMedia } from './live-media';

const sourceA = 'Synthetic playlist A';
const sourceB = 'Synthetic playlist B';
async function favorites(page: Page, orphan = false, channels = 1) {
    await start(page);
    await addSource(page, 'xtream', { name: sourceA });
    await nav(page, 'TV');
    const channel = await page
        .locator('.channel')
        .first()
        .getAttribute('data-focus');
    await nav(page, 'Movies');
    const movie = await page
        .locator('.poster-card')
        .first()
        .getAttribute('data-focus');
    await nav(page, 'Series');
    const series = await page
        .locator('.poster-card')
        .first()
        .getAttribute('data-focus');
    await addSource(page, 'xtream', { name: sourceB });
    await page.evaluate(
        async ({ ids, orphan, channels }) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open('iptvnator-tv-user-data', 1);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () =>
                    reject(Error('Synthetic fixture open failed'));
            });
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction('state', 'readwrite');
                const store = tx.objectStore('state');
                const read = store.get('user');
                read.onsuccess = () => {
                    const saved = read.result;
                    saved.data.favorites = saved.data.sources.flatMap(
                        (source: { id: string; provider: string }) =>
                            ids.flatMap((id, index) => {
                                const [, , kind, originalId] = JSON.parse(id!);
                                return Array.from(
                                    { length: kind === 'live' ? channels : 1 },
                                    (_, number) => {
                                        const providerId = number
                                            ? String(
                                                  Number(originalId) + number
                                              )
                                            : originalId;
                                        return {
                                            id: JSON.stringify([
                                                source.id,
                                                source.provider,
                                                kind,
                                                providerId,
                                            ]),
                                            sourceId: source.id,
                                            providerId,
                                            kind,
                                            title: `Synthetic favorite ${index + 1}`,
                                            raw: {},
                                        };
                                    }
                                );
                            })
                    );
                    if (orphan)
                        saved.data.sources = saved.data.sources.slice(1);
                    store.put(saved, 'user');
                };
                tx.oncomplete = () => resolve();
                tx.onerror = tx.onabort = () =>
                    reject(Error('Synthetic fixture write failed'));
            });
            db.close();
        },
        { ids: [channel, movie, series], orphan, channels }
    );
    await page.reload();
    await prepareLiveMedia(page);
    await nav(page, 'Favorites');
}
const savedChannel = (page: Page, source: string) =>
    page
        .locator('.channel-card')
        .filter({ has: page.getByText(source, { exact: true }) });

test('historical favorites combine sources for every type and persist their scope', async ({
    page,
}) => {
    await favorites(page);
    await expect(page.locator('.poster-card')).toHaveCount(2);
    await expect(
        page.getByRole('combobox', { name: 'Active source' })
    ).toHaveCount(0);
    for (const kind of ['series', 'live', 'movie']) {
        await page.locator(`[data-focus="favorites:${kind}"]`).click();
        await expect(
            page.locator(kind === 'live' ? '.channel-card' : '.poster-card')
        ).toHaveCount(2);
        await expect(page.getByText(sourceA, { exact: true })).toBeVisible();
        await expect(page.getByText(sourceB, { exact: true })).toBeVisible();
    }
    await chooseTv(page, 'Favorite sources', 'current');
    await expect(page.locator('.poster-card')).toHaveCount(1);
    await page.reload();
    await nav(page, 'Favorites');
    await expect(
        page.getByRole('combobox', { name: 'Favorite sources' })
    ).toHaveAttribute('data-value', 'current');
    await expect(page.locator('.poster-card')).toHaveCount(1);
    await chooseTv(page, 'Favorite sources', 'all');
    await expect(page.locator('.poster-card')).toHaveCount(2);
});

for (const back of ['Escape', 'Samsung Return'] as const)
    test(`favorite channel activates its exact source, opens fullscreen and restores Favorites after playlist browsing (${back})`, async ({
        page,
    }) => {
        const pressBack = () =>
            back === 'Escape'
                ? page.keyboard.press('Escape')
                : page.evaluate((keyCode) => {
                      const event = new KeyboardEvent('keydown', {
                          key: 'Unidentified',
                          bubbles: true,
                          cancelable: true,
                      });
                      Object.defineProperty(event, 'keyCode', {
                          get: () => keyCode,
                      });
                      (document.activeElement ?? document.body).dispatchEvent(
                          event
                      );
                  }, tvBackCodes.tizen);
        await favorites(page);
        await page.locator('[data-focus="favorites:live"]').click();
        const card = savedChannel(page, sourceA);
        await card.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.native-player.fullscreen')).toBeVisible();
        await expect(page.locator('.player-source-name')).toHaveText(sourceA);
        await expect
            .poll(() =>
                page
                    .locator('video')
                    .evaluate((video: HTMLVideoElement) => video.currentTime)
            )
            .toBeGreaterThan(0.1);
        await page.locator('[data-focus="player-guide"]').click();
        await expect(page.locator('.programme-guide .source-name')).toHaveText(
            sourceA
        );
        await page.keyboard.press('Escape');
        await page.locator('[data-focus="player-playlist"]').click();
        await expect(page.locator('.live-layout')).toBeVisible();
        await expect(page.locator('.native-player.preview')).toBeVisible();
        await expect(
            page.getByRole('combobox', { name: 'Active source' })
        ).toContainText(sourceA);
        await expect(page.locator('.channel.is-playing')).toBeFocused();
        await pressBack();
        await expect(page.locator('.native-player.fullscreen')).toBeVisible();
        await pressBack();
        await expect(card).toBeFocused();
        await expect(page.locator('video[src],video source')).toHaveCount(0);
        await expect(page.locator('.channel-card')).toHaveCount(2);
    });

for (const section of ['Movies', 'Series', 'TV', 'Search'])
    test(`manual source selection retains ${section} and picker focus`, async ({
        page,
    }) => {
        await start(page);
        await addSource(page, 'xtream', { name: sourceA });
        await addSource(page, 'xtream', { name: sourceB });
        await nav(page, section);
        await chooseTv(page, 'Active source', { label: `${sourceA} · XTREAM` });
        await expect(
            page
                .getByRole('navigation')
                .getByRole('button', { name: section, exact: true })
        ).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('.loading')).toBeHidden();
        await expect(
            page.getByRole('combobox', { name: 'Active source' })
        ).toBeFocused();
        await expect(page.locator('video[src],video source')).toHaveCount(0);
    });

for (const kind of ['movie', 'series'])
    test(`a foreign ${kind} favorite opens its exact source and returns to its card`, async ({
        page,
    }) => {
        await favorites(page);
        await page.locator(`[data-focus="favorites:${kind}"]`).click();
        const card = page
            .locator('.poster-card')
            .filter({ has: page.getByText(sourceA, { exact: true }) });
        const key = await card.getAttribute('data-focus');
        await card.click();
        await expect(page.locator('.detail-hero')).toBeVisible();
        await expect(
            page.getByRole('combobox', { name: 'Active source' })
        ).toContainText(sourceA);
        await expect(page.locator('video[src],video source')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(
            page.locator('[data-focus=' + JSON.stringify(key) + ']')
        ).toBeFocused();
        await expect(page.locator('.poster-card')).toHaveCount(2);
    });

test('a missing source retains its favorites and cannot borrow the active provider', async ({
    page,
}) => {
    await favorites(page, true);
    await page.locator('[data-focus="favorites:live"]').click();
    await expect(page.locator('.channel-card')).toHaveCount(2);
    const missing = savedChannel(page, 'Source unavailable');
    await missing.click();
    await expect(page.getByRole('alert')).toContainText('no longer available');
    await expect(missing).toBeVisible();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
});

test('a failed scope write preserves the visible list and retries without losing favorites', async ({
    page,
}) => {
    await favorites(page);
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
            if (key === 'user' && value.data.favoriteScope === 'current') {
                IDBObjectStore.prototype.put = put;
                throw new DOMException(
                    'Synthetic quota failure',
                    'QuotaExceededError'
                );
            }
            return put.call(this, value, key!);
        };
    });
    await chooseTv(page, 'Favorite sources', 'current');
    await expect(page.getByRole('alert')).toContainText('filter was not saved');
    await expect(
        page.getByRole('combobox', { name: 'Favorite sources' })
    ).toHaveAttribute('data-value', 'all');
    await expect(page.locator('.poster-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Retry favorite filter' }).click();
    await expect(page.locator('.poster-card')).toHaveCount(1);
    await chooseTv(page, 'Favorite sources', 'all');
    await expect(page.locator('.poster-card')).toHaveCount(2);
});

for (const action of ['Back', 'Settings', 'newer channel'] as const)
    test(`delayed favorite activation cannot launch after ${action}`, async ({
        page,
    }) => {
        await favorites(page);
        await page.locator('[data-focus="favorites:live"]').click();
        let held = false;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        await page.route('**/xtream?**', async (route) => {
            const operation =
                new URL(route.request().url()).searchParams.get('action') ?? '';
            if (
                held ||
                !['get_account_info', '', 'get_profile'].includes(operation)
            )
                return route.fallback();
            held = true;
            await gate;
            await route.fallback().catch(() => undefined);
        });
        try {
            const first = savedChannel(page, sourceA);
            await first.click();
            await expect.poll(() => held).toBe(true);
            await expect(
                page.getByRole('button', { name: 'Cancel opening title' })
            ).toBeVisible();
            if (action === 'Back') await page.keyboard.press('Escape');
            else if (action === 'Settings')
                await page
                    .getByRole('navigation')
                    .getByRole('button', { name: 'Settings', exact: true })
                    .click();
            else await savedChannel(page, sourceB).click();
            release();
            if (action === 'newer channel') {
                await expect(
                    page.locator('.native-player.fullscreen')
                ).toBeVisible();
                await expect(page.locator('.player-source-name')).toHaveText(
                    sourceB
                );
                await page.keyboard.press('Escape');
                await expect(savedChannel(page, sourceB)).toBeFocused();
            } else {
                await expect(page.locator('.loading')).toBeHidden();
                if (action === 'Back') await expect(first).toBeFocused();
                else
                    await expect(
                        page.locator('[aria-current="page"]')
                    ).toHaveText('Settings');
                await expect(
                    page.locator('.native-player.fullscreen')
                ).toHaveCount(0);
            }
            await expect(page.locator('video[src],video source')).toHaveCount(
                0
            );
        } finally {
            release();
        }
    });

for (const width of [1280, 1920])
    test(`global favorite labels and fullscreen source controls fit at ${width}`, async ({
        page,
    }, info) => {
        await page.setViewportSize({
            width,
            height: width === 1280 ? 720 : 1080,
        });
        await favorites(page);
        await page.locator('[data-focus="favorites:live"]').click();
        await savedChannel(page, sourceA).focus();
        await page.screenshot({
            path: info.outputPath(`favorites-${width}.png`),
        });
        await page.keyboard.press('Enter');
        await expect(
            page.locator('[data-focus="player-toggle"]')
        ).toBeFocused();
        await expect(page.locator('.player-source-name')).toHaveText(sourceA);
        const action = page.locator('[data-focus="player-playlist"]');
        await action.focus();
        const bounds = await action.boundingBox();
        expect(bounds).toBeTruthy();
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
            width === 1280 ? 720 : 1080
        );
        await page.screenshot({ path: info.outputPath(`player-${width}.png`) });
    });

for (const provider of ['stalker', 'm3u'] as const)
    test(`${provider} favorite uses its own source and cancels obsolete resolution`, async ({
        page,
    }) => {
        await start(page);
        await addSource(page, provider, { name: sourceA });
        await nav(page, 'TV');
        await page.locator('.channel').first().focus();
        await page.getByRole('button', { name: 'Favorite channel' }).click();
        await expect(
            page.getByRole('button', { name: 'Favorite channel' })
        ).toContainText('Saved');
        await addSource(page, 'xtream', { name: sourceB });
        await prepareLiveMedia(page);
        await nav(page, 'Favorites');
        await page.locator('[data-focus="favorites:live"]').click();
        const card = savedChannel(page, sourceA);
        if (provider === 'stalker') {
            let held = false;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => (release = resolve));
            await page.route('**/stalker?**', async (route) => {
                if (
                    held ||
                    new URL(route.request().url()).searchParams.get(
                        'action'
                    ) !== 'create_link'
                )
                    return route.fallback();
                held = true;
                await gate;
                await route.fallback().catch(() => undefined);
            });
            try {
                await card.click();
                await expect.poll(() => held).toBe(true);
                await page.keyboard.press('Escape');
                await expect(card).toBeFocused();
                release();
                await expect(
                    page.getByRole('button', { name: 'Cancel opening title' })
                ).toHaveCount(0);
                await expect(
                    page.locator('video[src],video source')
                ).toHaveCount(0);
            } finally {
                release();
            }
        }
        await card.click();
        await expect(page.locator('.native-player.fullscreen')).toBeVisible();
        await expect(page.locator('.player-source-name')).toHaveText(sourceA);
        await expect
            .poll(() =>
                page
                    .locator('video')
                    .evaluate((video: HTMLVideoElement) => video.currentTime)
            )
            .toBeGreaterThan(0.1);
        await page.keyboard.press('Escape');
        await expect(card).toBeFocused();
        await expect(page.locator('video[src],video source')).toHaveCount(0);
    });

test('fullscreen Back restores a favorite beyond the first virtual window and its scroll', async ({
    page,
}) => {
    await favorites(page, false, 80);
    await page.locator('[data-focus="favorites:live"]').click();
    await page.locator('.channel-card').first().focus();
    for (let row = 0; row < 22; row++) {
        await page.keyboard.press('ArrowDown');
        await expect(
            page.locator(`[data-virtual-index="${(row + 1) * 3}"]`)
        ).toBeFocused();
    }
    const card = page.locator('.channel-card:focus');
    const key = await card.getAttribute('data-focus');
    const scroll = await page
        .locator('main')
        .evaluate((main) => main.scrollTop);
    expect(scroll).toBeGreaterThan(1000);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-focus="player-toggle"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
        page.locator('[data-focus=' + JSON.stringify(key) + ']')
    ).toBeFocused();
    expect(await page.locator('main').evaluate((main) => main.scrollTop)).toBe(
        scroll
    );
});

for (const section of ['Movies', 'Series'])
    test(`source-bound details return to ${section} when the source changes`, async ({
        page,
    }) => {
        await start(page);
        await addSource(page, 'xtream', { name: sourceA });
        await addSource(page, 'xtream', { name: sourceB });
        await nav(page, section);
        await page.locator('.poster-card').first().click();
        await expect(page.locator('.detail-hero')).toBeVisible();
        await chooseTv(page, 'Active source', { label: `${sourceA} · XTREAM` });
        await expect(page.locator('.detail-hero')).toHaveCount(0);
        await expect(page.locator('[aria-current="page"]')).toHaveText(section);
        await expect(
            page.getByRole('combobox', { name: 'Active source' })
        ).toBeFocused();
        await expect(page.locator('video[src],video source')).toHaveCount(0);
    });

test('removing a playing favorite preserves the same provider ID in another source and restores usable focus', async ({
    page,
}) => {
    await favorites(page);
    await page.locator('[data-focus="favorites:live"]').click();
    await savedChannel(page, sourceA).click();
    await expect(page.locator('.native-player.fullscreen')).toBeVisible();
    const save = page
        .locator('.player-bottom')
        .getByRole('button', { name: 'Saved', exact: false });
    await save.click();
    await expect(
        page
            .locator('.player-bottom')
            .getByRole('button', { name: 'Save', exact: false })
    ).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="favorites:live"]')).toBeFocused();
    await expect(page.locator('.channel-card')).toHaveCount(1);
    await expect(savedChannel(page, sourceB)).toBeVisible();
    await expect(page.locator('.catalog-count')).toHaveText('1 channel');
});

test('the favorite scope picker owns Back before a pending activation', async ({
    page,
}) => {
    await favorites(page);
    await page.locator('[data-focus="favorites:live"]').click();
    let held = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/xtream?**', async (route) => {
        const action =
            new URL(route.request().url()).searchParams.get('action') ?? '';
        if (held || !['get_account_info', '', 'get_profile'].includes(action))
            return route.fallback();
        held = true;
        await gate;
        await route.fallback().catch(() => undefined);
    });
    try {
        await savedChannel(page, sourceA).click();
        await expect.poll(() => held).toBe(true);
        await page.getByRole('combobox', { name: 'Favorite sources' }).click();
        const picker = page.getByRole('dialog', { name: 'Favorite sources' });
        await expect(picker).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(picker).toBeHidden();
        await expect(
            page.getByRole('button', { name: 'Cancel opening title' })
        ).toBeVisible();
        await expect(
            page.getByRole('combobox', { name: 'Favorite sources' })
        ).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(savedChannel(page, sourceA)).toBeFocused();
        release();
        await expect(page.locator('.loading')).toBeHidden();
        await expect(page.locator('video[src],video source')).toHaveCount(0);
    } finally {
        release();
    }
});

test('showing all playlists from an empty scope restores remote focus within Favorites', async ({
    page,
}) => {
    await favorites(page);
    await addSource(page, 'xtream', { name: 'Synthetic empty playlist' });
    await nav(page, 'Favorites');
    await chooseTv(page, 'Favorite sources', 'current');
    const showAll = page.getByRole('button', { name: 'Show all playlists' });
    await showAll.focus();
    await page.keyboard.press('Enter');
    await expect(showAll).toHaveCount(0);
    await expect(page.locator('.poster-card')).toHaveCount(2);
    await expect(
        page.getByRole('combobox', { name: 'Favorite sources' })
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('main :focus')).toHaveCount(1);
});
