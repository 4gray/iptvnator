import { expect, Page, test } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { nav, start } from './helpers';

const manifest = JSON.parse(
    readFileSync(join(workspaceRoot, 'apps/tv/public/appinfo.json'), 'utf8')
);
const pkg = JSON.parse(
    readFileSync(join(workspaceRoot, 'package.json'), 'utf8')
);
const value = (page: Page, label: string) =>
    page
        .locator('.about-row')
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator('dd');
const aboutTab = (page: Page) =>
    page.getByRole('tab', { name: 'About Version & device information' });

test('About shows packaged build metadata without a source and fits both TV viewports', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    await aboutTab(page).click();
    await page.keyboard.press('ArrowRight');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toBeFocused();
    await expect(
        panel.getByRole('heading', { name: `About ${manifest.title}` })
    ).toBeVisible();
    await expect(value(page, 'TV app version')).toHaveText(manifest.version);
    await expect(value(page, 'Application ID')).toHaveText(manifest.id);
    await expect(value(page, 'IPTVnator release')).toHaveText(pkg.version);
    await expect(value(page, 'Revision')).toHaveText(
        /^[a-f0-9]{12}( · local changes)?$/
    );
    const builtAt = await value(page, 'Built · UTC').innerText();
    expect(Number.isFinite(Date.parse(`${builtAt.replace(' ', 'T')}Z`))).toBe(
        true
    );
    await expect(value(page, 'Platform')).toHaveText('Web browser');
    await expect(value(page, 'Browser engine')).toHaveText(/^Chromium [\d.]+$/);
    await expect(panel).toContainText(pkg.homepage);
    await expect(panel).toContainText(
        `${manifest.vendor} · ${pkg.license} license`
    );
    await expect(panel.locator('input,button,select,textarea')).toHaveCount(0);
    const output = join(workspaceRoot, 'dist/tv-about-verification');
    mkdirSync(output, { recursive: true });
    for (const [width, height] of [
        [1920, 1080],
        [1280, 720],
    ]) {
        await page.setViewportSize({ width, height });
        await expect(value(page, 'Viewport')).toHaveText(
            `${width} × ${height} px`
        );
        expect(
            await panel.evaluate((e) => e.scrollWidth <= e.clientWidth)
        ).toBe(true);
        const bounds = await panel.boundingBox();
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
        await page.screenshot({ path: join(output, `about-${width}.png`) });
    }
    const before = await panel.evaluate((e) => e.scrollTop);
    await page.keyboard.press('ArrowDown');
    await expect
        .poll(() => panel.evaluate((e) => e.scrollTop))
        .toBeGreaterThan(before);
    await page.keyboard.press('Escape');
    await expect(aboutTab(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel).toBeFocused();
});

test('About supports remote category movement, platform Back and focus restoration', async ({
    page,
}) => {
    await start(page);
    await nav(page, 'Settings');
    await page.getByRole('tab', { name: 'Your remote', exact: false }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(aboutTab(page)).toBeFocused();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toBeFocused();
    await panel.dispatchEvent('keydown', { key: 'Unidentified', keyCode: 461 });
    await expect(aboutTab(page)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(panel).toBeFocused();
    await nav(page, 'Home');
    await nav(page, 'Settings');
    await expect(aboutTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(aboutTab(page)).toBeFocused();
});
