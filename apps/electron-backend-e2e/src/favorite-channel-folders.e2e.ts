import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
    routePlayableStreams,
    startAndConfirmPlayback,
} from './playable-stream-fixture';
import {
    closeElectronApp,
    electronMainPath,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openWorkspaceSection,
    restartElectronApp,
    switchUnifiedCollectionScope,
    test,
    waitForM3uCatalog,
    workspaceRoot,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

const folderStorageKey = 'global-favorite-channel-folders-v1';

test('@persistence @m3u @electron keeps legacy SQLite membership and persists global channel folders across restarts', async ({
    dataDir,
}) => {
    test.setTimeout(120_000);
    const urls = [
        'https://streams.example.test/one.webm',
        'https://streams.example.test/two.webm',
    ];
    const path = writeTemporaryM3uFile(dataDir, 'synthetic-favorites.m3u', [
        { groupTitle: 'Synthetic', name: 'Synthetic one', url: urls[0] },
        { groupTitle: 'Synthetic', name: 'Synthetic two', url: urls[1] },
    ]);
    let app = await launchElectronApp(dataDir);
    try {
        await importM3uPlaylistFromNativeDialog(app, path);
        await waitForM3uCatalog(app.mainWindow);
        const playlist = await app.mainWindow.evaluate(
            async ({ folderKey, urls }) => {
                const [meta] = await window.electron.dbGetAppPlaylistMetas();
                const document = await window.electron.dbGetAppPlaylist(
                    meta._id
                );
                const items = document?.playlist.items;
                if (!document || !items?.[1]?.id)
                    throw new Error(
                        'Synthetic playlist has no stable channel ID'
                    );
                const order = JSON.stringify(
                    urls.map((url) => `m3u::${meta._id}::${url}`)
                );
                const favorites = [items[1].id, urls[0]];
                if (
                    !(
                        await window.electron.dbUpsertAppPlaylist({
                            ...document,
                            favorites,
                        })
                    ).success ||
                    !(
                        await window.electron.dbSetAppState(
                            'global-favorites-channel-order-v1',
                            order
                        )
                    ).success
                )
                    throw new Error(
                        'Could not seed synthetic legacy favorites'
                    );
                return {
                    id: meta._id,
                    favorites,
                    order,
                    folders: await window.electron.dbGetAppState(folderKey),
                };
            },
            { folderKey: folderStorageKey, urls }
        );
        expect(playlist.folders).toBeNull();

        app = await restartElectronApp(app, dataDir);
        const openFavorites = async () => {
            await openWorkspaceSection(app.mainWindow, 'Global favorites');
            await switchUnifiedCollectionScope(app.mainWindow, 'All sources');
        };
        const titles = () =>
            app.mainWindow.locator('app-global-favorites-list .channel-name');
        const originalTitles = ['Synthetic one', 'Synthetic two'];
        await openFavorites();
        await expect(titles()).toHaveText(originalTitles);
        await expect(
            app.mainWindow.locator('app-workspace-favorite-folders-panel')
        ).toHaveCount(0);
        const page = app.mainWindow;
        const viewport = { width: 1280, height: 820 };
        await page.setViewportSize(viewport);
        await createFolder(page);
        await expect(titles()).toHaveText(originalTitles);
        const folderRail = () =>
            app.mainWindow.locator('#workspace-favorite-folders');
        const folderWidth = () =>
            folderRail().evaluate((element) =>
                Math.round(element.getBoundingClientRect().width)
            );
        const widthBefore = await folderWidth();
        const handle = await folderRail()
            .locator(':scope > .resize-handle')
            .boundingBox();
        if (!handle) throw new Error('The folders rail has no resize handle');
        const x = handle.x + 2;
        const y = handle.y + handle.height / 2;
        const addedWidth = 56;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + addedWidth, y, { steps: 8 });
        await page.mouse.up();
        await expect.poll(folderWidth).toBe(widthBefore + addedWidth);
        await folderPanel(page)
            .getByRole('button', { name: /^Without folder / })
            .click();
        await routePlayableStreams(page);
        await startAndConfirmPlayback(
            page,
            () =>
                favoriteRow(page, 'Synthetic one')
                    .locator('.channel-content')
                    .press('Enter'),
            0.5
        );
        const video = page.locator('app-unified-live-tab video');
        const beforeMove = await video.evaluate((media: HTMLVideoElement) => {
            media.dataset['beforeFolderMove'] = 'true';
            return media.currentTime;
        });
        await moveToFolder(page, 'Synthetic one');
        await expect(titles()).toHaveText(['Synthetic two']);
        await expect(video).toHaveAttribute('data-before-folder-move', 'true');
        await expect
            .poll(() =>
                video.evaluate((media: HTMLVideoElement) => media.currentTime)
            )
            .toBeGreaterThan(beforeMove);

        app = await restartElectronApp(app, dataDir);
        await app.mainWindow.setViewportSize(viewport);
        await openFavorites();
        await expect(titles()).toHaveText(originalTitles);
        await expect.poll(folderWidth).toBe(widthBefore + addedWidth);
        await app.mainWindow
            .locator('app-workspace-favorite-folders-panel')
            .getByRole('button', { name: /^Synthetic folder / })
            .click();
        await expect(titles()).toHaveText(['Synthetic one']);
        await app.mainWindow
            .locator('[data-test-id="favorite-folder-actions"]')
            .click();
        await app.mainWindow
            .getByRole('menuitem', { name: 'Delete folder' })
            .click();
        await app.mainWindow
            .getByRole('dialog')
            .getByRole('button', { name: 'Delete', exact: true })
            .click();
        await expect(titles()).toHaveText(originalTitles);

        const persisted = await app.mainWindow.evaluate(
            async ({ id, folderKey }) => ({
                favorites: (await window.electron.dbGetAppPlaylist(id))
                    ?.favorites,
                order: await window.electron.dbGetAppState(
                    'global-favorites-channel-order-v1'
                ),
                folders: JSON.parse(
                    (await window.electron.dbGetAppState(folderKey)) ?? 'null'
                ),
            }),
            { id: playlist.id, folderKey: folderStorageKey }
        );
        expect(persisted).toEqual({
            favorites: playlist.favorites,
            order: playlist.order,
            folders: { version: 1, folders: [], assignments: {} },
        });
    } finally {
        await closeElectronApp(app);
    }
});

