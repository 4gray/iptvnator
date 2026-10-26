import { expect, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';

test('M3U Luma cards publish opaque handles and open the same saved movie after relaunch', async ({
    page,
}) => {
    let card: { id: string; sourceId: string; title: string } | undefined;
    let publication = '';
    await start(page);
    await page.route('**/luma-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: 'window.__IPTVNATOR_LUMA__={url:"http://127.0.0.1:4455/api",instanceId:"luma-test"};',
        })
    );
    await page.route('**/api/v1/instance', (route) =>
        route.fulfill({
            json: {
                service: 'iptvnator',
                apiVersion: 1,
                storage: 'server',
                auth: 'none',
                instanceId: 'luma-test',
            },
        })
    );
    await page.route('**/api/v1/playlists?**', (route) =>
        route.fulfill({ json: [] })
    );
    await page.route('**/api/v1/app-state/luma-home-v1', async (route) => {
        publication = route.request().postDataJSON().value;
        card = JSON.parse(publication).favorites[0];
        await route.fulfill({ json: { success: true } });
    });
    await page.route('**/parse?**', (route) =>
        route.fulfill({
            json: {
                playlist: {
                    items: [
                        {
                            name: 'Saved M3U movie',
                            url: 'https://portal.test/movie/private-user/private-password/1.mp4',
                        },
                    ],
                },
            },
        })
    );
    await page.reload();
    await addSource(page, 'm3u');
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.getByRole('button', { name: /add.*favorite/i }).click();
    await expect
        .poll(() => card?.title, { timeout: 20000 })
        .toBe('Saved M3U movie');
    expect(publication).not.toMatch(
        /private-user|private-password|portal\.test|mp4|providerId|raw/
    );
    expect(card!.id).toMatch(/^luma-[a-f0-9]{32}$/);
    const request = { action: 'open', id: card!.id, sourceId: card!.sourceId };
    await page.addInitScript(
        (luma) =>
            Object.defineProperty(window, 'webOSSystem', {
                value: { launchParams: JSON.stringify({ luma }) },
                configurable: true,
            }),
        request
    );
    await page.reload();
    await expect(page.locator('.detail-hero h1')).toHaveText('Saved M3U movie');
    await expect(page.locator('video[src], video source')).toHaveCount(0);
});

test('Luma publishes only saved cards and handles warm and cold item launches', async ({
    page,
}) => {
    let published: { value: string } | undefined;
    await start(page);
    await page.route('**/luma-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: 'window.__IPTVNATOR_LUMA__={url:"http://127.0.0.1:4455/api",instanceId:"luma-test"};',
        })
    );
    await page.route('**/api/v1/instance', (route) =>
        route.fulfill({
            json: {
                service: 'iptvnator',
                apiVersion: 1,
                storage: 'server',
                auth: 'none',
                instanceId: 'luma-test',
            },
        })
    );
    await page.route('**/api/v1/app-state/luma-home-v1', async (route) => {
        published = route.request().postDataJSON();
        await route.fulfill({ json: { success: true } });
    });
    await page.reload();
    await addSource(page, 'xtream');
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    const title = await page.locator('.detail-hero h1').innerText();
    await page.getByRole('button', { name: /add.*favorite/i }).click();
    await expect
        .poll(() => published && JSON.parse(published.value).favorites.length, {
            timeout: 20000,
        })
        .toBe(1);
    const feed = JSON.parse(published!.value);
    expect(feed.favorites[0].title).toBe(title);
    expect(published!.value).not.toMatch(/password|pass1|user1|raw|providerId/);
    const request = {
        action: 'open',
        id: feed.favorites[0].id,
        sourceId: feed.favorites[0].sourceId,
    };
    await addSource(page, 'm3u');
    await nav(page, 'Home');
    await page.evaluate(
        (luma) =>
            document.dispatchEvent(
                new CustomEvent('webOSRelaunch', { detail: { luma } })
            ),
        request
    );
    await expect(page.locator('.detail-hero h1')).toHaveText(title);
    await expect(page.locator('[data-focus="detail-play"]')).toBeFocused();
    await page.addInitScript((luma) => {
        Object.defineProperty(window, 'webOSSystem', {
            value: { launchParams: JSON.stringify({ luma }) },
            configurable: true,
        });
    }, request);
    await page.reload();
    await expect(page.locator('.detail-hero h1')).toHaveText(title);
    await expect(page.locator('video[src]')).toHaveCount(0);
    await page.evaluate(() =>
        document.dispatchEvent(
            new CustomEvent('webOSRelaunch', {
                detail: {
                    luma: {
                        action: 'open',
                        id: 'removed',
                        sourceId: 'missing',
                    },
                },
            })
        )
    );
    await expect(page.locator('.error')).toContainText('no longer saved');
});

test('Luma series cards show the parent name and cold/warm launches open its episodes', async ({
    page,
}) => {
    let recent: {
        id: string;
        sourceId: string;
        title: string;
        kind: string;
    }[] = [];
    await start(page);
    await page.route('**/luma-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: 'window.__IPTVNATOR_LUMA__={url:"http://127.0.0.1:4455/api",instanceId:"luma-test"};',
        })
    );
    await page.route('**/api/v1/instance', (route) =>
        route.fulfill({
            json: {
                service: 'iptvnator',
                apiVersion: 1,
                storage: 'server',
                auth: 'none',
                instanceId: 'luma-test',
            },
        })
    );
    await page.route('**/api/v1/app-state/luma-home-v1', async (route) => {
        recent = JSON.parse(route.request().postDataJSON().value).recent;
        await route.fulfill({ json: { success: true } });
    });
    await page.reload();
    await addSource(page, 'xtream');
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    const title = await page.locator('.detail-hero h1').innerText();
    await page.locator('.episode').first().click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(0.1);
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.keyboard.press('Escape');
    await nav(page, 'Home');
    await expect.poll(() => recent[0]?.title, { timeout: 20000 }).toBe(title);
    expect(recent[0].kind).toBe('series');
    // A warm launch must replace an existing fullscreen playback session.
    await page.locator('.resume-card').first().click();
    await expect(page.locator('.player-controls')).toBeVisible();
    const request = {
        action: 'open',
        id: recent[0].id,
        sourceId: recent[0].sourceId,
    };
    await page.evaluate(
        (luma) =>
            document.dispatchEvent(
                new CustomEvent('webOSRelaunch', { detail: { luma } })
            ),
        request
    );
    await expect(page.locator('.detail-hero h1')).toHaveText(title);
    await expect(page.locator('video[src], video source')).toHaveCount(0);
    await expect(
        page.getByRole('heading', { name: 'Episodes', exact: true })
    ).toBeVisible();
    await page.addInitScript(
        (luma) =>
            Object.defineProperty(window, 'webOSSystem', {
                value: { launchParams: JSON.stringify({ luma }) },
                configurable: true,
            }),
        request
    );
    await page.reload();
    await expect(page.locator('.detail-hero h1')).toHaveText(title);
    await expect(page.locator('.episode').first()).toBeVisible();
    await expect(page.locator('video[src], video source')).toHaveCount(0);
});
