import { Page } from '@playwright/test';
import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    LaunchedElectronApp,
    openPlaylistRecent,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    sourceRowByTitle,
    test,
    waitForM3uCatalog,
    waitForXtreamWorkspaceReady,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';
import { fetchXtreamLiveFixture } from './portal-mock-fixtures';

/**
 * Issue #1458, second report: "all channels disappear after clearing the
 * playback history; a reset does not bring them back". The history write
 * never touched the channels — the reporter's screenshot shows a collapsed
 * channel rail, a state that used to be persisted under one key shared by
 * every live surface and that survived restart, "Remove all playlists" and
 * re-import. These scenarios pin both halves: the data path stays intact,
 * and the collapsed rail is discoverable, scoped, and restorable.
 */

const CHANNELS = [
    {
        groupTitle: 'News',
        name: 'Channel Alpha',
        url: 'https://streams.example.test/alpha.m3u8',
    },
    {
        groupTitle: 'News',
        name: 'Channel Beta',
        url: 'https://streams.example.test/beta.m3u8',
    },
    {
        groupTitle: 'Sports',
        name: 'Channel Gamma',
        url: 'https://streams.example.test/gamma.m3u8',
    },
];

const M3U_STATE_KEY = 'live-sidebar-state:m3u';
const PORTAL_STATE_KEY = 'live-sidebar-state:portal';
const LEGACY_STATE_KEY = 'live-sidebar-state';

