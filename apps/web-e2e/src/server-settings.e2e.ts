import { expect, test } from './fixtures';
import { applyUiTheme, selectUiLanguage } from './ui-consistency.fixture';

const server = 'http://127.0.0.1:49990';
const token = 'synthetic-setup-token';

test.use({ serviceWorkers: 'block', testIdAttribute: 'data-test-id' });

test.beforeEach(async ({ page }) => {
    await page.route('https://**', (route) => route.abort());
    await page.goto('/workspace/settings/server');
    await expect(page.getByTestId('source-server-url')).toBeVisible();
});

test('@settings @pwa validates the address inline without losing the token', async ({
    page,
}) => {
    const address = page.getByTestId('source-server-url');
    await page.getByTestId('source-server-token').fill(token);
    await address.fill('nas');
    await page.getByTestId('source-server-connect').click();
    await expect(address).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#server mat-error')).toContainText('http://');
    await expect(page.getByTestId('source-server-token')).toHaveValue(token);
    await expect(page.getByTestId('source-server-message')).toBeEmpty();
    await expect(page.getByTestId('source-server-help')).toHaveAttribute(
        'href',
        /docker\/README.md#connect-your-clients$/
    );
    await address.fill(server);
    await address.press('Tab');
    await expect(address).toHaveAttribute('aria-invalid', 'false');
});

test('@settings @pwa announces waiting and keeps inputs for retry after failure', async ({
    page,
}) => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(`${server}/api/v1/instance`, async (route) => {
        await wait;
        await route.abort('connectionrefused');
    });
    const address = page.getByTestId('source-server-url');
    const secret = page.getByTestId('source-server-token');
    await address.fill(server);
    await secret.fill(token);
    const connect = page.getByTestId('source-server-connect');
    await connect.click();
    await expect(connect).toBeDisabled();
    await expect(connect).toContainText('Connecting');
    await expect(page.getByTestId('source-server-message')).toContainText(
        'Connecting'
    );
    await expect(address).toHaveAttribute('readonly', '');
    await expect(secret).toHaveAttribute('readonly', '');
    release();
    await expect(page.getByTestId('source-server-message')).toContainText(
        'Check the server address'
    );
    await expect(address).toHaveValue(server);
    await expect(secret).toHaveValue(token);
    await expect(connect).toBeEnabled();
    await expect(address).not.toHaveAttribute('readonly', '');
});

test('@settings @pwa connects after a rejected token is corrected', async ({
    page,
}) => {
    await page.route(`${server}/api/v1/**`, async (route) => {
        const request = route.request();
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Authorization',
        };
        if (request.method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers });
        } else if (request.url().endsWith('/instance')) {
            await route.fulfill({
                json: {
                    service: 'iptvnator',
                    apiVersion: 1,
                    storage: 'server',
                    instanceId: 'setup-fixture',
                    auth: 'token',
                    capabilities: ['sources-v1'],
                },
                headers,
            });
        } else {
            const authorized =
                request.headers()['authorization'] === `Bearer ${token}`;
            await route.fulfill({
                status: authorized ? 200 : 401,
                json: { entries: [] },
                headers: { ...headers, ETag: '"setup"' },
            });
        }
    });
    await page.getByTestId('source-server-url').fill(server);
    const secret = page.getByTestId('source-server-token');
    await secret.fill('wrong-token');
    await page.getByTestId('source-server-connect').click();
    await expect(page.getByTestId('source-server-message')).toContainText(
        'valid access token'
    );
    await expect(secret).toHaveValue('wrong-token');
    await secret.fill(token);
    await page.getByTestId('source-server-connect').click();
    await expect(page.getByTestId('source-server-state')).toHaveText(
        'Connected'
    );
    await expect(secret).toHaveValue('');
    await expect(page.getByTestId('source-server-url')).toHaveValue(
        `${server}/api`
    );
    await expect(page.getByTestId('source-server-connect')).toBeDisabled();
    await page.evaluate(() =>
        Reflect.set(window, '__connectionSession', 'kept')
    );
    await secret.fill(token);
    await page.getByTestId('source-server-connect').click();
    await expect(secret).toHaveValue('');
    await expect(page.getByTestId('source-server-connect')).toBeDisabled();
    expect(
        await page.evaluate(() => Reflect.get(window, '__connectionSession'))
    ).toBe('kept');
    await page.getByTestId('source-server-refresh').click();
    expect(
        await page.evaluate(() => Reflect.get(window, '__connectionSession'))
    ).toBe('kept');
});

test('@settings @ui server help fits both themes and a narrow translated view', async ({
    page,
}, testInfo) => {
    for (const dark of [true, false]) {
        await applyUiTheme(page, dark);
        await page.screenshot({
            path: testInfo.outputPath(`server-${dark ? 'dark' : 'light'}.png`),
        });
    }
    await selectUiLanguage(page, 'de');
    await page.goto('/workspace/settings/server');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('source-server-help')).toBeVisible();
    await expect(page.getByTestId('source-server-url')).toBeVisible();
    await expect(page.getByTestId('source-server-connect')).toBeInViewport();
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
        path: testInfo.outputPath('server-mobile-de.png'),
    });
});

