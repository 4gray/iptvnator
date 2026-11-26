import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addStalkerPortal,
    interceptStalkerRequests,
} from './stalker-portal.fixture';

test.use({ serviceWorkers: 'block' });

test('@pwa @stalker saves hidden genres across reload and restores them with the TV remote', async ({
    page,
}) => {
    await configureMockProviderBackend(page);
    await interceptStalkerRequests(page);
    await page.goto('/');
    await addStalkerPortal(page, {
        name: 'Visibility fixture',
        mac: '00:1A:79:18:44:01',
    });
    const catalog = new URL(page.url()).pathname.replace(
        /\/vod(?:\/.*)?$/,
        '/vod'
    );
    const manage = page.getByRole('button', { name: 'Manage categories' });
    const dialog = page.getByRole('dialog');
    const genre = dialog.getByRole('checkbox', { name: 'Fixture shows' });
    const movie = page
        .locator('app-grid-list')
        .getByRole('button', { name: 'Fixture Beta', exact: true });
    await expect(movie).toBeVisible();
    await manage.click();
    await dialog.getByRole('searchbox').fill('fixture');
    await dialog.getByRole('button', { name: 'Deselect Filtered' }).click();
    await expect(genre).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(movie).toHaveCount(0);
    const rail = page.locator('app-workspace-context-panel');
    await expect(rail.getByText('Fixture shows', { exact: true })).toHaveCount(
        0
    );

    await page.goto(catalog.replace(/\/vod$/, '/search?q=Fixture&kind=vod'));
    await expect(
        page.getByText('No results found for "Fixture"')
    ).toBeVisible();
    await expect(page.getByText('Fixture Beta', { exact: true })).toHaveCount(
        0
    );

    // Drive the same remote layer that the Android WebView injects.
    await page.addInitScript({
        path: resolve(
            __dirname,
            '../../../tv-shell/android/app/src/main/assets/tvshell/tv.js'
        ),
    });
    await page.goto(catalog);
    const search = dialog.getByRole('searchbox');
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    const openGenreWithRemote = async () => {
        // A trial click waits for a stable, actionable trigger without clicking.
        // Open it with the remote's OK key, not a mouse action.
        await manage.click({ trial: true });
        await manage.press('Enter');
        await expect(genre).toBeVisible();
        await expect(genre).not.toBeChecked();

        // Match the Xtream remote test: isolate the target row so that the
        // next downward move is towards the footer, not another category.
        await search.fill('Fixture shows');
        await expect(dialog.getByRole('checkbox')).toHaveCount(1);
        await expect(genre).toBeVisible();
        await save.click({ trial: true });
        await search.focus();
        await expect(search).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(genre).toBeFocused();
    };
    await openGenreWithRemote();
    await page.keyboard.press('Enter');
    await expect(genre).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(genre).not.toBeFocused();
    await page.keyboard.press('F9');
    await expect(dialog).toBeHidden();
    await openGenreWithRemote();
    await page.keyboard.press('Enter');
    await expect(genre).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(genre).not.toBeFocused();
    if (!(await save.evaluate((button) => button === document.activeElement))) {
        await page.keyboard.press('ArrowRight');
    }
    await expect(save).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(movie).toBeVisible();
});
