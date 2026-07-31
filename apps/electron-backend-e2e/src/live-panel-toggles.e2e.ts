import type { Locator, Page } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    fillWorkspaceSearch,
    importM3uPlaylistFromNativeDialog,
    type LaunchedElectronApp,
    launchElectronApp,
    openSources,
    openSettings,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    saveSettings,
    sourceRowByTitle,
    test,
    waitForM3uCatalog,
    waitForStalkerCatalog,
    waitForXtreamWorkspaceReady,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';
import {
    fetchStalkerCategoryFixture,
    fetchXtreamLiveFixture,
    getStalkerTitle,
    getXtreamTitle,
} from './portal-mock-fixtures';

const groupsStorageKey = 'live-groups-panel-state';
const channelsStorageKey = 'live-channels-panel-state';
const legacyStorageKey = 'live-sidebar-state';
const m3uPanelPlaylistTitle = 'live-panel-toggles';

test('@live-panels @m3u @electron keeps Groups and Channels independent, persistent, and accessible', async ({
    dataDir,
}) => {
    const playlistPath = writeTemporaryM3uFile(
        dataDir,
        'live-panel-toggles.m3u',
        [
            {
                groupTitle: 'News',
                name: 'Panel News',
                url: 'https://example.com/panel-news.m3u8',
            },
            {
                groupTitle: 'Sports',
                name: 'Panel Sports',
                url: 'https://example.com/panel-sports.m3u8',
            },
        ]
    );
    let app = await launchElectronApp(dataDir);
    let page = app.mainWindow;

    try {
        await importM3uPlaylistFromNativeDialog(app, playlistPath);
        await waitForM3uCatalog(page);
        await openWorkspaceSection(page, 'Groups');
        await expectGroupLayoutReady(page);

        await hidePanel(page, 'groups');
        await expectPanelState(page, 'groups', false);
        await expectPanelState(page, 'channels', true);
        await expect(panelControl(page, 'groups', 'restore')).toBeFocused();
        await showPanel(page, 'groups');

        await hidePanel(page, 'channels');
        await expectPanelState(page, 'channels', false);
        await expectPanelState(page, 'groups', true);
        await expect(panelControl(page, 'channels', 'restore')).toBeFocused();
        await showPanel(page, 'channels');

        await hidePanel(page, 'groups');
        await hidePanel(page, 'channels');
        await expectRestoreRailOrder(page);
        await showPanel(page, 'groups');
        await showPanel(page, 'channels');

        await page.keyboard.press(masterShortcut());
        await expectPanelState(page, 'groups', false);
        await expectPanelState(page, 'channels', false);
        await expectStoredPanelStates(page, 'expanded', 'expanded');
        await page.keyboard.press(masterShortcut());
        await expectPanelState(page, 'groups', true);
        await expectPanelState(page, 'channels', true);

        await hidePanel(page, 'groups');
        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await reopenM3uGroupLayout(page);
        await expectPanelState(page, 'groups', false);
        await expectPanelState(page, 'channels', true);

        await page.evaluate(
            ({ channelsKey, groupsKey, legacyKey }) => {
                localStorage.removeItem(groupsKey);
                localStorage.removeItem(channelsKey);
                localStorage.setItem(legacyKey, 'collapsed');
            },
            {
                channelsKey: channelsStorageKey,
                groupsKey: groupsStorageKey,
                legacyKey: legacyStorageKey,
            }
        );
        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await reopenM3uGroupLayout(page);
        await expectPanelState(page, 'groups', false);
        await expectPanelState(page, 'channels', false);
        await expectStoredPanelStates(page, 'collapsed', 'collapsed');
        await expect
            .poll(() =>
                page.evaluate(
                    (key) => localStorage.getItem(key),
                    legacyStorageKey
                )
            )
            .toBe('collapsed');

        await page.setViewportSize({ width: 580, height: 900 });
        await expect(panelControl(page, 'groups', 'restore')).toHaveCount(0);
        await expect(panelControl(page, 'channels', 'restore')).toBeVisible();
        await showPanel(page, 'channels');
        await expectPanelState(page, 'channels', true);
    } finally {
        await closeElectronApp(app);
    }
});

