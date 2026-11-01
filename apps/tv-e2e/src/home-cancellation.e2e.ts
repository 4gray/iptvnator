import { expect, Page, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';

const sourceA = 'Synthetic cancellation source A';
const sourceB = 'Synthetic cancellation source B';
async function watch(page: Page, name: string, index: number) {
    await addSource(page, 'xtream', {
        name,
        username: 'marketing',
        password: 'marketing',
    });
    await nav(page, 'Movies');
    await page.locator('.poster-card').nth(index).click();
    await page.getByRole('button', { name: 'Watch now' }).click();
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
async function setup(page: Page, ready = false) {
    await start(page);
    await watch(page, sourceA, 1);
    await watch(page, sourceB, 0);
    await page.evaluate(
        ({ name, ready }) =>
            new Promise<void>((resolve, reject) => {
                const r = indexedDB.open('iptvnator-tv-user-data', 1);
                r.onerror = () =>
                    reject(Error('Synthetic storage read failed'));
                r.onsuccess = () => {
                    const db = r.result,
                        tx = db.transaction('state', 'readwrite'),
                        store = tx.objectStore('state'),
                        q = store.get('user');
                    q.onsuccess = () => {
                        const saved = q.result;
                        const id = saved.data.sources.find(
                            (s: { id: string; name: string }) => s.name === name
                        ).id;
                        for (const p of [
                            ...saved.data.history,
                            ...Object.values(saved.data.positions),
                        ] as {
                            item: {
                                sourceId: string;
                                raw: Record<string, unknown>;
                            };
                        }[])
                            if (p.item.sourceId === id) p.item.raw = {};
                        if (ready) saved.data.activeId = id;
                        store.put(saved, 'user');
                    };
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(Error('Synthetic storage write failed'));
                    };
                };
            }),
        { name: sourceA, ready }
    );
    await page.reload();
    await expect(page.locator('.resume-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Next unfinished title' }).click();
    await expect(page.locator('.hero .home-source-name')).toHaveText(sourceA);
}

for (const exit of ['Next', 'Previous', 'Cancel', 'Back', 'Settings'] as const)
    test(`Home playback resolution is cancelled by ${exit}`, async ({
        page,
    }) => {
        await setup(page, exit === 'Previous');
        let held = 0,
            settled = 0,
            aborted = 0;
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        page.on('requestfailed', (request) => {
            if (
                new URL(request.url()).searchParams.get('action') ===
                'get_vod_info'
            )
                aborted++;
        });
        await page.route('**/xtream?**', async (route) => {
            if (
                new URL(route.request().url()).searchParams.get('action') !==
                'get_vod_info'
            )
                return route.fallback();
            held++;
            await gate;
            try {
                await route.fallback();
            } catch {
                /* Retired request. */
            } finally {
                settled++;
            }
        });
        try {
            await page.locator('[data-focus="hero-resume"]').click();
            await expect.poll(() => held).toBeGreaterThan(0);
            await expect(
                page.getByRole('button', { name: 'Cancel opening title' })
            ).toBeVisible();
            if (exit === 'Back') await page.keyboard.press('Escape');
            else if (exit === 'Cancel')
                await page
                    .getByRole('button', { name: 'Cancel opening title' })
                    .click();
            else if (exit === 'Settings') await nav(page, 'Settings');
            else {
                await page
                    .getByRole('button', { name: `${exit} unfinished title` })
                    .focus();
                await page.keyboard.press('Enter');
            }
            release();
            await expect.poll(() => settled).toBeGreaterThan(0);
            await expect.poll(() => aborted).toBeGreaterThan(0);
            await expect(
                page.getByRole('button', { name: 'Cancel opening title' })
            ).toHaveCount(0);
            await expect(
                page.locator('.player-controls,video[src],video source')
            ).toHaveCount(0);
            if (exit === 'Next' || exit === 'Previous') {
                await expect(
                    page.locator('.hero .home-source-name')
                ).toHaveText(sourceB);
                await expect(
                    page.getByRole('button', {
                        name: `${exit} unfinished title`,
                    })
                ).toBeFocused();
            } else if (exit === 'Back' || exit === 'Cancel')
                await expect(
                    page.locator('[data-focus="hero-resume"]')
                ).toBeFocused();
        } finally {
            release();
        }
    });

for (const failure of ['connection', 'resolution'] as const)
    test(`changing the featured title retires a failed ${failure} retry`, async ({
        page,
    }) => {
        await setup(page);
        let offline = true;
        await page.route('**/xtream?**', async (route) => {
            const action =
                new URL(route.request().url()).searchParams.get('action') ?? '';
            const match =
                failure === 'connection'
                    ? ['get_account_info', '', 'get_profile'].includes(action)
                    : action === 'get_vod_info';
            if (offline && match)
                return route.fulfill({
                    status: 503,
                    json: { error: 'Synthetic unavailable source' },
                });
            return route.fallback();
        });
        await page.locator('[data-focus="hero-resume"]').click();
        const retry = page.getByRole('button', {
            name:
                failure === 'connection'
                    ? 'Retry Home title'
                    : 'Retry playback',
            exact: true,
        });
        await expect(retry).toBeVisible();
        const retained = await retry.elementHandle();
        await page
            .getByRole('button', { name: 'Next unfinished title' })
            .click();
        await expect(page.locator('.hero .home-source-name')).toHaveText(
            sourceB
        );
        await expect(retry).toHaveCount(0);
        offline = false;
        await retained!.evaluate((button: HTMLButtonElement) => button.click());
        await page.evaluate(
            () =>
                new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => resolve())
                    )
                )
        );
        await expect(
            page.locator('.player-controls,video[src],video source')
        ).toHaveCount(0);
        await page.locator('[data-focus="hero-resume"]').click();
        await expect(page.locator('.player-controls')).toBeVisible();
    });

test('a Home playback retry remains cancellable while resolving its address', async ({
    page,
}) => {
    await setup(page);
    let held = 0,
        aborted = 0,
        offline = true;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    page.on('requestfailed', (r) => {
        if (new URL(r.url()).searchParams.get('action') === 'get_vod_info')
            aborted++;
    });
    await page.route('**/xtream?**', async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_vod_info'
        )
            return route.fallback();
        if (offline)
            return route.fulfill({
                status: 503,
                json: { error: 'Synthetic initial failure' },
            });
        held++;
        await gate;
        try {
            await route.fallback();
        } catch {
            /* Retired retry. */
        }
    });
    try {
        await page.locator('[data-focus="hero-resume"]').click();
        await expect(
            page.getByRole('button', { name: 'Retry playback', exact: true })
        ).toBeVisible();
        offline = false;
        await page
            .getByRole('button', { name: 'Retry playback', exact: true })
            .click();
        await expect.poll(() => held).toBeGreaterThan(0);
        await expect(
            page.getByRole('button', { name: 'Cancel opening title' })
        ).toBeVisible();
        await page
            .getByRole('button', { name: 'Next unfinished title' })
            .click();
        release();
        await expect.poll(() => aborted).toBeGreaterThan(0);
        await expect(page.locator('.hero .home-source-name')).toHaveText(
            sourceB
        );
        await expect(
            page.locator('.player-controls,video[src],video source')
        ).toHaveCount(0);
    } finally {
        release();
    }
});
