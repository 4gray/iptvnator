import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const firstId = 'synthetic-source-a';
const secondId = 'synthetic-source-b';
const portalId = 'synthetic-source-c';
const stalkerId = 'synthetic-source-d';
const stream = 'https://fixture.invalid/channel.webm';
const orderKey = 'global-favorites-channel-order-v1';
const list = (page: Page) => page.locator('app-global-favorites-list').first();
const titles = (page: Page) => list(page).locator('.channel-name');
const panel = (page: Page) =>
    page.locator('app-workspace-favorite-folders-panel');
const folder = (page: Page, name: string) =>
    panel(page).getByRole('button', { name: new RegExp('^' + name + ' ') });
const channel = (page: Page, name: string) =>
    list(page)
        .locator('[data-test-id="channel-item"]')
        .filter({ has: page.getByText(name, { exact: true }) });
const dialog = (page: Page) => page.getByRole('dialog');
const globalFavorites = (page: Page) =>
    page.getByRole('link', { name: 'Global favorites', exact: true });

test.use({
    serviceWorkers: 'block',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
});

async function seedLegacyProfile(page: Page, includeStalker = false) {
    await page.route('**/__favorite-folders-seed__', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
    );
    await page.route('https://fixture.invalid/channel.webm*', (route) =>
        route.fulfill({
            path: join(__dirname, 'fixtures/playback/episode.webm'),
            headers: { 'Access-Control-Allow-Origin': '*' },
        })
    );
    await page.goto('/__favorite-folders-seed__');
    await page.evaluate(
        ({
            firstId,
            secondId,
            portalId,
            stalkerId,
            stream,
            orderKey,
            includeStalker,
        }) => {
            localStorage.setItem('favorites-channel-sort-mode', 'custom');
            localStorage.setItem(
                orderKey,
                JSON.stringify([
                    `m3u::${secondId}::${stream}`,
                    `m3u::${firstId}::${stream}`,
                    `m3u::${firstId}::${stream}?other`,
                    ...(includeStalker ? [`stalker::${stalkerId}::42`] : []),
                ])
            );
            const xtreamRows = [
                { type: 'live', id: 19, title: 'Synthetic portal channel' },
                { type: 'movie', id: 19, title: 'Synthetic saved film' },
                { type: 'series', id: 19, title: 'Synthetic saved series' },
            ];
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({
                    [portalId]: xtreamRows.map(
                        ({ type, id }) => `${type}:${id}`
                    ),
                })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({
                    [portalId]: Object.fromEntries(
                        xtreamRows.map((row) => [
                            `${row.type}:${row.id}`,
                            {
                                ...row,
                                xtream_id: row.id,
                                catalog_status: 'present',
                                position: 0,
                            },
                        ])
                    ),
                })
            );
            return new Promise<void>((resolve, reject) => {
                const opening = indexedDB.open('iptvnator', 1);
                opening.onerror = () => reject(opening.error);
                opening.onupgradeneeded = () => {
                    const store = opening.result.createObjectStore(
                        'playlists',
                        { keyPath: '_id' }
                    );
                    for (const name of [
                        '_id',
                        'filename',
                        'title',
                        'count',
                        'playlist',
                        'importDate',
                        'lastUsage',
                        'favorites',
                        'recentlyViewed',
                        'autoRefresh',
                        'url',
                        'filePath',
                    ]) {
                        store.createIndex(name, name);
                    }
                    const a = {
                        id: 'synthetic-a',
                        name: 'Synthetic alpha',
                        url: stream,
                        group: { title: 'Synthetic' },
                        tvg: {},
                    };
                    const b = {
                        ...a,
                        id: 'synthetic-b',
                        name: 'Synthetic beta',
                        url: stream + '?other',
                    };
                    const c = {
                        ...a,
                        id: 'synthetic-c',
                        name: 'Synthetic extra',
                        url: stream + '?extra',
                    };
                    for (const [id, title, items, favorites] of [
                        [
                            firstId,
                            'Synthetic source A',
                            [a, b, c],
                            [a.id, b.url],
                        ],
                        [
                            secondId,
                            'Synthetic source B',
                            [{ ...a, name: 'Synthetic duplicate URL' }],
                            [a.url],
                        ],
                    ] as const) {
                        store.add({
                            _id: id,
                            title,
                            count: items.length,
                            favorites,
                            playlist: {
                                header: { attrs: {}, raw: '#EXTM3U' },
                                items,
                            },
                            autoRefresh: false,
                            recentlyViewed: [],
                        });
                    }
                    store.add({
                        _id: portalId,
                        title: 'Synthetic portal',
                        serverUrl: 'https://fixture.invalid',
                        username: 'synthetic',
                        password: 'synthetic',
                    });
                    if (includeStalker) {
                        store.add({
                            _id: stalkerId,
                            title: 'Synthetic Stalker source',
                            portalUrl: 'https://portal.fixture.invalid/portal.php',
                            macAddress: '02:00:00:00:00:42',
                            favorites: [
                                {
                                    id: '42',
                                    favoriteContentType: 'radio',
                                    title: 'Synthetic radio',
                                },
                                {
                                    id: '42',
                                    favoriteContentType: 'itv',
                                    title: 'Synthetic station',
                                    cmd: stream,
                                    use_http_tmp_link: '0',
                                    use_load_balancing: '0',
                                },
                            ],
                        });
                    }
                };
                opening.onsuccess = () => {
                    opening.result.close();
                    resolve();
                };
            });
        },
        {
            firstId,
            secondId,
            portalId,
            stalkerId,
            stream,
            orderKey,
            includeStalker,
        }
    );
    await page.goto('/workspace/global-favorites');
}

