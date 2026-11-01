import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { addSource, nav, start } from './helpers';

test('TV picker separates remote focus, confirmation and Back cancellation', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    await page.getByRole('tab', { name: 'Appearance', exact: false }).click();
    await page.keyboard.press('ArrowRight');
    const trigger = page.getByRole('combobox', {
        name: 'Home composition',
        exact: true,
    });
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
        name: 'Home composition',
        exact: true,
    });
    await expect(dialog.getByRole('option', { selected: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
        dialog.getByRole('option', { name: 'Витрина · Showcase' })
    ).toBeFocused();
    await expect(trigger).toHaveAttribute('data-value', 'cinema');
    await page.keyboard.press('Tab');
    await expect
        .poll(() =>
            page.evaluate(
                () => !!document.activeElement?.closest('[data-tv-modal]')
            )
        )
        .toBe(true);
    await dialog.dispatchEvent('keydown', {
        key: 'Unidentified',
        keyCode: 461,
    });
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('data-value', 'cinema');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('data-value', 'shelf');
    await expect(trigger).toBeFocused();
    await expect(page.locator('.tv-app')).toHaveClass(/cinema/);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('.tv-app')).toHaveClass(/shelf/);
});

test('long TV choices have large rows, scrolling, filtering and pointer selection', async ({
    page,
}) => {
    await start(page);
    await page.route('**/xtream?**', async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_vod_categories'
        )
            return route.fallback();
        await route.fulfill({
            json: {
                payload: Array.from({ length: 80 }, (_, i) => ({
                    category_id: String(i + 1),
                    category_name: `Synthetic category ${String(i + 1).padStart(3, '0')} with a longer descriptive label`,
                })),
            },
        });
    });
    await addSource(page, 'xtream', {
        username: 'marketing',
        password: 'marketing',
    });
    await nav(page, 'Movies');
    const trigger = page.getByRole('combobox', {
        name: 'Category',
        exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Category', exact: true });
    await expect(dialog.getByRole('option')).toHaveCount(81);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    expect(
        await dialog.getByRole('listbox').evaluate((e) => e.scrollTop)
    ).toBeGreaterThan(0);
    const row = dialog.getByRole('option').nth(12);
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(76);
    expect(
        await row.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    ).toBeGreaterThanOrEqual(28);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await expect(
        page.getByRole('searchbox', { name: 'Filter Category' })
    ).toBeFocused();
    const output = join(workspaceRoot, 'dist/tv-p1-verification');
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, 'category-picker.png') });
    await page.getByRole('searchbox', { name: 'Filter Category' }).fill('079');
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await dialog.getByRole('option').click();
    await expect(trigger).toHaveAttribute('data-value', '79');
    await expect(page.locator('video[src],video source')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 720 });
    await trigger.click();
    const rect = (await dialog.boundingBox())!;
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(720);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
});

test('long descriptions can be read with a remote and return to their trigger', async ({
    page,
}) => {
    await start(page);
    await page.route('**/xtream?**', async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_vod_info'
        )
            return route.fallback();
        const response = await route.fetch();
        const body = await response.json();
        body.payload.info.plot =
            'Synthetic description. Every paragraph remains readable with the TV remote. '.repeat(
                80
            );
        await route.fulfill({ response, json: body });
    });
    await addSource(page, 'xtream', {
        username: 'marketing',
        password: 'marketing',
    });
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    const more = page.getByRole('button', { name: 'Read full description' });
    await more.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Full description' });
    const text = dialog.getByLabel('Description', { exact: true });
    await expect(text).toBeFocused();
    await page.keyboard.press('ArrowDown');
    expect(await text.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('ArrowUp');
    expect(await text.evaluate((e) => e.scrollTop)).toBe(0);
    await page.addScriptTag({
        path: join(workspaceRoot, 'node_modules/axe-core/axe.min.js'),
    });
    const violations = await page.evaluate(async () => {
        const axe = (
            window as unknown as {
                axe: { run: () => Promise<{ violations: { id: string }[] }> };
            }
        ).axe;
        return (await axe.run()).violations.map((v) => v.id);
    });
    expect(violations).toEqual([]);
    const output = join(workspaceRoot, 'dist/tv-p1-verification');
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, 'full-description.png') });
    await dialog.dispatchEvent('keydown', {
        key: 'Unidentified',
        keyCode: 461,
    });
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.poster-card').first()).toBeFocused();
});
