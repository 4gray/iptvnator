/**
 * MPV launch queue: launches run one at a time, only the newest queued one
 * runs, and Stop on a queued launch delegates to the in-flight launch's and
 * the stored player's own closers. Reply handling lives in
 * `mpv-session.service.ipc-reply.spec.ts`.
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
    MPV_PLAYER_ARGUMENTS: 'MPV_PLAYER_ARGUMENTS',
    MPV_PLAYER_PATH: 'MPV_PLAYER_PATH',
    MPV_REUSE_INSTANCE: 'MPV_REUSE_INSTANCE',
    store: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));

import {
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import { externalPlayerSessions } from './external-player-runtime';
import { MPV_IPC_COMMAND_TIMEOUT_MS } from './mpv-ipc-command';
import { MpvSocketMock } from './mpv-ipc-socket.test-helpers';
import {
    openMpvPlayer,
    setMpvReuseInstance,
    shutdownMpvSession,
} from './mpv-session.service';
import {
    spawnMock,
    createMockChildProcess,
    mockMpvSockets,
    nextTick,
    launchReusableSession,
    mockUnansweredSockets,
    mockSocketsQuittingInto,
    commandsOf,
    writtenRequestId,
} from './mpv-session.test-helpers';

describe('MPV launch queue', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        shutdownMpvSession();
    });

    afterEach(() => {
        jest.useRealTimers();
        shutdownMpvSession();
    });
    it('runs a quick second launch only after the first one settles', async () => {
        const { proc } = await launchReusableSession();
        const sockets = mockUnansweredSockets();
        const commandOf = (socket: MpvSocketMock) =>
            (
                JSON.parse(String(socket.write.mock.calls[0][0])) as {
                    command: string[];
                }
            ).command[0];
        const answer = (socket: MpvSocketMock, id: number) =>
            socket.emit(
                'data',
                Buffer.from(
                    JSON.stringify({ request_id: id, error: 'success' }) + '\n'
                )
            );

        const first = openMpvPlayer({
            title: 'Channel A',
            url: 'https://example.com/a.m3u8',
        });
        const firstId = await writtenRequestId(sockets[0]);
        const second = openMpvPlayer({
            title: 'Channel B',
            url: 'https://example.com/b.m3u8',
            userAgent: 'IPTVnator test agent',
        });
        await nextTick();
        await nextTick();
        // The second launch waits in the queue: nothing else reached mpv.
        expect(sockets).toHaveLength(1);

        answer(sockets[0], firstId);
        await expect(first).resolves.toMatchObject({ status: 'opened' });
        answer(sockets[1], await writtenRequestId(sockets[1]));
        while (sockets.length < 3) await nextTick();
        answer(sockets[2], await writtenRequestId(sockets[2]));
        await expect(second).resolves.toMatchObject({ status: 'opened' });

        expect(sockets.map(commandOf)).toEqual([
            'loadfile',
            'set_property',
            'loadfile',
        ]);
        expect(proc.kill).not.toHaveBeenCalled();
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('lets Stop on a queued launch cancel it and stop the in-flight player', async () => {
        const { proc } = await launchReusableSession();
        const sockets = mockSocketsQuittingInto(proc);

        const first = openMpvPlayer({
            title: 'Channel A',
            url: 'https://example.com/a.m3u8',
        });
        await writtenRequestId(sockets[0]);
        const second = openMpvPlayer({
            title: 'Channel B',
            url: 'https://example.com/b.m3u8',
        });
        // The queued launch is already the session the dock shows and stops.
        const queuedId = externalPlayerSessions.getActiveSessionId() as string;
        expect(externalPlayerSessions.getSession(queuedId)).toMatchObject({
            title: 'Channel B',
            status: 'launching',
            canClose: true,
        });

        // Stop goes through the in-flight launch's own closer: quit, exit.
        await expect(
            externalPlayerSessions.closeSession(queuedId)
        ).resolves.toMatchObject({ id: queuedId, status: 'closed' });
        expect(proc.exitCode).toBe(0);
        // The quit player's socket closes before any reply.
        sockets[0].emit('close');

        await expect(first).resolves.toMatchObject({ status: 'closed' });
        await expect(second).resolves.toMatchObject({
            id: queuedId,
            status: 'closed',
        });
        // Nothing started playing again after Stop.
        expect(commandsOf(sockets)).toEqual(['loadfile', 'quit']);
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('lets Stop on the newest queued launch cancel every launch queued before it', async () => {
        const { proc } = await launchReusableSession();
        const sockets = mockSocketsQuittingInto(proc);

        const first = openMpvPlayer({
            title: 'Channel A',
            url: 'https://example.com/a.m3u8',
        });
        await writtenRequestId(sockets[0]);
        const second = openMpvPlayer({
            title: 'Channel B',
            url: 'https://example.com/b.m3u8',
        });
        const third = openMpvPlayer({
            title: 'Channel C',
            url: 'https://example.com/c.m3u8',
        });
        const newestId = externalPlayerSessions.getActiveSessionId() as string;

        await expect(
            externalPlayerSessions.closeSession(newestId)
        ).resolves.toMatchObject({ status: 'closed' });
        sockets[0].emit('close');

        await expect(first).resolves.toMatchObject({ status: 'closed' });
        await expect(second).resolves.toMatchObject({ status: 'closed' });
        await expect(third).resolves.toMatchObject({ status: 'closed' });
        expect(proc.exitCode).toBe(0);
        expect(commandsOf(sockets)).toEqual(['loadfile', 'quit']);
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('hands the dock back to the live player when a queued launch is blocked by its teardown', async () => {
        const { proc } = await launchReusableSession();
        // The first launch's loadfile fails and its teardown never sees the
        // child exit, so the queued launch finds the teardown gate closed.
        (proc.kill as jest.Mock).mockImplementation(() => true);
        mockMpvSockets({
            reply: (command) =>
                command[0] === 'loadfile' ? 'error running command' : 'success',
        });
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        jest.useFakeTimers();

        try {
            const first = openMpvPlayer({
                title: 'Channel A',
                url: 'https://example.com/a.m3u8',
            });
            const firstId =
                externalPlayerSessions.getActiveSessionId() as string;
            const firstRejection = expect(first).rejects.toThrow(
                'External player process did not exit'
            );
            const second = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            const secondId =
                externalPlayerSessions.getActiveSessionId() as string;
            const secondRejection = expect(second).rejects.toThrow(
                'previous external player is still shutting down'
            );

            await jest.advanceTimersByTimeAsync(6_000);
            await firstRejection;
            await secondRejection;

            // The session owning the still-running child is active again
            // and can be stopped; the blocked launch is a terminal error.
            expect(externalPlayerSessions.getActiveSessionId()).toBe(firstId);
            expect(externalPlayerSessions.getSession(firstId)).toMatchObject({
                status: 'error',
                canClose: true,
            });
            expect(externalPlayerSessions.getSession(secondId)).toMatchObject({
                status: 'error',
                canClose: false,
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        } finally {
            errorSpy.mockRestore();
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
        }
    });

    it('runs only the newest queued launch once the in-flight one settles', async () => {
        await launchReusableSession();
        const sockets = mockUnansweredSockets();
        const answer = (socket: MpvSocketMock, id: number) =>
            socket.emit(
                'data',
                Buffer.from(
                    JSON.stringify({ request_id: id, error: 'success' }) + '\n'
                )
            );

        const first = openMpvPlayer({
            title: 'Channel A',
            url: 'https://example.com/a.m3u8',
        });
        const firstId = await writtenRequestId(sockets[0]);
        const skipped = openMpvPlayer({
            title: 'Channel B',
            url: 'https://example.com/b.m3u8',
        });
        const newest = openMpvPlayer({
            title: 'Channel C',
            url: 'https://example.com/c.m3u8',
        });
        const newestId = externalPlayerSessions.getActiveSessionId();

        answer(sockets[0], firstId);
        await expect(first).resolves.toMatchObject({ status: 'opened' });
        // The skipped launch never reached mpv nor took the dock.
        await expect(skipped).resolves.toMatchObject({ status: 'closed' });
        expect(externalPlayerSessions.getActiveSessionId()).toBe(newestId);
        answer(sockets[1], await writtenRequestId(sockets[1]));
        await expect(newest).resolves.toMatchObject({
            id: newestId,
            status: 'opened',
        });
        expect(sockets).toHaveLength(2);
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('keeps a queued launch stoppable when its Stop cannot confirm the exit', async () => {
        const { proc } = await launchReusableSession();
        (proc.kill as jest.Mock).mockImplementation(() => true);
        mockUnansweredSockets();
        jest.useFakeTimers();

        try {
            const first = openMpvPlayer({
                title: 'Channel A',
                url: 'https://example.com/a.m3u8',
            });
            const queued = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            const queuedId =
                externalPlayerSessions.getActiveSessionId() as string;
            await jest.advanceTimersByTimeAsync(0);

            // Stop goes through the in-flight launch's closer: its quit gets
            // no reply, and the bounded teardown cannot confirm the exit.
            const closing = externalPlayerSessions.closeSession(queuedId);
            const closeRejection = expect(closing).rejects.toThrow(
                'External player process did not exit'
            );
            const firstRejection = expect(first).rejects.toThrow(
                'External player process did not exit'
            );
            await jest.advanceTimersByTimeAsync(10_000);
            await closeRejection;
            await firstRejection;
            await expect(queued).resolves.toMatchObject({
                id: queuedId,
                status: 'error',
                canClose: true,
            });

            // A retried Stop reaches the still-running child again.
            const killsBeforeRetry = (proc.kill as jest.Mock).mock.calls.length;
            const retry = externalPlayerSessions.closeSession(queuedId);
            await jest.advanceTimersByTimeAsync(
                MPV_IPC_COMMAND_TIMEOUT_MS + 100
            );
            expect((proc.kill as jest.Mock).mock.calls.length).toBeGreaterThan(
                killsBeforeRetry
            );
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            await expect(retry).resolves.toMatchObject({
                id: queuedId,
                status: 'closed',
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        } finally {
            if (proc.exitCode === null) {
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
            }
        }
    });

    it('lets a late Stop for an older queued launch cancel only that launch', async () => {
        const { proc } = await launchReusableSession();
        const sockets = mockUnansweredSockets();
        const answer = (socket: MpvSocketMock, id: number) =>
            socket.emit(
                'data',
                Buffer.from(
                    JSON.stringify({ request_id: id, error: 'success' }) + '\n'
                )
            );

        const first = openMpvPlayer({
            title: 'Channel A',
            url: 'https://example.com/a.m3u8',
        });
        const firstId = await writtenRequestId(sockets[0]);
        const older = openMpvPlayer({
            title: 'Channel B',
            url: 'https://example.com/b.m3u8',
        });
        const olderId = externalPlayerSessions.getActiveSessionId() as string;
        const newest = openMpvPlayer({
            title: 'Channel C',
            url: 'https://example.com/c.m3u8',
        });

        await expect(
            externalPlayerSessions.closeSession(olderId)
        ).resolves.toMatchObject({ id: olderId, status: 'closed' });
        expect(proc.kill).not.toHaveBeenCalled();

        answer(sockets[0], firstId);
        await expect(first).resolves.toMatchObject({ status: 'opened' });
        await expect(older).resolves.toMatchObject({ status: 'closed' });
        answer(sockets[1], await writtenRequestId(sockets[1]));
        await expect(newest).resolves.toMatchObject({ status: 'opened' });
        expect(commandsOf(sockets)).toEqual(['loadfile', 'loadfile']);
        expect(proc.kill).not.toHaveBeenCalled();
    });

    it('settles a fresh launch and its queued Stop when the exit cannot be confirmed', async () => {
        const proc = createMockChildProcess();
        (proc.kill as jest.Mock).mockImplementation(() => {
            Object.defineProperty(proc, 'killed', {
                value: true,
                configurable: true,
            });
            return true;
        });
        spawnMock.mockReturnValueOnce(proc);
        (store.get as unknown as jest.Mock).mockImplementation(
            (key: string, fallback?: unknown) =>
                ({
                    [MPV_PLAYER_PATH]: '/usr/bin/mpv',
                    [MPV_REUSE_INSTANCE]: true,
                })[key] ?? fallback
        );
        jest.useFakeTimers();

        try {
            // The first launch spawns fresh; the second queues during its
            // start-up confirmation window.
            const first = openMpvPlayer({
                title: 'Channel A',
                url: 'https://example.com/a.m3u8',
            });
            const queued = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            const queuedId =
                externalPlayerSessions.getActiveSessionId() as string;
            // The Stop arrives over IPC, after the first launch spawned.
            await jest.advanceTimersByTimeAsync(0);
            let firstSettled = false;
            void first.then(
                () => (firstSettled = true),
                () => (firstSettled = true)
            );
            const firstRejection = expect(first).rejects.toThrow(
                'External player process did not exit'
            );
            const closeRejection = expect(
                externalPlayerSessions.closeSession(queuedId)
            ).rejects.toThrow('External player process did not exit');

            await jest.advanceTimersByTimeAsync(6_000);
            expect(firstSettled).toBe(true);
            await firstRejection;
            await closeRejection;
            await expect(queued).resolves.toMatchObject({
                id: queuedId,
                status: 'error',
                canClose: true,
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
        }
    });

    it('never lets a retried queued Stop reach a player started later', async () => {
        const { proc } = await launchReusableSession();
        (proc.kill as jest.Mock).mockImplementation(() => true);
        const sockets = mockUnansweredSockets();
        jest.useFakeTimers();
        const later = createMockChildProcess();

        try {
            const first = openMpvPlayer({
                title: 'Channel A',
                url: 'https://example.com/a.m3u8',
            });
            const queued = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            const queuedId =
                externalPlayerSessions.getActiveSessionId() as string;
            // The Stop arrives after the first launch wrote its loadfile.
            while (!sockets[0]?.write.mock.calls.length) {
                await jest.advanceTimersByTimeAsync(0);
            }
            const firstRejection = expect(first).rejects.toThrow(
                'External player process did not exit'
            );
            const closeRejection = expect(
                externalPlayerSessions.closeSession(queuedId)
            ).rejects.toThrow('External player process did not exit');
            await jest.advanceTimersByTimeAsync(10_000);
            await firstRejection;
            await closeRejection;
            await expect(queued).resolves.toMatchObject({ status: 'error' });

            // The stuck child exits on its own and a new stream starts.
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            spawnMock.mockReturnValueOnce(later);
            const next = openMpvPlayer({
                title: 'Channel C',
                url: 'https://example.com/c.m3u8',
            });
            await jest.advanceTimersByTimeAsync(100);
            await expect(next).resolves.toMatchObject({ status: 'opened' });

            // A retried Stop for the old queued launch stays on its own
            // targets and leaves the new player alone.
            const retry = externalPlayerSessions.closeSession(queuedId);
            await jest.advanceTimersByTimeAsync(
                MPV_IPC_COMMAND_TIMEOUT_MS + 100
            );
            await expect(retry).resolves.toMatchObject({ status: 'closed' });
            expect(later.kill).not.toHaveBeenCalled();
        } finally {
            if (proc.exitCode === null) {
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
            }
        }
    });

    it('restores the last started launch when a queued one is blocked by its teardown', async () => {
        const proc = createMockChildProcess();
        (proc.kill as jest.Mock).mockImplementation(() => {
            Object.defineProperty(proc, 'killed', {
                value: true,
                configurable: true,
            });
            return true;
        });
        spawnMock.mockReturnValueOnce(proc);
        // Reuse off: the detached child is never stored for reuse.
        (store.get as unknown as jest.Mock).mockImplementation(
            (key: string, fallback?: unknown) =>
                ({
                    [MPV_PLAYER_PATH]: '/usr/bin/mpv',
                    [MPV_REUSE_INSTANCE]: false,
                })[key] ?? fallback
        );
        jest.useFakeTimers();

        try {
            const first = openMpvPlayer({
                title: 'Channel A',
                url: 'https://example.com/a.m3u8',
            });
            const firstId =
                externalPlayerSessions.getActiveSessionId() as string;
            const skipped = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            const newest = openMpvPlayer({
                title: 'Channel C',
                url: 'https://example.com/c.m3u8',
            });
            const newestId =
                externalPlayerSessions.getActiveSessionId() as string;
            const firstRejection = expect(first).rejects.toThrow(
                'External player process did not exit'
            );
            const newestRejection = expect(newest).rejects.toThrow(
                'previous external player is still shutting down'
            );

            // A delayed Stop for the first launch cannot confirm its exit.
            const closeRejection = expect(
                externalPlayerSessions.closeSession(firstId)
            ).rejects.toThrow('External player process did not exit');
            await jest.advanceTimersByTimeAsync(6_000);
            await closeRejection;
            await firstRejection;
            await expect(skipped).resolves.toMatchObject({ status: 'closed' });
            await newestRejection;

            // The dock goes back to the session owning the stuck child.
            expect(externalPlayerSessions.getActiveSessionId()).toBe(firstId);
            expect(externalPlayerSessions.getSession(firstId)).toMatchObject({
                status: 'error',
                canClose: true,
            });
            expect(externalPlayerSessions.getSession(newestId)).toMatchObject({
                status: 'error',
                canClose: false,
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
        }
    });

    it('lets a queued Stop reach the child a failed launch is tearing down', async () => {
        const { proc } = await launchReusableSession();
        (proc.kill as jest.Mock).mockImplementation(() => true);
        // The first launch's loadfile fails; its teardown then waits for an
        // exit that never comes.
        mockMpvSockets({
            reply: (command) =>
                command[0] === 'loadfile' ? 'error running command' : null,
        });
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        jest.useFakeTimers();

        try {
            const first = openMpvPlayer({
                title: 'Channel A',
                url: 'https://example.com/a.m3u8',
            });
            const firstRejection = expect(first).rejects.toThrow(
                'External player process did not exit'
            );
            const queued = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            const queuedId =
                externalPlayerSessions.getActiveSessionId() as string;
            for (
                let tick = 0;
                tick < 50 && !(proc.kill as jest.Mock).mock.calls.length;
                tick += 1
            ) {
                await jest.advanceTimersByTimeAsync(10);
            }
            expect(proc.kill).toHaveBeenCalled();

            // Stop during that teardown must not report success while the
            // child is still alive.
            const closeRejection = expect(
                externalPlayerSessions.closeSession(queuedId)
            ).rejects.toThrow('External player process did not exit');
            await jest.advanceTimersByTimeAsync(10_000);
            await closeRejection;
            await firstRejection;
            await expect(queued).resolves.toMatchObject({
                id: queuedId,
                status: 'error',
                canClose: true,
            });

            // A retry reaches the same child and settles once it exits; the
            // retried quit gets no reply within its bound.
            const retry = externalPlayerSessions.closeSession(queuedId);
            await jest.advanceTimersByTimeAsync(0);
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            await jest.advanceTimersByTimeAsync(
                MPV_IPC_COMMAND_TIMEOUT_MS + 100
            );
            await expect(retry).resolves.toMatchObject({
                id: queuedId,
                status: 'closed',
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        } finally {
            errorSpy.mockRestore();
            if (proc.exitCode === null) {
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
            }
        }
    });

    it('keeps a queued Stop working after the previous owner closed during a failed handback', async () => {
        const { proc, session: previous } = await launchReusableSession();
        (proc.kill as jest.Mock).mockImplementation(() => true);
        const sockets = mockUnansweredSockets();
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        jest.useFakeTimers();

        try {
            const first = openMpvPlayer({
                title: 'Channel A',
                url: 'https://example.com/a.m3u8',
            });
            const firstRejection = expect(first).rejects.toThrow(
                'External player process did not exit'
            );
            const loadfileId = await (async () => {
                while (!sockets[0]?.write.mock.calls.length) {
                    await jest.advanceTimersByTimeAsync(0);
                }
                return (
                    JSON.parse(String(sockets[0].write.mock.calls[0][0])) as {
                        request_id: number;
                    }
                ).request_id;
            })();
            // A late Stop for the previous session closes it; the child now
            // belongs to the first launch.
            await expect(
                externalPlayerSessions.closeSession(previous.id)
            ).resolves.toMatchObject({ status: 'closed' });
            const queued = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            const queuedId =
                externalPlayerSessions.getActiveSessionId() as string;

            // mpv rejects the load: the child is handed back to the closed
            // previous session while the first launch tears it down.
            sockets[0].emit(
                'data',
                Buffer.from(
                    JSON.stringify({
                        request_id: loadfileId,
                        error: 'error running command',
                    }) + '\n'
                )
            );
            await jest.advanceTimersByTimeAsync(10);

            const closeRejection = expect(
                externalPlayerSessions.closeSession(queuedId)
            ).rejects.toThrow('External player process did not exit');
            await jest.advanceTimersByTimeAsync(10_000);
            await closeRejection;
            await firstRejection;
            await expect(queued).resolves.toMatchObject({
                id: queuedId,
                status: 'error',
                canClose: true,
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        } finally {
            errorSpy.mockRestore();
            if (proc.exitCode === null) {
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
            }
        }
    });

    it('keeps a queued Stop working when reuse is disabled before the in-flight load', async () => {
        const { proc } = await launchReusableSession();
        (proc.kill as jest.Mock).mockImplementation(() => true);
        const sockets = mockUnansweredSockets();
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        jest.useFakeTimers();

        try {
            // The first launch still waits on its user-agent reply, so the
            // child still belongs to the session before it.
            const first = openMpvPlayer({
                title: 'Channel A',
                url: 'https://example.com/a.m3u8',
                userAgent: 'IPTVnator test agent',
            });
            const firstRejection = expect(first).rejects.toThrow(
                'External player process did not exit'
            );
            while (!sockets[0]?.write.mock.calls.length) {
                await jest.advanceTimersByTimeAsync(0);
            }
            const queued = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            const queuedId =
                externalPlayerSessions.getActiveSessionId() as string;

            // Disabling reuse clears the stored child before it has exited.
            setMpvReuseInstance(false);
            const closeRejection = expect(
                externalPlayerSessions.closeSession(queuedId)
            ).rejects.toThrow('External player process did not exit');
            await jest.advanceTimersByTimeAsync(10_000);
            await closeRejection;
            await firstRejection;
            await expect(queued).resolves.toMatchObject({
                id: queuedId,
                status: 'error',
                canClose: true,
            });

            // The first launch has settled; a retried Stop must still reach
            // the live child and settle only once it exits.
            const killsBeforeRetry = (proc.kill as jest.Mock).mock.calls.length;
            const retry = externalPlayerSessions.closeSession(queuedId);
            let retried = false;
            void retry.then(
                () => (retried = true),
                () => (retried = true)
            );
            await jest.advanceTimersByTimeAsync(
                MPV_IPC_COMMAND_TIMEOUT_MS + 100
            );
            expect(retried).toBe(false);
            expect((proc.kill as jest.Mock).mock.calls.length).toBeGreaterThan(
                killsBeforeRetry
            );
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            await expect(retry).resolves.toMatchObject({
                id: queuedId,
                status: 'closed',
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        } finally {
            errorSpy.mockRestore();
            if (proc.exitCode === null) {
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
            }
        }
    });

    it('starts a queued launch on the fresh player a failed launch spawned', async () => {
        const { proc } = await launchReusableSession();
        const freshProc = createMockChildProcess();
        spawnMock.mockReturnValueOnce(freshProc);
        // The first launch's loadfile fails; every later command succeeds.
        // Each loadfile records how many players had been spawned by then.
        let rejectedLoadfile = false;
        const spawnsAtLoadfile: number[] = [];
        mockMpvSockets({
            reply: (command) => {
                if (command[0] === 'loadfile') {
                    spawnsAtLoadfile.push(spawnMock.mock.calls.length);
                }
                if (command[0] === 'loadfile' && !rejectedLoadfile) {
                    rejectedLoadfile = true;
                    return 'error running command';
                }
                return 'success';
            },
        });
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            const first = openMpvPlayer({
                title: 'Channel A',
                url: 'https://example.com/a.m3u8',
            });
            const second = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });

            await expect(first).resolves.toMatchObject({ status: 'opened' });
            const secondSession = await second;
            // The second launch loaded into the replacement the first one's
            // fallback spawned, not into the child that fallback tore down.
            expect(spawnsAtLoadfile).toEqual([1, 2]);
            expect(
                externalPlayerSessions.getSession(secondSession.id)?.status
            ).toBe('opened');
            expect(proc.kill).toHaveBeenCalledTimes(1);
            expect(spawnMock).toHaveBeenCalledTimes(2);
            expect(freshProc.kill).not.toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });
});
