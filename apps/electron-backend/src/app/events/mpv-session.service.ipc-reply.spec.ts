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

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createConnection } from 'net';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
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
    MpvSocketMockOptions,
} from './mpv-ipc-socket.test-helpers';
import {
    openMpvPlayer,
    setMpvReuseInstance,
    shutdownMpvSession,
} from './mpv-session.service';

const spawnMock = spawn as unknown as jest.Mock;
const createConnectionMock = createConnection as unknown as jest.Mock;

function createMockChildProcess(): ChildProcess {
    const proc = Object.assign(new EventEmitter(), {
        exitCode: null,
        killed: false,
        kill: jest.fn(),
        signalCode: null,
        stderr: null,
        stdout: null,
        unref: jest.fn(),
    }) as unknown as ChildProcess;
    (proc.kill as jest.Mock).mockImplementation(() => {
        setImmediate(() => {
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
        });
        return true;
    });
    return proc;
}

function mockMpvSockets(options: MpvSocketMockOptions = {}): void {
    createConnectionMock.mockImplementation(() => createMpvSocketMock(options));
}

function nextTick(): Promise<void> {
    return new Promise<void>((resolve) => setImmediate(resolve));
}

/** Spawns the reusable instance a later launch is handed over to. */
async function launchReusableInstance(): Promise<ChildProcess> {
    return (await launchReusableSession()).proc;
}

async function launchReusableSession(): Promise<{
    proc: ChildProcess;
    session: ExternalPlayerSession;
}> {
    const proc = createMockChildProcess();
    spawnMock.mockReturnValueOnce(proc);
    (store.get as unknown as jest.Mock).mockImplementation(
        (key: string, fallback?: unknown) =>
            ({
                [MPV_PLAYER_PATH]: '/usr/bin/mpv',
                [MPV_REUSE_INSTANCE]: true,
            })[key] ?? fallback
    );
    const session = await openMpvPlayer({
        title: 'First stream',
        url: 'https://example.com/one.m3u8',
    });
    return { proc, session };
}

/** A socket whose written command mpv never answers; the test replies. */
function mockUnansweredSockets(): MpvSocketMock[] {
    const sockets: MpvSocketMock[] = [];
    createConnectionMock.mockImplementation(() => {
        const socket = createMpvSocketMock({ reply: () => null });
        sockets.push(socket);
        return socket;
    });
    return sockets;
}

async function writtenRequestId(socket: MpvSocketMock): Promise<number> {
    while (!socket?.write.mock.calls.length) {
        await nextTick();
    }
    return (
        JSON.parse(socket.write.mock.calls[0][0] as string) as {
            request_id: number;
        }
    ).request_id;
}

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
        const sockets = mockUnansweredSockets();

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

        await expect(
            externalPlayerSessions.closeSession(queuedId)
        ).resolves.toMatchObject({ id: queuedId, status: 'closed' });
        expect(proc.kill).toHaveBeenCalledTimes(1);
        // The killed player's socket closes before any reply.
        sockets[0].emit('close');

        await expect(first).resolves.toMatchObject({ status: 'closed' });
        await expect(second).resolves.toMatchObject({
            id: queuedId,
            status: 'closed',
        });
        // Nothing started playing again after Stop.
        expect(sockets).toHaveLength(1);
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('lets Stop on the newest queued launch cancel every launch queued before it', async () => {
        const { proc } = await launchReusableSession();
        const sockets = mockUnansweredSockets();

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
        expect(proc.kill).toHaveBeenCalledTimes(1);
        expect(sockets).toHaveLength(1);
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
