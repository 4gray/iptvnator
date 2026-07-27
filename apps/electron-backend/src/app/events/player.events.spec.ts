jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

const mockCreateConnection = jest.fn();

jest.mock('net', () => ({
    ...jest.requireActual('net'),
    createConnection: mockCreateConnection,
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

const mockConsumeStalkerPlaybackContext = jest.fn();
const mockGetStalkerPlaybackContextHeaders = jest.fn(() => undefined);

jest.mock('../services/stalker-playback-context.service', () => ({
    getStalkerPlaybackContextHeaders: mockGetStalkerPlaybackContextHeaders,
    stalkerPlaybackContextService: {
        consume: mockConsumeStalkerPlaybackContext,
    },
}));

import { ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
    MPV_REUSE_INSTANCE,
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
import { resolveEffectiveExternalPlaybackRequest } from './external-player-playback-request';
import {
    openMpvPlayer,
    shutdownMpvSession,
} from './mpv-session.service';
import { openVlcPlayer } from './vlc-session.service';

function createPathExists(existingPaths: string[]) {
    return (candidatePath: string) => existingPaths.includes(candidatePath);
}

function createReadDirectory(entriesByPath: Record<string, string[]>) {
    return (directoryPath: string) => entriesByPath[directoryPath] ?? [];
}

function createMockChildProcess(): ChildProcess {
    return Object.assign(new EventEmitter(), {
        killed: false,
        kill: jest.fn(() => true),
        stderr: null,
        stdout: null,
        unref: jest.fn(),
    }) as unknown as ChildProcess;
}

async function waitForSpawnCallCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if ((spawn as unknown as jest.Mock).mock.calls.length >= count) {
            return;
        }

        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
    }

    throw new Error(`Expected ${count} VLC spawn calls`);
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

    it('resolves versioned Homebrew Cask VLC app installs on macOS', () => {
        const caskVlcPath =
            '/opt/homebrew/Caskroom/vlc/3.0.21/VLC.app/Contents/MacOS/VLC';
        const launchContext = resolveExternalPlayerLaunchContext(
            'vlc',
            undefined,
            {
                platform: 'darwin',
                isFlatpak: false,
                pathExists: createPathExists([caskVlcPath]),
                readDirectory: createReadDirectory({
                    '/opt/homebrew/Caskroom/vlc': ['3.0.21'],
                }),
            }
        );

        expect(launchContext).toEqual({
            mode: 'direct',
            playerPath: caskVlcPath,
            command: caskVlcPath,
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

describe('player.events Stalker playback contexts', () => {
    beforeEach(() => {
        mockConsumeStalkerPlaybackContext.mockReset();
        mockGetStalkerPlaybackContextHeaders.mockReset();
        mockGetStalkerPlaybackContextHeaders.mockReturnValue(undefined);
        (spawn as unknown as jest.Mock).mockReset();
        (store.get as unknown as jest.Mock).mockImplementation(
            (_key: string, fallback?: unknown) => fallback
        );
    });

    it('uses only main-owned context headers for a sender-bound MPV launch and consumes the ref once', async () => {
        jest.useFakeTimers();
        try {
            const proc = createMockChildProcess();
            (spawn as unknown as jest.Mock).mockReturnValue(proc);
            mockConsumeStalkerPlaybackContext
                .mockReturnValueOnce({
                    Authorization: 'Bearer main-token',
                    Cookie: 'session=main-cookie',
                    Origin: 'https://main.example',
                    Referer: 'https://main.example/player/',
                    'User-Agent': 'MainAgent/1.0',
                })
                .mockReturnValueOnce(null);
            const handler = getIpcMainHandler('OPEN_MPV_PLAYER');
            const args = [
                'https://stream.example/live.m3u8',
                'Managed stream',
                '',
                'RendererAgent/1.0',
                'https://renderer.example/referrer',
                'https://renderer.example',
                undefined,
                undefined,
                {
                    Authorization: 'Bearer renderer-token',
                    Cookie: 'session=renderer-cookie',
                },
                'opaque-playback-context',
            ] as const;

            const firstLaunch = handler({ sender: { id: 71 } }, ...args);
            jest.advanceTimersByTime(100);
            await expect(firstLaunch).resolves.toMatchObject({
                player: 'mpv',
                status: 'opened',
            });

            expect(mockConsumeStalkerPlaybackContext).toHaveBeenCalledWith({
                contextRef: 'opaque-playback-context',
                senderId: 71,
                streamUrl: 'https://stream.example/live.m3u8',
            });
            expect(mockGetStalkerPlaybackContextHeaders).not.toHaveBeenCalled();
            const spawnArgs = (spawn as unknown as jest.Mock).mock.calls[0][1];
            const serializedArgs = JSON.stringify(spawnArgs);
            expect(serializedArgs).toContain('Bearer main-token');
            expect(serializedArgs).toContain('session=main-cookie');
            expect(serializedArgs).toContain('MainAgent/1.0');
            expect(serializedArgs).not.toContain('renderer-token');
            expect(serializedArgs).not.toContain('renderer-cookie');
            expect(serializedArgs).not.toContain('RendererAgent/1.0');
            expect(serializedArgs).not.toContain('opaque-playback-context');

            await expect(
                handler({ sender: { id: 71 } }, ...args)
            ).rejects.toThrow('invalid-playback-context');
            expect(spawn).toHaveBeenCalledTimes(1);
            expect(mockConsumeStalkerPlaybackContext).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it('fails a foreign or expired VLC context before spawning the player', async () => {
        mockConsumeStalkerPlaybackContext.mockReturnValue(null);
        const handler = getIpcMainHandler('OPEN_VLC_PLAYER');

        await expect(
            handler(
                { sender: { id: 99 } },
                'https://stream.example/live.m3u8',
                'Managed stream',
                '',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                'foreign-or-expired-context'
            )
        ).rejects.toThrow('invalid-playback-context');

        expect(mockConsumeStalkerPlaybackContext).toHaveBeenCalledWith({
            contextRef: 'foreign-or-expired-context',
            senderId: 99,
            streamUrl: 'https://stream.example/live.m3u8',
        });
        expect(spawn).not.toHaveBeenCalled();
    });

    it('keeps the legacy no-ref fallback while main-owned headers bypass renderer overrides', () => {
        mockGetStalkerPlaybackContextHeaders.mockReturnValue({
            'User-Agent': 'LegacyAgent/1.0',
        });

        expect(
            resolveEffectiveExternalPlaybackRequest({
                headers: { 'X-Renderer': 'allowed-legacy-header' },
                url: 'https://stream.example/legacy.m3u8',
            }).mergedHeaders
        ).toEqual({
            'User-Agent': 'LegacyAgent/1.0',
            'X-Renderer': 'allowed-legacy-header',
        });

        const managedOptions = {
            headers: {
                Authorization: 'Bearer renderer-token',
                'User-Agent': 'RendererAgent/1.0',
            },
            mainOwnedHeaders: {
                Authorization: 'Bearer main-token',
                'User-Agent': 'MainAgent/1.0',
            },
            url: 'https://stream.example/managed.m3u8',
            userAgent: 'RendererAgent/1.0',
        };
        const managed = resolveEffectiveExternalPlaybackRequest(managedOptions);

        expect(managed.mergedHeaders).toEqual(managedOptions.mainOwnedHeaders);
        expect(managed.effectiveUserAgent).toBe('MainAgent/1.0');
    });
});

describe('openMpvPlayer reusable request isolation', () => {
    const ipcCommands: unknown[][] = [];

    beforeEach(() => {
        ipcCommands.length = 0;
        mockGetStalkerPlaybackContextHeaders.mockReset();
        mockGetStalkerPlaybackContextHeaders.mockReturnValue(undefined);
        mockCreateConnection.mockReset();
        mockCreateConnection.mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                destroy: jest.fn(),
                destroyed: false,
                end: jest.fn(),
                write: jest.fn((request: string) => {
                    const payload = JSON.parse(request) as {
                        command: unknown[];
                    };
                    ipcCommands.push(payload.command);
                    return true;
                }),
            });

            setImmediate(() => socket.emit('connect'));
            return socket;
        });
        (spawn as unknown as jest.Mock).mockReset();
        (spawn as unknown as jest.Mock).mockReturnValue(
            createMockChildProcess()
        );
        (store.get as unknown as jest.Mock).mockImplementation(
            (key: string, fallback?: unknown) =>
                key === MPV_REUSE_INSTANCE ? true : fallback
        );
    });

    afterEach(() => {
        shutdownMpvSession();
    });

    it('clears managed UA, referrer, Authorization, and Cookie before loading a plain source', async () => {
        await openMpvPlayer({
            title: '',
            url: 'https://seed.example/stream.m3u8',
        });

        await openMpvPlayer({
            mainOwnedHeaders: {
                Authorization: 'Bearer managed-token',
                Cookie: 'session=managed-cookie',
                Origin: 'https://portal.example',
                Referer: 'https://portal.example/player/',
                'User-Agent': 'ManagedAgent/1.0',
            },
            title: '',
            url: 'https://portal.example/managed.m3u8',
        });

        expect(ipcCommands).toEqual([
            ['set_property', 'user-agent', 'ManagedAgent/1.0'],
            [
                'set_property',
                'referrer',
                'https://portal.example/player/',
            ],
            [
                'set_property',
                'http-header-fields',
                'Authorization: Bearer managed-token,Cookie: session=managed-cookie,Origin: https://portal.example,Referer: https://portal.example/player/,User-Agent: ManagedAgent/1.0',
            ],
            [
                'loadfile',
                'https://portal.example/managed.m3u8',
                'replace',
            ],
        ]);

        ipcCommands.length = 0;

        await openMpvPlayer({
            title: '',
            url: 'https://plain.example/public.m3u8',
        });

        expect(ipcCommands).toEqual([
            ['set_property', 'user-agent', ''],
            ['set_property', 'referrer', ''],
            ['set_property', 'http-header-fields', ''],
            [
                'loadfile',
                'https://plain.example/public.m3u8',
                'replace',
            ],
        ]);
        expect(JSON.stringify(ipcCommands)).not.toContain('managed-token');
        expect(JSON.stringify(ipcCommands)).not.toContain('managed-cookie');
    });

    it('serializes concurrent managed and plain loads so their request properties cannot interleave', async () => {
        await openMpvPlayer({
            title: '',
            url: 'https://seed.example/stream.m3u8',
        });

        const managedOpen = openMpvPlayer({
            mainOwnedHeaders: {
                Authorization: 'Bearer concurrent-token',
                Cookie: 'session=concurrent-cookie',
                Referer: 'https://portal.example/player/',
                'User-Agent': 'ConcurrentAgent/1.0',
            },
            title: '',
            url: 'https://portal.example/concurrent.m3u8',
        });
        const plainOpen = openMpvPlayer({
            title: '',
            url: 'https://plain.example/concurrent.m3u8',
        });

        await Promise.all([managedOpen, plainOpen]);

        expect(ipcCommands).toEqual([
            ['set_property', 'user-agent', 'ConcurrentAgent/1.0'],
            [
                'set_property',
                'referrer',
                'https://portal.example/player/',
            ],
            [
                'set_property',
                'http-header-fields',
                'Authorization: Bearer concurrent-token,Cookie: session=concurrent-cookie,Referer: https://portal.example/player/,User-Agent: ConcurrentAgent/1.0',
            ],
            [
                'loadfile',
                'https://portal.example/concurrent.m3u8',
                'replace',
            ],
            ['set_property', 'user-agent', ''],
            ['set_property', 'referrer', ''],
            ['set_property', 'http-header-fields', ''],
            [
                'loadfile',
                'https://plain.example/concurrent.m3u8',
                'replace',
            ],
        ]);
    });
});

describe('openVlcPlayer', () => {
    beforeEach(() => {
        (spawn as unknown as jest.Mock).mockReset();
        (store.get as unknown as jest.Mock).mockImplementation(
            (_key: string, fallback?: unknown) => fallback
        );
    });

    it('rejects when VLC process spawning emits an error', async () => {
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            const proc = createMockChildProcess();
            (spawn as unknown as jest.Mock).mockReturnValue(proc);

            const openPromise = openVlcPlayer({
                title: 'Broken VLC',
                url: 'https://example.com/live.m3u8',
            });
            proc.emit('error', new Error('spawn vlc ENOENT'));

            await expect(openPromise).rejects.toThrow(
                'Failed to start VLC player: spawn vlc ENOENT'
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('rejects when VLC RC retry spawning also emits an error', async () => {
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            const firstProc = createMockChildProcess();
            const retryProc = createMockChildProcess();
            (spawn as unknown as jest.Mock)
                .mockReturnValueOnce(firstProc)
                .mockReturnValueOnce(retryProc);
            (store.get as unknown as jest.Mock).mockImplementation(
                (key: string, fallback?: unknown) =>
                    key === VLC_REUSE_INSTANCE ? true : fallback
            );

            const openPromise = openVlcPlayer({
                title: 'Broken reusable VLC',
                url: 'https://example.com/live.m3u8',
            });

            await waitForSpawnCallCount(1);
            firstProc.emit('error', new Error('spawn vlc ENOENT'));
            await waitForSpawnCallCount(2);
            retryProc.emit('error', new Error('spawn vlc ENOENT'));

            await expect(openPromise).rejects.toThrow(
                'Failed to start VLC player: spawn vlc ENOENT'
            );
            expect(spawn).toHaveBeenCalledTimes(2);
            expect((spawn as unknown as jest.Mock).mock.calls[0][1]).toContain(
                '--extraintf=rc'
            );
            expect(
                (spawn as unknown as jest.Mock).mock.calls[1][1]
            ).not.toContain('--extraintf=rc');
        } finally {
            consoleErrorSpy.mockRestore();
        }
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
