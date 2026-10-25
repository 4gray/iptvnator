import { expect, test } from '@playwright/test';
import { backend, nav, start } from './helpers';
test('phone settings require TV confirmation, preserve the saved key on blank replacement and survive reload', async ({
    page,
    browser,
}) => {
    await start(page);
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await expect(page.locator('.connection-status')).toHaveText('Connected');
    await nav(page, 'Settings');
    const phone = await browser.newPage({
        viewport: { width: 390, height: 844 },
    });
    try {
        for (const replace of [true, false]) {
            const response = page.waitForResponse(
                (r) =>
                    r.url() === `${backend}/tv/pairing` &&
                    r.request().method() === 'POST'
            );
            await page
                .getByRole('button', { name: 'Set up from phone', exact: true })
                .click();
            const session = await (await response).json();
            await phone.goto(
                `${backend}/tv/setup#${session.id}.${session.phoneToken}`
            );
            await expect(
                phone.getByRole('button', { name: 'Send settings to TV' })
            ).toBeVisible();
            await expect(
                phone.getByLabel('TMDB API key or read access token')
            ).toHaveValue('');
            await phone.getByLabel('Home layout').selectOption('shelf');
            await phone.getByLabel('Use TMDB metadata').check();
            await phone
                .getByLabel('Metadata language')
                .selectOption(replace ? 'ru' : 'de');
            if (replace)
                await phone
                    .getByLabel('TMDB API key or read access token')
                    .fill('phone-test-key');
            else
                await expect(
                    phone.getByText('A key is already saved', { exact: false })
                ).toBeVisible();
            await phone
                .getByRole('button', { name: 'Send settings to TV' })
                .click();
            await expect(
                page.getByRole('button', {
                    name: 'Apply settings',
                    exact: true,
                })
            ).toBeVisible();
            await expect(page.locator('.phone-review')).not.toContainText(
                'phone-test-key'
            );
            await expect(phone.getByRole('status')).toContainText('Confirm');
            await page
                .getByRole('button', { name: 'Apply settings', exact: true })
                .click();
            await expect(phone.getByRole('status')).toContainText(
                'Settings saved'
            );
            await expect(
                page.getByLabel('TMDB API key or read access token')
            ).toHaveValue('phone-test-key');
            await expect(page.getByLabel('Home composition')).toHaveValue(
                'shelf'
            );
        }
        await page.reload();
        await nav(page, 'Settings');
        await expect(page.getByLabel('Metadata language')).toHaveValue('de');
        await expect(
            page.getByLabel('TMDB API key or read access token')
        ).toHaveValue('phone-test-key');
    } finally {
        await phone.close();
    }
});
