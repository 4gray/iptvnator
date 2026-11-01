import type { Locator, Page } from '@playwright/test';
import { setInputValue } from './e2e-helpers';
import { expect, test } from './pwa-mock.fixture';
import {
    XTREAM_MOCK_SERVER,
    addStalkerPortal,
    interceptPwaProviderRequests,
} from './sources-pwa.helpers';

/**
 * The three add-source forms share one vocabulary: the same name label, a
 * masked password with a show/hide toggle, a URL error of their own and the
 * single "Add playlist" submit. Credentials are the Xtream mock's fixtures.
 */
test.beforeEach(async ({ page }) => {
    await interceptPwaProviderRequests(page);
    await page.goto('/');
});

async function openMethod(page: Page, method: RegExp): Promise<Locator> {
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: method }).click();
    return dialog;
}

async function expectPasswordToggle(dialog: Locator): Promise<void> {
    const password = dialog.locator('#password');
    const toggle = dialog.getByRole('button', { name: 'Show password' });

    await expect(password).toHaveAttribute('type', 'password');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
}

test('@sources @pwa adds an Xtream source through the dialog', async ({
    page,
    pwaMocks,
}) => {
    const dialog = await openMethod(page, /Xtream credentials/i);
    const serverUrl = dialog.locator('#serverUrl');

    await expect(
        dialog.getByText('Server address, e.g. http://host:port')
    ).toBeVisible();
    await setInputValue(serverUrl, 'panel.example');
    await serverUrl.blur();
    await expect(dialog.locator('mat-error')).toHaveText(
        'Enter a valid http:// or https:// URL.'
    );
    // The field used to borrow the EPG source error.
    await expect(dialog.getByText(/absolute file path/i)).toHaveCount(0);

    await setInputValue(
        dialog.getByRole('textbox', { name: 'Playlist title' }),
        'Dialog Xtream Source'
    );
    await setInputValue(serverUrl, XTREAM_MOCK_SERVER);
    await expect(dialog.locator('mat-error')).toHaveCount(0);
    await setInputValue(dialog.locator('#username'), pwaMocks.username);
    await setInputValue(dialog.locator('#password'), 'pass1');
    await expectPasswordToggle(dialog);
    await expect(dialog.locator('#password')).toHaveValue('pass1');

    const add = dialog.getByRole('button', {
        name: 'Add playlist',
        exact: true,
    });
    await expect(add).toBeEnabled({ timeout: 10_000 });
    await add.click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/xtreams.*vod/);
});

test('@sources @pwa explains an invalid M3U playlist URL', async ({ page }) => {
    const dialog = await openMethod(page, /M3U URL/i);
    const url = dialog.getByRole('textbox', {
        name: 'Playlist URL (m3u, m3u8)',
    });

    await expect(
        dialog.getByRole('textbox', { name: 'Playlist title' })
    ).toBeVisible();
    await setInputValue(url, 'playlist.m3u');
    await url.blur();

    await expect(dialog.locator('mat-error')).toHaveText(
        'Enter a valid http:// or https:// URL.'
    );
    await expect(
        dialog.getByRole('button', { name: 'Add playlist', exact: true })
    ).toBeDisabled();
});

for (const code of ['ETIMEDOUT', 'ENETUNREACH', 'E' + 'X'.repeat(47)]) {
    test(`@sources @pwa retains ${code.length === 48 ? 'a bounded long code' : code} in URL setup without raw provider detail`, async ({
        page,
    }, testInfo) => {
        if (code.length === 48)
            await page.setViewportSize({ width: 320, height: 844 });
        await page.route('**/localhost:3000/parse**', (route) =>
            route.fulfill({
                status: 500,
                json: {
                    status: 500,
                    code,
                    message: 'https://user:secret@private.example/list.m3u',
                },
            })
        );
        const dialog = await openMethod(page, /M3U URL/i);
        const url = dialog.getByRole('textbox', { name: /Playlist URL/ });
        await url.fill('https://fixture.example/list.m3u');
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        const alert = dialog.getByRole('alert');
        await expect(alert).toContainText(`(${code})`);
        await expect(alert).not.toContainText('secret');
        expect(
            await alert.evaluate((el) => el.scrollWidth <= el.clientWidth)
        ).toBe(true);
        await expect(url).toHaveValue('https://fixture.example/list.m3u');
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(
                `network-error-${code.length === 48 ? 'narrow' : code}.png`
            ),
        });
        await url.fill('https://fixture.example/other.m3u');
        await expect(alert).toBeHidden();
    });
}

