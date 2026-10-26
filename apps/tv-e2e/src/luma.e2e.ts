import { expect, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';

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
