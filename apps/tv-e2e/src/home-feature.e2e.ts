import { expect, Page, test } from '@playwright/test';
import { addSource, nav, start, xtream } from './helpers';

async function watch(page: Page, index: number, episode = false) {
    await nav(page, episode ? 'Series' : 'Movies');
    await page.locator('.poster-card').nth(index).click();
    const title = await page.locator('.detail-hero h1').innerText();
    if (episode) await page.locator('.episode').first().click();
    else await page.getByRole('button', { name: 'Watch now' }).click();
    const video = page.locator('video');
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
    await page.getByLabel('Playback position').fill('8');
    await expect
        .poll(() =>
            video.evaluate(
                (v: HTMLVideoElement) => !v.seeking && v.currentTime >= 8
            )
        )
        .toBe(true);
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.keyboard.press('Escape');
    await nav(page, 'Home');
    await expect(page.locator('[data-focus="nav:home"]')).toBeFocused();
    // Clicking the nav button focuses it before its scheduled restoration runs.
    // Let that navigation frame finish before starting another keyboard gesture.
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                )
            )
    );
    return title;
}

test('home features three unfinished titles with manual wrap, remote focus, details and resume', async ({
    page,
}) => {
    test.setTimeout(90000);
    await start(page);
    await addSource(page, 'xtream', {
        username: 'marketing',
        password: 'marketing',
    });
    await nav(page, 'Home');
    await expect(page.locator('[data-focus="hero"]')).toHaveText(
        'Explore title →'
    );
    await expect(page.locator('.hero-switcher')).toHaveCount(0);
    const titles: string[] = [];
    for (let i = 0; i < 4; i++) titles.push(await watch(page, i));
    const heading = page.locator('.hero h1');
    const next = page.getByRole('button', { name: 'Next unfinished title' });
    const previous = page.getByRole('button', {
        name: 'Previous unfinished title',
    });
    await expect(heading).toHaveText(titles[3]);
    await expect(page.locator('.resume-card')).toHaveCount(4);
    await expect(page.locator('.hero-switcher')).toContainText('1 / 3');
    await previous.focus();
    await expect(previous).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(next).toBeFocused();
    for (const index of [2, 1, 3]) {
        await page.keyboard.press('Enter');
        await expect(heading).toHaveText(titles[index]);
        await expect(next).toBeFocused();
    }
    await previous.click();
    await expect(heading).toHaveText(titles[1]);
    await page.locator('[data-focus="hero"]').click();
    await expect(page.locator('.detail-hero h1')).toHaveText(titles[1]);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="hero"]')).toBeFocused();
    await expect(heading).toHaveText(titles[1]);
    await expect(page.locator('video[src], video source')).toHaveCount(0);
    for (const width of [1920, 1280, 960]) {
        await page.setViewportSize({ width, height: 1080 });
        const geometry = await page.locator('.hero').evaluate((hero) => {
            const switcher = hero
                .querySelector('.hero-switcher')!
                .getBoundingClientRect();
            const rail = document
                .querySelector('.resume-card')!
                .getBoundingClientRect();
            const main = document.querySelector('main')!;
            return {
                bottom: switcher.bottom,
                rail: rail.top,
                overflow: main.scrollWidth > main.clientWidth,
            };
        });
        expect(geometry.bottom).toBeLessThan(geometry.rail);
        expect(geometry.bottom).toBeLessThan(900);
        expect(geometry.overflow).toBe(false);
    }
    await page.locator('[data-focus="hero-resume"]').click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(7);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="hero-resume"]')).toBeFocused();
    await expect(heading).toHaveText(titles[1]);
    await page.reload();
    await expect(heading).toHaveText(titles[1]);
    await expect(page.locator('.hero-switcher')).toContainText('1 / 3');
    await expect(page.locator('.resume-card')).toHaveCount(4);
    await addSource(page, 'm3u');
    await nav(page, 'Home');
    await expect(page.locator('[data-focus="hero-resume"]')).toHaveCount(0);
    await expect(page.locator('.resume-card')).toHaveCount(0);
});