async function submitNewFolder(page: Page, name: string, button: Locator) {
    await button.click();
    const field = dialog(page).getByRole('textbox', { name: 'Folder name' });
    await expect(field).toBeFocused();
    await field.fill(name);
    await field.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
}

async function createFolder(page: Page, name: string, button: Locator) {
    await submitNewFolder(page, name, button);
    await expect(folder(page, name)).toBeVisible();
}

async function chooseDestination(page: Page, name: string) {
    await dialog(page)
        .getByRole('combobox', { name: 'Destination folder' })
        .click();
    await page.getByRole('option', { name, exact: true }).click();
    // Material closes the select before its overlay finishes detaching.
    await expect(
        page.getByRole('listbox', { includeHidden: true })
    ).toHaveCount(0);
}

async function drag(
    page: Page,
    source: Locator,
    target: Locator,
    folderDrop?: 'commit' | 'cancel'
) {
    await source.click({ trial: true });
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error('Synthetic drag target is unavailable');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
        steps: 14,
    });
    if (folderDrop) await expect(target).toHaveClass(/folder-row--drag-over/);
    if (folderDrop === 'cancel') {
        await page.keyboard.press('Escape');
        await expect(target).not.toHaveClass(/folder-row--drag-over/);
    }
    await page.mouse.up();
}

function railWidth(rail: Locator): Promise<number> {
    return rail.evaluate((element) =>
        Math.round(element.getBoundingClientRect().width)
    );
}

async function resizeRail(page: Page, rail: Locator, delta: number) {
    const handle = await rail.locator(':scope > .resize-handle').boundingBox();
    if (!handle) throw new Error('The rail has no resize handle');
    const x = handle.x + 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 8 });
    const widthDuringDrag = await railWidth(rail);
    await page.mouse.up();
    return widthDuringDrag;
}

