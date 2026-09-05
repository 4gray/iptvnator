/**
 * Pure helper and launch-argument coverage for the VLC session service.
 * Instance reuse, process exit, and spawn-error handling live in
 * `vlc-session.service.lifecycle.spec.ts`.
 */
jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

jest.mock('net', () => ({
    createConnection: jest.fn(),
    createServer: jest.fn(),
}));

jest.mock('../app', () => ({
    __esModule: true,
    default: {
        mainWindow: null,
    },
}));

jest.mock('../services/store.service', () => ({
    VLC_PLAYER_ARGUMENTS: 'VLC_PLAYER_ARGUMENTS',
    VLC_PLAYER_PATH: 'VLC_PLAYER_PATH',
    VLC_REUSE_INSTANCE: 'VLC_REUSE_INSTANCE',
    store: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createServer } from 'net';
import {
    VLC_PLAYER_ARGUMENTS,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import {
    buildVlcEnqueueCommands,
    openVlcPlayer,
    parseVlcRcNumericResponse,
    parseVlcRcPlaybackState,
    shutdownVlcSession,
} from './vlc-session.service';

const originalPlatform = process.platform;
const spawnMock = spawn as unknown as jest.Mock;
const streamUrl = 'https://example.com/stream.m3u8';

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
        if (spawnMock.mock.calls.length >= count) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Expected ${count} player spawn calls`);
}

function mockStoreValues(values: Record<string, unknown>): void {
    (store.get as unknown as jest.Mock).mockImplementation(
        (key: string, fallback?: unknown) =>
            key in values ? values[key] : fallback
    );
}

describe('vlc-session.service helpers and launch args', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        jest.useFakeTimers({ doNotFake: ['setImmediate'] });
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        (createServer as unknown as jest.Mock).mockImplementation(() => ({
            unref: jest.fn(),
            on: jest.fn(),
            listen: (_port: number, _host: string, cb: () => void) => cb(),
            address: () => ({ port: 43210 }),
            close: (cb?: () => void) => cb?.(),
        }));
        mockStoreValues({
            [VLC_PLAYER_PATH]: '/usr/bin/vlc',
            [VLC_REUSE_INSTANCE]: false,
        });
    });

    afterEach(() => {
        // Drop any process tracked for reuse so tests stay isolated.
        shutdownVlcSession();
        jest.clearAllTimers();
        jest.useRealTimers();
        consoleErrorSpy.mockRestore();
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    describe('buildVlcEnqueueCommands', () => {
        it('builds clear/add/seek commands with all input options', () => {
            expect(
                buildVlcEnqueueCommands({
                    url: 'http://srv/1',
                    title: 'My Title',
                    userAgent: 'UA/1.0',
                    referer: 'https://ref.example',
                    headers: { 'X-A': ' padded ', 'X-Empty': '  ' },
                    startTime: 12.7,
                })
            ).toEqual([
                'clear',
                'add http://srv/1 :http-user-agent=UA/1.0 ' +
                    ':http-referrer=https://ref.example ' +
                    ':http-header=X-A: padded :meta-title=My Title',
                'seek 12',
            ]);
        });

        it('falls back to origin as referrer and omits empty options', () => {
            expect(
                buildVlcEnqueueCommands({
                    url: 'http://srv/2',
                    origin: 'https://origin.example',
                })
            ).toEqual([
                'clear',
                'add http://srv/2 :http-referrer=https://origin.example ' +
                    ':http-header=Origin: https://origin.example',
            ]);
            expect(buildVlcEnqueueCommands({ url: 'http://srv/3' })).toEqual([
                'clear',
                'add http://srv/3',
            ]);
        });

        it('does not duplicate an Origin already present in the headers map', () => {
            expect(
                buildVlcEnqueueCommands({
                    url: 'http://srv/4',
                    referer: 'https://ref.example',
                    origin: 'https://origin.example',
                    headers: { Origin: 'https://explicit.example' },
                })
            ).toEqual([
                'clear',
                'add http://srv/4 :http-referrer=https://ref.example ' +
                    ':http-header=Origin: https://explicit.example',
            ]);
        });
    });

    describe('RC response parsing', () => {
        it('extracts numeric RC responses', () => {
            expect(parseVlcRcNumericResponse('status change: > 123')).toBe(
                '123'
            );
            expect(parseVlcRcNumericResponse('> -4.5')).toBe('-4.5');
            expect(parseVlcRcNumericResponse('no prompt here')).toBe('');
        });

        it('extracts the playback state', () => {
            expect(parseVlcRcPlaybackState('( state Stopped )')).toBe(
                'stopped'
            );
            expect(parseVlcRcPlaybackState('garbage')).toBeNull();
        });
    });

    describe('openVlcPlayer launch args', () => {
        it.each(['error', 'exit'])(
            'preserves data containing --rc-quiet during an RC retry (%s)',
            async (event) => {
                Object.defineProperty(process, 'platform', { value: 'win32' });
                mockStoreValues({
                    [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                    [VLC_REUSE_INSTANCE]: true,
                    [VLC_PLAYER_ARGUMENTS]: '--fullscreen\n--rc-quiet',
                });
                const proc = createMockChildProcess();
                const retryProc = createMockChildProcess();
                spawnMock
                    .mockReturnValueOnce(proc)
                    .mockReturnValueOnce(retryProc);
                const url = `${streamUrl}?option=--rc-quiet`;
                const openPromise = openVlcPlayer({
                    title: 'Movie --rc-quiet',
                    url,
                    userAgent: 'Agent --rc-quiet',
                });
                await waitForSpawnCallCount(1);
                proc.emit('spawn');
                await openPromise;
                proc.emit(event, event === 'exit' ? 1 : new Error('RC failed'));
                await waitForSpawnCallCount(2);

                expect(spawnMock.mock.lastCall[1]).toEqual([
                    '--fullscreen',
                    // Custom arguments are preserved; only the managed flag goes.
                    '--rc-quiet',
                    ':http-user-agent=Agent --rc-quiet',
                    url,
                    ':meta-title=Movie --rc-quiet',
                ]);
                retryProc.emit('spawn');
                retryProc.emit('exit', 0);
            }
        );

        it.each(['win32', 'darwin', 'linux'] as const)(
            'adds quiet mode only for managed Windows RC launches (%s)',
            async (platform) => {
                Object.defineProperty(process, 'platform', { value: platform });
                for (const reuseInstance of [false, true]) {
                    mockStoreValues({
                        [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                        [VLC_REUSE_INSTANCE]: reuseInstance,
                    });
                    const proc = createMockChildProcess();
                    spawnMock.mockReturnValueOnce(proc);
                    const openPromise = openVlcPlayer({
                        title: 'RC Stream',
                        url: streamUrl,
                        // Exercise progress-only and reuse-only RC separately.
                        ...(!reuseInstance && {
                            contentInfo: {
                                playlistId: 'playlist',
                                contentXtreamId: 1,
                                contentType: 'vod' as const,
                            },
                        }),
                    });
                    await waitForSpawnCallCount(reuseInstance ? 2 : 1);
                    proc.emit('spawn');
                    await openPromise;

                    expect(spawnMock.mock.lastCall[1]).toEqual([
                        '--extraintf=rc',
                        '--rc-host=127.0.0.1:43210',
                        ...(platform === 'win32' ? ['--rc-quiet'] : []),
                        streamUrl,
                        ':meta-title=RC Stream',
                    ]);
                    expect(spawnMock.mock.lastCall[2].detached).toBe(
                        !reuseInstance
                    );
                    proc.emit('exit', 0);
                }
            }
        );

        it.each(['--rc-quiet', '--no-rc-quiet'])(
            'keeps custom arguments before managed quiet mode (%s)',
            async (customQuiet) => {
                Object.defineProperty(process, 'platform', { value: 'win32' });
                mockStoreValues({
                    [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                    [VLC_REUSE_INSTANCE]: true,
                    [VLC_PLAYER_ARGUMENTS]: `--fullscreen\n${customQuiet}`,
                });
                const proc = createMockChildProcess();
                spawnMock.mockReturnValueOnce(proc);
                const openPromise = openVlcPlayer({
                    title: 'Custom',
                    url: streamUrl,
                });
                await waitForSpawnCallCount(1);
                proc.emit('spawn');
                await openPromise;

                expect(spawnMock.mock.lastCall[1]).toEqual([
                    '--fullscreen',
                    customQuiet,
                    '--extraintf=rc',
                    '--rc-host=127.0.0.1:43210',
                    '--rc-quiet',
                    streamUrl,
                    ':meta-title=Custom',
                ]);
                proc.emit('exit', 0);
            }
        );

        it.each([false, true])(
            'does not add quiet mode without an RC port (reuse: %s)',
            async (reuseInstance) => {
                Object.defineProperty(process, 'platform', { value: 'win32' });
                mockStoreValues({
                    [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                    [VLC_REUSE_INSTANCE]: reuseInstance,
                });
                (createServer as unknown as jest.Mock).mockImplementation(
                    () => {
                        throw new Error('No free port');
                    }
                );
                const proc = createMockChildProcess();
                spawnMock.mockReturnValueOnce(proc);
                const openPromise = openVlcPlayer({
                    title: 'No RC',
                    url: streamUrl,
                });
                await waitForSpawnCallCount(1);
                proc.emit('spawn');
                await openPromise;

                expect(spawnMock.mock.lastCall[1]).toEqual([
                    streamUrl,
                    ':meta-title=No RC',
                ]);
                expect(createServer).toHaveBeenCalledTimes(
                    reuseInstance ? 1 : 0
                );
            }
        );

        it('spawns a detached VLC process with http options and start time', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);

            const openPromise = openVlcPlayer({
                title: 'My Stream',
                url: streamUrl,
                userAgent: 'UA/1.0',
                referer: 'https://ref.example/page',
                headers: { 'X-Test': 'yes' },
                startTime: 90,
            });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            const session = await openPromise;

            expect(spawnMock).toHaveBeenCalledWith(
                '/usr/bin/vlc',
                [
                    ':http-user-agent=UA/1.0',
                    ':http-referrer=https://ref.example/page',
                    ':http-header=X-Test: yes',
                    '--start-time=90',
                    streamUrl,
                    ':meta-title=My Stream',
                ],
                { shell: false, detached: true, stdio: 'ignore' }
            );
            expect(proc.unref).toHaveBeenCalled();
            expect(session.status).toBe('opened');
        });

        it('uses the origin as referrer fallback and sends it as a real header', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);

            const openPromise = openVlcPlayer({
                title: 'Origin Stream',
                url: streamUrl,
                origin: 'https://origin.example',
            });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            await openPromise;

            expect(spawnMock.mock.calls[0][1]).toEqual([
                ':http-referrer=https://origin.example',
                ':http-header=Origin: https://origin.example',
                streamUrl,
                ':meta-title=Origin Stream',
            ]);
        });

        it('adds the RC interface and tracks the process when reuse is enabled', async () => {
            mockStoreValues({
                [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                [VLC_REUSE_INSTANCE]: true,
            });
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);

            const openPromise = openVlcPlayer({
                title: 'First',
                url: streamUrl,
            });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            await openPromise;

            expect(spawnMock.mock.calls[0][1]).toEqual([
                '--extraintf=rc',
                '--rc-host=127.0.0.1:43210',
                streamUrl,
                ':meta-title=First',
            ]);
            expect(spawnMock.mock.calls[0][2]).toEqual({
                shell: false,
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            expect(proc.unref).not.toHaveBeenCalled();
        });
    });
});