for (const provider of ['xtream', 'stalker'] as const)
    test(`${provider}: featured series opens the parent and resumes its saved episode after relaunch`, async ({
        page,
    }) => {
        await start(page);
        await addSource(page, provider);
        // Real local media responses support byte-range seeks; mocked full-file
        // responses do not prove that the saved position can be resumed.
        await page.route('**/tv-test-media.webm', (route) => route.continue());
        if (provider === 'stalker')
            await page.route('**/stalker?**', (route) =>
                new URL(route.request().url()).searchParams.get('action') ===
                'create_link'
                    ? route.fulfill({
                          json: {
                              action: 'create_link',
                              payload: {
                                  js: { cmd: `${xtream}/tv-test-media.webm` },
                              },
                          },
                      })
                    : route.fallback()
            );
        const seriesTitle = await watch(
            page,
            provider === 'xtream' ? 13 : 0,
            true
        );
        await page.reload();
        await expect(page.locator('.hero-position')).toContainText('S1 · E1');
        await expect(page.locator('.hero-switcher')).toHaveCount(0);
        const title = await page.locator('.hero h1').innerText();
        expect(title).toBe(seriesTitle);
        await expect(page.locator('.resume-card strong').first()).toHaveText(
            seriesTitle
        );
        if (provider === 'xtream')
            await expect(
                page
                    .locator('.rail .poster-card strong')
                    .filter({ hasText: seriesTitle })
            ).toHaveCount(0);
        await page.locator('[data-focus="hero"]').click();
        await expect(page.locator('.detail-hero h1')).toHaveText(seriesTitle);
        await expect(
            page.getByRole('heading', { name: 'Episodes', exact: true })
        ).toBeVisible();
        await expect(page.locator('.episode').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-focus="hero"]')).toBeFocused();
        await page.locator('[data-focus="hero-resume"]').click();
        await expect(page.locator('.player-bottom h1')).toHaveText(title);
        await expect
            .poll(() =>
                page
                    .locator('video')
                    .evaluate((v: HTMLVideoElement) => v.currentTime)
            )
            .toBeGreaterThan(7);
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-focus="hero-resume"]')).toBeFocused();
        await page.locator('[data-focus="hero-resume"]').click();
        await page.locator('[data-focus="player-series-details"]').click();
        await expect(page.locator('.episode').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-focus="hero-resume"]')).toBeFocused();
        const resume = page.locator('.resume-card').first();
        await resume.scrollIntoViewIfNeeded();
        const resumeScroll = await page
            .locator('main')
            .evaluate((el) => el.scrollTop);
        await resume.click();
        await expect(
            page.locator('[data-focus="player-series-details"]')
        ).toBeVisible();
        await page.locator('[data-focus="player-series-details"]').click();
        await expect(page.locator('.detail-hero h1')).toHaveText(seriesTitle);
        await expect(
            page.getByRole('heading', { name: 'Episodes', exact: true })
        ).toBeVisible();
        await expect(page.locator('video[src], video source')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(resume).toBeFocused();
        await expect
            .poll(async () =>
                Math.abs(
                    (await page
                        .locator('main')
                        .evaluate((el) => el.scrollTop)) - resumeScroll
                )
            )
            .toBeLessThan(8);
    });

