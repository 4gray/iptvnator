/**
 * Instance reuse, process exit, and spawn-error coverage for the VLC session
 * service. Pure helpers and launch-argument construction live in
 * `vlc-session.service.spec.ts`.
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
import { createConnection, createServer } from 'net';
import {
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import { externalPlayerSessions } from './external-player-runtime';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import { openVlcPlayer, shutdownVlcSession } from './vlc-session.service';

const originalPlatform = process.platform;
const spawnMock = spawn as unknown as jest.Mock;
const streamUrl = 'https://example.com/stream.m3u8';
const rcWrites: string[] = [];

function createMockChildProcess(): ChildProcess {
    return Object.assign(new EventEmitter(), {
        exitCode: null,
        killed: false,
        kill: jest.fn(() => true),
        signalCode: null,
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

function installRcSocketMock(behavior: 'ack' | 'error'): void {
    (createConnection as unknown as jest.Mock).mockImplementation(() => {
        const socket = Object.assign(new EventEmitter(), {
            destroyed: false,
            write: jest.fn((data: string) => {
                rcWrites.push(data);
                setImmediate(() => socket.emit('data', Buffer.from('> ')));
                return true;
            }),
            destroy: jest.fn(() => {
                socket.destroyed = true;
            }),
        });
        setImmediate(() => {
            if (behavior === 'error') {
                socket.emit('error', new Error('rc connect failed'));
            } else {
                socket.emit('connect');
            }
        });
        return socket;
    });
}

async function openTrackedVlcInstance(proc: ChildProcess): Promise<void> {
    spawnMock.mockReturnValueOnce(proc);
    const openPromise = openVlcPlayer({ title: 'First', url: streamUrl });
    await waitForSpawnCallCount(1);
    proc.emit('spawn');
    await openPromise;
}

describe('vlc-session.service process lifecycle', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        rcWrites.length = 0;
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
        consoleErrorSpy.mockRestore();
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    describe('instance reuse', () => {
        beforeEach(() => {
            mockStoreValues({
                [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                [VLC_REUSE_INSTANCE]: true,
            });
        });

        it('reuses the tracked VLC instance through RC commands', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            installRcSocketMock('ack');

            const session = await openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
                referer: 'https://ref.example',
            });

            expect(spawnMock).toHaveBeenCalledTimes(1);
            expect(rcWrites).toEqual([
                'clear\n',
                'add https://example.com/two.m3u8 ' +
                    ':http-referrer=https://ref.example :meta-title=Second\n',
            ]);
            expect(session.status).toBe('opened');
        });

        it('quits a reused VLC process and waits for its exact exit on close', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            installRcSocketMock('ack');
            const session = await openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            rcWrites.length = 0;

            let closeSettled = false;
            const closePromise = externalPlayerSessions
                .closeSession(session.id)
                .then((closed) => {
                    closeSettled = true;
                    return closed;
                });
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(rcWrites).toEqual(['quit\n']);
            expect(closeSettled).toBe(false);

            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);

            await expect(closePromise).resolves.toMatchObject({
                id: session.id,
                status: 'closed',
            });
        });

        it('guards reused VLC teardown while its protocol quit is pending', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            const sockets: EventEmitter[] = [];
            (createConnection as unknown as jest.Mock).mockImplementation(
                () => {
                    const socket = Object.assign(new EventEmitter(), {
                        destroyed: false,
                        write: jest.fn((data: string) => {
                            if (data !== 'quit\n') {
                                setImmediate(() =>
                                    socket.emit('data', Buffer.from('> '))
                                );
                            }
                            return true;
                        }),
                        destroy: jest.fn(() => {
                            socket.destroyed = true;
                        }),
                    });
                    sockets.push(socket);
                    setImmediate(() => socket.emit('connect'));
                    return socket;
                }
            );
            const session = await openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            const closing = externalPlayerSessions.closeSession(session.id);

            try {
                expect(() =>
                    externalPlayerProcessTeardownGate.assertLaunchAllowed()
                ).toThrow('previous external player is still shutting down');
            } finally {
                while (sockets.length === 0) {
                    await Promise.resolve();
                }
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                sockets.at(-1)?.emit('data', Buffer.from('> '));
                proc.emit('exit', 0);
                await closing;
            }
        });

        it('guards a VLC content session while Stop flushes its position', async () => {
            const proc = createMockChildProcess();
            (proc.kill as jest.Mock).mockImplementation(() => {
                setImmediate(() => {
                    Object.defineProperty(proc, 'exitCode', { value: 0 });
                    proc.emit('exit', 0);
                });
                return true;
            });
            spawnMock.mockReturnValueOnce(proc);
            const opening = openVlcPlayer({
                title: 'Movie',
                url: streamUrl,
                contentInfo: {
                    playlistId: 'playlist-1',
                    contentXtreamId: 1,
                    contentType: 'vod',
                },
            });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            const session = await opening;

            const sockets: EventEmitter[] = [];
            (createConnection as unknown as jest.Mock).mockImplementation(
                () => {
                    const socket = Object.assign(new EventEmitter(), {
                        destroyed: false,
                        write: jest.fn((data: string) => {
                            rcWrites.push(data);
                            return true;
                        }),
                        destroy: jest.fn(() => {
                            socket.destroyed = true;
                        }),
                    });
                    sockets.push(socket);
                    setImmediate(() => socket.emit('connect'));
                    return socket;
                }
            );

            const closing = externalPlayerSessions.closeSession(session.id);
            while (!rcWrites.includes('get_time\n')) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            try {
                expect(() =>
                    externalPlayerProcessTeardownGate.assertLaunchAllowed()
                ).toThrow('previous external player is still shutting down');
            } finally {
                sockets[0].emit('data', Buffer.from('> 12'));
                while (sockets.length < 2) {
                    await new Promise<void>((resolve) =>
                        setImmediate(resolve)
                    );
                }
                sockets[1].emit('data', Buffer.from('> 120'));
                await closing;
            }
        });

        it('does not spawn a replacement when Stop interrupts a reuse command', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            const sockets: EventEmitter[] = [];
            (createConnection as unknown as jest.Mock).mockImplementation(
                () => {
                    const socket = Object.assign(new EventEmitter(), {
                        destroyed: false,
                        write: jest.fn((data: string) => {
                            rcWrites.push(data);
                            if (data !== 'clear\n') {
                                setImmediate(() =>
                                    socket.emit('data', Buffer.from('> '))
                                );
                            }
                            return true;
                        }),
                        destroy: jest.fn(() => {
                            socket.destroyed = true;
                        }),
                    });
                    sockets.push(socket);
                    setImmediate(() => socket.emit('connect'));
                    return socket;
                }
            );
            const opening = openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            const replacementId =
                externalPlayerSessions.getActiveSessionId() as string;
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(rcWrites).toEqual(['clear\n']);

            const closing = externalPlayerSessions.closeSession(replacementId);
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(rcWrites).toEqual(['clear\n', 'quit\n']);

            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            sockets[0].emit('error', new Error('connection closed'));
            await new Promise<void>((resolve) => setImmediate(resolve));

            await expect(closing).resolves.toMatchObject({
                id: replacementId,
                status: 'closed',
            });
            await expect(opening).resolves.toMatchObject({
                id: replacementId,
                status: 'closed',
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        });

        it('does not enqueue reused VLC content after Stop interrupts clear', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            const sockets: EventEmitter[] = [];
            (createConnection as unknown as jest.Mock).mockImplementation(
                () => {
                    const socket = Object.assign(new EventEmitter(), {
                        destroyed: false,
                        write: jest.fn((data: string) => {
                            rcWrites.push(data);
                            if (data === 'quit\n') {
                                setImmediate(() =>
                                    socket.emit('data', Buffer.from('> '))
                                );
                            }
                            return true;
                        }),
                        destroy: jest.fn(() => {
                            socket.destroyed = true;
                        }),
                    });
                    sockets.push(socket);
                    setImmediate(() => socket.emit('connect'));
                    return socket;
                }
            );

            const opening = openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            const replacementId =
                externalPlayerSessions.getActiveSessionId() as string;
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(rcWrites).toEqual(['clear\n']);

            const closing = externalPlayerSessions.closeSession(replacementId);
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(rcWrites).toEqual(['clear\n', 'quit\n']);

            sockets[0].emit('data', Buffer.from('> '));
            await new Promise<void>((resolve) => setImmediate(resolve));

            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            await expect(closing).resolves.toMatchObject({ status: 'closed' });
            await expect(opening).resolves.toMatchObject({ status: 'closed' });
            expect(rcWrites).toEqual(['clear\n', 'quit\n']);
            expect(spawnMock).toHaveBeenCalledTimes(1);
        });

        it('does not spawn fresh when Stop arrives during failed VLC reuse teardown', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            installRcSocketMock('error');
            spawnMock.mockReturnValue(proc);

            const opening = openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            const replacementId =
                externalPlayerSessions.getActiveSessionId() as string;
            for (
                let attempt = 0;
                attempt < 20 && !(proc.kill as jest.Mock).mock.calls.length;
                attempt += 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            expect(proc.kill).toHaveBeenCalledTimes(1);

            const closing = externalPlayerSessions.closeSession(replacementId);
            await new Promise<void>((resolve) => setImmediate(resolve));
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            setImmediate(() => proc.emit('spawn'));

            await expect(closing).resolves.toMatchObject({ status: 'closed' });
            await expect(opening).resolves.toMatchObject({
                id: replacementId,
                status: 'closed',
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        });

        it('does not spawn fresh when Stop arrives during fallback port allocation', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            (proc.kill as jest.Mock).mockImplementation(() => {
                setImmediate(() => {
                    Object.defineProperty(proc, 'exitCode', { value: 0 });
                    proc.emit('exit', 0);
                });
                return true;
            });
            let releaseClose: (() => void) | undefined;
            (createConnection as unknown as jest.Mock)
                .mockImplementationOnce(() => {
                    const socket = Object.assign(new EventEmitter(), {
                        destroyed: false,
                        write: jest.fn(),
                        destroy: jest.fn(() => {
                            socket.destroyed = true;
                        }),
                    });
                    setImmediate(() =>
                        socket.emit('error', new Error('rc connect failed'))
                    );
                    return socket;
                })
                .mockImplementationOnce(() => {
                    const socket = Object.assign(new EventEmitter(), {
                        destroyed: false,
                        write: jest.fn((data: string) => {
                            rcWrites.push(data);
                            return true;
                        }),
                        destroy: jest.fn(() => {
                            socket.destroyed = true;
                        }),
                    });
                    releaseClose = () => socket.emit('data', Buffer.from('> '));
                    setImmediate(() => socket.emit('connect'));
                    return socket;
                });
            let releasePort: (() => void) | undefined;
            (createServer as unknown as jest.Mock).mockImplementationOnce(
                () => ({
                    unref: jest.fn(),
                    on: jest.fn(),
                    listen: (
                        _port: number,
                        _host: string,
                        cb: () => void
                    ) => {
                        releasePort = cb;
                    },
                    address: () => ({ port: 43211 }),
                    close: (cb?: () => void) => cb?.(),
                })
            );
            spawnMock.mockReturnValue(proc);

            const opening = openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            const replacementId =
                externalPlayerSessions.getActiveSessionId() as string;
            for (
                let attempt = 0;
                attempt < 20 && !releasePort;
                attempt += 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            expect(releasePort).toBeDefined();

            const closing = externalPlayerSessions.closeSession(replacementId);
            for (
                let attempt = 0;
                attempt < 20 && !releaseClose;
                attempt += 1
            ) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            expect(releaseClose).toBeDefined();

            // Resume the pending launch while Stop is still awaiting the old
            // reuse closer. It must observe that cancellation instead of
            // attaching a fresh child to the same session.
            releasePort?.();
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(spawnMock).toHaveBeenCalledTimes(1);

            releaseClose?.();

            await expect(closing).resolves.toMatchObject({ status: 'closed' });
            await expect(opening).resolves.toMatchObject({
                id: replacementId,
                status: 'closed',
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        });

        it('kills the stale instance and spawns fresh when RC reuse fails', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            installRcSocketMock('error');

            const freshProc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(freshProc);
            const openPromise = openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(proc.kill).toHaveBeenCalledTimes(1);
            expect(spawnMock).toHaveBeenCalledTimes(1);

            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            await waitForSpawnCallCount(2);
            freshProc.emit('spawn');
            const session = await openPromise;

            expect(spawnMock).toHaveBeenCalledTimes(2);
            expect(session.status).toBe('opened');
        });

        it('keeps the fallback VLC session live after partial reuse failure', async () => {
            const reusedProc = createMockChildProcess();
            await openTrackedVlcInstance(reusedProc);
            (reusedProc.kill as jest.Mock).mockImplementation(() => {
                setImmediate(() => {
                    Object.defineProperty(reusedProc, 'exitCode', { value: 0 });
                    reusedProc.emit('exit', 0);
                });
                return true;
            });
            let connectionCount = 0;
            (createConnection as unknown as jest.Mock).mockImplementation(
                () => {
                    connectionCount += 1;
                    const socket = Object.assign(new EventEmitter(), {
                        destroyed: false,
                        write: jest.fn(() => {
                            setImmediate(() =>
                                socket.emit('data', Buffer.from('> '))
                            );
                            return true;
                        }),
                        destroy: jest.fn(() => {
                            socket.destroyed = true;
                        }),
                    });
                    setImmediate(() => {
                        if (connectionCount <= 2) {
                            socket.emit('connect');
                        } else {
                            socket.emit('error', new Error('seek failed'));
                        }
                    });
                    return socket;
                }
            );
            const freshProc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(freshProc);

            const opening = openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
                startTime: 120,
            });
            await waitForSpawnCallCount(2);
            freshProc.emit('spawn');
            const session = await opening;

            expect(spawnMock).toHaveBeenCalledTimes(2);
            expect(session.status).toBe('opened');
            expect(externalPlayerSessions.getSession(session.id)?.status).toBe(
                'opened'
            );
        });

        it('restores the globally displaced session when reusable VLC teardown is unconfirmed', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            const displaced = externalPlayerSessions.beginSession({
                player: 'mpv',
                title: 'Current MPV stream',
                streamUrl: 'https://example.com/current-mpv.m3u8',
            });
            externalPlayerSessions.attachCloser(displaced.id, jest.fn());
            externalPlayerSessions.markOpened(displaced.id);
            installRcSocketMock('error');

            jest.useFakeTimers();
            try {
                const opening = openVlcPlayer({
                    title: 'Second',
                    url: 'https://example.com/two.m3u8',
                });
                const rejection = expect(opening).rejects.toThrow(
                    'External player process did not exit'
                );

                for (
                    let attempt = 0;
                    attempt < 5 && !(proc.kill as jest.Mock).mock.calls.length;
                    attempt += 1
                ) {
                    await jest.runOnlyPendingTimersAsync();
                }
                expect(proc.kill).toHaveBeenCalledTimes(1);
                await jest.advanceTimersByTimeAsync(5_000);
                await rejection;

                expect(externalPlayerSessions.getActiveSessionId()).toBe(
                    displaced.id
                );
                expect(
                    externalPlayerSessions.getSession(displaced.id)
                ).toMatchObject({ status: 'opened', canClose: true });
                expect(spawnMock).toHaveBeenCalledTimes(1);
            } finally {
                jest.useRealTimers();
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
            }
        });

        it('keeps an orphaned reusable VLC teardown failure closable when the displaced session is terminal', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            const previousId =
                externalPlayerSessions.getActiveSessionId() as string;
            externalPlayerSessions.markError(previousId, 'Old terminal error');
            installRcSocketMock('error');

            jest.useFakeTimers();
            try {
                const opening = openVlcPlayer({
                    title: 'Second',
                    url: 'https://example.com/two.m3u8',
                });
                const replacementId =
                    externalPlayerSessions.getActiveSessionId() as string;
                const rejection = expect(opening).rejects.toThrow(
                    'External player process did not exit'
                );

                for (
                    let attempt = 0;
                    attempt < 5 && !(proc.kill as jest.Mock).mock.calls.length;
                    attempt += 1
                ) {
                    await jest.runOnlyPendingTimersAsync();
                }
                expect(proc.kill).toHaveBeenCalledTimes(1);
                await jest.advanceTimersByTimeAsync(5_000);
                await rejection;

                expect(
                    externalPlayerSessions.getSession(replacementId)
                ).toMatchObject({
                    title: 'Second',
                    status: 'error',
                    canClose: true,
                });
            } finally {
                jest.useRealTimers();
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
            }
        });

        it('keeps replacement ownership when reused VLC content changed before teardown failed', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            const previousId = externalPlayerSessions.getActiveSessionId();
            let connectionCount = 0;
            (createConnection as unknown as jest.Mock).mockImplementation(
                () => {
                    connectionCount += 1;
                    const socket = Object.assign(new EventEmitter(), {
                        destroyed: false,
                        write: jest.fn(() => {
                            setImmediate(() =>
                                socket.emit('data', Buffer.from('> '))
                            );
                            return true;
                        }),
                        destroy: jest.fn(() => {
                            socket.destroyed = true;
                        }),
                    });
                    setImmediate(() => {
                        if (connectionCount <= 2) {
                            socket.emit('connect');
                        } else {
                            socket.emit('error', new Error('seek failed'));
                        }
                    });
                    return socket;
                }
            );

            jest.useFakeTimers();
            try {
                const opening = openVlcPlayer({
                    title: 'Second',
                    url: 'https://example.com/two.m3u8',
                    startTime: 120,
                });
                const replacementId =
                    externalPlayerSessions.getActiveSessionId();
                const rejection = expect(opening).rejects.toThrow(
                    'External player process did not exit'
                );

                for (
                    let attempt = 0;
                    attempt < 5 && !(proc.kill as jest.Mock).mock.calls.length;
                    attempt += 1
                ) {
                    await jest.runOnlyPendingTimersAsync();
                }
                expect(proc.kill).toHaveBeenCalledTimes(1);
                await jest.advanceTimersByTimeAsync(5_000);
                await rejection;

                expect(replacementId).not.toBe(previousId);
                expect(externalPlayerSessions.getActiveSessionId()).toBe(
                    replacementId
                );
                expect(
                    externalPlayerSessions.getSession(replacementId as string)
                ).toMatchObject({
                    title: 'Second',
                    status: 'error',
                    canClose: true,
                });

                Object.defineProperty(proc, 'killed', { value: true });
                await expect(
                    openVlcPlayer({
                        title: 'Third',
                        url: 'https://example.com/three.m3u8',
                    })
                ).rejects.toThrow(
                    'previous external player is still shutting down'
                );
                expect(spawnMock).toHaveBeenCalledTimes(1);
            } finally {
                jest.useRealTimers();
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
            }
        });

        it('does not let a stale reusable VLC closer stop the remapped session', async () => {
            const proc = createMockChildProcess();
            (proc.kill as jest.Mock).mockImplementation(() => {
                Object.defineProperty(proc, 'exitCode', {
                    value: 0,
                    configurable: true,
                });
                proc.emit('exit', 0);
                return true;
            });
            await openTrackedVlcInstance(proc);
            const previousId = externalPlayerSessions.getActiveSessionId();
            installRcSocketMock('ack');
            const current = await openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            (proc.kill as jest.Mock).mockClear();

            await expect(
                externalPlayerSessions.closeSession(previousId as string)
            ).resolves.toMatchObject({ status: 'closed' });

            expect(proc.kill).not.toHaveBeenCalled();
            expect(externalPlayerSessions.getSession(current.id)).toMatchObject(
                { status: 'opened', canClose: true }
            );
        });

        it('does not send a stale quit after a closed reused session is replaced', async () => {
            const firstProc = createMockChildProcess();
            const nextProc = createMockChildProcess();
            await openTrackedVlcInstance(firstProc);
            installRcSocketMock('ack');
            const reused = await openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });

            spawnMock.mockReturnValueOnce(nextProc);
            Object.defineProperty(firstProc, 'exitCode', { value: 0 });
            firstProc.emit('exit', 0);
            const opening = openVlcPlayer({
                title: 'Third',
                url: 'https://example.com/three.m3u8',
            });
            await waitForSpawnCallCount(2);
            nextProc.emit('spawn');
            const current = await opening;
            rcWrites.length = 0;

            await expect(
                externalPlayerSessions.closeSession(reused.id)
            ).resolves.toMatchObject({ status: 'closed' });

            expect(rcWrites).toEqual([]);
            expect(nextProc.kill).not.toHaveBeenCalled();
            expect(externalPlayerSessions.getSession(current.id)).toMatchObject(
                { status: 'opened', canClose: true }
            );
        });

        it('allows Stop to retry a reused VLC teardown after confirmation times out', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            installRcSocketMock('ack');
            const reused = await openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            installRcSocketMock('error');

            jest.useFakeTimers();
            try {
                const firstClose = externalPlayerSessions.closeSession(
                    reused.id
                );
                const firstRejection = expect(firstClose).rejects.toThrow(
                    'External player process did not exit'
                );
                await jest.advanceTimersByTimeAsync(5_000);
                await firstRejection;
                const killsAfterFirstAttempt = (proc.kill as jest.Mock).mock
                    .calls.length;

                const retry = externalPlayerSessions.closeSession(reused.id);
                await jest.advanceTimersByTimeAsync(0);
                expect(
                    (proc.kill as jest.Mock).mock.calls.length
                ).toBeGreaterThan(killsAfterFirstAttempt);
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);

                await expect(retry).resolves.toMatchObject({
                    status: 'closed',
                });
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('process exit handling', () => {
        it('keeps a reused-mode VLC child closable when RC port allocation fails', async () => {
            mockStoreValues({
                [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                [VLC_REUSE_INSTANCE]: true,
            });
            let rejectPort: ((error: Error) => void) | undefined;
            (createServer as unknown as jest.Mock).mockImplementation(() => ({
                unref: jest.fn(),
                on: jest.fn((event: string, listener: (error: Error) => void) => {
                    if (event === 'error') rejectPort = listener;
                }),
                listen: () =>
                    setImmediate(() =>
                        rejectPort?.(new Error('port allocation failed'))
                    ),
                address: () => null,
                close: jest.fn(),
            }));
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);

            const opening = openVlcPlayer({ title: 'Fallback', url: streamUrl });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            const session = await opening;

            const closing = externalPlayerSessions.closeSession(session.id);
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(proc.kill).toHaveBeenCalledTimes(1);
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            await expect(closing).resolves.toMatchObject({ status: 'closed' });
        });

        it('rechecks teardown immediately before a delayed spawn', async () => {
            let releasePort: (() => void) | undefined;
            (createServer as unknown as jest.Mock).mockImplementation(() => ({
                unref: jest.fn(),
                on: jest.fn(),
                listen: (_port: number, _host: string, cb: () => void) => {
                    releasePort = cb;
                },
                address: () => ({ port: 43210 }),
                close: (cb?: () => void) => cb?.(),
            }));
            const opening = openVlcPlayer({
                title: 'Delayed',
                url: streamUrl,
                contentInfo: {
                    playlistId: 'playlist-1',
                    contentXtreamId: 1,
                    contentType: 'vod',
                },
            });
            while (!releasePort) {
                await Promise.resolve();
            }

            const blocker = createMockChildProcess();
            const unexpected = createMockChildProcess();
            spawnMock.mockReturnValueOnce(unexpected);
            try {
                externalPlayerProcessTeardownGate.terminateInBackground(
                    blocker
                );
                releasePort();
                setImmediate(() => unexpected.emit('spawn'));

                await expect(opening).rejects.toThrow(
                    'previous external player is still shutting down'
                );
                expect(spawnMock).not.toHaveBeenCalled();
            } finally {
                Object.defineProperty(blocker, 'exitCode', { value: 0 });
                blocker.emit('exit', 0);
                Object.defineProperty(unexpected, 'exitCode', { value: 0 });
                unexpected.emit('exit', 0);
                // The fixed path never consumes the one-shot spawn result;
                // do not let it leak into the next lifecycle case.
                spawnMock.mockReset();
            }
        });

        it('settles a fresh VLC launch when Stop wins before spawn', async () => {
            const proc = createMockChildProcess();
            (proc.kill as jest.Mock).mockImplementation(() => {
                Object.defineProperty(proc, 'killed', { value: true });
                setImmediate(() => {
                    Object.defineProperty(proc, 'exitCode', { value: 0 });
                    proc.emit('exit', 0);
                });
                return true;
            });
            spawnMock.mockReturnValueOnce(proc);

            const opening = openVlcPlayer({ title: 'S', url: streamUrl });
            await waitForSpawnCallCount(1);
            const sessionId =
                externalPlayerSessions.getActiveSessionId() as string;
            const closing = externalPlayerSessions.closeSession(sessionId);

            await expect(closing).resolves.toMatchObject({ status: 'closed' });

            await expect(opening).resolves.toMatchObject({
                id: sessionId,
                status: 'closed',
            });
        });

        it('settles a fresh VLC launch when bounded Stop cannot confirm exit', async () => {
            const proc = createMockChildProcess();
            try {
                (proc.kill as jest.Mock).mockImplementation(() => {
                    Object.defineProperty(proc, 'killed', {
                        value: true,
                        configurable: true,
                    });
                    return true;
                });
                spawnMock.mockReturnValueOnce(proc);

                const opening = openVlcPlayer({ title: 'S', url: streamUrl });
                await waitForSpawnCallCount(1);
                jest.useFakeTimers();
                let launchSettled = false;
                void opening.then(
                    () => {
                        launchSettled = true;
                    },
                    () => {
                        launchSettled = true;
                    }
                );
                const sessionId =
                    externalPlayerSessions.getActiveSessionId() as string;
                const closing = externalPlayerSessions.closeSession(sessionId);
                const closeRejection = expect(closing).rejects.toThrow(
                    'External player process did not exit'
                );

                await jest.advanceTimersByTimeAsync(5_000);
                await closeRejection;
                await Promise.resolve();

                expect(launchSettled).toBe(true);
                expect(
                    externalPlayerSessions.getSession(sessionId)
                ).toMatchObject({ status: 'error', canClose: true });
            } finally {
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
                jest.useRealTimers();
            }
        });

        it('allows Stop to retry a fresh VLC teardown after confirmation times out', async () => {
            const proc = createMockChildProcess();
            (proc.kill as jest.Mock).mockImplementation(() => true);
            spawnMock.mockReturnValueOnce(proc);
            const opening = openVlcPlayer({ title: 'S', url: streamUrl });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            const session = await opening;

            jest.useFakeTimers();
            try {
                const firstClose = externalPlayerSessions.closeSession(
                    session.id
                );
                const firstRejection = expect(firstClose).rejects.toThrow(
                    'External player process did not exit'
                );
                await jest.advanceTimersByTimeAsync(5_000);
                await firstRejection;
                const killsAfterFirstAttempt = (proc.kill as jest.Mock).mock
                    .calls.length;

                const retry = externalPlayerSessions.closeSession(session.id);
                await Promise.resolve();
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);

                await expect(retry).resolves.toMatchObject({
                    status: 'closed',
                });
                expect(
                    (proc.kill as jest.Mock).mock.calls.length
                ).toBeGreaterThan(killsAfterFirstAttempt);
            } finally {
                jest.useRealTimers();
            }
        });

        it('marks an opened VLC session failed when its fallback spawn is blocked', async () => {
            const initial = createMockChildProcess();
            spawnMock.mockReturnValueOnce(initial);
            const opening = openVlcPlayer({
                title: 'S',
                url: streamUrl,
                contentInfo: {
                    playlistId: 'playlist-1',
                    contentXtreamId: 1,
                    contentType: 'vod',
                },
            });
            await waitForSpawnCallCount(1);
            initial.emit('spawn');
            const session = await opening;
            const blocker = createMockChildProcess();
            externalPlayerProcessTeardownGate.terminateInBackground(blocker);

            try {
                Object.defineProperty(initial, 'exitCode', { value: 1 });
                initial.emit('exit', 1);

                expect(spawnMock).toHaveBeenCalledTimes(1);
                expect(
                    externalPlayerSessions.getSession(session.id)
                ).toMatchObject({ status: 'error', canClose: false });
            } finally {
                Object.defineProperty(blocker, 'exitCode', { value: 0 });
                blocker.emit('exit', 0);
            }
        });

        it('settles a stopped VLC launch when spawn errors then only closes', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);

            const opening = openVlcPlayer({ title: 'S', url: streamUrl });
            const sessionId =
                externalPlayerSessions.getActiveSessionId() as string;
            const closing = externalPlayerSessions.closeSession(sessionId);
            let launchResult: unknown;
            void opening.then((result) => {
                launchResult = result;
            });

            proc.emit(
                'error',
                Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
            );
            Object.defineProperty(proc, 'exitCode', { value: -2 });
            proc.emit('close', -2, null);

            await expect(closing).resolves.toMatchObject({ status: 'closed' });
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(launchResult).toMatchObject({
                id: sessionId,
                status: 'closed',
            });
        });

        it('waits for a detached VLC process to exit before closing its session', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);
            const openPromise = openVlcPlayer({ title: 'S', url: streamUrl });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            const session = await openPromise;

            let closeSettled = false;
            const closePromise = externalPlayerSessions
                .closeSession(session.id)
                .then((closed) => {
                    closeSettled = true;
                    return closed;
                });
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(proc.kill).toHaveBeenCalledTimes(1);
            expect(closeSettled).toBe(false);

            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);

            await expect(closePromise).resolves.toMatchObject({
                id: session.id,
                status: 'closed',
            });
        });

        it('marks the session closed on a clean exit', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);
            const openPromise = openVlcPlayer({ title: 'S', url: streamUrl });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            const session = await openPromise;

            proc.emit('exit', 0);
            expect(externalPlayerSessions.getSession(session.id)?.status).toBe(
                'closed'
            );
        });

        it('marks the session as errored on an unexpected exit code', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);
            const openPromise = openVlcPlayer({ title: 'S', url: streamUrl });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            const session = await openPromise;

            proc.emit('exit', 2);
            const updated = externalPlayerSessions.getSession(session.id);
            expect(updated?.status).toBe('error');
            expect(updated?.error).toContain('exit code: 2');
        });

        it('retries without the RC interface when VLC exits with code 1', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            mockStoreValues({
                [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                [VLC_REUSE_INSTANCE]: true,
            });
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            expect(spawnMock.mock.calls[0][1]).toContain('--rc-quiet');

            const retryProc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(retryProc);
            proc.emit('exit', 1);
            await waitForSpawnCallCount(2);

            const retryArgs = spawnMock.mock.calls[1][1] as string[];
            expect(retryArgs.join(' ')).not.toContain('--extraintf');
            expect(retryArgs.join(' ')).not.toContain('--rc-host');
            expect(retryArgs).not.toContain('--rc-quiet');
            // Retry processes are never tracked for reuse.
            expect(spawnMock.mock.calls[1][2]).toMatchObject({
                detached: true,
                stdio: 'ignore',
            });
            expect(retryProc.unref).toHaveBeenCalled();
        });
    });

    describe('spawn error handling', () => {
        it('rejects with an actionable error when VLC fails to start', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);
            const openPromise = openVlcPlayer({ title: 'S', url: streamUrl });
            const sessionId = externalPlayerSessions.getActiveSessionId();
            await waitForSpawnCallCount(1);

            proc.emit('error', new Error('boom'));

            await expect(openPromise).rejects.toThrow(
                "Failed to start VLC player: boom. Make sure VLC is installed and the path '/usr/bin/vlc' is correct."
            );
            expect(
                externalPlayerSessions.getSession(sessionId as string)?.status
            ).toBe('error');
        });

        it('retries without the RC interface after a start error', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            mockStoreValues({
                [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                [VLC_REUSE_INSTANCE]: true,
            });
            const proc = createMockChildProcess();
            const retryProc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc).mockReturnValueOnce(retryProc);

            const openPromise = openVlcPlayer({ title: 'S', url: streamUrl });
            await waitForSpawnCallCount(1);
            expect(spawnMock.mock.calls[0][1]).toContain('--rc-quiet');
            proc.emit('error', new Error('rc unsupported'));
            await waitForSpawnCallCount(2);

            const retryArgs = spawnMock.mock.calls[1][1] as string[];
            expect(retryArgs.join(' ')).not.toContain('--extraintf');
            expect(retryArgs.join(' ')).not.toContain('--rc-host');
            expect(retryArgs).not.toContain('--rc-quiet');
            retryProc.emit('spawn');
            const session = await openPromise;
            expect(session.status).toBe('opened');
        });
    });
});
