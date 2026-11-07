import { expect, Page, test } from '@playwright/test';
import { addSource, nav, start, cardAction } from './helpers';
import type { Progress, UserData } from '@iptvnator/tv/util';

async function seed(page: Page, extra = 0) {
    await start(page);
    await addSource(page, 'xtream', { name: 'Demo source A' });
    await addSource(page, 'xtream', {
        name: 'Demo source B',
        username: 'demo-secondary',
    });
    await page.evaluate(async (extra) => {
        const db = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open('iptvnator-tv-user-data', 1);
            request.onsuccess = () => resolve(request.result);
        });
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('state', 'readwrite');
            const store = tx.objectStore('state');
            const request = store.get('user');
            request.onsuccess = () => {
                const saved = request.result as {
                    version: number;
                    data: UserData;
                };
                const source = saved.data.sources[0];
                const entry = (
                    id: string,
                    seconds: number,
                    duration: number,
                    updated: number
                ): Progress => ({
                    item: {
                        id: JSON.stringify([source.id, 'xtream', 'movie', id]),
                        sourceId: source.id,
                        providerId: id,
                        kind: 'movie',
                        title: `Demo film ${id}`,
                        raw: {
                            stream_id: Number(id),
                            container_extension: 'mp4',
                        },
                    },
                    seconds,
                    duration,
                    updated: Date.UTC(2026, 10, 1, 12) + updated * 60000,
                });
                saved.data.history = [
                    entry('101', 2700, 2760, 3),
                    entry('102', 1200, 2760, 2),
                    entry('103', 1200, 0, 1),
                    ...Array.from({ length: extra }, (_, i) =>
                        entry(String(200 + i), 1200, 2760, -i)
                    ),
                ];
                saved.data.positions = Object.fromEntries(
                    saved.data.history.map((p) => [p.item.id, p])
                );
                store.put(saved, 'user');
            };
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () =>
                reject(new Error('Synthetic seed failed'));
        });
        db.close();
    }, extra);
    await page.reload();
    await expect(page.locator('.loading')).toBeHidden();
}

test('viewing posters have one focus target, stable Right navigation and a Back-safe actions menu', async ({
    page,
}) => {
    await seed(page);
    for (const view of ['Home', 'History']) {
        await nav(page, view);
        const entries = page.locator('.resume-entry');
        await expect(entries.first().getByRole('button')).toHaveCount(1);
        for (const [width, height] of [
            [1920, 1080],
            [1280, 720],
        ]) {
            await page.setViewportSize({ width, height });
            const card = entries.first().locator('.resume-card');
            const ratio = await card
                .locator('.poster-art')
                .evaluate((cover) => {
                    const box = cover.getBoundingClientRect();
                    return box.height / box.width;
                });
            expect(ratio).toBeCloseTo(1.5, 2);
            await card.focus();
            await page.keyboard.press('ArrowRight');
            await expect(entries.nth(1).locator('.resume-card')).toBeFocused();
            await card.focus();
            await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();
            await expect(
                dialog.getByRole('button', { name: /^(Resume|Watch again)$/ })
            ).toBeFocused();
            await expect(
                dialog.getByRole('button', { name: 'Details', exact: true })
            ).toBeVisible();
            await page.keyboard.press('Tab');
            await expect(
                dialog.getByRole('button', { name: 'Details', exact: true })
            ).toBeFocused();
            await expect(
                dialog.getByRole('button', {
                    name: /^Mark as (unwatched|watched)$/,
                })
            ).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await expect(card).toBeFocused();
            await expect(page.locator('video[src],video source')).toHaveCount(
                0
            );
        }
    }
});

