import { expect, test } from '@playwright/test';
import { addSource, backend, nav, start } from './helpers';

test('automatic retries are bounded and a network return can restart recovery', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await page.clock.install();
    let registrations = 0;
    await page.route(`${backend}/provider-targets`, (route) => {
        registrations++;
        return route.abort();
    });
    await page.reload();
    await page.clock.runFor(200);
    const status = page.getByRole('status');
    await expect(status.filter({ hasText: '(1/4)' })).toBeVisible();
    for (const [index, delay] of [2000, 5000, 10000, 30000].entries()) {
        await page.clock.runFor(delay + 300);
        await expect(
            status.filter({
                hasText:
                    index === 3
                        ? 'Automatic retries stopped'
                        : `(${index + 2}/4)`,
            })
        ).toBeVisible();
    }
    const exhausted = registrations;
    await page.clock.runFor(120000);
    expect(registrations).toBe(exhausted);
    await page.unroute(`${backend}/provider-targets`);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.clock.runFor(500);
    await expect(page.locator('.hero')).toBeVisible();
});

test('returning to the app preserves an existing playback session without resolving again', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await nav(page, 'TV');
    await page.locator('.channel').first().click();
    await expect(page.locator('video[src], video source')).toHaveAttribute(
        'src',
        /live/
    );
    let registrations = 0;
    page.on('request', (request) => {
        if (request.url().endsWith('/provider-targets')) registrations++;
    });
    const before = await page
        .locator('video[src], video source')
        .getAttribute('src');
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            value: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            value: false,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('online'));
    });
    await expect(page.locator('video[src], video source')).toHaveAttribute(
        'src',
        before!
    );
    expect(registrations).toBe(0);
});

test('failed startup read blocks editing and safely retries the original saved sources', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await page.addInitScript(() => {
        const get = IDBObjectStore.prototype.get;
        let fail = true;
        IDBObjectStore.prototype.get = function (key) {
            if (fail && this.name === 'state' && key === 'user') {
                fail = false;
                throw new DOMException(
                    'Synthetic read failure',
                    'UnknownError'
                );
            }
            return get.call(this, key);
        };
    });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText(
        'has not been replaced'
    );
    await expect(page.getByRole('navigation')).toBeHidden();
    await expect(
        page.getByRole('button', { name: 'Save settings', exact: true })
    ).toHaveCount(0);
    await page
        .getByRole('button', { name: 'Retry reading saved data' })
        .click();
    await expect(page.getByRole('navigation')).toBeVisible();
    await nav(page, 'Sources');
    await expect(page.locator('.source-row')).toHaveCount(1);
    await expect(page.locator('.source-row')).toContainText('TV xtream');
});

test('temporary startup outage reconnects automatically without losing the saved source', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await page.route(`${backend}/provider-targets`, (route) => route.abort());
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('request failed');
    await expect(
        page.getByRole('status').filter({ hasText: 'Reconnecting in' })
    ).toBeVisible();
    await page.unroute(`${backend}/provider-targets`);
    await expect(page.locator('.hero')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test('settings write failure retries the save and never reconnects the provider', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await nav(page, 'Settings');
    let registrations = 0;
    page.on('request', (request) => {
        if (request.url().endsWith('/provider-targets')) registrations++;
    });
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        let fail = true;
        IDBObjectStore.prototype.put = function (...args) {
            if (fail) {
                fail = false;
                throw new DOMException('Full', 'QuotaExceededError');
            }
            return put.apply(this, args);
        };
    });
    await page.getByRole('tab', { name: 'Appearance', exact: false }).click();
    await page.getByLabel('Home composition').selectOption('shelf');
    await page
        .getByRole('button', { name: 'Save settings', exact: true })
        .click();
    await expect(page.getByRole('alert')).toContainText('could not be saved');
    await expect(
        page.getByRole('button', { name: 'Retry connection', exact: true })
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry saving settings' }).click();
    await expect(
        page.getByRole('status').filter({ hasText: 'Settings saved' })
    ).toBeVisible();
    expect(registrations).toBe(0);
    await page.reload();
    await expect(page.locator('.tv-app')).toHaveClass(/shelf/);
});

test('one home server address can explicitly connect its shared sources', async ({
    page,
}) => {
    await start(page);
    let libraryReads = 0;
    await page.route(`${backend}/v1/instance`, (route) =>
        route.fulfill({
            json: {
                service: 'iptvnator',
                apiVersion: 1,
                storage: 'server',
                instanceId: 'home-server-fixture',
                auth: 'none',
            },
        })
    );
    await page.route(`${backend}/v1/playlists?**`, (route) => {
        libraryReads++;
        return route.fulfill({ json: [] });
    });
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await expect(
        page.getByRole('button', { name: 'Use this server’s sources' })
    ).toBeVisible();
    expect(libraryReads).toBe(0);
    await page
        .getByRole('button', { name: 'Use this server’s sources' })
        .click();
    await expect(
        page.getByRole('button', { name: 'Server sources connected' })
    ).toBeDisabled();
    expect(libraryReads).toBe(1);
});
