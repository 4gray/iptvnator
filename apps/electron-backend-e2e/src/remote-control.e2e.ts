import { APIRequestContext, Page } from '@playwright/test';
import { AddressInfo, createServer as createNetServer } from 'net';

import {
    addStalkerPortal,
    addXtreamPortal,
    channelItemByTitle,
    closeElectronApp,
    enableRemoteControl,
    expect,
    fillWorkspaceSearch,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    resetMockServers,
    test,
    waitForM3uCatalog,
    waitForStalkerCatalog,
    waitForXtreamCatalog,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

type RemoteControlStatus = {
    channelName?: string;
    channelNumber?: number;
    isLiveView: boolean;
    muted?: boolean;
    portal: 'm3u' | 'xtream' | 'stalker' | 'unknown';
    supportsVolume?: boolean;
    volume?: number;
};

test.describe('Electron Remote Control', () => {
    for (const mode of ['xtream', 'stalker', 'radio'] as const) {
        test(`@remote-control @electron ${mode} keeps playback order while browsing and reveals the playing channel`, async ({
            dataDir,
            request,
        }) => {
            test.setTimeout(120000);
            const provider = mode === 'xtream' ? 'xtream' : 'stalker';
            await resetMockServers(request, [provider]);
            const remotePort = await reserveFreePort();
            const app = await launchElectronApp(dataDir);
            try {
                const page = app.mainWindow;
                await openSettings(page);
                await openSettingsSection(page, 'playback');
                await selectSettingsOption(
                    page,
                    'select-video-player',
                    'artplayer'
                );
                await enableRemoteControl(page, remotePort);
                await saveSettings(page);
                await waitForRemoteControlServer(request, remotePort);
                await goToDashboard(page);
                if (provider === 'xtream') {
                    await addXtreamPortal(page);
                    await waitForXtreamCatalog(page);
                } else {
                    await addStalkerPortal(page);
                    await waitForStalkerCatalog(page);
                }
                await page
                    .getByRole('link', {
                        name: mode === 'radio' ? 'Radio' : 'Live TV',
                        exact: true,
                    })
                    .click();
                const categories = page.locator(
                    '.context-panel .category-item:not([data-category-id="*"])'
                );
                await expect(categories.nth(1)).toBeVisible();
                const originalCategory = categories.first();
                const browsedCategory = categories.nth(1);
                await originalCategory.click();
                const rows = page
                    .locator('#live-channels')
                    .getByTestId('channel-item');
                await expect(rows.nth(2)).toBeVisible();
                if (provider === 'xtream') {
                    await page
                        .getByRole('button', {
                            name: 'Sort channels',
                            exact: true,
                        })
                        .click();
                    await page
                        .getByRole('menuitem', { name: 'Name Z-A' })
                        .click();
                }
                const titles = await rows
                    .locator('.channel-name')
                    .allTextContents();
                const [first, second, third] = titles.map((title) =>
                    title.trim()
                );
                expect(first).toBeTruthy();
                expect(second).toBeTruthy();
                expect(third).toBeTruthy();
                await rows.first().click();
                await waitForRemoteStatus(
                    request,
                    remotePort,
                    (status) =>
                        status.portal === provider &&
                        status.channelName === first &&
                        status.channelNumber === 1
                );
                await browsedCategory.click();
                await expect(browsedCategory).toHaveAttribute(
                    'aria-current',
                    'true'
                );
                if (provider === 'xtream') {
                    await page
                        .getByRole('button', {
                            name: 'Sort channels',
                            exact: true,
                        })
                        .click();
                    await page
                        .getByRole('menuitem', { name: 'Name A-Z' })
                        .click();
                }
                await fillWorkspaceSearch(page, '__no_playing_channel__');
                await page.waitForURL(/q=__no_playing_channel__/);
                await expect(rows).toHaveCount(0);
                await waitForRemoteStatus(
                    request,
                    remotePort,
                    (status) =>
                        status.portal === provider &&
                        status.channelName === first &&
                        status.channelNumber === 1
                );
                await postRemoteCommand(
                    request,
                    remotePort,
                    '/channel/select-number',
                    { number: 2 }
                );
                await waitForRemoteStatus(
                    request,
                    remotePort,
                    (status) =>
                        status.channelName === second &&
                        status.channelNumber === 2
                );
                await expect(browsedCategory).toHaveAttribute(
                    'aria-current',
                    'true'
                );
                await postRemoteCommand(request, remotePort, '/channel/down');
                await waitForRemoteStatus(
                    request,
                    remotePort,
                    (status) =>
                        status.channelName === third &&
                        status.channelNumber === 3
                );
                await postRemoteCommand(request, remotePort, '/channel/up');
                await waitForRemoteStatus(
                    request,
                    remotePort,
                    (status) =>
                        status.channelName === second &&
                        status.channelNumber === 2
                );
                await expect(browsedCategory).toHaveAttribute(
                    'aria-current',
                    'true'
                );
                const media = page
                    .locator(
                        mode === 'radio'
                            ? 'app-audio-player audio'
                            : 'app-web-player-view video'
                    )
                    .first();
                await expect(media).toBeAttached();
                const originalMedia = await media.elementHandle();
                const originalSource = await media.evaluate(
                    (element: HTMLMediaElement) => element.src
                );
                const reveal = page.getByRole('button', {
                    name: 'Show playing channel',
                    exact: true,
                });
                await expect(reveal).toBeVisible();
                for (const theme of ['light', 'dark'] as const) {
                    await page.emulateMedia({ colorScheme: theme });
                    if (theme === 'dark') {
                        await expect(page.locator('body')).toHaveClass(
                            /dark-theme/
                        );
                    } else {
                        await expect(page.locator('body')).not.toHaveClass(
                            /dark-theme/
                        );
                    }
                    await page.screenshot({
                        path: test
                            .info()
                            .outputPath(`${mode}-show-playing-${theme}.png`),
                    });
                }
                await reveal.click();
                await expect(originalCategory).toHaveAttribute(
                    'aria-current',
                    'true'
                );
                await expect(
                    page.locator(
                        'app-workspace-shell-header input[type="search"]'
                    )
                ).toHaveValue('');
                await expect(page.locator('#live-channels')).toBeFocused();
                const activeRow = channelItemByTitle(page, second).first();
                await expect(activeRow).toBeVisible();
                await expect(activeRow).toHaveClass(/active/);
                await expect(reveal).toHaveCount(0);
                expect(
                    await media.evaluate(
                        (element, previous) => element === previous,
                        originalMedia
                    )
                ).toBe(true);
                await expect(media).toHaveJSProperty('src', originalSource);
                await waitForRemoteStatus(
                    request,
                    remotePort,
                    (status) =>
                        status.channelName === second &&
                        status.channelNumber === 2
                );
                await page.screenshot({
                    path: test.info().outputPath(`${mode}-revealed-dark.png`),
                });
                // Category-only root browsing does not change the URL; a
                // router no-op must still reveal without restarting playback.
                await browsedCategory.click();
                await expect(reveal).toBeVisible();
                await reveal.click();
                await expect(originalCategory).toHaveAttribute(
                    'aria-current',
                    'true'
                );
                await expect(activeRow).toBeVisible();
                expect(
                    await media.evaluate(
                        (element, previous) => element === previous,
                        originalMedia
                    )
                ).toBe(true);
                await originalMedia?.dispose();
            } finally {
                await closeElectronApp(app);
            }
        });
    }

    test('@remote-control @m3u @electron applies remote volume commands to the selected built-in video player', async ({
        dataDir,
        request,
    }) => {
        const remotePort = await reserveFreePort();
        const channelName = 'Remote ArtPlayer Channel';
        const playlistFile = writeTemporaryM3uFile(
            dataDir,
            'remote-control-video.m3u',
            [
                {
                    groupTitle: 'Remote',
                    name: channelName,
                    url: 'https://example.channels/remote-art-player.m3u8',
                },
            ]
        );
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'playback');
            await selectSettingsOption(
                app.mainWindow,
                'select-video-player',
                'artplayer'
            );
            await enableRemoteControl(app.mainWindow, remotePort);
            await saveSettings(app.mainWindow);
            await waitForRemoteControlServer(request, remotePort);

            await goToDashboard(app.mainWindow);
            await importM3uPlaylistFromNativeDialog(app, playlistFile);
            await waitForM3uCatalog(app.mainWindow);
            await channelItemByTitle(app.mainWindow, channelName)
                .first()
                .click();

            const playerVideo = app.mainWindow
                .locator('app-art-player video')
                .first();
            await expect(playerVideo).toHaveCount(1, { timeout: 20000 });
            await waitForRemoteStatus(request, remotePort, (status) => {
                return (
                    status.portal === 'm3u' &&
                    status.channelName === channelName &&
                    status.supportsVolume === true &&
                    roundVolume(status.volume) === 1
                );
            });

            await postRemoteCommand(request, remotePort, '/volume/down');

            await waitForRemoteStatus(request, remotePort, (status) => {
                return (
                    status.portal === 'm3u' &&
                    status.channelName === channelName &&
                    status.supportsVolume === true &&
                    roundVolume(status.volume) === 0.9 &&
                    status.muted === false
                );
            });
            await expect
                .poll(() =>
                    readMediaVolume(app.mainWindow, 'app-art-player video')
                )
                .toBe(0.9);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@remote-control @m3u @electron applies remote volume commands to radio audio playback', async ({
        dataDir,
        request,
    }) => {
        const remotePort = await reserveFreePort();
        const channelName = 'Remote Radio Channel';
        const playlistFile = writeTemporaryM3uFile(
            dataDir,
            'remote-control-radio.m3u',
            [
                {
                    groupTitle: 'Radio',
                    name: channelName,
                    radio: true,
                    url: 'https://example.channels/remote-radio-stream.mp3',
                },
            ]
        );
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await enableRemoteControl(app.mainWindow, remotePort);
            await saveSettings(app.mainWindow);
            await waitForRemoteControlServer(request, remotePort);

            await goToDashboard(app.mainWindow);
            await importM3uPlaylistFromNativeDialog(app, playlistFile);
            await waitForM3uCatalog(app.mainWindow);
            await channelItemByTitle(app.mainWindow, channelName)
                .first()
                .click();

            const audio = app.mainWindow
                .locator('app-audio-player audio')
                .first();
            await expect(audio).toHaveCount(1, { timeout: 20000 });
            await waitForRemoteStatus(request, remotePort, (status) => {
                return (
                    status.portal === 'm3u' &&
                    status.channelName === channelName &&
                    status.supportsVolume === true &&
                    roundVolume(status.volume) === 1
                );
            });

            await postRemoteCommand(request, remotePort, '/volume/down');

            await waitForRemoteStatus(request, remotePort, (status) => {
                return (
                    status.portal === 'm3u' &&
                    status.channelName === channelName &&
                    status.supportsVolume === true &&
                    roundVolume(status.volume) === 0.9 &&
                    status.muted === false
                );
            });
            await expect
                .poll(() =>
                    readMediaVolume(app.mainWindow, 'app-audio-player audio')
                )
                .toBe(0.9);
        } finally {
            await closeElectronApp(app);
        }
    });
});

