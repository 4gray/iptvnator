import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { addSource, backend, nav, start } from './helpers';

test('categories retain drafts and save only their own field across relaunch', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    const category = (name: string) =>
        page.getByRole('tab', { name, exact: false });
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await category('Appearance').click();
    await page.getByLabel('Home composition').selectOption('shelf');
    await category('Metadata').click();
    await page
        .getByLabel('TMDB API key or read access token')
        .fill('unsaved-fixture');
    await category('Programme guide').click();
    await page.getByLabel('Show provider programme guide').uncheck();
    await page
        .getByRole('button', { name: 'Save settings', exact: true })
        .click();
    await expect(
        page.getByRole('status').filter({ hasText: 'Settings saved' })
    ).toBeVisible();
    await expect(page.locator('.tv-app')).toHaveClass(/cinema/);
    await category('Appearance').click();
    await expect(page.getByLabel('Home composition')).toHaveValue('shelf');
    await page
        .getByRole('button', { name: 'Save settings', exact: true })
        .click();
    await expect(page.locator('.tv-app')).toHaveClass(/shelf/);
    await category('Metadata').click();
    await expect(
        page.getByLabel('TMDB API key or read access token')
    ).toHaveValue('unsaved-fixture');
    await page.reload();
    await nav(page, 'Settings');
    await category('Programme guide').click();
    await expect(
        page.getByLabel('Show provider programme guide')
    ).not.toBeChecked();
    await category('Metadata').click();
    await expect(
        page.getByLabel('TMDB API key or read access token')
    ).toHaveValue('');
    await expect(page.locator('.tv-app')).toHaveClass(/shelf/);
});

test('remote category navigation, text editing, Back and return restore focus', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    const appearance = page.getByRole('tab', {
        name: 'Appearance',
        exact: false,
    });
    await appearance.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByLabel('Home composition')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(appearance).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Home composition')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(appearance).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
        page.getByRole('tab', { name: 'Programme guide', exact: false })
    ).toBeFocused();
    await page.keyboard.press('ArrowRight');
    const epg = page.getByLabel('Show provider programme guide');
    await expect(epg).toBeFocused();
    await nav(page, 'Sources');
    await nav(page, 'Settings');
    await expect(epg).toBeFocused();
    await page.getByRole('tab', { name: 'Metadata', exact: false }).click();
    const key = page.getByLabel('TMDB API key or read access token');
    await key.fill('editable');
    await key.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(key).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
        page.getByRole('tab', { name: 'Metadata', exact: false })
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
        page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeHidden();
});

test('panels fit TV sizes, keep categories fixed and support pointer selection', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    const folder = join(
        workspaceRoot,
        'dist/tv-verification/settings-categories'
    );
    await mkdir(folder, { recursive: true });
    for (const [width, height] of [
        [1920, 1080],
        [1280, 720],
    ]) {
        await page.setViewportSize({ width, height });
        for (const name of [
            'Connection',
            'Library',
            'Metadata',
            'Your remote',
        ]) {
            const tab = page.getByRole('tab', { name, exact: false });
            await tab.hover();
            await expect(tab).toBeFocused();
            await tab.click();
            await expect(tab).toHaveAttribute('aria-selected', 'true');
            const panel = page.getByRole('tabpanel');
            const bounds = await panel.boundingBox();
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
            expect(
                await page
                    .locator('main')
                    .evaluate((main) => main.scrollHeight <= main.clientHeight)
            ).toBe(true);
            await page.screenshot({
                path: join(
                    folder,
                    `${width}-${name.replace(/ /g, '-').toLowerCase()}.png`
                ),
            });
        }
    }
});

test('phone setup owns remote and Tab focus, Back closes it in the selected category', async ({
    page,
}) => {
    await start(page);
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await expect(page.locator('.connection-status')).toHaveText('Connected');
    await nav(page, 'Settings');
    await page.getByRole('tab', { name: 'Metadata', exact: false }).click();
    await page
        .getByRole('button', { name: 'Set up from phone', exact: true })
        .click();
    const dialog = page.getByRole('dialog', { name: 'Set up from phone' });
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole('button', { name: 'Close setup' });
    await expect(close).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await close.dispatchEvent('keydown', { key: 'Unidentified', keyCode: 461 });
    await expect(dialog).toBeHidden();
    await expect(
        page.getByRole('tab', { name: 'Metadata', exact: false })
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
        page.getByRole('button', { name: 'Set up from phone', exact: true })
    ).toBeFocused();
});

