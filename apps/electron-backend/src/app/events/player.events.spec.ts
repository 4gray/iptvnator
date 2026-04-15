jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('../app', () => ({
    __esModule: true,
    default: {
        mainWindow: null,
    },
}));

jest.mock('../services/store.service', () => ({
    MPV_PLAYER_PATH: 'MPV_PLAYER_PATH',
    MPV_REUSE_INSTANCE: 'MPV_REUSE_INSTANCE',
    VLC_PLAYER_PATH: 'VLC_PLAYER_PATH',
    store: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));

jest.mock('../services/stalker-playback-context.service', () => ({
    getStalkerPlaybackContextHeaders: jest.fn(() => undefined),
}));

import {
    buildExternalPlayerSpawnSpec,
    isRunningInFlatpak,
    resolveExternalPlayerLaunchContext,
    shouldReuseMpvInstance,
    shouldUseMpvSocketBridge,
} from './player.events';

function createPathExists(existingPaths: string[]) {
    return (candidatePath: string) => existingPaths.includes(candidatePath);
}

describe('player.events Flatpak launch helpers', () => {
    it('detects Flatpak only on Linux when /.flatpak-info exists', () => {
        expect(isRunningInFlatpak(createPathExists(['/.flatpak-info']), 'linux')).toBe(
            true
        );
        expect(isRunningInFlatpak(createPathExists(['/.flatpak-info']), 'darwin')).toBe(
            false
        );
        expect(isRunningInFlatpak(createPathExists([]), 'linux')).toBe(false);
    });

    it('keeps direct Linux player launching outside Flatpak', () => {
        const launchContext = resolveExternalPlayerLaunchContext('mpv', undefined, {
            platform: 'linux',
            isFlatpak: false,
            pathExists: createPathExists(['/usr/local/bin/mpv']),
        });
        const spawnSpec = buildExternalPlayerSpawnSpec(launchContext, [
            '--ytdl=no',
            'https://example.com/stream.m3u8',
        ]);

        expect(launchContext).toEqual({
            mode: 'direct',
            playerPath: '/usr/local/bin/mpv',
            command: '/usr/local/bin/mpv',
            argsPrefix: [],
        });
        expect(spawnSpec).toEqual({
            mode: 'direct',
            playerPath: '/usr/local/bin/mpv',
            command: '/usr/local/bin/mpv',
            args: ['--ytdl=no', 'https://example.com/stream.m3u8'],
        });
    });

    it('builds Flatpak host launches with bare player names by default', () => {
        const launchContext = resolveExternalPlayerLaunchContext('vlc', undefined, {
            platform: 'linux',
            isFlatpak: true,
            pathExists: createPathExists(['/usr/bin/vlc']),
        });
        const spawnSpec = buildExternalPlayerSpawnSpec(launchContext, [
            '--extraintf=rc',
            'https://example.com/stream.m3u8',
        ]);

        expect(launchContext).toEqual({
            mode: 'flatpak-host',
            playerPath: 'vlc',
            command: 'flatpak-spawn',
            argsPrefix: ['--host', '--watch-bus', 'vlc'],
        });
        expect(spawnSpec.args).toEqual([
            '--host',
            '--watch-bus',
            'vlc',
            '--extraintf=rc',
            'https://example.com/stream.m3u8',
        ]);
    });

    it('passes custom host player paths through Flatpak launching unchanged', () => {
        const launchContext = resolveExternalPlayerLaunchContext(
            'mpv',
            '/opt/mpv/bin/mpv',
            {
                platform: 'linux',
                isFlatpak: true,
            }
        );

        expect(launchContext).toEqual({
            mode: 'flatpak-host',
            playerPath: '/opt/mpv/bin/mpv',
            command: 'flatpak-spawn',
            argsPrefix: ['--host', '--watch-bus', '/opt/mpv/bin/mpv'],
        });
    });

    it('disables MPV reuse and socket bridging only in Flatpak', () => {
        expect(shouldReuseMpvInstance(true, true)).toBe(false);
        expect(shouldUseMpvSocketBridge(true)).toBe(false);

        expect(shouldReuseMpvInstance(true, false)).toBe(true);
        expect(shouldReuseMpvInstance(false, false)).toBe(false);
        expect(shouldUseMpvSocketBridge(false)).toBe(true);
    });
});
