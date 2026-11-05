import { expect, test } from './fixtures';

test('compact methods preserve private drafts across switches', async ({
    page,
}, testInfo) => {
    await page.goto('/');
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    const dialog = page.getByRole('dialog');
    const method = (name: RegExp) => dialog.getByRole('radio', { name });
    await expect(method(/M3U URL/)).toBeVisible();
    const grid = dialog.locator('.apd-method-grid');
    expect((await grid.boundingBox())!.height).toBeLessThan(125);
    await method(/Xtream credentials/).click();
    await dialog.locator('#title').fill('Remembered Xtream');
    await dialog.locator('#serverUrl').fill('https://fixture.example');
    await dialog.locator('#username').fill('draft-user');
    await dialog.locator('#password').fill('draft-password');
    await dialog.getByRole('button', { name: 'Show password' }).click();
    await method(/Stalker portal/).click();
    await dialog.locator('#title').fill('Remembered Stalker');
    await dialog
        .locator('#portalUrl')
        .fill('https://fixture.example/portal.php');
    await dialog.locator('#macAddress').fill('00:1A:79:5E:00:41');
    const advanced = dialog.locator('app-stalker-portal-import details');
    const openAdvanced = async () => {
        if ((await advanced.getAttribute('open')) === null)
            await advanced.locator('summary').click();
    };
    await openAdvanced();
    await dialog.locator('#serialNumber').fill('DRAFT-SERIAL');
    await dialog
        .getByRole('checkbox', {
            name: 'Generate device IDs from the MAC address',
            exact: true,
        })
        .check();
    await expect(dialog.locator('#deviceId1')).not.toHaveValue('');
    const derivedId = await dialog.locator('#deviceId1').inputValue();
    await method(/M3U URL/).click();
    await dialog
        .getByRole('textbox', { name: /Playlist URL/ })
        .fill('https://fixture.example/list.m3u');
    await dialog
        .getByRole('textbox', { name: 'Playlist title' })
        .fill('Remembered M3U');
    await method(/Xtream credentials/).click();
    await expect(dialog.locator('#title')).toHaveValue('Remembered Xtream');
    await expect(dialog.locator('#username')).toHaveValue('draft-user');
    await expect(dialog.locator('#password')).toHaveValue('draft-password');
    await expect(dialog.locator('#password')).toHaveAttribute(
        'type',
        'password'
    );
    await method(/Stalker portal/).click();
    await expect(dialog.locator('#macAddress')).toHaveValue(
        '00:1A:79:5E:00:41'
    );
    await openAdvanced();
    await expect(dialog.locator('#serialNumber')).toHaveValue('DRAFT-SERIAL');
    await expect(
        dialog.getByRole('checkbox', {
            name: 'Generate device IDs from the MAC address',
            exact: true,
        })
    ).toBeChecked();
    await expect(dialog.locator('#deviceId1')).toHaveValue(derivedId);
    await method(/Raw m3u text/).click();
    await dialog
        .locator('textarea')
        .fill('#EXTM3U\n#EXTINF:-1,Draft\nhttps://fixture.example/live.m3u8');
    await method(/M3U URL/).click();
    await expect(
        dialog.getByRole('textbox', { name: 'Playlist title' })
    ).toHaveValue('Remembered M3U');
    await method(/Raw m3u text/).click();
    await expect(dialog.locator('textarea')).toHaveValue(/Draft/);
    await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
    await method(/M3U URL/).click();
    await method(/Raw m3u text/).click();
    await expect(dialog.locator('textarea')).toHaveValue('');
    await method(/M3U file/).click();
    await dialog.locator('input[type="file"]').setInputFiles({
        name: 'draft.m3u',
        mimeType: 'application/x-mpegURL',
        buffer: Buffer.from(
            '#EXTM3U\n#EXTINF:-1,Draft\nhttps://fixture.example/live'
        ),
    });
    await method(/M3U URL/).click();
    await method(/M3U file/).click();
    await expect(dialog).toContainText('draft.m3u');
    await method(/M3U URL/).click();
    for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => {
            document.body.classList.toggle('dark-theme', theme === 'dark');
            document.body.classList.toggle('light-theme', theme === 'light');
        }, theme);
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`compact-${theme}.png`),
        });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await grid.boundingBox())!.height).toBeLessThan(210);
    await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('compact-mobile-dark.png'),
    });
    await method(/M3U URL/).focus();
    await page.keyboard.press('ArrowRight');
    await expect(method(/M3U file/)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    await method(/Xtream credentials/).click();
    await expect(dialog.locator('#username')).toHaveValue('');
});

test('compact methods fit longer translations at intermediate and narrow widths', async ({
    page,
}, testInfo) => {
    await page.goto('/workspace/settings/general');
    await page.locator('[data-test-id="select-language"]').click();
    await page.locator('mat-option[data-test-id="de"]').click();
    const save = page.locator('[data-test-id="save-settings"]');
    await save.click({ noWaitAfter: true });
    await expect(save).toBeHidden();
    await page.goto('/');
    await page
        .getByRole('button', { name: 'Playlist hinzufügen', exact: true })
        .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio')).toHaveCount(6);
    await expect(dialog).toContainText('Xtream-Zugangsdaten');
    for (const width of [768, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await dialog.locator('.apd-method-grid').boundingBox();
        if (!bounds) throw new Error('Missing method picker');
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        for (const radio of await dialog.getByRole('radio').all()) {
            await expect
                .poll(async () => (await radio.boundingBox())!.height)
                .toBeGreaterThanOrEqual(44);
            expect((await radio.boundingBox())!.height).toBeLessThanOrEqual(60);
            expect(
                await radio.evaluate((el) => el.scrollWidth <= el.clientWidth)
            ).toBe(true);
        }
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`compact-de-${width}.png`),
        });
    }
});
