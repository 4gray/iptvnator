import { expect, test } from './fixtures';
import {
    configureMockProviderBackend,
    getRegisteredProviderUrl,
    interceptProviderTargetRegistration,
} from './provider-target-route';

const providerUrl = 'https://panel.example:8443/base';
const playlistUrl = `${providerUrl}/get.php?username=demo&password=p%26ss&type=m3u_plus&output=ts`;

for (const available of [true, false]) {
    test(`@web @m3u @xtream URL suggestion is optional and keeps the draft: API=${available}`, async ({
        page,
    }) => {
        const password = available ? "sec'ret!" : 'p&ss';
        const sourceUrl = available
            ? `${providerUrl}/get.php?username=demo&password=${password}`
            : playlistUrl;
        await configureMockProviderBackend(page);
        const targets = await interceptProviderTargetRegistration(page);
        const requested: string[] = [];
        await page.route(
            '**/localhost:3000/connectivity-guard/reset',
            (route) => route.fulfill({ json: { reset: true } })
        );
        await page.route('**/localhost:3000/xtream**', async (route) => {
            const url = new URL(route.request().url());
            requested.push(getRegisteredProviderUrl(url, targets) ?? '');
            expect(url.searchParams.get('userAgent')).toBe('VLC/3.0.21');
            await route.fulfill({
                json: available
                    ? { payload: { user_info: { auth: 1, status: 'Active' } } }
                    : { connectionFailure: { kind: 'tls', canTryHttp: false } },
            });
        });
        await page.goto('/');
        await page
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        const dialog = page.getByRole('dialog');
        const urlInput = dialog.locator('[formcontrolname="playlistUrl"]');
        await urlInput.fill(sourceUrl);
        await dialog
            .locator('[formcontrolname="playlistName"]')
            .fill('My provider');
        await dialog
            .locator('[data-test-id="url-advanced-settings"] > summary')
            .click();
        await dialog
            .locator('[formcontrolname="userAgent"]')
            .fill('VLC/3.0.21');
        await expect(
            dialog.getByText('Xtream may be available', { exact: true })
        ).toBeVisible();
        await expect(
            dialog.getByRole('button', { name: 'Add playlist', exact: true })
        ).toBeEnabled();
        expect(requested).toEqual([]);

        await dialog
            .getByRole('button', { name: 'Set up Xtream', exact: true })
            .click();
        await expect(dialog.locator('#title')).toHaveValue('My provider');
        await expect(dialog.locator('#title')).toBeFocused();
        await expect(dialog.locator('#serverUrl')).toHaveValue(providerUrl);
        await expect(dialog.locator('#username')).toHaveValue('demo');
        await expect(dialog.locator('#password')).toHaveValue(password);
        await expect(dialog.locator('#password')).toHaveAttribute(
            'type',
            'password'
        );
        await expect(
            dialog.locator(
                'app-xtream-code-import [formcontrolname="userAgent"]'
            )
        ).toHaveValue('VLC/3.0.21');
        await expect(
            dialog.locator('[data-test-id="xtream-advanced-settings"]')
        ).toHaveAttribute('open', '');
        expect(requested).toEqual([]);

        await dialog
            .getByRole('button', { name: 'Test HTTPS and HTTP', exact: true })
            .click();
        await expect(dialog.getByRole('status')).toContainText(
            available
                ? 'Connected. The portal is active.'
                : 'Could not establish a secure connection'
        );
        expect(requested).toEqual([providerUrl]);

        await dialog
            .getByRole('button', { name: 'Back to M3U link', exact: true })
            .click();
        await expect(urlInput).toBeFocused();
        await expect(urlInput).toHaveValue(sourceUrl);
        await expect(
            dialog.locator('[formcontrolname="playlistName"]')
        ).toHaveValue('My provider');
        await expect(
            dialog.locator('app-url-upload [formcontrolname="userAgent"]')
        ).toHaveValue('VLC/3.0.21');
        await expect(
            dialog.getByRole('button', { name: 'Add playlist', exact: true })
        ).toBeEnabled();

        await dialog
            .getByRole('button', { name: 'Clear', exact: true })
            .click();
        await expect(
            dialog.getByRole('button', { name: 'Set up Xtream', exact: true })
        ).toHaveCount(0);
        await expect(
            dialog.getByRole('button', { name: 'Add playlist', exact: true })
        ).toBeDisabled();
    });
}

test('@web @m3u plain and tokenized playlist URLs stay on the M3U path', async ({
    page,
}) => {
    await page.goto('/');
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    const dialog = page.getByRole('dialog');
    for (const url of [
        'https://lists.example/main.m3u',
        `${playlistUrl}&token=provider-specific`,
    ]) {
        await dialog.locator('[formcontrolname="playlistUrl"]').fill(url);
        await expect(
            dialog.getByRole('button', { name: 'Set up Xtream', exact: true })
        ).toHaveCount(0);
        await expect(
            dialog.getByRole('button', { name: 'Add playlist', exact: true })
        ).toBeEnabled();
    }
});

test('@web @m3u @xtream optional settings and server details are disclosed only when needed', async ({
    page,
}) => {
    await page.goto('/');
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.app-dialog__subtitle')).toHaveCount(0);
    const userAgent = dialog.locator(
        'app-url-upload [formcontrolname="userAgent"]'
    );
    await expect(userAgent).not.toBeVisible();
    await expect(dialog.locator('.url-server-info > summary')).toBeVisible();
    await expect(dialog.locator('.cors-note')).not.toBeVisible();
    await dialog.locator('.url-server-info > summary').press('Enter');
    await expect(dialog.locator('.cors-note')).toBeVisible();
    await expect(dialog.locator('.cors-note')).toContainText(
        'Only use a backend you trust'
    );
    await dialog
        .locator('[data-test-id="url-advanced-settings"] > summary')
        .press('Space');
    await expect(userAgent).toBeVisible();
    await dialog
        .locator('[data-test-id="url-advanced-settings"] > summary')
        .press('Space');
    await expect(userAgent).not.toBeVisible();
    await dialog.locator('[formcontrolname="playlistUrl"]').fill(playlistUrl);
    await dialog
        .getByRole('button', { name: 'Set up Xtream', exact: true })
        .click();
    await expect(
        dialog.locator('app-xtream-code-import [formcontrolname="userAgent"]')
    ).not.toBeVisible();
    await expect(dialog.locator('#xtream-http-test-notice')).toBeVisible();
    await dialog
        .locator('[data-test-id="xtream-advanced-settings"] > summary')
        .press('Enter');
    await expect(
        dialog.locator('app-xtream-code-import [formcontrolname="userAgent"]')
    ).toBeVisible();
});
