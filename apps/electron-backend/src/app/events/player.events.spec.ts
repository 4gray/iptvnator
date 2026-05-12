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
    VLC_REUSE_INSTANCE: 'VLC_REUSE_INSTANCE',
    store: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));

jest.mock('../services/stalker-playback-context.service', () => ({
    getStalkerPlaybackContextHeaders: jest.fn(() => undefined),
}));

import { ipcMain } from 'electron';
import {
    MPV_PLAYER_PATH,
    store,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
} from '../services/store.service';
import {
    buildExternalPlayerSpawnSpec,
    buildPlayerArgsWithCustomArguments,
    buildVlcEnqueueCommands,
    isRunningInFlatpak,
    parseExternalPlayerArguments,
    parseVlcRcPlaybackState,
    parseVlcRcNumericResponse,
    resolveExternalPlayerLaunchContext,
    shouldReuseMpvInstance,
    shouldReuseVlcInstance,
    shouldUseMpvSocketBridge,
} from './player.events';

function createPathExists(existingPaths: string[]) {
    return (candidatePath: string) => existingPaths.includes(candidatePath);
}

function getIpcMainHandler(channel: string): (...args: unknown[]) => unknown {
    const handleMock = ipcMain.handle as unknown as jest.Mock;
    const calls = handleMock.mock.calls as Array<
        [string, (...args: unknown[]) => unknown]
    >;
    const match = calls.find(
        ([registeredChannel]) => registeredChannel === channel
    );

    if (!match) {
        throw new Error(`Missing ipcMain handler for ${channel}`);
    }

    return match[1];
}

