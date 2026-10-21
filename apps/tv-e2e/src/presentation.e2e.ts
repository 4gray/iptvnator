import { expect, test } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { addSource, nav, start } from './helpers';
test('packaged classic script boots from file protocol', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.name));
    await page.goto(
        pathToFileURL(join(workspaceRoot, 'dist/apps/tv/index.html')).href
    );
    await expect(
        page.getByRole('heading', { name: 'Sources', exact: true })
    ).toBeVisible();
    expect(errors).toEqual([]);
});
test('cinema/showcase, direct catalog diagnostic and TV layout widths', async ({
    page,
}) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.name));
    await start(page);
    await addSource(page, 'xtream', {
        username: 'marketing',
        password: 'marketing',
    });
    await expect(page.locator('.hero h1')).not.toHaveText(
        'Make yourself at home.'
    );
    await mkdir(join(workspaceRoot, 'dist/tv-verification'), {
        recursive: true,
    });
    await expect
        .poll(() =>
            page
                .locator('.poster-art img')
                .first()
                .evaluate((img) => (img as HTMLImageElement).naturalWidth)
        )
        .toBeGreaterThan(0);
    await page.screenshot({
        path: join(workspaceRoot, 'dist/tv-verification/cinema-home.png'),
    });
    await nav(page, 'Settings');
    await page.getByRole('button', { name: 'Test direct access' }).click();
    await expect(page.locator('.probe [role=status]')).toContainText(
        'directly readable'
    );
    await page.getByLabel('Home composition').selectOption('shelf');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await nav(page, 'Home');
    await expect(page.locator('.hero.compact')).toBeVisible();
    await page.screenshot({
        path: join(workspaceRoot, 'dist/tv-verification/showcase-home.png'),
    });
    for (const width of [1920, 1280, 1024]) {
        await page.setViewportSize({ width, height: 1080 });
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            )
        ).toBe(true);
    }
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().hover();
    await expect(page.locator('.poster-card').first()).toBeFocused();
    await page.evaluate(() =>
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Unidentified',
                keyCode: 39,
                bubbles: true,
            })
        )
    );
    await expect(page.locator('.poster-card').nth(1)).toBeFocused();
    expect(errors).toEqual([]);
});