test('@m3u @collections resizes the folders and channels rails independently', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await seedLegacyProfile(page);
    const name = 'Synthetic weekend channel list';
    await createFolder(
        page,
        name,
        page.getByRole('button', { name: 'New folder' })
    );

    const foldersRail = page.locator('#workspace-favorite-folders');
    const channelRail = page.locator('app-unified-live-tab .sidebar');
    const handle = foldersRail.locator(':scope > .resize-handle');
    const label = folder(page, name).locator('.folder-name');
    const labelFits = () =>
        label.evaluate((element) => element.scrollWidth <= element.clientWidth);
    await expect.poll(labelFits).toBe(false);
    await expect(label).toHaveAttribute('title', name);
    const initialFolders = await railWidth(foldersRail);
    const initialChannels = await railWidth(channelRail);

    expect(await resizeRail(page, foldersRail, -12)).toBe(initialFolders - 12);
    await expect.poll(() => railWidth(foldersRail)).toBe(initialFolders - 12);
    await resizeRail(page, foldersRail, 88);
    const preferred = initialFolders + 76;
    await expect.poll(() => railWidth(foldersRail)).toBe(preferred);
    await expect.poll(labelFits).toBe(true);
    await expect.poll(() => railWidth(channelRail)).toBe(initialChannels);

    await resizeRail(page, channelRail, 24);
    await expect.poll(() => railWidth(channelRail)).toBe(initialChannels + 24);
    await expect.poll(() => railWidth(foldersRail)).toBe(preferred);

    await page.setViewportSize({ width: 900, height: 700 });
    await expect.poll(() => railWidth(foldersRail)).toBeLessThan(preferred);
    await expect
        .poll(() => railWidth(foldersRail))
        .toBeGreaterThan(initialFolders);
    await page.setViewportSize({ width: 390, height: 820 });
    await page.locator('[data-favorite-folder-drawer-toggle]').press('Enter');
    await expect(label).toBeVisible();
    await expect(handle).toBeHidden();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1280, height: 820 });
    await page.reload();
    await expect.poll(() => railWidth(foldersRail)).toBe(preferred);
    await expect.poll(() => railWidth(channelRail)).toBe(initialChannels + 24);
    await expect.poll(labelFits).toBe(true);
});

