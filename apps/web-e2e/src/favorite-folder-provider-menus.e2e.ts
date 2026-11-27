import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addStalkerPortal,
    interceptStalkerRequests,
} from './stalker-portal.fixture';
import {
    addXtreamPortal,
    interceptXtreamRequests,
} from './xtream-series-playback.fixture';

const folderName = 'Synthetic channel folder';
const favoriteRows = (page: Page) =>
    page.locator('app-global-favorites-list .channel-name');
const folderButton = (page: Page, name: string) =>
    page
        .locator('app-workspace-favorite-folders-panel')
        .getByRole('button', { name: new RegExp(`^${name} `) });

test.use({ serviceWorkers: 'block' });

async function openLiveCategory(page: Page, path: string) {
    await page.goto(path);
    await page.locator('.context-panel .category-item').nth(1).click();
    const rows = page.locator('#live-channels [data-test-id="channel-item"]');
    await expect(rows.first()).toBeVisible();
    return rows;
}

async function openFolderDialog(
    page: Page,
    row: Locator,
    action: 'Add' | 'Move'
) {
    await row.getByRole('button', { name: 'More actions' }).press('Enter');
    const title =
        action === 'Add' ? 'Add to a favorites folder' : 'Move to folder';
    const menuItem = page.getByRole('menuitem', {
        name: `${title}…`,
    });
    await expect(menuItem).toBeVisible();
    await page.keyboard.press('End');
    await expect(menuItem).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    return dialog;
}

async function confirmFolder(
    page: Page,
    dialog: Locator,
    action: 'Add' | 'Move'
) {
    await dialog.getByRole('combobox', { name: 'Destination folder' }).click();
    await page.getByRole('option', { name: folderName, exact: true }).click();
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect(dialog).toBeHidden();
}

const providers = [
    {
        name: 'xtream',
        intercept: interceptXtreamRequests,
        add: (page: Page) =>
            addXtreamPortal(page, { name: 'Synthetic Xtream source' }),
        liveSegment: '/live',
    },
    {
        name: 'stalker',
        intercept: interceptStalkerRequests,
        add: (page: Page) =>
            addStalkerPortal(page, {
                name: 'Synthetic Stalker source',
                mac: '00:1A:79:00:22:67',
            }),
        liveSegment: '/itv',
    },
];

for (const provider of providers) {
    test(`@${provider.name} @collections live row menus add and move favorite channels`, async ({
        page,
    }) => {
        test.setTimeout(60_000);
        await page.route('https://**', (route) => route.abort());
        await configureMockProviderBackend(page);
        await provider.intercept(page);
        await page.goto('/');
        await provider.add(page);
        const livePath = new URL(page.url()).pathname.replace(
            /\/vod.*$/,
            provider.liveSegment
        );
        const globalFavorites = page.getByRole('link', {
            name: 'Global favorites',
            exact: true,
        });

        await globalFavorites.press('Enter');
        await page.getByRole('button', { name: 'New folder' }).press('Enter');
        const nameField = page.getByRole('textbox', { name: 'Folder name' });
        await nameField.fill(folderName);
        await nameField.press('Enter');
        await expect(folderButton(page, folderName)).toBeVisible();

        const rows = await openLiveCategory(page, livePath);
        const channelName = await rows
            .first()
            .locator('.channel-name')
            .innerText();
        const row = rows.filter({
            has: page.getByText(channelName, { exact: true }),
        });
        const star = row.getByRole('button', { name: 'Favorite', exact: true });
        await expect(star).toHaveAttribute('aria-pressed', 'false');
        const canceledDialog = await openFolderDialog(page, row, 'Add');
        await page.keyboard.press('Escape');
        await expect(canceledDialog).toBeHidden();
        await expect(star).toHaveAttribute('aria-pressed', 'false');

        await confirmFolder(
            page,
            await openFolderDialog(page, row, 'Add'),
            'Add'
        );
        await expect(star).toHaveAttribute('aria-pressed', 'true');
        await globalFavorites.press('Enter');
        await folderButton(page, folderName).press('Enter');
        await expect(favoriteRows(page)).toHaveText([channelName]);

        await openLiveCategory(page, livePath);
        await star.click();
        await expect(star).toHaveAttribute('aria-pressed', 'false');
        await star.click();
        await expect(star).toHaveAttribute('aria-pressed', 'true');
        await globalFavorites.press('Enter');
        await folderButton(page, 'Without folder').press('Enter');
        await expect(favoriteRows(page)).toHaveText([channelName]);
        await folderButton(page, folderName).press('Enter');
        await expect(page.getByText('This folder is empty')).toBeVisible();
        await expect(favoriteRows(page)).toHaveCount(0);

        await openLiveCategory(page, livePath);
        await confirmFolder(
            page,
            await openFolderDialog(page, row, 'Move'),
            'Move'
        );
        await globalFavorites.press('Enter');
        await expect(page).toHaveURL(/\/workspace\/global-favorites$/);
        await page.reload();
        await folderButton(page, folderName).press('Enter');
        await expect(favoriteRows(page)).toHaveText([channelName]);
    });
}