function playlistIdFromUrl(page: Page): string {
    const match = page.url().match(/\/workspace\/playlists\/([^/?#]+)\//);
    if (!match) {
        throw new Error(`Not on a playlist route: ${page.url()}`);
    }
    return match[1];
}

async function storedItemCount(
    page: Page,
    playlistId: string
): Promise<number> {
    return page.evaluate(async (id) => {
        const bridge = (
            window as unknown as {
                electron: {
                    dbGetAppPlaylist: (
                        playlistId: string
                    ) => Promise<{ playlist?: { items?: unknown[] } } | null>;
                };
            }
        ).electron;
        const playlist = await bridge.dbGetAppPlaylist(id);
        return playlist?.playlist?.items?.length ?? -1;
    }, playlistId);
}

async function reopenPlaylist(page: Page, sourceTitle: string): Promise<void> {
    await openSources(page);
    await sourceRowByTitle(page, sourceTitle).first().click();
    await page.waitForURL(/\/workspace\/playlists\/.+\/all$/);
}

function readStorage(page: Page, key: string): Promise<string | null> {
    return page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
}

function headerToggle(page: Page) {
    return page.locator('app-workspace-shell-header .header-sidebar-toggle');
}

function hiddenStateRestoreButton(page: Page) {
    return page.locator(
        'app-channel-list-hidden-state button.empty-state-action'
    );
}

/**
 * The collapsed rail keeps its children in the DOM (overflow-clipped inside
 * a zero-width container), so Playwright still reports them "visible";
 * assert on the container and its restore affordances instead.
 */
async function expectRailCollapsed(page: Page): Promise<void> {
    const sidebar = page.locator('.sidebar').first();
    await expect(sidebar).toHaveClass(/sidebar-collapsed/);
    // width: 0 !important, but the 1px (transparent) border still counts.
    await expect
        .poll(async () => (await sidebar.boundingBox())?.width ?? -1)
        .toBeLessThanOrEqual(1);
    await expect(page.locator('.sidebar-restore')).toBeVisible();
    await expect(headerToggle(page)).toHaveAttribute('aria-pressed', 'false');
}

async function expectRailExpanded(page: Page): Promise<void> {
    await expect(page.locator('.sidebar').first()).not.toHaveClass(
        /sidebar-collapsed/
    );
    await expect(page.locator('.sidebar-restore')).toHaveCount(0);
    await expect(page.getByTestId('channel-item').first()).toBeVisible();
    await expect(headerToggle(page)).toHaveAttribute('aria-pressed', 'true');
}

test.describe('Live channel rail collapse (#1458)', () => {
    test('clearing the playlist history keeps every channel in SQLite and in the All channels view, also after restart', async ({
        dataDir,
    }) => {
        const sourceTitle = 'rail-history';
        const filePath = writeTemporaryM3uFile(
            dataDir,
            `${sourceTitle}.m3u`,
            CHANNELS
        );
        const app: LaunchedElectronApp = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);
            const playlistId = playlistIdFromUrl(app.mainWindow);
            expect(await storedItemCount(app.mainWindow, playlistId)).toBe(3);

            await channelItemByTitle(app.mainWindow, 'Channel Alpha')
                .first()
                .click();

            await openPlaylistRecent(app.mainWindow);
            await expect(
                channelItemByTitle(app.mainWindow, 'Channel Alpha').first()
            ).toBeVisible({ timeout: 20000 });

            await app.mainWindow
                .getByRole('button', { name: 'Clear recently viewed Live TV' })
                .click();
            await app.mainWindow.getByRole('button', { name: 'Yes' }).click();
            await expect(
                channelItemByTitle(app.mainWindow, 'Channel Alpha')
            ).toHaveCount(0);

            await reopenPlaylist(app.mainWindow, sourceTitle);
            await expect(
                app.mainWindow.getByTestId('channel-item')
            ).toHaveCount(3);
            await expectRailExpanded(app.mainWindow);
            expect(await storedItemCount(app.mainWindow, playlistId)).toBe(3);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await reopenPlaylist(app.mainWindow, sourceTitle);
            await expect(
                app.mainWindow.getByTestId('channel-item')
            ).toHaveCount(3);
            await expectRailExpanded(app.mainWindow);
            expect(await storedItemCount(app.mainWindow, playlistId)).toBe(3);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('a collapsed rail stays discoverable and restorable: hidden-list state, header toggle, restart, and a fresh import', async ({
        dataDir,
    }) => {
        const firstTitle = 'rail-collapse-a';
        const secondTitle = 'rail-collapse-b';
        const firstPath = writeTemporaryM3uFile(
            dataDir,
            `${firstTitle}.m3u`,
            CHANNELS
        );
        const secondPath = writeTemporaryM3uFile(
            dataDir,
            `${secondTitle}.m3u`,
            CHANNELS
        );
        const app: LaunchedElectronApp = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, firstPath);
            await waitForM3uCatalog(app.mainWindow);
            await expectRailExpanded(app.mainWindow);
            expect(await readStorage(app.mainWindow, M3U_STATE_KEY)).not.toBe(
                'collapsed'
            );

            // The chevron in the "All channels" header hides the rail. With
            // nothing playing, the content area must say so instead of
            // asking the user to pick from a list they cannot see.
            await app.mainWindow
                .locator('.all-channels-sidebar-toggle')
                .first()
                .click();
            await expectRailCollapsed(app.mainWindow);
            await expect(
                app.mainWindow.locator('app-channel-list-hidden-state')
            ).toBeVisible();
            await expect(
                hiddenStateRestoreButton(app.mainWindow)
            ).toBeVisible();
            await expect(
                app.mainWindow.locator('app-portal-empty-state', {
                    hasText: 'select a channel',
                })
            ).toHaveCount(0);
            expect(await readStorage(app.mainWindow, M3U_STATE_KEY)).toBe(
                'collapsed'
            );

            // The full-size action restores the rail.
            await hiddenStateRestoreButton(app.mainWindow).click();
            await expectRailExpanded(app.mainWindow);
            expect(await readStorage(app.mainWindow, M3U_STATE_KEY)).toBe(
                'expanded'
            );

            // The header toggle exists in both states and drives the same
            // rail.
            await headerToggle(app.mainWindow).click();
            await expectRailCollapsed(app.mainWindow);
            await headerToggle(app.mainWindow).click();
            await expectRailExpanded(app.mainWindow);

            // A hidden rail is a preference the user made, so it survives a
            // restart and applies to a second playlist — but the way back
            // survives with it.
            await headerToggle(app.mainWindow).click();
            await expectRailCollapsed(app.mainWindow);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await reopenPlaylist(app.mainWindow, firstTitle);
            const playlistId = playlistIdFromUrl(app.mainWindow);
            expect(await storedItemCount(app.mainWindow, playlistId)).toBe(3);
            await expectRailCollapsed(app.mainWindow);
            await expect(
                hiddenStateRestoreButton(app.mainWindow)
            ).toBeVisible();

            await importM3uPlaylistFromNativeDialog(app, secondPath);
            await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+\/all$/);
            await expectRailCollapsed(app.mainWindow);

            // Ctrl/Cmd+B still works and is reflected by the header toggle.
            await app.mainWindow.keyboard.press('Control+b');
            await expectRailExpanded(app.mainWindow);
            expect(await readStorage(app.mainWindow, M3U_STATE_KEY)).toBe(
                'expanded'
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('the collapsed state is scoped per surface and the legacy shared key is forgotten', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const liveFixture = await fetchXtreamLiveFixture(request, {
            username: 'user1',
            password: 'pass1',
        });
        const m3uTitle = 'rail-scope';
        const m3uPath = writeTemporaryM3uFile(
            dataDir,
            `${m3uTitle}.m3u`,
            CHANNELS
        );
        const app: LaunchedElectronApp = await launchElectronApp(dataDir);

        try {
            // A leftover pre-split value must not hide anything after the
            // update, and it must be cleaned up.
            await app.mainWindow.evaluate((key) => {
                localStorage.setItem(key, 'collapsed');
            }, LEGACY_STATE_KEY);

            await importM3uPlaylistFromNativeDialog(app, m3uPath);
            await waitForM3uCatalog(app.mainWindow);
            await expectRailExpanded(app.mainWindow);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await reopenPlaylist(app.mainWindow, m3uTitle);
            await expectRailExpanded(app.mainWindow);
            expect(await readStorage(app.mainWindow, LEGACY_STATE_KEY)).toBe(
                null
            );

            // Hide the M3U rail, then open an Xtream portal's Live TV: its
            // rail (and the header toggle for it) must still be expanded.
            await headerToggle(app.mainWindow).click();
            await expectRailCollapsed(app.mainWindow);

            await addXtreamPortal(app.mainWindow, {
                name: 'Rail Scope Portal',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(
                app.mainWindow,
                liveFixture.categoryName
            );

            await expect(headerToggle(app.mainWindow)).toHaveAttribute(
                'aria-pressed',
                'true'
            );
            await expect(
                app.mainWindow.locator('.sidebar-restore')
            ).toHaveCount(0);
            expect(
                await readStorage(app.mainWindow, PORTAL_STATE_KEY)
            ).not.toBe('collapsed');
            expect(await readStorage(app.mainWindow, M3U_STATE_KEY)).toBe(
                'collapsed'
            );

            // And the other way round: hiding the portal rail leaves the
            // M3U preference untouched. With a category open and nothing
            // playing, the portal host shows the same hidden-list state and
            // its button restores the rail.
            await headerToggle(app.mainWindow).click();
            await expect(headerToggle(app.mainWindow)).toHaveAttribute(
                'aria-pressed',
                'false'
            );
            await expect(hiddenStateRestoreButton(app.mainWindow)).toBeVisible();
            expect(await readStorage(app.mainWindow, PORTAL_STATE_KEY)).toBe(
                'collapsed'
            );

            await hiddenStateRestoreButton(app.mainWindow).click();
            await expect(headerToggle(app.mainWindow)).toHaveAttribute(
                'aria-pressed',
                'true'
            );
            await expect(
                app.mainWindow.locator('app-channel-list-hidden-state')
            ).toHaveCount(0);

            await headerToggle(app.mainWindow).click();
            expect(await readStorage(app.mainWindow, PORTAL_STATE_KEY)).toBe(
                'collapsed'
            );

            await reopenPlaylist(app.mainWindow, m3uTitle);
            await expectRailCollapsed(app.mainWindow);
            await headerToggle(app.mainWindow).click();
            await expectRailExpanded(app.mainWindow);
            expect(await readStorage(app.mainWindow, PORTAL_STATE_KEY)).toBe(
                'collapsed'
            );
        } finally {
            await closeElectronApp(app);
        }
    });
});