async function selectSettingsOption(
    page: Page,
    selectTestId: string,
    optionTestId: string
): Promise<void> {
    await page.getByTestId(selectTestId).click();
    await page.getByTestId(optionTestId).click();
}

async function reserveFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createNetServer();

        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as AddressInfo | null;
            if (!address) {
                server.close();
                reject(new Error('Could not reserve a remote control port.'));
                return;
            }

            server.close(() => resolve(address.port));
        });
    });
}

async function waitForRemoteControlServer(
    request: APIRequestContext,
    port: number
): Promise<void> {
    await waitForRemoteStatus(
        request,
        port,
        (status) => status.portal === 'unknown' && status.isLiveView === false
    );
}

async function waitForRemoteStatus(
    request: APIRequestContext,
    port: number,
    predicate: (status: RemoteControlStatus) => boolean
): Promise<RemoteControlStatus> {
    let latestStatus: RemoteControlStatus | null = null;

    try {
        await expect
            .poll(
                async () => {
                    latestStatus = await getRemoteStatus(request, port);
                    return latestStatus ? predicate(latestStatus) : false;
                },
                { timeout: 20000 }
            )
            .toBe(true);
    } catch (error) {
        // The predicate alone says nothing about how far the status got;
        // surface the last payload so a CI failure is diagnosable.
        throw new Error(
            `Remote status never matched. Last status: ${JSON.stringify(latestStatus)}`,
            { cause: error }
        );
    }

    return latestStatus as RemoteControlStatus;
}

async function getRemoteStatus(
    request: APIRequestContext,
    port: number
): Promise<RemoteControlStatus | null> {
    try {
        const response = await request.get(remoteControlUrl(port, '/status'), {
            timeout: 1000,
        });

        if (!response.ok()) {
            return null;
        }

        return (await response.json()) as RemoteControlStatus;
    } catch {
        return null;
    }
}

async function postRemoteCommand(
    request: APIRequestContext,
    port: number,
    path: string,
    data: Record<string, unknown> = {}
): Promise<void> {
    const response = await request.post(remoteControlUrl(port, path), {
        data,
    });

    expect(response.ok()).toBe(true);
}

function remoteControlUrl(port: number, path: string): string {
    return `http://127.0.0.1:${port}/api/remote-control${path}`;
}

async function readMediaVolume(page: Page, selector: string): Promise<number> {
    return page
        .locator(selector)
        .first()
        .evaluate((element) => {
            return Number((element as HTMLMediaElement).volume.toFixed(2));
        });
}

function roundVolume(volume: number | undefined): number | null {
    if (volume === undefined) {
        return null;
    }

    return Number(volume.toFixed(2));
}
