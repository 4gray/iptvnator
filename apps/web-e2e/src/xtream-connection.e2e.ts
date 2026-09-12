import { expect, test } from './fixtures';
import {
    getRegisteredProviderUrl,
    interceptProviderTargetRegistration,
} from './provider-target-route';

for (const canTryHttp of [true, false]) {
    test(`@xtream connection test respects proxy evidence: fallback=${canTryHttp}`, async ({
        page,
    }) => {
        await page.goto('/');
        const targets = await interceptProviderTargetRegistration(page);
        const requested: string[] = [];
        await page.route(
            '**/localhost:3000/connectivity-guard/reset',
            (route) => route.fulfill({ json: { reset: true } })
        );
        await page.route('**/localhost:3000/xtream**', async (route) => {
            const url = new URL(route.request().url());
            const base = getRegisteredProviderUrl(url, targets);
            if (!base) throw new Error('Missing synthetic provider target');
            requested.push(base);
            expect(url.searchParams.get('connectionTest')).toBe('true');
            await route.fulfill({
                json: base.startsWith('https:')
                    ? {
                          connectionFailure: {
                              kind: canTryHttp ? 'connection' : 'tls',
                              canTryHttp,
                          },
                      }
                    : { payload: { user_info: { auth: 1, status: 'Active' } } },
            });
        });
        await page.getByRole('button', { name: 'Add playlist' }).click();
        const dialog = page.getByRole('dialog');
        await dialog
            .getByRole('radio', { name: /Xtream credentials/i })
            .click();
        await dialog.locator('#title').fill('Synthetic protocol test');
        await dialog
            .locator('#serverUrl')
            .fill('https://panel.example/base/get.php?type=m3u');
        await dialog.locator('#username').fill('user');
        await dialog.locator('#password').fill('pass');
        await expect(dialog.locator('#xtream-http-test-notice')).toBeVisible();
        await expect(dialog.locator('#xtream-http-test-notice')).toContainText(
            'username and password'
        );
        await dialog
            .getByRole('button', { name: 'Test HTTPS and HTTP', exact: true })
            .click();
        await expect(dialog.getByRole('status')).toContainText(
            canTryHttp
                ? 'Connected using HTTP'
                : 'Could not establish a secure connection'
        );
        await expect(dialog.locator('#serverUrl')).toHaveValue(
            canTryHttp
                ? 'http://panel.example/base'
                : 'https://panel.example/base/get.php?type=m3u'
        );
        expect(requested).toEqual(
            canTryHttp
                ? ['https://panel.example/base', 'http://panel.example/base']
                : ['https://panel.example/base']
        );
        await expect(
            dialog.getByRole('button', { name: 'Add', exact: true })
        ).toBeEnabled();
    });
}