const folderPanel = (page: Page) =>
    page.locator('app-workspace-favorite-folders-panel');
const favoriteRow = (page: Page, title: string) =>
    page
        .locator('app-global-favorites-list [data-test-id="channel-item"]')
        .filter({ hasText: title });

async function createFolder(page: Page) {
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const input = dialog.getByRole('textbox', { name: 'Folder name' });
    await input.fill('Synthetic folder');
    await input.press('Enter');
    await expect(dialog).toHaveCount(0);
}

async function moveToFolder(page: Page, title: string) {
    const dialog = page.getByRole('dialog');
    await favoriteRow(page, title)
        .getByRole('button', { name: 'More actions' })
        .press('Enter');
    await page.getByRole('menuitem', { name: /Move to folder/ }).press('Enter');
    await dialog.getByRole('combobox', { name: 'Destination folder' }).click();
    await page
        .getByRole('option', { name: 'Synthetic folder', exact: true })
        .click();
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(dialog).toHaveCount(0);
}

test('@persistence @xtream @electron preserves historical native Xtream favorite positions and playlist ownership', async ({
    dataDir,
}) => {
    test.setTimeout(100_000);
    const schema = await readFile(
        join(
            workspaceRoot,
            'libs/shared/database/src/lib/testing/fixtures/v0.24.0-schema.sql'
        ),
        'utf8'
    );
    const databaseFile = join(dataDir, 'databases/iptvnator.db');
    const dependency = join(workspaceRoot, 'node_modules/better-sqlite3');
    const wrapper = join(dataDir, 'synthetic-folders-startup.cjs');
    const seed = `
        INSERT INTO playlists (id, name, type, serverUrl) VALUES
            ('synthetic-a', 'Synthetic source A', 'xtream', 'https://fixture.invalid'),
            ('synthetic-b', 'Synthetic source B', 'xtream', 'https://fixture.invalid');
        INSERT INTO categories (id, playlist_id, name, type, xtream_id) VALUES
            (1, 'synthetic-a', 'Synthetic category', 'live', 1),
            (2, 'synthetic-b', 'Synthetic category', 'live', 1);
        INSERT INTO content (id, category_id, title, xtream_id, type) VALUES
            (100, 1, 'Synthetic native A', 42, 'live'),
            (200, 2, 'Synthetic native B', 42, 'live');
        INSERT INTO favorites (id, content_id, playlist_id, added_at, position) VALUES
            (1000, 100, 'synthetic-a', '2024-01-01', 8),
            (2000, 200, 'synthetic-b', '2024-01-01', 3);`;
    await mkdir(join(dataDir, 'databases'), { recursive: true });
    await writeFile(
        wrapper,
        `const Database = require(${JSON.stringify(dependency)});
const db = new Database(${JSON.stringify(databaseFile)});
db.exec(${JSON.stringify(schema)});
db.exec(${JSON.stringify(seed)});
db.close();
require(${JSON.stringify(electronMainPath)});`
    );
    let app = await launchElectronApp(dataDir, { entryPoint: wrapper });
    try {
        const titles = () =>
            app.mainWindow.locator('app-global-favorites-list .channel-name');
        const favorites = () =>
            app.mainWindow.evaluate(async () =>
                (await window.electron.dbGetGlobalFavorites()).map(
                    ({ favorite_id, playlist_id, xtream_id, position }) => ({
                        favorite_id,
                        playlist_id,
                        xtream_id,
                        position,
                    })
                )
            );
        const originalTitles = ['Synthetic native B', 'Synthetic native A'];
        const originalFavorites = [
            {
                favorite_id: 2000,
                playlist_id: 'synthetic-b',
                xtream_id: 42,
                position: 3,
            },
            {
                favorite_id: 1000,
                playlist_id: 'synthetic-a',
                xtream_id: 42,
                position: 8,
            },
        ];
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        await expect(titles()).toHaveText(originalTitles);
        expect(await favorites()).toEqual(originalFavorites);
        await createFolder(app.mainWindow);
        await moveToFolder(app.mainWindow, 'Synthetic native A');
        app = await restartElectronApp(app, dataDir);
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        await expect(titles()).toHaveText(originalTitles);
        await app.mainWindow
            .locator('app-workspace-favorite-folders-panel')
            .getByRole('button', { name: /^Synthetic folder / })
            .click();
        await expect(titles()).toHaveText(['Synthetic native A']);
        expect(await favorites()).toEqual(originalFavorites);
    } finally {
        await closeElectronApp(app);
    }
});