test('@sources @pwa gives the Stalker form the shared labels and a masked password', async ({
    page,
}) => {
    const dialog = await openMethod(page, /Stalker portal/i);

    await expect(
        dialog.getByRole('textbox', { name: 'Playlist title' })
    ).toBeVisible();
    await expect(
        dialog.getByRole('textbox', { name: 'MAC address', exact: true })
    ).toBeVisible();
    await expect(dialog.locator('#password')).toBeHidden();
    await dialog.locator('app-stalker-portal-import summary').click();
    await setInputValue(dialog.locator('#password'), 'secret');
    await expectPasswordToggle(dialog);
    await expect(
        dialog.getByRole('button', { name: 'Add playlist', exact: true })
    ).toBeVisible();
});

test('@sources @pwa preserves a failed M3U draft and discards cancelled responses', async ({
    page,
}, testInfo) => {
    let resolve!: () => void;
    let attempts = 0;
    await page.route('**/localhost:3000/parse**', async (route) => {
        attempts++;
        if (attempts === 1) {
            await route.fulfill({
                status: 404,
                json: { message: 'Missing fixture' },
            });
            return;
        }
        await new Promise<void>((done) => {
            resolve = done;
        });
        await route.fulfill({
            json: {
                _id: 'cancelled-m3u',
                title: 'Cancelled import',
                items: [],
                count: 0,
            },
        });
    });
    const dialog = await openMethod(page, /M3U URL/i);
    const url = dialog.getByRole('textbox', { name: /Playlist URL/ });
    await url.fill('http://');
    await url.blur();
    await expect(
        dialog.getByRole('button', { name: 'Add playlist', exact: true })
    ).toBeDisabled();
    await url.fill('https://fixture.example/audit.m3u');
    await dialog
        .getByRole('textbox', { name: 'Playlist title' })
        .fill('Preserved draft');
    const add = dialog.getByRole('button', {
        name: 'Add playlist',
        exact: true,
    });
    await add.click();
    await expect(dialog.getByRole('alert')).toContainText('404');
    await expect(url).toHaveValue('https://fixture.example/audit.m3u');
    await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('m3u-error-light.png'),
    });
    await page.evaluate(() => {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole('alert').scrollIntoViewIfNeeded();
    await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('m3u-error-mobile-dark.png'),
    });
    await page.setViewportSize({ width: 1280, height: 900 });

    await expect(
        dialog.getByRole('textbox', { name: 'Playlist title' })
    ).toHaveValue('Preserved draft');
    await add.click();
    await expect(dialog.getByRole('status')).toContainText('Fetching playlist');
    await expect(add).toBeDisabled();
    await expect.poll(() => typeof resolve).toBe('function');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    resolve();
    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await expect(page.locator('app-source-row')).toHaveCount(0);
    await expect(page).toHaveURL(/workspace\/sources/);
});

test('@sources @pwa Stalker cancel ignores late discovery', async ({
    page,
    pwaMocks,
}) => {
    let resolve!: () => void;
    await page.route('**/localhost:3000/stalker**', async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (action !== 'get_genres') return route.fallback();
        await new Promise<void>((done) => {
            resolve = done;
        });
        await route.fulfill({
            json: { payload: { js: [{ id: '1', title: 'Audit' }] } },
        });
    });
    const dialog = await openMethod(page, /Stalker portal/i);
    await dialog.locator('#title').fill('Cancelled Stalker');
    await dialog
        .locator('#portalUrl')
        .fill('https://fixture.example/portal.php');
    await dialog.locator('#macAddress').fill(pwaMocks.macAddress);
    await dialog
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    await expect(
        dialog.getByRole('button', { name: 'Validating portal…', exact: true })
    ).toBeVisible();
    await expect.poll(() => typeof resolve).toBe('function');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    resolve();
    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await expect(page.locator('app-source-row')).toHaveCount(0);
});

test('@sources @pwa retries a failed Stalker category in place', async ({
    page,
    pwaMocks,
}) => {
    await addStalkerPortal(page, 'Recovery portal', pwaMocks);
    const categories = page.locator('.category-item');
    await expect(categories.nth(2)).toBeVisible();
    let failing = true;
    await page.route('**/localhost:3000/stalker**', async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') ===
                'get_ordered_list' &&
            failing
        ) {
            return route.fulfill({
                json: { message: 'Synthetic unavailable portal', status: 503 },
            });
        }
        return route.fallback();
    });
    await categories.nth(2).click();
    const error = page.locator('.catalog-load-error');
    await expect(error).toContainText('Could not load this category');
    const categoryUrl = page.url();
    await expect(page.getByText('No content in this category')).toHaveCount(0);
    await expect(page.locator('.category-subtitle')).not.toHaveText('0 items');
    failing = false;
    const retry = error.getByRole('button', { name: 'Retry', exact: true });
    await retry.focus();
    await retry.press('Enter');
    await expect(error).toBeHidden();
    await expect(page.locator('app-grid-list mat-card').first()).toBeVisible();
    await expect(page).toHaveURL(categoryUrl);
});
