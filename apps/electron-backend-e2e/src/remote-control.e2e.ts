import { APIRequestContext, Page } from '@playwright/test';
import { AddressInfo, createServer as createNetServer } from 'net';

import {
    channelItemByTitle,
    closeElectronApp,
    enableRemoteControl,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSettings,
    saveSettings,
    test,
    waitForM3uCatalog,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

type RemoteControlStatus = {
    channelName?: string;
    isLiveView: boolean;
    muted?: boolean;
    portal: 'm3u' | 'xtream' | 'stalker' | 'unknown';
    supportsVolume?: boolean;
    volume?: number;
};

test.describe('Electron Remote Control', () => {
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

    await expect
        .poll(
            async () => {
                latestStatus = await getRemoteStatus(request, port);
                return latestStatus ? predicate(latestStatus) : false;
            },
            { timeout: 20000 }
        )
        .toBe(true);

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
    path: string
): Promise<void> {
    const response = await request.post(remoteControlUrl(port, path), {
        data: {},
    });

    expect(response.ok()).toBe(true);
}

function remoteControlUrl(port: number, path: string): string {
    return `http://127.0.0.1:${port}/api/remote-control${path}`;
}

async function readMediaVolume(page: Page, selector: string): Promise<number> {
    return page.locator(selector).first().evaluate((element) => {
        return Number((element as HTMLMediaElement).volume.toFixed(2));
    });
}

function roundVolume(volume: number | undefined): number | null {
    if (volume === undefined) {
        return null;
    }

    return Number(volume.toFixed(2));
}
