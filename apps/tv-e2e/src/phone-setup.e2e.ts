import { expect, test, Page } from '@playwright/test';
import { backend, nav, stalker, start, xtream } from './helpers';
async function connect(page: Page) {
    await start(page);
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await expect(page.locator('.connection-status')).toHaveText('Connected');
}
async function session(
    page: Page
): Promise<{ id: string; phoneToken: string; tvToken: string }> {
    // This shared backend keeps the production six-session/minute limit.
    // The full suite can legitimately exhaust it; wait for its fixed window.
    test.setTimeout(100_000);
    const reply = page.waitForResponse(
        (r) =>
            r.url() === `${backend}/tv/pairing` &&
            r.request().method() === 'POST'
    );
    await page
        .getByRole('button', { name: 'Add from phone', exact: true })
        .click();
    const response = await reply;
    if (response.status() === 429) {
        await page.waitForTimeout(60_000);
        return session(page);
    }
    expect(response.status()).toBe(201);
    const data = await response.json();
    await expect(page.locator('.pairing-qr')).toBeVisible();
    expect(await page.locator('.pairing-qr').getAttribute('src')).toMatch(
        /^data:image\/png;base64,/
    );
    return data as { id: string; phoneToken: string; tvToken: string };
}
for (const provider of ['xtream', 'stalker', 'm3u'] as const) {
    test(`phone adds ${provider} only after TV confirmation and survives reload`, async ({
        page,
        browser,
    }) => {
        await connect(page);
        const s = await session(page);
        const phone = await browser.newPage({
            viewport: { width: 390, height: 844 },
        });
        const errors: string[] = [];
        phone.on('pageerror', (e) => errors.push(e.message));
        try {
            await phone.goto(`${backend}/tv/setup#${s.id}.${s.phoneToken}`);
            await expect(phone.getByLabel('Source type')).toBeVisible();
            expect(new URL(phone.url()).hash).toBe('');
            await phone.getByLabel('Source type').selectOption(provider);
            await phone
                .getByLabel('Name', { exact: true })
                .fill(`Phone ${provider}`);
            await phone
                .getByLabel(
                    provider === 'm3u' ? 'Playlist URL' : 'Provider URL'
                )
                .fill(
                    provider === 'xtream'
                        ? xtream
                        : provider === 'stalker'
                          ? `${stalker}/server/load.php`
                          : `${xtream}/playlist.m3u`
                );
            if (provider === 'xtream') {
                await phone.getByLabel('Username').fill('user1');
                await phone
                    .getByLabel('Password', { exact: true })
                    .fill('pass1');
            }
            if (provider === 'stalker')
                await phone.getByLabel('MAC address').fill('00-1a-79-00-00-03');
            await phone.getByRole('button', { name: 'Send to TV' }).click();
            await expect(phone.getByRole('status')).toContainText('Confirm');
            await expect(
                page.getByRole('heading', {
                    name: `Phone ${provider}`,
                    exact: true,
                })
            ).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Add source', exact: true })
            ).toBeFocused();
            expect(
                (
                    await phone.request.get(
                        `${backend}/tv/pairing/${s.id}/phone`,
                        { headers: { 'X-TV-Pairing': s.phoneToken } }
                    )
                ).ok()
            ).toBe(true);
            await page
                .getByRole('button', { name: 'Add source', exact: true })
                .click();
            await expect(phone.getByRole('status')).toContainText(
                'Added to your TV'
            );
            await expect(page.locator('.loading')).toBeHidden({
                timeout: 25000,
            });
            await expect(page.locator('.error')).toBeHidden();
            await page.reload();
            await nav(page, 'Sources');
            await expect(
                page.locator('.source-row').getByRole('button', {
                    name: new RegExp(`Phone ${provider}`),
                })
            ).toBeVisible();
            expect(errors).toEqual([]);
        } finally {
            await phone.close();
        }
    });
}
test('quota failure keeps the phone pending; retry saves once and sends a receipt', async ({
    page,
    browser,
}) => {
    await connect(page);
    const s = await session(page);
    const phone = await browser.newPage({
        viewport: { width: 390, height: 844 },
    });
    try {
        await phone.goto(`${backend}/tv/setup#${s.id}.${s.phoneToken}`);
        await phone.getByLabel('Source type').selectOption('m3u');
        await phone.getByLabel('Name', { exact: true }).fill('Quota retry');
        await phone.getByLabel('Playlist URL').fill(`${xtream}/playlist.m3u`);
        await phone.getByRole('button', { name: 'Send to TV' }).click();
        await expect(
            page.getByRole('button', { name: 'Add source', exact: true })
        ).toBeVisible();
        await page.evaluate(() => {
            const original = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (
                ...args: Parameters<IDBObjectStore['put']>
            ) {
                IDBObjectStore.prototype.put = original;
                throw new DOMException('Full', 'QuotaExceededError');
            };
        });
        await page
            .getByRole('button', { name: 'Add source', exact: true })
            .click();
        await expect(page.getByRole('alert')).toContainText('not saved');
        await expect(phone.getByRole('status')).toContainText('Confirm');
        await page
            .getByRole('button', { name: 'Add source', exact: true })
            .click();
        await expect(phone.getByRole('status')).toContainText(
            'Added to your TV'
        );
        await nav(page, 'Sources');
        await expect(page.locator('.source-row')).toHaveCount(1);
    } finally {
        await phone.close();
    }
});
test('cancelled and expired links cannot add a source', async ({
    page,
    browser,
}) => {
    await connect(page);
    const s = await session(page);
    const phone = await browser.newPage();
    try {
        await phone.goto(`${backend}/tv/setup#${s.id}.${s.phoneToken}`);
        await expect(
            phone.getByRole('button', { name: 'Send to TV' })
        ).toBeVisible();
        await page.getByRole('button', { name: 'Close setup' }).click();
        await expect(phone.getByRole('status')).toContainText('cancelled');
        await phone.goto(`${backend}/tv/setup#expired.invalid`);
        await expect(phone.getByRole('status')).toContainText('expired');
        await expect(phone.locator('form')).toBeHidden();
        await expect(page.locator('.source-row')).toHaveCount(0);
    } finally {
        await phone.close();
    }
});
test('automatic discovery verifies a candidate and manual edits retire its connected status', async ({
    page,
}) => {
    await page.route('http://iptvnator.local:3335/tv/connection', (route) =>
        route.fulfill({
            json: {
                service: 'iptvnator',
                protocol: 1,
                pairing: true,
                auth: 'none',
            },
        })
    );
    await page.route(
        'http://iptvnator.local:3335/tv/connection/check',
        (route) =>
            route.fulfill({ json: { service: 'iptvnator', connected: true } })
    );
    await page.route('http://iptvnator.local:3333/**', (route) =>
        route.abort()
    );
    await page.route('http://iptvnator.local:4333/**', (route) =>
        route.abort()
    );
    await page.goto('/');
    await expect(page.locator('.connection-status')).toHaveText('Connected');
    await expect(page.getByLabel('IPTVnator backend URL')).toHaveValue(
        'http://iptvnator.local:3335'
    );
    await page
        .getByLabel('IPTVnator backend URL')
        .fill('http://unrelated.example');
    await expect(page.locator('.connection-status')).toHaveText('Not checked');
    await expect(
        page.getByRole('button', { name: 'Add from phone', exact: true })
    ).toBeDisabled();
    await page.route('http://unrelated.example/**', (route) =>
        route.fulfill({ json: { status: 'ok' } })
    );
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await expect(page.locator('.connection-status')).toContainText(
        'not a compatible'
    );
});
test('multiple discovered backends require a choice and late checks cannot override edited addresses', async ({
    page,
}) => {
    for (const port of [3333, 3335]) {
        await page.route(
            `http://iptvnator.local:${port}/tv/connection`,
            (route) =>
                route.fulfill({
                    json: {
                        service: 'iptvnator',
                        protocol: 1,
                        pairing: true,
                        auth: 'none',
                    },
                })
        );
        await page.route(
            `http://iptvnator.local:${port}/tv/connection/check`,
            (route) =>
                route.fulfill({
                    json: { service: 'iptvnator', connected: true },
                })
        );
    }
    await page.route('http://iptvnator.local:4333/**', (route) =>
        route.abort()
    );
    await page.goto('/');
    await expect(page.locator('.backend-results button')).toHaveCount(2);
    await expect(page.locator('.connection-status')).toHaveText(
        'Choose your backend below.'
    );
    await expect(
        page.getByRole('button', { name: 'Add from phone', exact: true })
    ).toBeDisabled();
    await page
        .locator('.backend-results')
        .getByRole('button', {
            name: 'http://iptvnator.local:3335',
            exact: true,
        })
        .click();
    await expect(page.locator('.connection-status')).toHaveText('Connected');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route('http://slow.example/tv/connection', async (route) => {
        await held;
        try {
            await route.fulfill({
                json: {
                    service: 'iptvnator',
                    protocol: 1,
                    pairing: true,
                    auth: 'none',
                },
            });
        } catch {
            /* cancelled */
        }
    });
    await page.getByLabel('IPTVnator backend URL').fill('http://slow.example');
    const started = page.waitForRequest('http://slow.example/tv/connection');
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await started;
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    release();
    await expect(page.locator('.connection-status')).toHaveText('Not checked');
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await expect(page.locator('.connection-status')).toHaveText('Connected');
    await expect(page.getByLabel('IPTVnator backend URL')).toHaveValue(backend);
});