test('@live-panels @xtream @electron keeps portal Groups and Channels independently operable', async ({
    dataDir,
    request,
}) => {
    const credentials = { password: 'minimal', username: 'minimal' };
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamLiveFixture(request, credentials);
    const channelTitle = requireTitle(
        getXtreamTitle(fixture.items[0] ?? {}),
        'Expected the Xtream fixture to include a live channel.'
    );
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;

    try {
        await addXtreamPortal(page, {
            name: 'Xtream Live Panel Fixture',
            ...credentials,
        });
        await waitForXtreamWorkspaceReady(page);
        await openWorkspaceSection(page, 'Live TV');

        await expect(panelControl(page, 'groups', 'hide')).toBeVisible();
        await expect(panelControl(page, 'channels', 'hide')).toHaveCount(0);
        await clickCategoryByNameExact(page, fixture.categoryName);
        await expect(
            channelItemByTitle(page, channelTitle).first()
        ).toBeVisible({
            timeout: 20000,
        });

        await hidePanel(page, 'channels');
        await expectPanelState(page, 'channels', false);
        await expectPanelState(page, 'groups', true);
        await expect(panelControl(page, 'channels', 'restore')).toBeFocused();
        await showPanel(page, 'channels');

        await hidePanel(page, 'groups');
        await expectPanelState(page, 'groups', false);
        await expectPanelState(page, 'channels', true);
        await showPanel(page, 'groups');

        await fillWorkspaceSearch(page, 'no-live-panel-match');
        await expect(page.getByText('No channels found').first()).toBeVisible();
        await hidePanel(page, 'channels');
        await expect(panelControl(page, 'channels', 'restore')).toBeVisible();
        await showPanel(page, 'channels');
        await fillWorkspaceSearch(page, '');

        await channelItemByTitle(page, channelTitle).first().click();
        await expect(
            page.locator('[data-testid="live-guide-toggle"]')
        ).toBeVisible({
            timeout: 20000,
        });

        await openSettings(page);
        await page.getByTestId('select-video-player').click();
        await page.getByTestId('mpv').click();
        await saveSettings(page);
        await installExternalPlayerStub(app);
        await page.goBack();
        await page.waitForURL(/\/workspace\/xtreams\/.+\/live/);
        await channelItemByTitle(page, channelTitle).first().click();
        await expect(page.locator('app-epg-timeline')).toBeVisible({
            timeout: 20000,
        });
        await expect(
            page.locator('[data-testid="live-guide-toggle"]')
        ).toHaveCount(0);
    } finally {
        await closeElectronApp(app);
    }
});

test('@live-panels @stalker @electron preserves panel controls and omits Guide for radio playback', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['stalker']);
    const liveFixture = await fetchStalkerCategoryFixture(request, 'itv');
    const radioFixture = await fetchStalkerCategoryFixture(request, 'radio');
    const liveTitle = requireTitle(
        getStalkerTitle(liveFixture.items[0] ?? {}),
        'Expected the Stalker live fixture to include an item.'
    );
    const radioTitle = requireTitle(
        getStalkerTitle(radioFixture.items[0] ?? {}),
        'Expected the Stalker radio fixture to include an item.'
    );
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;

    try {
        await addStalkerPortal(page, {
            name: 'Stalker Live Panel Fixture',
        });
        await waitForStalkerCatalog(page);
        await openWorkspaceSection(page, 'Live TV');
        await clickCategoryByNameExact(page, liveFixture.categoryName);
        await expect(channelItemByTitle(page, liveTitle).first()).toBeVisible({
            timeout: 20000,
        });

        await hidePanel(page, 'channels');
        await expectPanelState(page, 'channels', false);
        await expectPanelState(page, 'groups', true);
        await showPanel(page, 'channels');
        await hidePanel(page, 'groups');
        await expectPanelState(page, 'groups', false);
        await expectPanelState(page, 'channels', true);
        await showPanel(page, 'groups');

        await openWorkspaceSection(page, 'Radio');
        const radioCategory = page.getByRole('button', {
            name: radioFixture.categoryName,
            exact: true,
        });
        await expect(radioCategory).toBeVisible();
        await radioCategory.click();
        await channelItemByTitle(page, radioTitle).first().click();
        await expect(page.locator('app-audio-player')).toBeVisible({
            timeout: 20000,
        });
        await expect(
            page.locator('[data-testid="live-guide-toggle"]')
        ).toHaveCount(0);
    } finally {
        await closeElectronApp(app);
    }
});

