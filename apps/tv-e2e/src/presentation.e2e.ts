import { expect, test } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chooseTv, addSource, nav, start } from './helpers';
import { enableMarketingTmdb } from './marketing-tmdb';
test('packaged classic script boots and connects from file protocol', async ({
    page,
}) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.name));
    await page.goto(
        pathToFileURL(join(workspaceRoot, 'dist/apps/tv/index.html')).href
    );
    await expect(
        page.getByRole('heading', { name: 'Sources', exact: true })
    ).toBeVisible();
    await addSource(page, 'xtream');
    await expect(page.locator('.hero h1')).not.toHaveText(
        'Make yourself at home.'
    );
    expect(errors).toEqual([]);
});
test('remote arrows can leave source fields and reach native disclosure controls', async ({
    page,
}) => {
    await start(page);
    await expect(
        page
            .getByRole('navigation')
            .getByRole('button', { name: 'Sources', exact: true })
    ).toBeFocused();
    const backend = page.getByLabel('IPTVnator backend URL');
    await backend.focus();
    await page.keyboard.press('ArrowDown');
    await expect(
        page.getByText('Backend access token (if required)', { exact: true })
    ).toBeFocused();
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByLabel('Provider URL')).toBeFocused();
    await page.getByRole('button', { name: 'STALKER', exact: true }).click();
    await page.getByLabel('MAC address').focus();
    await page.keyboard.press('ArrowDown');
    const disclosure = page.getByText('Existing MAG device identity', {
        exact: true,
    });
    await expect(disclosure).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByLabel('Serial number')).toBeFocused();
    await nav(page, 'Settings');
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                )
            )
    );
    await page.getByRole('tab', { name: 'Appearance', exact: false }).click();
    const layout = page.getByLabel('Home composition');
    await layout.focus();
    await page.keyboard.press('Enter');
    await expect(
        page.getByRole('dialog', { name: 'Home composition', exact: true })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(layout).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(layout).not.toBeFocused();
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
    await enableMarketingTmdb(page);
    await nav(page, 'Home');
    await expect(page.locator('.hero h1')).not.toHaveText(
        'Make yourself at home.'
    );
    await mkdir(join(workspaceRoot, 'dist/tv-verification'), {
        recursive: true,
    });
    await expect
        .poll(() =>
            page.locator('.page-backdrop').evaluate((stage) => {
                const rect = stage.getBoundingClientRect();
                const main = document.querySelector('main')!;
                return (
                    Math.abs(rect.top) < 1 &&
                    Math.abs(rect.left - main.getBoundingClientRect().left) <
                        1 &&
                    Math.abs(rect.width - main.clientWidth) < 1
                );
            })
        )
        .toBe(true);
    expect(
        await page
            .locator('.hero')
            .evaluate((hero) => getComputedStyle(hero).backgroundImage)
    ).toBe('none');
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
    await page.getByRole('button', { name: 'Explore title' }).click();
    await expect(page.locator('.loading')).toBeHidden();
    await expect
        .poll(() =>
            page
                .locator('.page-backdrop')
                .evaluate((stage) =>
                    Math.abs(stage.getBoundingClientRect().top)
                )
        )
        .toBeLessThan(1);
    await expect(page.locator('.page-backdrop img')).toHaveAttribute(
        'src',
        /backdrop/
    );
    const chips = page.getByRole('list', { name: 'Title information' });
    await expect(
        chips.getByLabel('Genre: Maritime Crime Thriller', { exact: true })
    ).toBeVisible();
    await expect(
        chips.getByLabel('Country: Meridian Union', { exact: true })
    ).toBeVisible();
    await expect(
        chips.getByLabel('TMDB rating: TMDB 8.2', { exact: true })
    ).toBeVisible();
    const credits = page.getByRole('region', { name: 'TMDB credits' });
    await expect(credits.getByRole('heading')).toHaveText('Directors & cast');
    await expect(credits.getByRole('button')).toHaveCount(5);
    await expect
        .poll(() =>
            page
                .locator(
                    '.detail-poster img, .page-backdrop img, .person-avatar img'
                )
                .evaluateAll((images) =>
                    images.every(
                        (element) =>
                            (element as HTMLImageElement).complete &&
                            (element as HTMLImageElement).naturalWidth > 0
                    )
                )
        )
        .toBe(true);
    await page.screenshot({
        path: join(workspaceRoot, 'dist/tv-verification/cinema-detail.png'),
    });
    await credits
        .getByRole('button', {
            name: 'View filmography: Mara Venn',
            exact: true,
        })
        .click();
    await expect(
        page.getByRole('region', { name: 'Person filmography' })
    ).toBeVisible();
    await expect(page.locator('.filmography-card').first()).toContainText(
        'Black Harbor'
    );
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('.detail-hero h1')).toHaveText(
        'Skyline Sentinels'
    );
    await expect(
        chips.getByLabel('Duration: 44 min / episode', { exact: true })
    ).toBeVisible();
    await expect(credits.getByRole('heading')).toHaveText('Creators & cast');
    await expect(credits.getByRole('button')).toHaveCount(5);
    await expect(page.locator('.episode strong').first()).toHaveText(
        'The Dawn Shift'
    );
    await expect
        .poll(() =>
            page
                .locator(
                    '.detail-poster img, .page-backdrop img, .person-avatar img, .episode-still'
                )
                .evaluateAll((images) =>
                    images.every(
                        (element) =>
                            (element as HTMLImageElement).complete &&
                            (element as HTMLImageElement).naturalWidth > 0
                    )
                )
        )
        .toBe(true);
    await page.screenshot({
        path: join(workspaceRoot, 'dist/tv-verification/cinema-series.png'),
    });
    await nav(page, 'Settings');
    await page.getByRole('tab', { name: 'Connection', exact: false }).click();
    await page.getByRole('button', { name: 'Test direct access' }).click();
    await expect(page.locator('.probe [role=status]')).toContainText(
        'directly readable'
    );
    await page.getByRole('tab', { name: 'Appearance', exact: false }).click();
    await chooseTv(page, 'Home composition', 'shelf');
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