test('library drafts and metadata write errors survive switching categories', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    await page.getByRole('tab', { name: 'Library', exact: false }).click();
    await page.getByLabel('Library server URL').fill('http://draft.invalid');
    await page
        .getByLabel('Library access token (if required)')
        .fill('draft-fixture');
    await page.getByRole('tab', { name: 'Metadata', exact: false }).click();
    await page
        .getByLabel('TMDB API key or read access token')
        .fill('metadata-fixture');
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
    await page
        .getByRole('button', { name: 'Save TMDB settings', exact: true })
        .click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'not saved'
    );
    await page.getByRole('tab', { name: 'Library', exact: false }).click();
    await expect(page.getByLabel('Library server URL')).toHaveValue(
        'http://draft.invalid'
    );
    await expect(
        page.getByLabel('Library access token (if required)')
    ).toHaveValue('draft-fixture');
    await page.getByRole('tab', { name: 'Metadata', exact: false }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'not saved'
    );
    await page
        .getByRole('button', { name: 'Save TMDB settings', exact: true })
        .click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'saved on this TV'
    );
    await page.reload();
    await nav(page, 'Settings');
    await page.getByRole('tab', { name: 'Library', exact: false }).click();
    await expect(page.getByLabel('Library server URL')).toHaveValue('');
    await page.getByRole('tab', { name: 'Metadata', exact: false }).click();
    await expect(
        page.getByLabel('TMDB API key or read access token')
    ).toHaveValue('metadata-fixture');
});

test('dynamic backend results keep control focus keys unique and stable across return', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await nav(page, 'Settings');
    const probe = page.getByRole('button', {
        name: 'Test direct access',
        exact: true,
    });
    const key = await probe.getAttribute('data-focus');
    for (const port of [3333, 3335]) {
        await page.route(
            `http://iptvnator.local:${port}/tv/connection`,
            (route) =>
                route.fulfill({
                    json: {
                        service: 'iptvnator',
                        protocol: 1,
                        pairing: true,
                        auth: 'token',
                    },
                })
        );
    }
    await page.route('http://iptvnator.local:4333/**', (route) =>
        route.abort()
    );
    await page
        .getByRole('button', { name: 'Find backend', exact: true })
        .click();
    await expect(page.locator('.backend-results button')).toHaveCount(2);
    await expect(probe).toHaveAttribute('data-focus', key!);
    const keys = await page
        .locator('#settings-panel-connection [data-focus]')
        .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-focus'))
        );
    expect(new Set(keys).size).toBe(keys.length);
    await probe.focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowRight');
    await expect(probe).toBeFocused();
    await nav(page, 'Home');
    await nav(page, 'Settings');
    await expect(probe).toBeFocused();
});

test('phone modal blocks pointer and programmatic focus behind the QR', async ({
    page,
}) => {
    await start(page);
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await expect(page.locator('.connection-status')).toHaveText('Connected');
    await nav(page, 'Settings');
    await page
        .getByRole('button', { name: 'Set up from phone', exact: true })
        .click();
    const dialog = page.getByRole('dialog');
    const close = dialog.getByRole('button', { name: 'Close setup' });
    await expect(close).toBeFocused();
    const category = page.getByRole('tab', { name: 'Metadata', exact: false });
    const box = (await category.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(close).toBeFocused();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(close).toBeFocused();
    await category.focus();
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(
        page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible();
});

test('return falls back to the category when the remembered control is disabled', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    const category = page.getByRole('tab', { name: 'Metadata', exact: false });
    await category.click();
    await page
        .getByLabel('TMDB API key or read access token')
        .fill('unsaved-fixture');
    await page
        .getByRole('button', { name: 'Check TMDB key', exact: true })
        .focus();
    await nav(page, 'Home');
    await nav(page, 'Settings');
    await expect(
        page.getByRole('button', { name: 'Check TMDB key', exact: true })
    ).toBeDisabled();
    await expect(category).toBeFocused();
});

test('return preserves scroll for categories selected after the initial restored panel', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await start(page);
    await nav(page, 'Settings');
    const connection = page.locator('#settings-panel-connection');
    await connection.evaluate((panel) => {
        panel.scrollTop = panel.scrollHeight;
    });
    const scroll = await connection.evaluate((panel) => panel.scrollTop);
    expect(scroll).toBeGreaterThan(100);
    await page.getByRole('tab', { name: 'Metadata', exact: false }).click();
    await nav(page, 'Home');
    await nav(page, 'Settings');
    await page.getByRole('tab', { name: 'Connection', exact: false }).click();
    await expect
        .poll(() => connection.evaluate((panel) => panel.scrollTop))
        .toBe(scroll);
});

