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

test('explicit unchanged phone settings replace local preference drafts only after commit', async ({
    page,
    browser,
}) => {
    await start(page);
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await expect(page.locator('.connection-status')).toHaveText('Connected');
    await nav(page, 'Settings');
    await page.getByRole('tab', { name: 'Library', exact: false }).click();
    await page.getByLabel('Library server URL').fill('http://draft.invalid');
    await page
        .getByLabel('Library access token (if required)')
        .fill('library-draft-fixture');
    await page.getByRole('tab', { name: 'Appearance', exact: false }).click();
    await page.getByLabel('Home composition').selectOption('shelf');
    await page
        .getByRole('tab', { name: 'Programme guide', exact: false })
        .click();
    await page.getByLabel('Show provider programme guide').uncheck();
    await page.getByRole('tab', { name: 'Metadata', exact: false }).click();
    await page.getByLabel('Use TMDB metadata').check();
    await page
        .getByLabel('TMDB API key or read access token')
        .fill('unsaved-key-fixture');
    await page.getByLabel('Metadata language').selectOption('de');
    const response = page.waitForResponse(
        (r) =>
            r.url() === `${backend}/tv/pairing` &&
            r.request().method() === 'POST'
    );
    await page
        .getByRole('button', { name: 'Set up from phone', exact: true })
        .click();
    const session = await (await response).json();
    const phone = await browser.newPage({
        viewport: { width: 390, height: 844 },
    });
    try {
        await phone.goto(
            `${backend}/tv/setup#${session.id}.${session.phoneToken}`
        );
        // These are the committed defaults, deliberately unchanged by the phone.
        await expect(phone.getByLabel('Home layout')).toHaveValue('cinema');
        await phone
            .getByRole('button', { name: 'Send settings to TV' })
            .click();
        const apply = page.getByRole('button', {
            name: 'Apply settings',
            exact: true,
        });
        await expect(apply).toBeVisible();
        await page.evaluate(() => {
            const original = IDBObjectStore.prototype.put;
            let fail = true;
            IDBObjectStore.prototype.put = function (...args) {
                if (fail) {
                    fail = false;
                    throw new DOMException('Full', 'QuotaExceededError');
                }
                return original.apply(this, args);
            };
        });
        await apply.click();
        await expect(page.locator('.phone-setup [role=alert]')).toContainText(
            'not saved'
        );
        await expect(page.getByLabel('Home composition')).toHaveValue('shelf');
        await expect(
            page.getByLabel('TMDB API key or read access token')
        ).toHaveValue('unsaved-key-fixture');
        await apply.click();
        await expect(phone.getByRole('status')).toContainText('Settings saved');
        await expect(page.getByLabel('Home composition')).toHaveValue('cinema');
        await expect(
            page.getByLabel('Show provider programme guide')
        ).toBeChecked();
        await expect(page.getByLabel('Use TMDB metadata')).not.toBeChecked();
        await expect(
            page.getByLabel('TMDB API key or read access token')
        ).toHaveValue('');
        await expect(page.getByLabel('Metadata language')).toHaveValue('en');
        await expect(page.getByLabel('Library server URL')).toHaveValue(
            'http://draft.invalid'
        );
        await expect(
            page.getByLabel('Library access token (if required)')
        ).toHaveValue('library-draft-fixture');
    } finally {
        await phone.close();
    }
});
