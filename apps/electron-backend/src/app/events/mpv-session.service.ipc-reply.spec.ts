/**
 * Reply handling of the reused-instance MPV IPC path. Every command carries a
 * `request_id` and the launch waits, bounded, for mpv's matching reply; an
 * error reply or a missing one falls back to a fresh launch exactly like a
 * socket failure. Teardown, ownership and Stop-interleaving coverage lives in
 * `mpv-session.service.spec.ts`.
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
import * as externalPlayerRuntime from './external-player-runtime';
import { externalPlayerSessions } from './external-player-runtime';
import { MPV_IPC_COMMAND_TIMEOUT_MS } from './mpv-ipc-command';
import {
    createMpvSocketMock,
    MpvSocketMock,
} from './mpv-ipc-socket.test-helpers';
import {
    openMpvPlayer,
    setMpvReuseInstance,
    shutdownMpvSession,
} from './mpv-session.service';
import {
    spawnMock,
    createConnectionMock,
    createMockChildProcess,
    mockMpvSockets,
    nextTick,
    launchReusableInstance,
    launchReusableSession,
    mockUnansweredSockets,
    writtenRequestId,
} from './mpv-session.test-helpers';

describe('reused MPV IPC replies', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        shutdownMpvSession();
    });

    afterEach(() => {
        jest.useRealTimers();
        shutdownMpvSession();
    });
    it('opens the session once mpv acknowledges the content command', async () => {
        const reusedProc = await launchReusableInstance();
        const written: string[] = [];
        mockMpvSockets({ written });

        const session = await openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
            startTime: 30,
        });

        expect(session.status).toBe('opened');
        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(reusedProc.kill).not.toHaveBeenCalled();
        const requests = written.map(
            (chunk) =>
                JSON.parse(chunk.trim()) as {
                    command: Array<string | number>;
                    request_id: number;
                }
        );
        // The offset travels with loadfile; no seek races the load.
        expect(requests.map((request) => request.command[0])).toEqual([
            'loadfile',
        ]);
        expect(Number.isInteger(requests[0].request_id)).toBe(true);
    });

    it('falls back to a fresh launch when mpv rejects the content command', async () => {
        const reusedProc = await launchReusableInstance();
        const freshProc = createMockChildProcess();
        spawnMock.mockReturnValueOnce(freshProc);
        mockMpvSockets({
            reply: (command) =>
                command[0] === 'loadfile' ? 'error running command' : 'success',
        });
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            const session = await openMpvPlayer({
                title: 'Second stream',
                url: 'https://example.com/two.m3u8?token=secret-token',
            });

            expect(reusedProc.kill).toHaveBeenCalledTimes(1);
            expect(spawnMock).toHaveBeenCalledTimes(2);
            expect(session.status).toBe('opened');
            expect(externalPlayerSessions.getSession(session.id)?.status).toBe(
                'opened'
            );
            const logged = JSON.stringify(errorSpy.mock.calls);
            expect(logged).toContain('mpv loadfile: error running command');
            expect(logged).not.toContain('secret-token');
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('falls back to a fresh launch when mpv never replies', async () => {
        const reusedProc = await launchReusableInstance();
        const freshProc = createMockChildProcess();
        spawnMock.mockReturnValueOnce(freshProc);
        mockMpvSockets({ reply: () => null });
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        jest.useFakeTimers();

        try {
            const opening = openMpvPlayer({
                title: 'Second stream',
                url: 'https://example.com/two.m3u8',
            });
            await jest.advanceTimersByTimeAsync(MPV_IPC_COMMAND_TIMEOUT_MS - 1);
            expect(reusedProc.kill).not.toHaveBeenCalled();
            expect(spawnMock).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(1);
            expect(reusedProc.kill).toHaveBeenCalledTimes(1);
            // Exit of the reused child, the fresh spawn and its start
            // confirmation all run on timers.
            await jest.advanceTimersByTimeAsync(500);

            await expect(opening).resolves.toMatchObject({
                status: 'opened',
            });
            expect(spawnMock).toHaveBeenCalledTimes(2);
            expect(JSON.stringify(errorSpy.mock.calls)).toContain(
                'mpv loadfile: reply timed out'
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('ignores events and other replies while waiting for its own', async () => {
        await launchReusableInstance();
        const sockets: MpvSocketMock[] = [];
        createConnectionMock.mockImplementation(() => {
            const socket = createMpvSocketMock({ reply: () => null });
            sockets.push(socket);
            return socket;
        });

        const opening = openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });
        let settled = false;
        void opening.then(
            () => (settled = true),
            () => (settled = true)
        );
        while (!sockets[0]?.write.mock.calls.length) {
            await nextTick();
        }
        const { request_id: requestId } = JSON.parse(
            sockets[0].write.mock.calls[0][0] as string
        ) as { request_id: number };
        const push = (...lines: object[]) =>
            sockets[0].emit(
                'data',
                Buffer.from(
                    lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
                )
            );

        // mpv broadcasts events on every connection and may still be
        // answering an earlier request; none of these is this reply.
        push(
            { event: 'start-file', playlist_entry_id: 1 },
            {
                event: 'end-file',
                reason: 'error',
                file_error: 'loading failed',
            },
            { request_id: requestId + 1000, error: 'error running command' }
        );
        await nextTick();
        await nextTick();
        expect(settled).toBe(false);
        expect(spawnMock).toHaveBeenCalledTimes(1);

        push({ request_id: requestId, error: 'success' });
        await expect(opening).resolves.toMatchObject({ status: 'opened' });
        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(sockets).toHaveLength(1);
    });

    it('lets a stale Stop for the previous session pass while the loadfile reply is pending', async () => {
        const { proc, session: previous } = await launchReusableSession();
        const sockets = mockUnansweredSockets();

        const opening = openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });
        const requestId = await writtenRequestId(sockets[0]);

        // The child already belongs to the new session: the old closer
        // must neither kill it nor send quit.
        await expect(
            externalPlayerSessions.closeSession(previous.id)
        ).resolves.toMatchObject({ id: previous.id, status: 'closed' });
        expect(proc.kill).not.toHaveBeenCalled();
        expect(sockets).toHaveLength(1);

        sockets[0].emit(
            'data',
            Buffer.from(
                JSON.stringify({ request_id: requestId, error: 'success' }) +
                    '\n'
            )
        );
        await expect(opening).resolves.toMatchObject({ status: 'opened' });
        expect(proc.kill).not.toHaveBeenCalled();
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('settles the new session as closed when the child exits during the reply wait', async () => {
        const { proc, session: previous } = await launchReusableSession();
        const sockets = mockUnansweredSockets();

        const opening = openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 7,
                contentType: 'vod',
            },
        });
        const requestId = await writtenRequestId(sockets[0]);
        const replacementId =
            externalPlayerSessions.getActiveSessionId() as string;

        Object.defineProperty(proc, 'exitCode', { value: 0 });
        proc.emit('exit', 0);
        sockets[0].emit(
            'data',
            Buffer.from(
                JSON.stringify({ request_id: requestId, error: 'success' }) +
                    '\n'
            )
        );

        // The exit landed on the session that owned the child at that
        // moment, and a dead player is never reported as opened.
        await expect(opening).resolves.toMatchObject({
            id: replacementId,
            status: 'closed',
        });
        expect(externalPlayerSessions.getSession(previous.id)?.status).toBe(
            'opened'
        );
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('stops the previous position poll as soon as loadfile is written', async () => {
        jest.useFakeTimers();
        const contentInfo = {
            playlistId: 'playlist-1',
            contentXtreamId: 7,
            contentType: 'vod' as const,
        };
        const proc = createMockChildProcess();
        spawnMock.mockReturnValueOnce(proc);
        (store.get as unknown as jest.Mock).mockImplementation(
            (key: string, fallback?: unknown) =>
                ({
                    [MPV_PLAYER_PATH]: '/usr/bin/mpv',
                    [MPV_REUSE_INSTANCE]: true,
                })[key] ?? fallback
        );
        const sockets = mockUnansweredSockets();
        const first = openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
            contentInfo,
        });
        await jest.advanceTimersByTimeAsync(100);
        await first;
        // The first session polls 2 s after launch, then every 5 s: the
        // next poll is due at 7 s, inside the reply window of a loadfile
        // written at 6.5 s.
        await jest.advanceTimersByTimeAsync(6_500);
        const pollsBefore = sockets.length;

        const opening = openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
            contentInfo: { ...contentInfo, contentXtreamId: 8 },
        });
        await jest.advanceTimersByTimeAsync(0);
        const loadfileSocket = sockets[pollsBefore];
        const requestId = await writtenRequestId(loadfileSocket);
        await jest.advanceTimersByTimeAsync(1_000);

        const commandsAfterLoadfile = sockets
            .slice(pollsBefore + 1)
            .flatMap((socket) =>
                socket.write.mock.calls.map(
                    ([request]) =>
                        (JSON.parse(String(request)) as { command: string[] })
                            .command[0]
                )
            );
        expect(commandsAfterLoadfile).not.toContain('get_property');

        loadfileSocket.emit(
            'data',
            Buffer.from(
                JSON.stringify({ request_id: requestId, error: 'success' }) +
                    '\n'
            )
        );
        await jest.advanceTimersByTimeAsync(0);
        await expect(opening).resolves.toMatchObject({ status: 'opened' });
    });

    it('drops a position read that was in flight when loadfile was written', async () => {
        // The previous test's player exits on a real tick, and any MPV exit
        // stops polling; let it land before this test starts its poll.
        await nextTick();
        await nextTick();
        jest.useFakeTimers();
        const sendPosition = jest.spyOn(
            externalPlayerRuntime,
            'sendPlaybackPositionUpdate'
        );
        const proc = createMockChildProcess();
        spawnMock.mockReturnValueOnce(proc);
        (store.get as unknown as jest.Mock).mockImplementation(
            (key: string, fallback?: unknown) =>
                ({
                    [MPV_PLAYER_PATH]: '/usr/bin/mpv',
                    [MPV_REUSE_INSTANCE]: true,
                })[key] ?? fallback
        );
        const sockets = mockUnansweredSockets();
        const commandOf = (socket: MpvSocketMock) =>
            socket.write.mock.calls.length
                ? (
                      JSON.parse(String(socket.write.mock.calls[0][0])) as {
                          command: string[];
                      }
                  ).command
                : [];
        const first = openMpvPlayer({
            title: 'First stream',
            url: 'https://example.com/one.m3u8',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 7,
                contentType: 'vod',
            },
        });
        await jest.advanceTimersByTimeAsync(100);
        const previous = await first;

        // The first poll fires 2 s + 5 s after launch and waits for time-pos.
        await jest.advanceTimersByTimeAsync(6_950);
        const timePosSocket = sockets.find(
            (socket) => commandOf(socket)[1] === 'time-pos'
        );
        expect(timePosSocket).toBeDefined();

        const opening = openMpvPlayer({
            title: 'Second stream',
            url: 'https://example.com/two.m3u8',
        });
        await jest.advanceTimersByTimeAsync(0);
        const loadfileSocket = sockets.find(
            (socket) => commandOf(socket)[0] === 'loadfile'
        ) as MpvSocketMock;
        const requestId = await writtenRequestId(loadfileSocket);

        // The pending read now returns the new stream's position.
        timePosSocket?.emit(
            'data',
            Buffer.from(JSON.stringify({ data: 12.5, error: 'success' }) + '\n')
        );
        await jest.advanceTimersByTimeAsync(10);
        loadfileSocket.emit(
            'data',
            Buffer.from(
                JSON.stringify({ request_id: requestId, error: 'success' }) +
                    '\n'
            )
        );
        await jest.advanceTimersByTimeAsync(0);
        await expect(opening).resolves.toMatchObject({ status: 'opened' });

        // An unguarded poll would now ask for the duration and, once that
        // read times out, report the new position under the old content.
        await jest.advanceTimersByTimeAsync(MPV_IPC_COMMAND_TIMEOUT_MS + 100);
        expect(
            sockets.some((socket) => commandOf(socket)[1] === 'duration')
        ).toBe(false);
        expect(sendPosition).not.toHaveBeenCalledWith(
            previous.id,
            expect.anything(),
            expect.anything()
        );
        sendPosition.mockRestore();
    });

    it('keeps a reuse cancelled by disabling reuse stoppable until its child exits', async () => {
        const { proc } = await launchReusableSession();
        (proc.kill as jest.Mock).mockImplementation(() => true);
        const sockets = mockUnansweredSockets();
        jest.useFakeTimers();

        try {
            const opening = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            while (!sockets[0]?.write.mock.calls.length) {
                await jest.advanceTimersByTimeAsync(0);
            }

            setMpvReuseInstance(false);
            sockets[0].emit('close');
            await jest.advanceTimersByTimeAsync(6_000);

            // The child never confirmed its exit: the session stays a
            // closable error instead of a closed one Stop cannot retry.
            await expect(opening).resolves.toMatchObject({
                status: 'error',
                canClose: true,
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
        }
    });

    it('keeps Stop working for a reused session restored after a later attempt fails', async () => {
        const { proc } = await launchReusableSession();
        // Exit is never confirmed, so a failing later attempt cannot finish
        // its teardown and the previous owner is restored.
        (proc.kill as jest.Mock).mockImplementation(() => true);
        mockMpvSockets();
        const restored = await openMpvPlayer({
            title: 'Channel A',
            url: 'https://example.com/a.m3u8',
        });
        expect(restored.status).toBe('opened');
        createConnectionMock.mockImplementation(() => {
            const socket = createMpvSocketMock({ connect: false });
            setImmediate(() =>
                socket.emit('error', new Error('reuse command failed'))
            );
            return socket;
        });
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        jest.useFakeTimers();

        try {
            const failing = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            const rejection = expect(failing).rejects.toThrow(
                'External player process did not exit'
            );
            await jest.advanceTimersByTimeAsync(6_000);
            await rejection;
            expect(externalPlayerSessions.getActiveSessionId()).toBe(
                restored.id
            );

            const written: string[] = [];
            mockMpvSockets({ written });
            let closed = false;
            const closing = externalPlayerSessions
                .closeSession(restored.id)
                .then((session) => {
                    closed = true;
                    return session;
                });
            await jest.advanceTimersByTimeAsync(10);

            // Stop reaches the child and waits for its exit.
            expect(
                written.map(
                    (chunk) =>
                        (JSON.parse(chunk.trim()) as { command: string[] })
                            .command[0]
                )
            ).toContain('quit');
            expect(closed).toBe(false);
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
            await expect(closing).resolves.toMatchObject({
                id: restored.id,
                status: 'closed',
            });
        } finally {
            errorSpy.mockRestore();
            if (proc.exitCode === null) {
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);
            }
        }
    });

    it.each([
        ['reuse is disabled', () => setMpvReuseInstance(false)],
        ['the app shuts down', () => shutdownMpvSession()],
    ])(
        'does not fall back to a fresh player when %s during the reply wait',
        async (_label, stopStored) => {
            const { proc } = await launchReusableSession();
            // The kill is sent but its exit is reported only later, after
            // the socket close already rejected the pending loadfile.
            (proc.kill as jest.Mock).mockImplementation(() => true);
            const sockets = mockUnansweredSockets();

            const opening = openMpvPlayer({
                title: 'Channel B',
                url: 'https://example.com/b.m3u8',
            });
            await writtenRequestId(sockets[0]);

            stopStored();
            sockets[0].emit('close');
            await nextTick();
            await nextTick();
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);

            await expect(opening).resolves.toMatchObject({
                status: 'closed',
            });
            expect(spawnMock).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        ['reuse is disabled', () => setMpvReuseInstance(false)],
        ['the app shuts down', () => shutdownMpvSession()],
    ])(
        'does not fall back to a fresh player when %s during the failed-reuse teardown',
        async (_label, stopStored) => {
            const { proc } = await launchReusableSession();
            // mpv rejects the content command, and the teardown that
            // follows waits for an exit that is reported only later.
            (proc.kill as jest.Mock).mockImplementation(() => true);
            mockMpvSockets({
                reply: (command) =>
                    command[0] === 'loadfile'
                        ? 'error running command'
                        : 'success',
            });
            const errorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);

            try {
                const opening = openMpvPlayer({
                    title: 'Channel B',
                    url: 'https://example.com/b.m3u8',
                });
                while (!(proc.kill as jest.Mock).mock.calls.length) {
                    await nextTick();
                }

                stopStored();
                Object.defineProperty(proc, 'exitCode', { value: 0 });
                proc.emit('exit', 0);

                await expect(opening).resolves.toMatchObject({
                    status: 'closed',
                });
                expect(spawnMock).toHaveBeenCalledTimes(1);
            } finally {
                errorSpy.mockRestore();
            }
        }
    );

    it('keeps the errored session when the child crashes during the reply wait', async () => {
        const { proc, session: previous } = await launchReusableSession();
        const sockets = mockUnansweredSockets();
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            const opening = openMpvPlayer({
                title: 'Second stream',
                url: 'https://example.com/two.m3u8',
            });
            await writtenRequestId(sockets[0]);
            const replacementId =
                externalPlayerSessions.getActiveSessionId() as string;

            // A crash closes the IPC socket before any reply: the exit
            // handler reports it, and no fresh player is launched under a
            // session that could never be shown as opened.
            Object.defineProperty(proc, 'exitCode', { value: 1 });
            proc.emit('exit', 1);
            sockets[0].emit('close');

            await expect(opening).resolves.toMatchObject({
                id: replacementId,
                status: 'error',
                errorCode: 'closed-unexpectedly',
            });
            expect(externalPlayerSessions.getSession(previous.id)?.status).toBe(
                'opened'
            );
            expect(spawnMock).toHaveBeenCalledTimes(1);
        } finally {
            errorSpy.mockRestore();
        }
    });
});