test('leaving Sources during a committed write still delivers the saved receipt', async ({
    page,
    browser,
}) => {
    await connect(page);
    const s = await session(page);
    const phone = await browser.newPage();
    try {
        await phone.goto(`${backend}/tv/setup#${s.id}.${s.phoneToken}`);
        await phone.getByLabel('Source type').selectOption('m3u');
        await phone
            .getByLabel('Name', { exact: true })
            .fill('Navigation receipt');
        await phone.getByLabel('Playlist URL').fill(`${xtream}/playlist.m3u`);
        await phone.getByRole('button', { name: 'Send to TV' }).click();
        await expect(
            page.getByRole('button', { name: 'Add source', exact: true })
        ).toBeVisible();
        await page.evaluate(() => {
            const original = IDBObjectStore.prototype.put;
            const complete = Object.getOwnPropertyDescriptor(
                IDBTransaction.prototype,
                'oncomplete'
            )!;
            IDBObjectStore.prototype.put = function (
                ...args: Parameters<IDBObjectStore['put']>
            ) {
                IDBObjectStore.prototype.put = original;
                Object.defineProperty(this.transaction, 'oncomplete', {
                    set(callback: (event: Event) => void) {
                        complete.set!.call(this, (event: Event) => {
                            (
                                window as unknown as {
                                    releaseCommit: () => void;
                                }
                            ).releaseCommit = () => callback(event);
                        });
                    },
                });
                return original.apply(this, args);
            };
        });
        await page
            .getByRole('button', { name: 'Add source', exact: true })
            .click();
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        typeof (
                            window as unknown as { releaseCommit?: () => void }
                        ).releaseCommit
                )
            )
            .toBe('function');
        await nav(page, 'Settings');
        await page.evaluate(() =>
            (window as unknown as { releaseCommit: () => void }).releaseCommit()
        );
        await expect(phone.getByRole('status')).toContainText(
            'Added to your TV'
        );
        await expect(
            page.getByRole('heading', { name: 'Settings', exact: true })
        ).toBeVisible();
        await nav(page, 'Sources');
        await expect(page.locator('.source-row')).toHaveCount(1);
    } finally {
        await phone.close();
    }
});