test('historical Home episodes recover exact series details and cover without replacing their saved position', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    const title = await watch(page, 13, true);
    await page.evaluate(
        () =>
            new Promise<void>((resolve, reject) => {
                const r = indexedDB.open('iptvnator-tv-user-data', 1);
                r.onsuccess = () => {
                    const db = r.result,
                        tx = db.transaction('state', 'readwrite'),
                        store = tx.objectStore('state');
                    const read = store.get('user');
                    read.onsuccess = () => {
                        const saved = read.result;
                        for (const progress of [
                            ...saved.data.history,
                            ...Object.values(saved.data.positions),
                        ] as { item: Record<string, unknown> }[]) {
                            if (progress.item.kind === 'episode') {
                                delete progress.item.parentSeries;
                                progress.item.poster =
                                    'https://image.tmdb.org/t/p/w300/old-episode-still.jpg';
                            }
                        }
                        store.put(saved, 'user');
                    };
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(Error('Fixture write failed'));
                    };
                };
            })
    );
    await page.reload();
    await expect(page.locator('.hero h1')).toHaveText(title);
    await expect(page.locator('[data-focus="hero"]')).toBeVisible();
    await page.locator('[data-focus="hero"]').click();
    await expect(page.locator('.detail-hero h1')).toHaveText(title);
    await expect(
        page.getByRole('heading', { name: 'Episodes', exact: true })
    ).toBeVisible();
    const cover = await page.locator('.detail-poster img').getAttribute('src');
    await page.keyboard.press('Escape');
    await expect(page.locator('.resume-card img').first()).toHaveAttribute(
        'src',
        cover!
    );
    await expect(page.locator('.resume-card progress').first()).toHaveAttribute(
        'value',
        /^(8|9)/
    );
});

test('leaving fullscreen cancels a held historical series details lookup', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker');
    let historical = false;
    let targetId = '';
    let held = 0;
    let released = 0;
    let release!: () => void;
    const responseGate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/tv-test-media.webm', (route) => route.continue());
    await page.route('**/stalker?**', async (route) => {
        const query = new URL(route.request().url()).searchParams;
        if (query.get('action') === 'create_link')
            return route.fulfill({
                json: {
                    payload: { js: { cmd: `${xtream}/tv-test-media.webm` } },
                },
            });
        if (
            query.get('action') !== 'get_ordered_list' ||
            query.get('type') !== 'series' ||
            query.get('movie_id')
        )
            return route.fallback();
        const response = await route.fetch();
        const json = await response.json();
        const list = json.payload.js;
        if (!targetId) targetId = String(list.data[0].id);
        if (historical && query.get('search')) {
            held++;
            await responseGate;
            released++;
        } else if (historical) {
            list.data = list.data.filter(
                (item: { id: string | number }) => String(item.id) !== targetId
            );
        }
        await route.fulfill({ response, json });
    });
    const title = await watch(page, 0, true);
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
                        for (const progress of [
                            ...saved.data.history,
                            ...Object.values(saved.data.positions),
                        ] as { item: Record<string, unknown> }[])
                            delete progress.item.parentSeries;
                        store.put(saved, 'user');
                    };
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(Error('Fixture write failed'));
                    };
                };
            })
    );
    historical = true;
    try {
        await page.reload();
        await expect(page.locator('.hero h1')).toHaveText(title);
        await expect.poll(() => held).toBe(1);
        await page.locator('[data-focus="hero-resume"]').click();
        await page.locator('[data-focus="player-series-details"]').click();
        await expect.poll(() => held).toBe(2);
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-focus="hero"]')).toBeEnabled();
        release();
        await expect.poll(() => released).toBe(2);
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        new Promise<boolean>((resolve) => {
                            const request = indexedDB.open(
                                'iptvnator-tv-user-data',
                                1
                            );
                            request.onsuccess = () => {
                                const db = request.result;
                                const read = db
                                    .transaction('state')
                                    .objectStore('state')
                                    .get('user');
                                read.onsuccess = () => {
                                    resolve(
                                        !!read.result.data.history[0]?.item
                                            .parentSeries
                                    );
                                    db.close();
                                };
                            };
                        })
                )
            )
            .toBe(true);
        await expect(page.locator('.hero h1')).toHaveText(title);
        await expect(page.locator('.detail-hero')).toHaveCount(0);
        await expect(page.locator('video[src], video source')).toHaveCount(0);
        await expect(page.locator('.error')).toBeHidden();
    } finally {
        release();
    }
});
