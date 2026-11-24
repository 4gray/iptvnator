import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import { interceptCollidingXtreamItems } from './xtream-collection-helpers';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';

test.use({ serviceWorkers: 'block' });

for (const section of [
    { route: 'live', type: 'live', title: 'Collision Live' },
    { route: 'vod', type: 'movie', title: 'Collision Movie' },
    { route: 'series', type: 'series', title: 'Collision Series' },
] as const) {
    test(`@pwa @xtream saves hidden ${section.route} categories across reload`, async ({
        page,
        request,
    }) => {
        await configureMockProviderBackend(page);
        await interceptXtreamRequests(page);
        const categoryIds = await interceptCollidingXtreamItems(
            page,
            request,
            MOCK_SERVER
        );
        const categoryId = categoryIds[section.type];
        await page.goto('/');
        await addXtreamPortal(page);
        const catalog = new URL(page.url()).pathname.replace(
            /\/vod(?:\/.*)?$/,
            '/' + section.route
        );
        await page.goto(catalog);
        const manage = page.getByRole('button', { name: 'Manage categories' });
        const dialog = page.getByRole('dialog');
        const row = dialog.locator(`[data-category-id="${categoryId}"]`);
        const checkbox = row.getByRole('checkbox');
        const save = dialog.getByRole('button', { name: 'Save', exact: true });
        await manage.click();
        await expect(checkbox).toBeChecked();
        const name = await row.locator('.category-name').innerText();
        await checkbox.uncheck();
        await save.click();
        await expect(dialog).toBeHidden();

        const rail = page.locator('app-workspace-context-panel');
        await expect(rail.getByText(name, { exact: true })).toHaveCount(0);
        await page.goto(catalog.replace(/\/[^/]+$/, '/search?q=Collision'));
        const visibleOnly = page.getByRole('checkbox', {
            name: 'Visible categories only',
        });
        const result = page.getByText(section.title, { exact: true });
        await expect(visibleOnly).toBeChecked();
        await expect(result).toHaveCount(0);
        await visibleOnly.uncheck();
        await expect(result).toBeVisible();

        if (section.type === 'movie') {
            await page.addInitScript({
                path: resolve(
                    __dirname,
                    '../../../tv-shell/android/app/src/main/assets/tvshell/tv.js'
                ),
            });
        }
        await page.goto(catalog);
        await expect(rail.getByText(name, { exact: true })).toHaveCount(0);
        if (section.type === 'movie') {
            await expect(manage).toBeEnabled();
            await manage.press('Enter');
            await dialog.getByRole('searchbox').fill(name);
            await dialog.getByRole('searchbox').focus();
            await page.keyboard.press('ArrowDown');
            await expect(checkbox).toBeFocused();
            await expect(checkbox).not.toBeChecked();
            await page.keyboard.press('Enter');
            await expect(checkbox).toBeChecked();
            await page.keyboard.press('ArrowDown');
            if (
                !(await save.evaluate(
                    (button) => button === document.activeElement
                ))
            ) {
                await page.keyboard.press('ArrowRight');
            }
            await expect(save).toBeFocused();
            await page.keyboard.press('Enter');
        } else {
            await manage.click();
            await expect(checkbox).not.toBeChecked();
            await checkbox.check();
            await save.click();
        }
        await expect(dialog).toBeHidden();
        await expect(rail.getByText(name, { exact: true })).toBeVisible();
    });
}