test('@m3u @collections starts with a flat list in a new profile', async ({
    page,
}) => {
    await page.goto('/workspace/global-favorites');
    const firstFolder = page.locator('[data-test-id="favorite-first-folder"]');
    await expect(
        page.getByRole('heading', { name: 'No favorites to show' })
    ).toBeVisible();
    await expect(titles(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);

    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    await dialog(page)
        .getByRole('radio', { name: /Raw m3u text/i })
        .click();
    await dialog(page)
        .getByLabel('Insert m3u(8) playlist as text')
        .fill(
            '#EXTM3U\n#EXTINF:-1,Synthetic first channel\nhttps://fixture.invalid/first.webm'
        );
    await dialog(page)
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    await page.waitForURL(/\/workspace\/playlists\/.+\/all$/);

    const heart = page
        .locator('[data-test-id="channel-item"]')
        .filter({ hasText: 'Synthetic first channel' })
        .getByRole('button', { name: 'Favorite', exact: true });
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await globalFavorites(page).click();
    await expect(titles(page)).toHaveText(['Synthetic first channel']);
    await expect(firstFolder).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
});

test('@m3u @xtream @collections upgrades the old flat list and organizes it without changing source membership', async ({
    page,
}) => {
    test.setTimeout(60_000);
    const legacy = [
        'Synthetic duplicate URL',
        'Synthetic alpha',
        'Synthetic beta',
        'Synthetic portal channel',
    ];
    await seedLegacyProfile(page);
    await expect(titles(page)).toHaveText(legacy);
    await expect(panel(page)).toHaveCount(0);
    const first = page.locator('[data-test-id="favorite-first-folder"]');
    await expect(first).toBeVisible();
    await page.reload();
    await expect(titles(page)).toHaveText(legacy);

    await page.setViewportSize({ width: 390, height: 820 });
    await submitNewFolder(page, 'Synthetic folder', first);
    const drawer = page.locator('[data-favorite-folder-drawer-toggle]');
    await expect(drawer).toBeFocused();
    await drawer.press('Enter');
    await expect(folder(page, 'Synthetic folder')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 820 });
    await expect(titles(page)).toHaveText(legacy);
    await folder(page, 'Synthetic folder').click();
    await expect(titles(page)).toHaveCount(0);
    await folder(page, 'Without folder').click();
    await expect(titles(page)).toHaveText(legacy);

    await drag(
        page,
        channel(page, 'Synthetic alpha').locator('.drag-icon'),
        channel(page, 'Synthetic beta')
    );
    const reordered = [
        'Synthetic duplicate URL',
        'Synthetic beta',
        'Synthetic alpha',
        'Synthetic portal channel',
    ];
    await expect(titles(page)).toHaveText(reordered);

    await channel(page, 'Synthetic alpha')
        .locator('.channel-content')
        .press('Enter');
    await expect(channel(page, 'Synthetic alpha')).toHaveClass(/active/);
    const player = page.locator('app-unified-live-tab app-web-player-view');
    const video = player.locator('video');
    const railHeader = page.locator('app-unified-live-tab .collection-header');
    const foldersHeader = panel(page).locator('.folder-header');
    const activeRow = channel(page, 'Synthetic alpha');
    await expect(player).toBeVisible();
    const [railBox, railTitle, foldersTitle, playerBox, heartBox, menuBox] =
        await Promise.all([
            railHeader.boundingBox(),
            railHeader.getByRole('heading').boundingBox(),
            foldersHeader.getByRole('heading').boundingBox(),
            player.boundingBox(),
            activeRow.getByRole('button', { name: 'Favorite' }).boundingBox(),
            activeRow
                .getByRole('button', { name: 'More actions' })
                .boundingBox(),
        ]);
    if (
        !railBox ||
        !railTitle ||
        !foldersTitle ||
        !playerBox ||
        !heartBox ||
        !menuBox
    ) {
        throw new Error(
            'Favorites layout is missing a header, player or action'
        );
    }
    expect(railTitle.y + railTitle.height / 2).toBeCloseTo(
        foldersTitle.y + foldersTitle.height / 2,
        0
    );
    expect(playerBox.y).toBeCloseTo(railBox.y, 0);
    expect(heartBox.x).toBeCloseTo(menuBox.x, 0);
    expect(heartBox.y + heartBox.height).toBeLessThanOrEqual(menuBox.y);
    const sidebarToggle = page.locator('.collection-sidebar-toggle');
    const hideFolders = panel(page).getByRole('button', {
        name: 'Hide channel folders',
    });
    const showFolders = page.locator('[data-test-id="favorite-show-folders"]');
    await sidebarToggle.press('Enter');
    await expect(sidebarToggle).toHaveAccessibleName('Show channels list');
    await expect(sidebarToggle).toBeFocused();
    await expect(hideFolders).toBeVisible();
    await hideFolders.press('Enter');
    await expect(showFolders).toBeFocused();
    await expect(panel(page).locator('..')).toHaveAttribute('inert', '');
    await expect(sidebarToggle).toHaveAccessibleName('Show channels list');
    await showFolders.press('Enter');
    await expect(hideFolders).toBeFocused();
    await expect(sidebarToggle).toHaveAccessibleName('Show channels list');
    await sidebarToggle.press('Enter');
    await expect(
        railHeader.locator('.collection-sidebar-toggle')
    ).toBeFocused();
    await expect
        .poll(() =>
            video.evaluate((media: HTMLVideoElement) => media.currentTime)
        )
        .toBeGreaterThan(0);
    const beforeDrag = await video.evaluate((media: HTMLVideoElement) => {
        media.dataset['beforeFolderMove'] = 'true';
        return media.currentTime;
    });
    await hideFolders.press('Enter');
    await expect(showFolders).toBeFocused();
    await expect(titles(page)).toHaveText(reordered);
    await expect(video).toHaveAttribute('data-before-folder-move', 'true');
    await showFolders.press('Enter');
    await expect(hideFolders).toBeFocused();
    await expect(folder(page, 'Without folder')).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const handle = channel(page, 'Synthetic alpha').locator('.drag-icon');
    const destination = folder(page, 'Synthetic folder');
    await drag(page, handle, destination, 'cancel');
    await expect(titles(page)).toHaveText(reordered);
    await drag(page, handle, destination, 'commit');
    await expect(titles(page)).toHaveText(
        reordered.filter((name) => name !== 'Synthetic alpha')
    );
    await expect(video).toHaveAttribute('data-before-folder-move', 'true');
    await expect
        .poll(() =>
            video.evaluate((media: HTMLVideoElement) => media.currentTime)
        )
        .toBeGreaterThan(beforeDrag);
    await expect(folder(page, 'Without folder')).toHaveAttribute(
        'aria-pressed',
        'true'
    );

    const folderActions = page.locator(
        '[data-test-id="favorite-folder-actions"]'
    );
    await expect(
        list(page).getByRole('button', { name: 'Select', exact: true })
    ).toHaveCount(0);
    await folderActions.press('Enter');
    await page
        .getByRole('menuitem', { name: 'Select', exact: true })
        .press('Enter');
    const selectAll = list(page).getByRole('checkbox', {
        name: 'Select all shown',
    });
    await expect(selectAll).toBeFocused();
    await list(page)
        .getByRole('checkbox', { name: 'Synthetic beta' })
        .press('Space');
    await list(page)
        .getByRole('checkbox', { name: 'Synthetic portal channel' })
        .press('Space');
    const bulkMove = list(page).getByRole('button', {
        name: /^Move to folder/,
    });
    await bulkMove.click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(
        list(page).getByRole('checkbox', { name: 'Synthetic beta' })
    ).toBeChecked();
    await bulkMove.click();
    await chooseDestination(page, 'Synthetic folder');
    await dialog(page)
        .getByRole('button', { name: 'Move', exact: true })
        .click();
    await expect(titles(page)).toHaveText(['Synthetic duplicate URL']);
    await expect(folderActions).toBeFocused();

    await folder(page, 'Synthetic folder').click();
    await expect(titles(page)).toHaveText([
        'Synthetic beta',
        'Synthetic alpha',
        'Synthetic portal channel',
    ]);
    const sort = page.getByRole('button', { name: /^Sort:/ });
    await sort.click();
    await page.getByRole('menuitemradio', { name: 'Name A-Z' }).click();
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    await expect(sort).toHaveAccessibleName('Sort: Name A-Z');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await drag(page, handle, channel(page, 'Synthetic beta'));
    await expect(titles(page)).toHaveText([
        'Synthetic alpha',
        'Synthetic beta',
        'Synthetic portal channel',
    ]);
    await drag(page, handle, folder(page, 'Without folder'), 'commit');
    await expect(titles(page)).toHaveText([
        'Synthetic beta',
        'Synthetic portal channel',
    ]);
    await folder(page, 'Without folder').click();
    await drag(page, handle, destination, 'commit');
    await sort.click();
    await page.getByRole('menuitemradio', { name: 'Custom order' }).click();
    await folder(page, 'Synthetic folder').click();
    await page.getByRole('radio', { name: 'Movies', exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(
        page.getByText('Synthetic saved film', { exact: true })
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Series', exact: true }).click();
    await expect(
        page.getByText('Synthetic saved series', { exact: true })
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Live TV', exact: true }).click();
    await expect(folder(page, 'Synthetic folder')).toHaveAttribute(
        'aria-pressed',
        'true'
    );

    await page.setViewportSize({ width: 390, height: 820 });
    await drawer.click();
    await expect(folder(page, 'All channels')).toBeVisible();
    await folder(page, 'All channels').press('Enter');
    await expect(drawer).toBeFocused();
    await expect(titles(page)).toHaveText(reordered);
    await drawer.click();
    await expect(drawer).toHaveAttribute('aria-expanded', 'true');
    const openDrawer = page.locator(
        'app-workspace-shell-context-sidebar[role="dialog"]'
    );
    await expect(openDrawer.locator(':scope:focus-within')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 820 });

    await hideFolders.press('Enter');
    await page.setViewportSize({ width: 390, height: 820 });
    await expect(showFolders).toBeHidden();
    await drawer.press('Enter');
    await expect(folder(page, 'Synthetic folder')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.reload();
    await expect(titles(page)).toHaveText(reordered);
    await expect(showFolders).toBeVisible();
    await showFolders.press('Enter');
    await expect(hideFolders).toBeFocused();
    await createFolder(
        page,
        'Synthetic empty',
        panel(page).locator('[data-favorite-folder-create]')
    );
    await folder(page, 'Synthetic folder').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename folder' }).press('Enter');
    await dialog(page)
        .getByRole('textbox', { name: 'Folder name' })
        .fill('Renamed synthetic folder');
    await dialog(page)
        .getByRole('textbox', { name: 'Folder name' })
        .press('Enter');
    const renamed = folder(page, 'Renamed synthetic folder');
    await expect(renamed).toBeFocused();
    await expect(folder(page, 'All channels')).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await expect(titles(page)).toHaveText(reordered);

    const unfiled = folder(page, 'Without folder');
    await unfiled.click();
    await expect(titles(page)).toHaveText(['Synthetic duplicate URL']);
    await renamed.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Delete folder' }).press('Enter');
    await expect(dialog(page)).toContainText(
        'Its channels will stay in Favorites without a folder.'
    );
    await dialog(page).getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(renamed).toBeFocused();
    await expect(titles(page)).toHaveText(['Synthetic duplicate URL']);

    const allChannels = folder(page, 'All channels');
    await allChannels.click();
    await renamed.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete folder' }).click();
    await dialog(page)
        .getByRole('button', { name: 'Delete', exact: true })
        .click();
    await expect(renamed).toHaveCount(0);
    await expect(allChannels).toHaveAttribute('aria-pressed', 'true');
    await expect(titles(page)).toHaveText(reordered);
    await unfiled.click();
    await expect(unfiled).toHaveAttribute('aria-pressed', 'true');
    await expect(titles(page)).toHaveText(reordered);

    await folder(page, 'Synthetic empty').click();
    await hideFolders.press('Enter');
    await page.locator('[data-test-id="favorite-folder-actions"]').click();
    await page.getByRole('menuitem', { name: 'Delete folder' }).click();
    await dialog(page)
        .getByRole('button', { name: 'Delete', exact: true })
        .click();
    await expect(panel(page)).toHaveCount(0);
    await expect(first).toBeVisible();
    await expect(titles(page)).toHaveText(reordered);
    await page.reload();
    await expect(titles(page)).toHaveText(reordered);
    await createFolder(page, 'Synthetic replacement', first);
    await expect(hideFolders).toBeVisible();
});

test('@m3u @collections adds and moves from a playlist and filters by search and source without mixing duplicate channels', async ({
    page,
}) => {
    await seedLegacyProfile(page);
    await createFolder(
        page,
        'Synthetic folder',
        page.locator('[data-test-id="favorite-first-folder"]')
    );
    await page.goto(`/workspace/playlists/${firstId}/all`);

    const extra = page
        .locator('app-all-channels-view [data-test-id="channel-item"]')
        .filter({ hasText: 'Synthetic extra' });
    const actions = extra.getByRole('button', { name: 'More actions' });
    const star = extra.locator('button.favorite-button');
    await expect(star).toBeVisible();
    await actions.press('Enter');
    const addAction = page.getByRole('menuitem', {
        name: 'Add to a favorites folder…',
    });
    await addAction.press('Enter');
    await expect(dialog(page)).toHaveAccessibleName(
        'Add to a favorites folder'
    );
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(star).toHaveAttribute('aria-pressed', 'false');

    await actions.press('Enter');
    await addAction.press('Enter');
    await chooseDestination(page, 'New folder');
    await expect(
        dialog(page).getByRole('textbox', { name: 'Folder name' })
    ).toBeFocused();
    const fieldGap = await dialog(page)
        .locator('mat-form-field')
        .evaluateAll(
            ([destination, name]) =>
                name.getBoundingClientRect().top -
                destination.getBoundingClientRect().bottom
        );
    expect(fieldGap).toBeGreaterThanOrEqual(10);
    await chooseDestination(page, 'Synthetic folder');
    await dialog(page)
        .getByRole('button', { name: 'Add', exact: true })
        .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(star).toHaveAttribute('aria-pressed', 'true');

    await globalFavorites(page).click();
    await folder(page, 'Synthetic folder').click();
    await expect(titles(page)).toHaveText(['Synthetic extra']);
    await page.getByRole('radio', { name: 'All playlists' }).click();
    await expect(folder(page, 'All channels')).toContainText('5');
    const search = page.getByRole('searchbox');
    await search.fill('Synthetic alpha');
    await expect(folder(page, 'Synthetic folder')).toContainText('0');
    await expect(folder(page, 'All channels')).toContainText('1');
    await expect(titles(page)).toHaveCount(0);
    await search.fill('');
    await expect(titles(page)).toHaveText(['Synthetic extra']);
    await page.getByRole('radio', { name: 'This playlist' }).click();
    await expect(folder(page, 'All channels')).toContainText('3');

    await page.getByRole('link', { name: 'All channels', exact: true }).click();
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await globalFavorites(page).click();
    await folder(page, 'Without folder').click();
    await expect(channel(page, 'Synthetic extra')).toBeVisible();
    await folder(page, 'Synthetic folder').click();
    await expect(titles(page)).toHaveCount(0);
});

test('@stalker @collections keeps typed historical live and radio favorites with the same ID independent', async ({
    page,
}) => {
    await seedLegacyProfile(page, true);
    const historicalPair = ['Synthetic radio', 'Synthetic station'];
    const pair = titles(page).filter({ hasText: /Synthetic (radio|station)/ });
    await expect(pair).toHaveText(historicalPair);
    await createFolder(
        page,
        'Synthetic folder',
        page.locator('[data-test-id="favorite-first-folder"]')
    );
    await channel(page, 'Synthetic station')
        .getByRole('button', { name: 'More actions' })
        .press('Enter');
    await page
        .getByRole('menuitem', { name: /^Move to folder/ })
        .press('Enter');
    await chooseDestination(page, 'Synthetic folder');
    await dialog(page)
        .getByRole('button', { name: 'Move', exact: true })
        .click();
    await folder(page, 'Synthetic folder').click();
    await expect(titles(page)).toHaveText(['Synthetic station']);
    await page.reload();
    await expect(pair).toHaveText(historicalPair);
    await folder(page, 'Without folder').click();
    await expect(pair).toHaveText(['Synthetic radio']);

    await folder(page, 'All channels').click();
    const station = channel(page, 'Synthetic station');
    await station.locator('.channel-content').press('Enter');
    const video = page.locator('app-unified-live-tab app-web-player-view video');
    const playbackTime = () =>
        video.evaluate((media: HTMLVideoElement) => media.currentTime);
    await expect.poll(playbackTime).toBeGreaterThan(0);
    const beforeRemoval = await video.evaluate((media: HTMLVideoElement) => {
        media.dataset['beforeSiblingRemoval'] = 'true';
        return media.currentTime;
    });

    // Simulate a saved change made outside the open collection.
    await page.evaluate(async (id) => {
        await new Promise<void>((resolve, reject) => {
            const opening = indexedDB.open('iptvnator');
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
                const db = opening.result;
                const transaction = db.transaction('playlists', 'readwrite');
                const playlists = transaction.objectStore('playlists');
                const request = playlists.get(id);
                request.onsuccess = () => {
                    const saved = request.result;
                    saved.favorites = saved.favorites.filter(
                        (item: { favoriteContentType: string }) =>
                            item.favoriteContentType !== 'radio'
                    );
                    playlists.put(saved);
                };
                transaction.oncomplete = () => {
                    db.close();
                    resolve();
                };
                transaction.onerror = () => {
                    db.close();
                    reject(transaction.error);
                };
            };
        });
        window.dispatchEvent(new Event('iptvnator-favorites-changed'));
    }, stalkerId);
    await expect(pair).toHaveText(['Synthetic station']);
    await expect(station).toHaveClass(/active/);
    await expect(video).toHaveAttribute('data-before-sibling-removal', 'true');
    await expect.poll(playbackTime).toBeGreaterThan(beforeRemoval);
});