for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
]) {
    test(`remote saves Home composition through select and Right at ${width}`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height });
        await start(page);
        await nav(page, 'Settings');
        await page
            .getByRole('tab', { name: 'Appearance', exact: false })
            .click();
        await page.keyboard.press('ArrowRight');
        const layout = page.getByLabel('Home composition');
        await expect(layout).toBeFocused();
        await layout.selectOption('shelf');
        await expect(layout).toHaveValue('shelf');
        await expect(layout).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(
            page.getByRole('button', { name: 'Save settings', exact: true })
        ).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('.tv-app')).toHaveClass(/shelf/);
        await expect(
            page.getByRole('status').filter({ hasText: 'Settings saved' })
        ).toBeVisible();
    });
}

test('panel arrows keep Metadata controls in the active category', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    const category = page.getByRole('tab', { name: 'Metadata', exact: false });
    await category.click();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByLabel('Use TMDB metadata')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const key = page.getByLabel('TMDB API key or read access token');
    await expect(key).toBeFocused();
    await expect(category).toHaveAttribute('aria-selected', 'true');
    await key.fill('navigation-fixture');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByLabel('Use TMDB metadata')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByLabel('Metadata language')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(
        page.getByRole('button', { name: 'Check TMDB key', exact: true })
    ).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(
        page.getByRole('button', { name: 'Save TMDB settings', exact: true })
    ).toBeFocused();
});

test('closed backend disclosure is excluded from entry and restoration', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    await page
        .getByText('Backend access token (if required)', { exact: true })
        .click();
    const token = page.getByLabel('Backend access token', { exact: true });
    await token.focus();
    await nav(page, 'Home');
    await nav(page, 'Settings');
    await expect(token).toBeHidden();
    await expect(
        page.getByRole('tab', { name: 'Connection', exact: false })
    ).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByLabel('Backend URL', { exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
        page.getByText('Backend access token (if required)', { exact: true })
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
        page.getByRole('button', { name: 'Check and connect', exact: true })
    ).not.toBeFocused();
    await expect(
        page.getByRole('button', { name: 'Find backend', exact: true })
    ).toBeFocused();
});

test('remote OK toggles the programme checkbox and saves only through Save', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Programme guide', exact: false })
        .click();
    await page.keyboard.press('ArrowRight');
    const checkbox = page.getByLabel('Show provider programme guide');
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(checkbox).not.toBeChecked();
    await expect(
        page.getByRole('status').filter({ hasText: 'Settings saved' })
    ).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(
        page.getByRole('button', { name: 'Save settings', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
        page.getByRole('status').filter({ hasText: 'Settings saved' })
    ).toBeVisible();
    await page.reload();
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Programme guide', exact: false })
        .click();
    await expect(checkbox).not.toBeChecked();
});

test('Down at the last panel control scrolls the remaining help without changing category', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await start(page);
    await nav(page, 'Settings');
    await page
        .getByRole('button', { name: 'Find backend', exact: true })
        .focus();
    const panel = page.locator('#settings-panel-connection');
    const scroll = await panel.evaluate((element) => element.scrollTop);
    await page.keyboard.press('ArrowDown');
    await expect
        .poll(() => panel.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(scroll);
    await expect(
        page.getByRole('tab', { name: 'Connection', exact: false })
    ).toHaveAttribute('aria-selected', 'true');
});