function panelControl(
    page: Page,
    panel: 'channels' | 'groups',
    action: 'hide' | 'restore'
): Locator {
    return page.locator(
        `[data-testid="live-${panel}-panel-${action}"]:visible`
    );
}

function panelElement(page: Page, panel: 'channels' | 'groups'): Locator {
    return page.locator(`#live-${panel}-panel`).first();
}

async function hidePanel(
    page: Page,
    panel: 'channels' | 'groups'
): Promise<void> {
    const control = panelControl(page, panel, 'hide');
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('aria-expanded', 'true');
    await control.click();
}

async function showPanel(
    page: Page,
    panel: 'channels' | 'groups'
): Promise<void> {
    const control = panelControl(page, panel, 'restore');
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await control.click();
}

async function expectPanelState(
    page: Page,
    panel: 'channels' | 'groups',
    expanded: boolean
): Promise<void> {
    const element = panelElement(page, panel);
    await expect(element).toHaveAttribute('aria-hidden', String(!expanded));

    if (expanded) {
        await expect(element).not.toHaveAttribute('inert', '');
        await expect(panelControl(page, panel, 'hide')).toBeVisible();
        await expect(panelControl(page, panel, 'restore')).toHaveCount(0);
        return;
    }

    await expect(element).toHaveAttribute('inert', '');
    await expect(panelControl(page, panel, 'restore')).toBeVisible();
}

async function expectGroupLayoutReady(page: Page): Promise<void> {
    await expect
        .poll(() => new URL(page.url()).pathname)
        .toMatch(/\/workspace\/playlists\/[^/]+\/groups$/);
    await expect(panelElement(page, 'groups')).toHaveCount(1);
    await expect(panelElement(page, 'channels')).toHaveCount(1);
}

async function reopenM3uGroupLayout(page: Page): Promise<void> {
    await openSources(page);
    await sourceRowByTitle(page, m3uPanelPlaylistTitle).first().click();
    await waitForM3uCatalog(page);
    await openWorkspaceSection(page, 'Groups');
    await expectGroupLayoutReady(page);
}

async function expectRestoreRailOrder(page: Page): Promise<void> {
    const groupsBox = await panelControl(
        page,
        'groups',
        'restore'
    ).boundingBox();
    const channelsBox = await panelControl(
        page,
        'channels',
        'restore'
    ).boundingBox();

    expect(groupsBox).not.toBeNull();
    expect(channelsBox).not.toBeNull();
    expect(groupsBox?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(groupsBox?.height ?? 0).toBeGreaterThanOrEqual(40);
    expect(channelsBox?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(channelsBox?.height ?? 0).toBeGreaterThanOrEqual(40);
    expect(groupsBox?.x ?? 0).toBeLessThan(channelsBox?.x ?? 0);
}

async function expectStoredPanelStates(
    page: Page,
    groups: 'collapsed' | 'expanded',
    channels: 'collapsed' | 'expanded'
): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate(
                ({ channelsKey, groupsKey }) => ({
                    channels: localStorage.getItem(channelsKey),
                    groups: localStorage.getItem(groupsKey),
                }),
                {
                    channelsKey: channelsStorageKey,
                    groupsKey: groupsStorageKey,
                }
            )
        )
        .toEqual({ channels, groups });
}

function masterShortcut(): string {
    return process.platform === 'darwin' ? 'Meta+B' : 'Control+B';
}

function requireTitle(title: string, message: string): string {
    if (!title) {
        throw new Error(message);
    }

    return title;
}

async function installExternalPlayerStub(
    app: LaunchedElectronApp
): Promise<void> {
    await app.electronApp.evaluate(({ ipcMain }) => {
        const openPlayer = async (
            _event: unknown,
            url: string,
            title: string,
            thumbnail?: string | null
        ) => {
            const now = new Date().toISOString();

            return {
                canClose: false,
                id: 'e2e-mpv-live-panel',
                player: 'mpv',
                startedAt: now,
                status: 'opened',
                streamUrl: url,
                thumbnail: thumbnail ?? null,
                title,
                updatedAt: now,
            };
        };

        ipcMain.removeHandler('OPEN_MPV_PLAYER');
        ipcMain.handle('OPEN_MPV_PLAYER', openPlayer);
    });
}
