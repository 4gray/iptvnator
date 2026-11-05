import { expect, test } from '@playwright/test';
import { addSource, backend, nav, start } from './helpers';
test('storage quota failure is visible and does not claim favorite persistence', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.evaluate(() => {
        IDBObjectStore.prototype.put = () => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        };
    });
    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(page.getByRole('alert')).toContainText('not saved');
    await expect(
        page.getByRole('button', { name: 'Add to favorites' })
    ).toBeVisible();
    await page.reload();
    await expect(page.locator('.loading')).toBeHidden();
    await nav(page, 'Favorites');
    await expect(page.locator('.poster-card')).toHaveCount(0);
});
test('large catalog loads on scroll with bounded DOM and restores remote focus after detail', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', { username: 'large', password: 'large' });
    await nav(page, 'Movies');
    await expect(page.locator('.poster-card')).toHaveCount(60);
    await page.locator('main').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
    });
    await expect(page.locator('.virtual-collection')).toHaveAttribute(
        'data-loaded',
        '120'
    );
    await expect(page.locator('.poster-card')).toHaveCount(60);
    const first = page.locator('.poster-card[data-virtual-index="62"]');
    await first.focus();
    const key = await first.getAttribute('data-focus');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(
        page.locator('.poster-card[data-virtual-index="63"]')
    ).toBeFocused();
    const openedKey = await page
        .locator('.poster-card:focus')
        .getAttribute('data-focus');
    await page.keyboard.press('Enter');
    await expect(page.locator('.detail-hero')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
        page.locator(`.poster-card[data-focus=${JSON.stringify(openedKey)}]`)
    ).toBeFocused();
    await expect(page.locator('.poster-card')).toHaveCount(60);
    expect(await page.locator('button').count()).toBeLessThan(90);
    expect(key).toBeTruthy();
});
test('unavailable backend is recoverable and EPG failures do not gate playback', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await page.route(`${backend}/xtream?**`, async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (action === 'get_short_epg') await route.abort();
        else await route.continue();
    });
    await nav(page, 'TV');
    await page.locator('.channel').first().click();
    await expect(page.locator('.preview')).toBeVisible();
    await expect(page.locator('.live-information')).toContainText(
        'Programme information is unavailable'
    );
    await page.route(`${backend}/provider-targets`, (route) => route.abort());
    await nav(page, 'Settings');
    await page.getByRole('tab', { name: 'Appearance', exact: false }).click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await nav(page, 'Sources');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Save and connect' }).click();
    await expect(page.getByRole('alert')).toContainText('request failed');
    await page.unroute(`${backend}/provider-targets`);
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect(page.locator('.error')).toBeHidden();
});
test('latest search wins, missing artwork and empty catalogs remain usable', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await nav(page, 'Search');
    const search = page.getByLabel('Search this source');
    await search.fill('star');
    await search.fill('zzzz-no-match');
    await expect(page.locator('.poster-card')).toHaveCount(0);
    await expect(page.locator('.empty')).toBeVisible();
    await search.fill('');
    await expect(page.locator('.poster-card')).toHaveCount(60);
    await expect(page.locator('.poster-fallback').first()).toBeVisible();
});
test('confirmed VOD position survives reload and resumes on the same title', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.getByRole('button', { name: 'Watch now' }).click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v) => (v as HTMLVideoElement).readyState)
        )
        .toBeGreaterThan(1);
    await page.getByLabel('Playback position').fill('8');
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(
        page.getByRole('heading', { name: 'Continue watching' })
    ).toBeVisible();
    await page.locator('.resume-card').first().click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v) => (v as HTMLVideoElement).currentTime)
        )
        .toBeGreaterThan(7);
    await page.keyboard.press('Escape');
    await nav(page, 'Settings');
    await page.getByRole('button', { name: 'Test direct access' }).click();
    await expect(page.locator('.probe [role=status]')).toContainText(
        'Direct media HTTP headers are reachable'
    );
});
test('abandoned playback resolution cannot open a player after navigation', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker');
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('.episode').first()).toBeVisible();
    await page.route(`${backend}/stalker?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') ===
            'create_link'
        ) {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        try {
            await route.continue();
        } catch {
            /* Superseded browser request has been aborted. */
        }
    });
    await page.locator('.episode').first().click();
    await nav(page, 'Series');
    await expect(page.locator('.poster-card')).not.toHaveCount(0);
    await expect(page.locator('.fullscreen')).toHaveCount(0);
    await expect(page.locator('video[src], video source')).toHaveCount(0);
});
test('Back cancels a pending playback resolution before it can publish fullscreen', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker');
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('.loading')).toBeHidden();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
        release = resolve;
    });
    let requested = false;
    let finished: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
        finished = resolve;
    });
    await page.route(`${backend}/stalker?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'create_link'
        ) {
            await route.continue();
            return;
        }
        requested = true;
        try {
            const response = await route.fetch();
            await hold;
            await route.fulfill({ response });
        } catch {
            /* Back aborts this request. */
        } finally {
            finished();
        }
    });
    try {
        await page.locator('.episode').first().click();
        await expect.poll(() => requested).toBe(true);
        await page.keyboard.press('Escape');
        release();
        await settled;
        await page.evaluate(
            () =>
                new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => resolve())
                    )
                )
        );
        await expect(page.locator('.poster-card')).not.toHaveCount(0);
        await expect(page.locator('.fullscreen')).toHaveCount(0);
        await expect(page.locator('video[src], video source')).toHaveCount(0);
    } finally {
        release();
    }
});
