jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

// Passthrough by default (the VLC specs bind a real ephemeral port via
// createServer); individual tests override createConnection to capture the
// JSON IPC traffic of a reused mpv instance.
jest.mock('net', () => ({
    ...jest.requireActual('net'),
    createConnection: jest.fn((...args: unknown[]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        jest.requireActual('net').createConnection(...(args as [any]))
    ),
}));

jest.mock('../app', () => ({
    __esModule: true,
    default: {
        mainWindow: null,
    },
}));

jest.mock('../services/store.service', () => ({
    MPV_PLAYER_ARGUMENTS: 'MPV_PLAYER_ARGUMENTS',
    MPV_PLAYER_PATH: 'MPV_PLAYER_PATH',
    MPV_REUSE_INSTANCE: 'MPV_REUSE_INSTANCE',
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
import { createConnection } from 'net';
import {
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import { externalPlayerSessions } from './external-player-runtime';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import {
    openMpvPlayer,
    setMpvReuseInstance,
    shutdownMpvSession,
} from './mpv-session.service';
import {
    openVlcPlayer,
    setVlcReuseInstance,
    shutdownVlcSession,
} from './vlc-session.service';

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
        if ((spawn as unknown as jest.Mock).mock.calls.length >= count) {
            return;
        }

        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
    }

    throw new Error(`Expected ${count} player spawn calls`);
}

function mockStoreValues(values: Record<string, unknown>): void {
    (store.get as unknown as jest.Mock).mockImplementation(
        (key: string, fallback?: unknown) =>
            key in values ? values[key] : fallback
    );
}

describe('external player shutdown on app quit', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('kills the stored reusable MPV process on shutdown', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });

        await openMpvPlayer({
            title: 'Reusable MPV stream',
            url: 'https://example.com/live.m3u8',
        });

        expect(proc.kill).not.toHaveBeenCalled();

        shutdownMpvSession();

        expect(proc.kill).toHaveBeenCalledTimes(1);

        // The stored process reference is cleared, so a second shutdown
        // must not attempt another kill.
        shutdownMpvSession();
        expect(proc.kill).toHaveBeenCalledTimes(1);
    });

    it('blocks a launch until MPV exits after reuse is disabled', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'Reusable MPV stream',
            url: 'https://example.com/live.m3u8',
        });

        setMpvReuseInstance(false);

        await expect(
            openMpvPlayer({
                title: 'Replacement MPV stream',
                url: 'https://example.com/replacement.m3u8',
            })
        ).rejects.toThrow('previous external player is still shutting down');
        expect(spawn).toHaveBeenCalledTimes(1);

        Object.defineProperty(proc, 'exitCode', { value: 0 });
        proc.emit('exit', 0);
    });

    it('settles a fresh MPV launch when Stop wins before startup confirmation', async () => {
        jest.useFakeTimers();
        try {
            const proc = createMockChildProcess();
            (proc.kill as jest.Mock).mockImplementation(() => {
                Object.defineProperty(proc, 'killed', { value: true });
                setImmediate(() => {
                    Object.defineProperty(proc, 'exitCode', { value: 0 });
                    proc.emit('exit', 0);
                });
                return true;
            });
            (spawn as unknown as jest.Mock).mockReturnValue(proc);
            mockStoreValues({
                [MPV_PLAYER_PATH]: '/usr/bin/mpv',
                [MPV_REUSE_INSTANCE]: false,
            });

            const opening = openMpvPlayer({
                title: 'Stopped stream',
                url: 'https://example.com/stopped.m3u8',
            });
            const sessionId =
                externalPlayerSessions.getActiveSessionId() as string;
            const closing = externalPlayerSessions.closeSession(sessionId);

            await jest.runAllTimersAsync();
            await expect(closing).resolves.toMatchObject({ status: 'closed' });

            let launchSettled = false;
            void opening.then(() => {
                launchSettled = true;
            });
            await Promise.resolve();
            expect(launchSettled).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it('settles a fresh MPV launch when bounded Stop cannot confirm exit', async () => {
        jest.useFakeTimers();
        const proc = createMockChildProcess();
        try {
            (proc.kill as jest.Mock).mockImplementation(() => {
                Object.defineProperty(proc, 'killed', {
                    value: true,
                    configurable: true,
                });
                return true;
            });
            (spawn as unknown as jest.Mock).mockReturnValue(proc);
            mockStoreValues({
                [MPV_PLAYER_PATH]: '/usr/bin/mpv',
                [MPV_REUSE_INSTANCE]: false,
            });

            const opening = openMpvPlayer({
                title: 'Unresponsive stream',
                url: 'https://example.com/unresponsive.m3u8',
            });
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
            expect(externalPlayerSessions.getSession(sessionId)).toMatchObject({
                status: 'error',
                canClose: true,
            });
        } finally {
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            jest.useRealTimers();
        }
    });

    it('does not let a stale reusable MPV closer stop the remapped session', async () => {
        const proc = createMockChildProcess();
        (proc.kill as jest.Mock).mockImplementation(() => {
            Object.defineProperty(proc, 'exitCode', {
                value: 0,
                configurable: true,
            });
            proc.emit('exit', 0);
            return true;
        });
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        const previous = await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('connect'));
            return socket;
        });
        const current = await openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });
        (proc.kill as jest.Mock).mockClear();

        await expect(
            externalPlayerSessions.closeSession(previous.id)
        ).resolves.toMatchObject({ status: 'closed' });

        expect(proc.kill).not.toHaveBeenCalled();
        expect(externalPlayerSessions.getSession(current.id)).toMatchObject({
            status: 'opened',
            canClose: true,
        });
    });

    it('does not send a stale quit after a closed reused session is replaced', async () => {
        shutdownMpvSession();
        const firstProc = createMockChildProcess();
        const nextProc = createMockChildProcess();
        (spawn as unknown as jest.Mock)
            .mockReturnValueOnce(firstProc)
            .mockReturnValueOnce(nextProc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        const written: string[] = [];
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn((chunk: string) => written.push(chunk)),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('connect'));
            return socket;
        });
        const reused = await openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });

        Object.defineProperty(firstProc, 'exitCode', { value: 0 });
        firstProc.emit('exit', 0);
        const current = await openMpvPlayer({
            title: 'Third stream',
            url: 'https://example.com/three.m3u8',
        });
        written.length = 0;

        await expect(
            externalPlayerSessions.closeSession(reused.id)
        ).resolves.toMatchObject({ status: 'closed' });

        expect(written).toEqual([]);
        expect(nextProc.kill).not.toHaveBeenCalled();
        expect(externalPlayerSessions.getSession(current.id)).toMatchObject({
            status: 'opened',
            canClose: true,
        });

        shutdownMpvSession();
    });

    it('escapes commas in http header fields passed to mpv', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: false,
        });

        await openMpvPlayer({
            title: 'Stalker live stream',
            url: 'https://portal.example/ch/1234',
            headers: {
                'X-User-Agent':
                    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
            },
        });

        const args = (spawn as unknown as jest.Mock).mock
            .calls[0][1] as string[];
        const headerArg = args.find((arg) =>
            arg.startsWith('--http-header-fields=')
        );

        // mpv parses the option as a comma-separated list; the comma inside
        // the MAG user agent must arrive escaped or the header is truncated
        // and Stalker portals reject the stream with HTTP 400.
        expect(headerArg).toContain('(KHTML\\, like Gecko) MAG250');
        expect(headerArg).not.toContain('(KHTML, like Gecko)');
    });

    it('escapes commas in http header fields on the reused-instance IPC path', async () => {
        // Reset any reusable instance a previous test may have left behind so
        // the first launch below spawns rather than reuses.
        shutdownMpvSession();

        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });

        // First launch spawns the reusable instance and records its IPC socket.
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://portal.example/ch/1',
        });

        // Capture the JSON IPC traffic of the second, reused launch.
        const written: string[] = [];
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn((chunk: string) => written.push(chunk)),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('connect'));
            return socket;
        });

        await openMpvPlayer({
            title: 'Stalker live stream',
            url: 'https://portal.example/ch/1234',
            headers: {
                'X-User-Agent':
                    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
            },
        });

        const commands = written.map(
            (chunk) =>
                JSON.parse(chunk.trim()).command as Array<string | number>
        );
        const setHeaderFields = commands.find(
            (command) =>
                command[0] === 'set_property' &&
                command[1] === 'http-header-fields'
        );

        // The value must survive the JSON IPC transport with the mpv escape
        // intact: mpv re-parses the property as a comma-separated stringlist
        // on its side, so an unescaped comma truncates the MAG user agent.
        expect(setHeaderFields).toBeDefined();
        expect(setHeaderFields?.[2]).toContain('(KHTML\\, like Gecko) MAG250');
        expect(setHeaderFields?.[2]).not.toContain('(KHTML, like Gecko)');

        shutdownMpvSession();
    });

    it('bounds a reused MPV close when its IPC socket never connects', async () => {
        shutdownMpvSession();
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });

        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });

        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('connect'));
            return socket;
        });
        const reused = await openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });

        (createConnection as unknown as jest.Mock).mockImplementation(() =>
            Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            })
        );
        jest.useFakeTimers();
        try {
            const closing = externalPlayerSessions.closeSession(reused.id);

            await jest.advanceTimersByTimeAsync(2_000);
            expect(proc.kill).toHaveBeenCalledTimes(1);

            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            await expect(closing).resolves.toMatchObject({
                id: reused.id,
                status: 'closed',
            });
        } finally {
            jest.useRealTimers();
        }
    });

    it('allows Stop to retry a reused MPV teardown after confirmation times out', async () => {
        shutdownMpvSession();
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('connect'));
            return socket;
        });
        const reused = await openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('error', new Error('quit failed')));
            return socket;
        });

        jest.useFakeTimers();
        try {
            const firstClose = externalPlayerSessions.closeSession(reused.id);
            const firstRejection = expect(firstClose).rejects.toThrow(
                'External player process did not exit'
            );
            await jest.advanceTimersByTimeAsync(5_000);
            await firstRejection;
            const killsAfterFirstAttempt = (proc.kill as jest.Mock).mock.calls
                .length;

            const retry = externalPlayerSessions.closeSession(reused.id);
            await jest.advanceTimersByTimeAsync(0);
            expect((proc.kill as jest.Mock).mock.calls.length).toBeGreaterThan(
                killsAfterFirstAttempt
            );
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);

            await expect(retry).resolves.toMatchObject({ status: 'closed' });
        } finally {
            jest.useRealTimers();
        }
    });

    it('guards reused MPV teardown while its protocol quit is pending', async () => {
        shutdownMpvSession();
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });

        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });

        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('connect'));
            return socket;
        });
        const session = await openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });

        const sockets: EventEmitter[] = [];
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            sockets.push(socket);
            return socket;
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
            sockets[0].emit('connect');
            proc.emit('exit', 0);
            await closing;
        }
    });

    it('does not dispatch reused MPV content after Stop interrupts header setup', async () => {
        shutdownMpvSession();
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });

        const sockets: Array<
            EventEmitter & { write: jest.Mock; end: jest.Mock }
        > = [];
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            sockets.push(socket);
            if (sockets.length > 2) {
                setImmediate(() => socket.emit('connect'));
            }
            return socket;
        });

        const opening = openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
            userAgent: 'IPTVnator test agent',
        });
        while (sockets.length < 1) await Promise.resolve();
        const replacementId =
            externalPlayerSessions.getActiveSessionId() as string;
        const closing = externalPlayerSessions.closeSession(replacementId);
        while (sockets.length < 2) await Promise.resolve();

        sockets[0].emit('connect');
        await new Promise<void>((resolve) => setImmediate(resolve));

        sockets[1].emit('connect');
        Object.defineProperty(proc, 'exitCode', { value: 0 });
        proc.emit('exit', 0);
        await expect(closing).resolves.toMatchObject({ status: 'closed' });
        await expect(opening).resolves.toMatchObject({ status: 'closed' });
        const commands = sockets.flatMap((socket) =>
            socket.write.mock.calls.map(([request]) =>
                JSON.parse(String(request)).command[0]
            )
        );
        expect(commands).not.toContain('loadfile');
        expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('does not spawn a replacement when Stop interrupts reused MPV seek', async () => {
        shutdownMpvSession();
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });

        const sockets: EventEmitter[] = [];
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            sockets.push(socket);
            if (sockets.length === 1 || sockets.length === 3) {
                setImmediate(() => socket.emit('connect'));
            }
            return socket;
        });

        const opening = openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
            startTime: 120,
        });
        while (sockets.length < 2) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        const replacementId =
            externalPlayerSessions.getActiveSessionId() as string;
        const closing = externalPlayerSessions.closeSession(replacementId);
        while (sockets.length < 3) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }

        Object.defineProperty(proc, 'exitCode', { value: 0 });
        proc.emit('exit', 0);
        sockets[1].emit('error', new Error('connection closed'));

        await expect(closing).resolves.toMatchObject({
            id: replacementId,
            status: 'closed',
        });
        await expect(opening).resolves.toMatchObject({
            id: replacementId,
            status: 'closed',
        });
        expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('does not spawn fresh when Stop arrives during failed MPV reuse teardown', async () => {
        shutdownMpvSession();
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() =>
                socket.emit('error', new Error('reuse command failed'))
            );
            return socket;
        });

        const opening = openMpvPlayer({
            title: 'Second stream',
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

        await expect(closing).resolves.toMatchObject({ status: 'closed' });
        await expect(opening).resolves.toMatchObject({
            id: replacementId,
            status: 'closed',
        });
        expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('restores the globally displaced session when reusable MPV teardown is unconfirmed', async () => {
        shutdownMpvSession();
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        const displaced = externalPlayerSessions.beginSession({
            player: 'vlc',
            title: 'Current VLC stream',
            streamUrl: 'https://example.com/current-vlc.m3u8',
        });
        externalPlayerSessions.attachCloser(displaced.id, jest.fn());
        externalPlayerSessions.markOpened(displaced.id);
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() =>
                socket.emit('error', new Error('reuse command failed'))
            );
            return socket;
        });

        jest.useFakeTimers();
        try {
            const opening = openMpvPlayer({
                title: 'Second stream',
                url: 'https://example.com/two.m3u8',
            });
            const rejection = expect(opening).rejects.toThrow(
                'External player process did not exit'
            );

            for (
                let attempt = 0;
                attempt < 4 && !(proc.kill as jest.Mock).mock.calls.length;
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
            ).toMatchObject({
                status: 'opened',
                canClose: true,
            });
            expect(spawn).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
        }
    });

    it('keeps an orphaned reusable MPV teardown failure closable', async () => {
        shutdownMpvSession();
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        const previous = await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        externalPlayerSessions.markClosed(previous.id);
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() =>
                socket.emit('error', new Error('reuse command failed'))
            );
            return socket;
        });

        jest.useFakeTimers();
        try {
            const opening = openMpvPlayer({
                title: 'Second stream',
                url: 'https://example.com/two.m3u8',
            });
            const replacementId =
                externalPlayerSessions.getActiveSessionId() as string;
            const rejection = expect(opening).rejects.toThrow(
                'External player process did not exit'
            );

            for (
                let attempt = 0;
                attempt < 4 && !(proc.kill as jest.Mock).mock.calls.length;
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
                title: 'Second stream',
                status: 'error',
                canClose: true,
            });
        } finally {
            jest.useRealTimers();
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
        }
    });

    it('keeps replacement ownership when reused MPV content changed before teardown failed', async () => {
        shutdownMpvSession();
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        const previous = await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        let connectionCount = 0;
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            connectionCount += 1;
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => {
                if (connectionCount === 1) {
                    socket.emit('connect');
                } else {
                    socket.emit('error', new Error('seek failed'));
                }
            });
            return socket;
        });

        jest.useFakeTimers();
        try {
            const opening = openMpvPlayer({
                title: 'Second stream',
                url: 'https://example.com/two.m3u8',
                startTime: 120,
            });
            const replacementId = externalPlayerSessions.getActiveSessionId();
            const rejection = expect(opening).rejects.toThrow(
                'External player process did not exit'
            );

            for (
                let attempt = 0;
                attempt < 4 && !(proc.kill as jest.Mock).mock.calls.length;
                attempt += 1
            ) {
                await jest.runOnlyPendingTimersAsync();
            }
            expect(proc.kill).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(5_000);
            await rejection;

            expect(replacementId).not.toBe(previous.id);
            expect(externalPlayerSessions.getActiveSessionId()).toBe(
                replacementId
            );
            expect(
                externalPlayerSessions.getSession(replacementId as string)
            ).toMatchObject({
                title: 'Second stream',
                status: 'error',
                canClose: true,
            });

            Object.defineProperty(proc, 'killed', { value: true });
            await expect(
                openMpvPlayer({
                    title: 'Third stream',
                    url: 'https://example.com/three.m3u8',
                })
            ).rejects.toThrow(
                'previous external player is still shutting down'
            );
            expect(spawn).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
        }
    });

    it('waits for the stale reusable MPV process to exit before spawning fresh', async () => {
        shutdownMpvSession();
        const staleProc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValueOnce(staleProc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('error', new Error('stale socket')));
            return socket;
        });
        const freshProc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValueOnce(freshProc);

        const secondLaunch = openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(staleProc.kill).toHaveBeenCalledTimes(1);
        expect(spawn).toHaveBeenCalledTimes(1);

        Object.defineProperty(staleProc, 'exitCode', { value: 0 });
        staleProc.emit('exit', 0);
        await waitForSpawnCallCount(2);
        await secondLaunch;

        expect(spawn).toHaveBeenCalledTimes(2);
        shutdownMpvSession();
    });

    it('rechecks the process-wide teardown gate before fallback MPV spawn', async () => {
        shutdownMpvSession();
        const staleProc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(staleProc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('error', new Error('stale socket')));
            return socket;
        });

        const opening = openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(staleProc.kill).toHaveBeenCalledTimes(1);

        const blocker = createMockChildProcess();
        const blockerTeardown =
            externalPlayerProcessTeardownGate.terminate(blocker);
        try {
            Object.defineProperty(staleProc, 'exitCode', { value: 0 });
            staleProc.emit('exit', 0);

            await expect(opening).rejects.toThrow(
                'previous external player is still shutting down'
            );
            expect(spawn).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(blocker, 'exitCode', { value: 0 });
            blocker.emit('exit', 0);
            await blockerTeardown;
        }
    });

    it('keeps the fallback MPV session live after partial reuse failure', async () => {
        shutdownMpvSession();
        const reusedProc = createMockChildProcess();
        (reusedProc.kill as jest.Mock).mockImplementation(() => {
            setImmediate(() => {
                Object.defineProperty(reusedProc, 'exitCode', { value: 0 });
                reusedProc.emit('exit', 0);
            });
            return true;
        });
        const freshProc = createMockChildProcess();
        (spawn as unknown as jest.Mock)
            .mockReturnValueOnce(reusedProc)
            .mockReturnValueOnce(freshProc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
        });
        let connectionCount = 0;
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            connectionCount += 1;
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => {
                if (connectionCount === 1) {
                    socket.emit('connect');
                } else {
                    socket.emit('error', new Error('seek failed'));
                }
            });
            return socket;
        });

        const session = await openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
            startTime: 120,
        });

        expect(spawn).toHaveBeenCalledTimes(2);
        expect(session.status).toBe('opened');
        expect(externalPlayerSessions.getSession(session.id)?.status).toBe(
            'opened'
        );
        shutdownMpvSession();
    });

    it('does not track non-reusable MPV processes for shutdown', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: false,
        });

        await openMpvPlayer({
            title: 'Detached MPV stream',
            url: 'https://example.com/live.m3u8',
        });

        expect(proc.unref).toHaveBeenCalled();

        shutdownMpvSession();

        expect(proc.kill).not.toHaveBeenCalled();
    });

    it('waits for a detached MPV process to exit before closing its session', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: false,
        });
        const session = await openMpvPlayer({
            title: 'Detached MPV stream',
            url: 'https://example.com/live.m3u8',
        });

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

    it('kills the stored reusable VLC process on shutdown', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [VLC_PLAYER_PATH]: '/usr/bin/vlc',
            [VLC_REUSE_INSTANCE]: true,
        });

        const openPromise = openVlcPlayer({
            title: 'Reusable VLC stream',
            url: 'https://example.com/live.m3u8',
        });

        await waitForSpawnCallCount(1);
        proc.emit('spawn');
        await openPromise;

        expect(proc.kill).not.toHaveBeenCalled();

        shutdownVlcSession();

        expect(proc.kill).toHaveBeenCalledTimes(1);

        shutdownVlcSession();
        expect(proc.kill).toHaveBeenCalledTimes(1);
    });

    it('blocks a launch until VLC exits after reuse is disabled', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [VLC_PLAYER_PATH]: '/usr/bin/vlc',
            [VLC_REUSE_INSTANCE]: true,
        });
        const openPromise = openVlcPlayer({
            title: 'Reusable VLC stream',
            url: 'https://example.com/live.m3u8',
        });
        await waitForSpawnCallCount(1);
        proc.emit('spawn');
        await openPromise;

        setVlcReuseInstance(false);

        await expect(
            openVlcPlayer({
                title: 'Replacement VLC stream',
                url: 'https://example.com/replacement.m3u8',
            })
        ).rejects.toThrow('previous external player is still shutting down');
        expect(spawn).toHaveBeenCalledTimes(1);

        Object.defineProperty(proc, 'exitCode', { value: 0 });
        proc.emit('exit', 0);
    });
});
