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
import { externalPlayerSessions } from './external-player-runtime';
import { MPV_IPC_COMMAND_TIMEOUT_MS } from './mpv-ipc-command';
import {
    createMpvSocketMock,
    MpvSocketMock,
    MpvSocketMockOptions,
} from './mpv-ipc-socket.test-helpers';
import { openMpvPlayer, shutdownMpvSession } from './mpv-session.service';

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