test('@settings @ui connected activity controls keep clear status, spacing and responsive actions', async ({
    page,
}, testInfo) => {
    await page.route(`${server}/api/v1/**`, async (route) => {
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers':
                'Authorization, X-IPTVnator-Instance-Id',
            ETag: '"polish"',
        };
        await route.fulfill({
            status: route.request().method() === 'OPTIONS' ? 204 : 200,
            headers,
            json: route.request().url().endsWith('/instance')
                ? {
                      service: 'iptvnator',
                      apiVersion: 1,
                      storage: 'server',
                      instanceId: 'polish-fixture',
                      auth: 'none',
                      capabilities: ['sources-v1', 'activity-v1'],
                  }
                : { entries: [] },
        });
    });
    await page.getByTestId('source-server-url').fill(server);
    await page.getByTestId('source-server-connect').click();
    await expect(page.getByTestId('source-server-state')).toHaveText(
        'Connected'
    );
    await page.getByTestId('source-server-import').click();
    const emptyPreview = page.getByTestId('source-server-import-preview');
    await expect(page.getByTestId('source-server-import-empty')).toHaveText(
        'There are no sources in your original local library to import.'
    );
    await expect(emptyPreview.locator('ul')).toHaveCount(0);
    await expect(page.getByTestId('source-server-import-confirm')).toHaveCount(
        0
    );
    expect((await emptyPreview.boundingBox())!.height).toBeLessThan(110);
    for (const dark of [true, false]) {
        await applyUiTheme(page, dark);
        await emptyPreview.screenshot({
            path: testInfo.outputPath(
                `import-empty-${dark ? 'dark' : 'light'}.png`
            ),
        });
    }
    await page.getByTestId('source-server-import-close').click();
    await expect(emptyPreview).toHaveCount(0);
    await page
        .getByTestId('activity-sync-enabled')
        .getByRole('checkbox')
        .check();
    await expect(page.getByTestId('activity-sync-state')).toHaveText(
        'Activity is synchronized'
    );
    const connection = await page.locator('#server').boundingBox();
    const activity = await page
        .getByTestId('activity-sync-settings')
        .boundingBox();
    expect(
        activity!.y - (connection!.y + connection!.height)
    ).toBeGreaterThanOrEqual(28);
    await expect(page.locator('#server .sync-status--success')).toBeVisible();
    expect(await page.locator('#server time').getAttribute('datetime')).toMatch(
        /^\d{4}-\d{2}-\d{2}T/
    );
    for (const dark of [true, false]) {
        await applyUiTheme(page, dark);
        await page.screenshot({
            path: testInfo.outputPath(
                `connected-${dark ? 'dark' : 'light'}.png`
            ),
            fullPage: true,
        });
    }
    for (const language of ['de', 'ar'] as const) {
        await selectUiLanguage(page, language);
        await page.goto('/workspace/settings/server');
        await page.setViewportSize({ width: 390, height: 844 });
        await page
            .getByTestId('activity-sync-settings')
            .scrollIntoViewIfNeeded();
        await expect(
            page.getByTestId('activity-import-preview')
        ).toBeInViewport();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth)
        ).toBeLessThanOrEqual(390);
        await page.screenshot({
            path: testInfo.outputPath(`connected-mobile-${language}.png`),
            fullPage: true,
        });
    }
});

test('@settings @ui keeps an interrupted disable understandable and retryable', async ({
    page,
}, testInfo) => {
    await page.route(`${server}/api/v1/**`, async (route) => {
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers':
                'Authorization, X-IPTVnator-Instance-Id',
            ETag: '"disable-fixture"',
        };
        await route.fulfill({
            status: route.request().method() === 'OPTIONS' ? 204 : 200,
            headers,
            json: route.request().url().endsWith('/instance')
                ? {
                      service: 'iptvnator',
                      apiVersion: 1,
                      storage: 'server',
                      instanceId: 'disable-fixture',
                      auth: 'none',
                      capabilities: ['sources-v1', 'activity-v1'],
                  }
                : { entries: [] },
        });
    });
    await page.addInitScript(() => {
        Reflect.set(window, '__activityDisableBlocked', true);
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (
                key.endsWith(':activity-consent-v1') &&
                JSON.parse(value).enabled === false &&
                Reflect.get(window, '__activityDisableBlocked')
            )
                throw new DOMException(
                    'Synthetic storage failure',
                    'QuotaExceededError'
                );
            set.call(this, key, value);
        };
    });
    await page.reload();
    await page.getByTestId('source-server-url').fill(server);
    await page.getByTestId('source-server-connect').click();
    await expect(page.getByTestId('source-server-state')).toHaveText(
        'Connected'
    );
    const checkbox = page
        .getByTestId('activity-sync-enabled')
        .getByRole('checkbox');
    await checkbox.check();
    await expect(page.getByTestId('activity-sync-state')).toHaveText(
        'Activity is synchronized'
    );
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    const status = page.getByTestId('activity-sync-state');
    await expect(status).toHaveText(
        'Saving activity locally. Synchronization is paused.'
    );
    await expect(page.getByTestId('activity-import-preview')).toBeDisabled();
    await expect(page.getByTestId('activity-sync-refresh')).toBeEnabled();
    for (const dark of [true, false]) {
        await applyUiTheme(page, dark);
        await page
            .getByTestId('activity-sync-settings')
            .screenshot({
                path: testInfo.outputPath(
                    `disable-paused-${dark ? 'dark' : 'light'}.png`
                ),
            });
    }
    for (const language of ['de', 'ar'] as const) {
        await selectUiLanguage(page, language);
        await page.goto('/workspace/settings/server');
        await page.setViewportSize({ width: 390, height: 844 });
        await status.scrollIntoViewIfNeeded();
        await expect(checkbox).toBeChecked();
        await expect(
            page.getByTestId('activity-import-preview')
        ).toBeDisabled();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth)
        ).toBeLessThanOrEqual(390);
        await page.screenshot({
            path: testInfo.outputPath(`disable-paused-mobile-${language}.png`),
        });
    }
    await page.evaluate(() =>
        Reflect.set(window, '__activityDisableBlocked', false)
    );
    await page.getByTestId('activity-sync-refresh').click();
    await expect(checkbox).not.toBeChecked();
});