describe('player.events Flatpak launch helpers', () => {
    it('detects Flatpak only on Linux when /.flatpak-info exists', () => {
        expect(
            isRunningInFlatpak(createPathExists(['/.flatpak-info']), 'linux')
        ).toBe(true);
        expect(
            isRunningInFlatpak(createPathExists(['/.flatpak-info']), 'darwin')
        ).toBe(false);
        expect(isRunningInFlatpak(createPathExists([]), 'linux')).toBe(false);
    });

    it('keeps direct Linux player launching outside Flatpak', () => {
        const launchContext = resolveExternalPlayerLaunchContext(
            'mpv',
            undefined,
            {
                platform: 'linux',
                isFlatpak: false,
                pathExists: createPathExists(['/usr/local/bin/mpv']),
            }
        );
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
        const launchContext = resolveExternalPlayerLaunchContext(
            'vlc',
            undefined,
            {
                platform: 'linux',
                isFlatpak: true,
                pathExists: createPathExists(['/usr/bin/vlc']),
            }
        );
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

    it('resolves custom macOS MPV app bundles to their executable', () => {
        const launchContext = resolveExternalPlayerLaunchContext(
            'mpv',
            '/Applications/mpv copy.app',
            {
                platform: 'darwin',
                isFlatpak: false,
            }
        );

        expect(launchContext).toEqual({
            mode: 'direct',
            playerPath: '/Applications/mpv copy.app/Contents/MacOS/mpv',
            command: '/Applications/mpv copy.app/Contents/MacOS/mpv',
            argsPrefix: [],
        });
    });

    it('resolves custom macOS VLC app bundles to their executable', () => {
        const launchContext = resolveExternalPlayerLaunchContext(
            'vlc',
            '/Applications/VLC.app/',
            {
                platform: 'darwin',
                isFlatpak: false,
            }
        );

        expect(launchContext).toEqual({
            mode: 'direct',
            playerPath: '/Applications/VLC.app/Contents/MacOS/VLC',
            command: '/Applications/VLC.app/Contents/MacOS/VLC',
            argsPrefix: [],
        });
    });

    it('keeps custom macOS executable player paths unchanged', () => {
        const launchContext = resolveExternalPlayerLaunchContext(
            'mpv',
            '/Applications/mpv.app/Contents/MacOS/mpv',
            {
                platform: 'darwin',
                isFlatpak: false,
            }
        );

        expect(launchContext).toEqual({
            mode: 'direct',
            playerPath: '/Applications/mpv.app/Contents/MacOS/mpv',
            command: '/Applications/mpv.app/Contents/MacOS/mpv',
            argsPrefix: [],
        });
    });

    it('parses custom player arguments as one argument per non-empty line', () => {
        expect(
            parseExternalPlayerArguments(
                '  --screen=1\n\n--geometry=1280x720\r\n  --hwdec=auto-safe  '
            )
        ).toEqual(['--screen=1', '--geometry=1280x720', '--hwdec=auto-safe']);
    });

    it('treats missing custom player arguments as no arguments', () => {
        expect(parseExternalPlayerArguments(undefined)).toEqual([]);
        expect(parseExternalPlayerArguments('   \n  ')).toEqual([]);
    });

    it('adds custom player arguments before IPTVnator runtime arguments', () => {
        expect(
            buildPlayerArgsWithCustomArguments(
                '--screen=1\n--geometry=1280x720',
                [
                    '--ytdl=no',
                    '--force-media-title=News',
                    'https://example.com/stream.m3u8',
                ]
            )
        ).toEqual([
            '--screen=1',
            '--geometry=1280x720',
            '--ytdl=no',
            '--force-media-title=News',
            'https://example.com/stream.m3u8',
        ]);
    });

    it('disables MPV reuse and socket bridging only in Flatpak', () => {
        expect(shouldReuseMpvInstance(true, true)).toBe(false);
        expect(shouldUseMpvSocketBridge(true)).toBe(false);

        expect(shouldReuseMpvInstance(true, false)).toBe(true);
        expect(shouldReuseMpvInstance(false, false)).toBe(false);
        expect(shouldUseMpvSocketBridge(false)).toBe(true);
    });

    it('disables VLC reuse only in Flatpak', () => {
        expect(shouldReuseVlcInstance(true, true)).toBe(false);
        expect(shouldReuseVlcInstance(true, false)).toBe(true);
        expect(shouldReuseVlcInstance(false, false)).toBe(false);
    });

    it('parses numeric VLC RC responses that include the prompt prefix', () => {
        expect(
            parseVlcRcNumericResponse(`VLC media player 3.0.20 Vetinari
Command Line Interface initialized. Type \`help' for help.
> 20
> `)
        ).toBe('20');

        expect(
            parseVlcRcNumericResponse(`VLC media player 3.0.20 Vetinari
Command Line Interface initialized. Type \`help' for help.
> 9281
> `)
        ).toBe('9281');
    });

    it('returns an empty string for non-numeric VLC RC responses', () => {
        expect(
            parseVlcRcNumericResponse(`VLC media player 3.0.20 Vetinari
Command Line Interface initialized. Type \`help' for help.
> ( state playing )
> `)
        ).toBe('');
    });

    it('parses VLC RC playback states from status output', () => {
        expect(
            parseVlcRcPlaybackState(`VLC media player 3.0.20 Vetinari
Command Line Interface initialized. Type \`help' for help.
> ( audio volume: 196 )
( state playing )
> `)
        ).toBe('playing');

        expect(
            parseVlcRcPlaybackState(`VLC media player 3.0.20 Vetinari
Command Line Interface initialized. Type \`help' for help.
> ( state stopped )
> `)
        ).toBe('stopped');
    });
});

describe('player.events external player path settings', () => {
    beforeEach(() => {
        (store.set as unknown as jest.Mock).mockClear();
    });

    it('stores cleared VLC player paths as an empty string', () => {
        getIpcMainHandler('SET_VLC_PLAYER_PATH')({}, '   ');

        expect(store.set).toHaveBeenCalledWith(VLC_PLAYER_PATH, '');
    });

    it('trims custom MPV player paths before storing them', () => {
        getIpcMainHandler('SET_MPV_PLAYER_PATH')(
            {},
            '  /Applications/mpv.app/Contents/MacOS/mpv  '
        );

        expect(store.set).toHaveBeenCalledWith(
            MPV_PLAYER_PATH,
            '/Applications/mpv.app/Contents/MacOS/mpv'
        );
    });

    it('persists the VLC reuse-instance preference', () => {
        getIpcMainHandler('SET_VLC_REUSE_INSTANCE')({}, true);

        expect(store.set).toHaveBeenCalledWith(VLC_REUSE_INSTANCE, true);
    });
});

describe('buildVlcEnqueueCommands', () => {
    it('clears the playlist and adds the URL with no extra options', () => {
        expect(
            buildVlcEnqueueCommands({ url: 'http://stream.example/a.m3u8' })
        ).toEqual(['clear', 'add http://stream.example/a.m3u8']);
    });

    it('attaches per-input HTTP options inline with the add command', () => {
        const commands = buildVlcEnqueueCommands({
            url: 'http://stream.example/a.m3u8',
            title: 'Channel One',
            userAgent: 'Custom/1.0',
            referer: 'https://referer.example',
            headers: { 'X-Token': 'abc' },
        });

        expect(commands[0]).toBe('clear');
        expect(commands[1]).toBe(
            'add http://stream.example/a.m3u8 :http-user-agent=Custom/1.0 :http-referrer=https://referer.example :http-header=X-Token: abc :meta-title=Channel One'
        );
    });

    it('falls back to origin when referer is absent', () => {
        const commands = buildVlcEnqueueCommands({
            url: 'http://stream.example/a.m3u8',
            origin: 'https://origin.example',
        });

        expect(commands[1]).toContain(':http-referrer=https://origin.example');
    });

    it('appends a seek command when startTime is provided', () => {
        const commands = buildVlcEnqueueCommands({
            url: 'http://stream.example/a.m3u8',
            startTime: 42.7,
        });

        expect(commands).toEqual([
            'clear',
            'add http://stream.example/a.m3u8',
            'seek 42',
        ]);
    });

    it('skips empty header values', () => {
        const commands = buildVlcEnqueueCommands({
            url: 'http://stream.example/a.m3u8',
            headers: { 'X-Empty': '   ', 'X-Real': 'value' },
        });

        expect(commands[1]).toContain(':http-header=X-Real: value');
        expect(commands[1]).not.toContain('X-Empty');
    });
});