test('History includes completed titles across sources; manual status survives reload and can be undone', async ({
    page,
}, testInfo) => {
    await seed(page);
    await expect(page.locator('.resume-card')).toHaveCount(2);
    await expect(page.locator('.resume-card').first()).toContainText(
        '26 min left'
    );
    await expect(page.locator('.resume-card').last()).toContainText(
        '20 min watched'
    );
    await expect(
        page.locator('.resume-card').last().locator('progress')
    ).toHaveCount(0);
    const strip = await page
        .locator('.resume-card')
        .first()
        .evaluate((card) => {
            const art = card
                .querySelector('.poster-art')!
                .getBoundingClientRect();
            const progress = card
                .querySelector('progress')!
                .getBoundingClientRect();
            return {
                coverBottom: art.bottom,
                stripBottom: progress.bottom,
                coverWidth: art.width,
                stripWidth: progress.width,
            };
        });
    expect(strip.stripBottom).toBeCloseTo(strip.coverBottom, 1);
    expect(strip.stripWidth).toBeCloseTo(strip.coverWidth, 1);
    const keys = await page
        .locator('button[data-focus]')
        .evaluateAll((buttons) =>
            buttons.map((button) => (button as HTMLElement).dataset.focus)
        );
    expect(new Set(keys).size).toBe(keys.length);
    await nav(page, 'History');
    await expect(
        page.getByRole('heading', { name: 'History', exact: true })
    ).toBeVisible();
    await expect(page.locator('.history-list .resume-card')).toHaveCount(3);
    const complete = page
        .locator('.resume-entry')
        .filter({ hasText: 'Demo film 101' });
    await expect(complete).toContainText('Watched');
    await complete.locator('.resume-card').click();
    await expect(
        page
            .getByRole('dialog')
            .getByRole('button', { name: 'Watch again', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(complete).toContainText('Demo source A');
    for (const [width, height] of [
        [1920, 1080],
        [1280, 720],
    ]) {
        await page.setViewportSize({ width, height });
        await expect(
            page.locator('.history-list .resume-card').first()
        ).toBeInViewport();
        expect(
            await page
                .locator('main')
                .evaluate((main) => main.scrollWidth <= main.clientWidth)
        ).toBe(true);
        await page.screenshot({
            path: testInfo.outputPath(`history-${width}.png`),
        });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    const unknown = page
        .locator('.resume-entry')
        .filter({ hasText: 'Demo film 103' });
    await cardAction(page, unknown.locator('.resume-card'), 'Mark as watched');
    await expect(unknown.locator('.resume-card')).toBeFocused();
    await page.reload();
    await nav(page, 'History');
    await expect(unknown).toContainText('Watched');
    await cardAction(
        page,
        unknown.locator('.resume-card'),
        'Mark as unwatched'
    );
    await expect(unknown).toContainText('20 min watched');
    await nav(page, 'Home');
    await cardAction(
        page,
        page
            .locator('.resume-entry')
            .filter({ hasText: 'Demo film 102' })
            .locator('.resume-card'),
        'Mark as watched'
    );
    await expect(page.locator('.resume-card')).toHaveCount(1);
    await expect(page.locator('[data-focus="hero-resume"]')).toBeFocused();
    await nav(page, 'History');
    await expect(
        page.locator('.resume-entry').filter({ hasText: 'Demo film 102' })
    ).toContainText('Watched');
});

test('failed manual status saves keep continuation intact and offer a working retry', async ({
    page,
}) => {
    await seed(page);
    await page.evaluate(() => {
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (
            this: IDBDatabase,
            ...args: Parameters<typeof original>
        ) {
            const tx = original.apply(this, args);
            if (
                this.name === 'iptvnator-tv-user-data' &&
                args[1] === 'readwrite'
            ) {
                IDBDatabase.prototype.transaction = original;
                queueMicrotask(() => tx.abort());
            }
            return tx;
        };
    });
    const entry = page
        .locator('.resume-entry')
        .filter({ hasText: 'Demo film 102' });
    await cardAction(page, entry.locator('.resume-card'), 'Mark as watched');
    await expect(page.getByRole('alert')).toContainText(
        'Viewing status was not saved'
    );
    await expect(page.locator('.resume-card')).toHaveCount(2);
    await page
        .getByRole('button', { name: 'Retry viewing status', exact: true })
        .focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.resume-card')).toHaveCount(1);
    await expect(page.locator('[data-focus="hero-resume"]')).toBeFocused();
    await page.reload();
    await expect(page.locator('.resume-card')).toHaveCount(1);
});

test('History bounds each page and restores its page and Details focus after source activation', async ({
    page,
}) => {
    await seed(page, 27);
    await nav(page, 'History');
    await expect(page.locator('.history-list .resume-card')).toHaveCount(24);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('.history-list .resume-card')).toHaveCount(6);
    const entry = page.locator('.resume-entry').first();
    await expect(entry.locator('.resume-card')).toBeFocused();
    await cardAction(page, entry.locator('.resume-card'), 'Details');
    await expect(page.locator('.detail-hero')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.history-list .resume-card')).toHaveCount(6);
    await expect(entry.locator('.resume-card')).toBeFocused();
    await expect(page.locator('.pager')).toContainText('2 / 2');
    const played = await entry.locator('strong').innerText();
    await cardAction(page, entry.locator('.resume-card'));
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(
        page
            .locator('.resume-entry')
            .filter({ hasText: played })
            .locator('.resume-card')
    ).toBeFocused();
    await expect(page.locator('.pager')).toContainText('1 / 2');
});

test('History activates the saved source for playback and Details, then restores focus on Back', async ({
    page,
}) => {
    await seed(page);
    await nav(page, 'History');
    const entry = page
        .locator('.resume-entry')
        .filter({ hasText: 'Demo film 101' });
    await entry.locator('.resume-card').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(entry.locator('.resume-card')).toBeFocused();
    await cardAction(page, entry.locator('.resume-card'), 'Details');
    await expect(page.locator('.detail-hero')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(entry.locator('.resume-card')).toBeFocused();
});

test('History reveals a reordered cover after playback through Details', async ({
    page,
}) => {
    await seed(page, 27);
    await nav(page, 'History');
    const card = page.locator('.resume-card').nth(18);
    const title = await card.locator('strong').innerText();
    await card.scrollIntoViewIfNeeded();
    await cardAction(page, card, 'Details');
    await expect(page.locator('.detail-hero')).toBeVisible();
    await page.locator('[data-focus="detail-play"]').click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.detail-hero')).toBeVisible();
    await page.keyboard.press('Escape');
    const returned = page.locator('.resume-card').filter({ hasText: title });
    await expect(returned).toBeFocused();
    await expect(returned).toBeInViewport();
});

test('empty History is navigable and keeps the TV sidebar within the viewport', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    for (const [width, height] of [
        [1920, 1080],
        [1280, 720],
    ]) {
        await page.setViewportSize({ width, height });
        await nav(page, 'History');
        await expect(
            page.getByText('Your viewing history is empty.')
        ).toBeVisible();
        await expect(
            page.locator('nav [data-focus="nav:settings"]')
        ).toBeInViewport({ ratio: 1 });
        await page
            .getByRole('button', { name: 'Browse movies', exact: true })
            .click();
        await expect(
            page.getByRole('heading', { name: 'Movies', exact: true })
        ).toBeVisible();
    }
});
