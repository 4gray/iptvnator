jest.mock('net', () => ({
    createConnection: jest.fn(),
}));

jest.mock('./external-player-runtime', () => {
    const { ExternalPlayerSessionRegistry } = jest.requireActual(
        './external-player-session-registry'
    );
    return {
        traceExternalPlayer: jest.fn(),
        externalPlayerSessions: new ExternalPlayerSessionRegistry(jest.fn()),
    };
});

import { EventEmitter } from 'events';
import { createConnection } from 'net';
import { externalPlayerSessions } from './external-player-runtime';
import {
    MPV_IPC_COMMAND_TIMEOUT_MS,
    markMpvOpened,
    MpvIpcCommandError,
    sendMpvCommand,
} from './mpv-ipc-command';

type SocketMock = EventEmitter & {
    write: jest.Mock;
    destroy: jest.Mock;
    destroyed: boolean;
};

const createConnectionMock = createConnection as unknown as jest.Mock;
const socketPath = '/tmp/mpv-ipc-command.sock';
const streamUrl = 'https://example.com/stream.m3u8?token=secret-token';

function makeSocket(): SocketMock {
    const socket: SocketMock = Object.assign(new EventEmitter(), {
        write: jest.fn(() => true),
        destroy: jest.fn(() => {
            socket.destroyed = true;
        }),
        destroyed: false,
    });
    return socket;
}

function nextSocket(): SocketMock {
    const socket = makeSocket();
    createConnectionMock.mockReturnValueOnce(socket);
    return socket;
}

function writtenRequest(socket: SocketMock): {
    command: Array<string | number>;
    request_id: number;
} {
    return JSON.parse(String(socket.write.mock.calls[0][0]).trim());
}

function reply(socket: SocketMock, ...lines: Array<object | string>): void {
    socket.emit(
        'data',
        Buffer.from(
            lines
                .map((line) =>
                    typeof line === 'string' ? line : JSON.stringify(line)
                )
                .join('\n') + '\n'
        )
    );
}

async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('sendMpvCommand', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('opens a socketless guide launch without confirming media', () => {
        const session = externalPlayerSessions.beginSession({
            player: 'mpv',
            title: 'Synthetic Channel',
            streamUrl: 'https://example.test/synthetic.ts',
        });
        expect(markMpvOpened(session.id, null, undefined, true)).toMatchObject({
            status: 'opened',
            mediaLoaded: false,
            playbackUnverified: true,
            mediaObservationUnavailable: true,
        });
        expect(createConnectionMock).not.toHaveBeenCalled();
    });

    it('makes stalled fresh media retryable and clears uncertainty when it starts', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
        let ready = false;
        createConnectionMock.mockImplementation(() => {
            const socket = makeSocket();
            socket.write.mockImplementation(() => {
                const { command, request_id } = writtenRequest(socket);
                queueMicrotask(() =>
                    reply(
                        socket,
                        command[1] === 'idle-active'
                            ? { request_id, error: 'success', data: false }
                            : ready
                              ? { request_id, error: 'success', data: 0 }
                              : { request_id, error: 'property unavailable' }
                    )
                );
            });
            queueMicrotask(() => socket.emit('connect'));
            return socket;
        });
        const session = externalPlayerSessions.beginSession({
            player: 'mpv',
            title: 'Synthetic Channel',
            streamUrl,
        });
        try {
            markMpvOpened(session.id, socketPath, undefined, true);
            await jest.advanceTimersByTimeAsync(29_999);
            expect(externalPlayerSessions.getSession(session.id)).toMatchObject(
                { mediaLoaded: false, playbackUnverified: undefined }
            );
            await jest.advanceTimersByTimeAsync(1);
            expect(externalPlayerSessions.getSession(session.id)).toMatchObject(
                { mediaLoaded: false, playbackUnverified: true }
            );
            ready = true;
            await jest.advanceTimersByTimeAsync(2_001);
            expect(externalPlayerSessions.getSession(session.id)).toMatchObject(
                { mediaLoaded: true, playbackUnverified: undefined }
            );
        } finally {
            externalPlayerSessions.markClosed(session.id);
            createConnectionMock.mockReset();
        }
    });

    it('sends a request_id and resolves with the matching reply', async () => {
        const socket = nextSocket();
        const pending = sendMpvCommand(socketPath, 'loadfile', [
            streamUrl,
            'replace',
            -1,
            'start=0',
        ]);
        socket.emit('connect');

        const request = writtenRequest(socket);
        expect(request.command).toEqual([
            'loadfile',
            streamUrl,
            'replace',
            -1,
            'start=0',
        ]);
        expect(Number.isInteger(request.request_id)).toBe(true);
        expect(String(socket.write.mock.calls[0][0]).endsWith('\n')).toBe(true);

        reply(socket, {
            data: { playlist_entry_id: 1 },
            request_id: request.request_id,
            error: 'success',
        });
        await expect(pending).resolves.toEqual({
            request_id: request.request_id,
            error: 'success',
            data: { playlist_entry_id: 1 },
        });
        expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])(
        'observes media for the acknowledged playlist entry (%s)',
        async (loaded) => {
            const socket = nextSocket();
            const onOutcome = jest.fn();
            const pending = sendMpvCommand(
                socketPath,
                'loadfile',
                [streamUrl],
                {
                    media: { signal: new AbortController().signal, onOutcome },
                }
            );
            socket.emit('connect');
            reply(socket, {
                request_id: writtenRequest(socket).request_id,
                error: 'success',
                data: { playlist_entry_id: 2 },
            });
            await expect(pending).resolves.toMatchObject({ error: 'success' });
            expect(onOutcome).not.toHaveBeenCalled();
            expect(socket.destroyed).toBe(false);

            reply(
                socket,
                { event: 'start-file', playlist_entry_id: 1 },
                { event: 'file-loaded' }
            );
            expect(onOutcome).not.toHaveBeenCalled();
            reply(
                socket,
                { event: 'start-file', playlist_entry_id: 2 },
                loaded
                    ? { event: 'file-loaded' }
                    : {
                          event: 'end-file',
                          reason: 'error',
                          playlist_entry_id: 2,
                      }
            );
            expect(onOutcome).toHaveBeenCalledTimes(1);
            expect(onOutcome).toHaveBeenCalledWith(loaded);
            expect(socket.destroyed).toBe(true);
        }
    );

    it('releases an acknowledged media observer when superseded', async () => {
        const socket = nextSocket();
        const controller = new AbortController();
        const onOutcome = jest.fn();
        const pending = sendMpvCommand(socketPath, 'loadfile', [streamUrl], {
            media: { signal: controller.signal, onOutcome },
        });
        socket.emit('connect');
        reply(socket, {
            request_id: writtenRequest(socket).request_id,
            error: 'success',
            data: { playlist_entry_id: 2 },
        });
        await pending;
        controller.abort();
        reply(
            socket,
            { event: 'start-file', playlist_entry_id: 2 },
            { event: 'file-loaded' }
        );
        expect(onOutcome).not.toHaveBeenCalled();
        expect(socket.destroyed).toBe(true);
    });

    it('follows a matching redirect and ignores media outside its inserted entries', async () => {
        const socket = nextSocket();
        const onOutcome = jest.fn();
        const pending = sendMpvCommand(socketPath, 'loadfile', [streamUrl], {
            media: { signal: new AbortController().signal, onOutcome },
        });
        socket.emit('connect');
        reply(
            socket,
            { event: 'start-file', playlist_entry_id: 2 },
            {
                event: 'end-file',
                reason: 'redirect',
                playlist_entry_id: 2,
                playlist_insert_id: 3,
                playlist_insert_num_entries: 2,
            },
            { event: 'start-file', playlist_entry_id: 20 },
            { event: 'file-loaded' }
        );
        reply(socket, {
            request_id: writtenRequest(socket).request_id,
            error: 'success',
            data: { playlist_entry_id: 2 },
        });
        await pending;
        expect(onOutcome).not.toHaveBeenCalled();
        reply(
            socket,
            { event: 'start-file', playlist_entry_id: 4 },
            { event: 'file-loaded' }
        );
        expect(onOutcome).toHaveBeenCalledWith(true);
    });

    it.each([true, false])(
        'observes outer siblings after a nested redirect (%s)',
        async (loaded) => {
            const socket = nextSocket();
            const onOutcome = jest.fn();
            const pending = sendMpvCommand(
                socketPath,
                'loadfile',
                [streamUrl],
                {
                    media: { signal: new AbortController().signal, onOutcome },
                }
            );
            socket.emit('connect');
            reply(socket, {
                request_id: writtenRequest(socket).request_id,
                error: 'success',
                data: { playlist_entry_id: 2 },
            });
            await pending;
            reply(
                socket,
                {
                    event: 'end-file',
                    reason: 'redirect',
                    playlist_entry_id: 2,
                    playlist_insert_id: 3,
                    playlist_insert_num_entries: 2,
                },
                {
                    event: 'end-file',
                    reason: 'redirect',
                    playlist_entry_id: 3,
                    playlist_insert_id: 5,
                    playlist_insert_num_entries: 1,
                },
                { event: 'end-file', reason: 'error', playlist_entry_id: 5 }
            );
            expect(onOutcome).not.toHaveBeenCalled();
            reply(
                socket,
                { event: 'start-file', playlist_entry_id: 4 },
                loaded
                    ? { event: 'file-loaded' }
                    : {
                          event: 'end-file',
                          reason: 'error',
                          playlist_entry_id: 4,
                      }
            );
            expect(onOutcome).toHaveBeenCalledTimes(1);
            expect(onOutcome).toHaveBeenCalledWith(loaded);
        }
    );

    it('reports unavailable confirmation when an acknowledged media observer expires', async () => {
        jest.useFakeTimers();
        const socket = nextSocket();
        const onOutcome = jest.fn();
        const pending = sendMpvCommand(socketPath, 'loadfile', [streamUrl], {
            media: { signal: new AbortController().signal, onOutcome },
        });
        socket.emit('connect');
        reply(socket, {
            request_id: writtenRequest(socket).request_id,
            error: 'success',
            data: { playlist_entry_id: 2 },
        });
        await pending;
        await jest.runOnlyPendingTimersAsync();
        expect(onOutcome).toHaveBeenCalledTimes(1);
        expect(onOutcome).toHaveBeenCalledWith(undefined);
        expect(socket.destroyed).toBe(true);
    });

    it('gives consecutive commands distinct request ids', async () => {
        const first = nextSocket();
        const second = nextSocket();
        const firstPending = sendMpvCommand(socketPath, 'set_property', [
            'user-agent',
            'agent',
        ]);
        const secondPending = sendMpvCommand(socketPath, 'set_property', [
            'referrer',
            'https://example.com/',
        ]);
        first.emit('connect');
        second.emit('connect');
        const firstId = writtenRequest(first).request_id;
        const secondId = writtenRequest(second).request_id;
        expect(secondId).not.toBe(firstId);

        reply(first, { request_id: firstId, error: 'success' });
        reply(second, { request_id: secondId, error: 'success' });
        await expect(firstPending).resolves.toMatchObject({
            request_id: firstId,
        });
        await expect(secondPending).resolves.toMatchObject({
            request_id: secondId,
        });
    });

    it('resolves false without writing when dispatch is vetoed', async () => {
        const socket = nextSocket();
        const onDispatched = jest.fn();
        const pending = sendMpvCommand(socketPath, 'loadfile', [streamUrl], {
            shouldDispatch: () => false,
            onDispatched,
        });
        socket.emit('connect');

        await expect(pending).resolves.toBe(false);
        expect(socket.write).not.toHaveBeenCalled();
        expect(onDispatched).not.toHaveBeenCalled();
        expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    it('rejects with mpv error text after the command was dispatched', async () => {
        const socket = nextSocket();
        const onDispatched = jest.fn();
        const pending = sendMpvCommand(socketPath, 'seek', ['10', 'absolute'], {
            onDispatched,
        });
        socket.emit('connect');
        expect(onDispatched).toHaveBeenCalledTimes(1);

        reply(socket, {
            request_id: writtenRequest(socket).request_id,
            error: 'error running command',
        });
        await expect(pending).rejects.toMatchObject({
            name: 'MpvIpcCommandError',
            command: 'seek',
            dispatched: true,
            mpvError: 'error running command',
            message: 'mpv seek: error running command',
        });
        expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a missing error', {}],
        ['a non-string error', { error: 0 }],
    ])(
        'rejects a matching reply with %s instead of confirming it',
        async (_label, fields) => {
            const socket = nextSocket();
            const pending = sendMpvCommand(socketPath, 'loadfile', [streamUrl]);
            socket.emit('connect');

            reply(socket, {
                request_id: writtenRequest(socket).request_id,
                data: { playlist_entry_id: 1 },
                ...fields,
            });
            await expect(pending).rejects.toMatchObject({
                name: 'MpvIpcCommandError',
                dispatched: true,
                mpvError: null,
                message: 'mpv loadfile: malformed reply',
            });
        }
    );

    it('rejects an undispatched command on a socket error without echoing arguments', async () => {
        const socket = nextSocket();
        const pending = sendMpvCommand(socketPath, 'loadfile', [streamUrl]);
        socket.emit('error', new Error('connect ENOENT'));

        const error = (await pending.catch((caught) => caught)) as unknown;
        expect(error).toBeInstanceOf(MpvIpcCommandError);
        expect(error).toMatchObject({
            dispatched: false,
            mpvError: null,
            message: 'mpv loadfile: connect ENOENT',
        });
        expect(socket.write).not.toHaveBeenCalled();
        expect(String((error as Error).message)).not.toContain('secret');
    });

    it('rejects when the socket closes before a reply', async () => {
        const socket = nextSocket();
        const pending = sendMpvCommand(socketPath, 'quit', []);
        socket.emit('connect');
        socket.emit('close');

        await expect(pending).rejects.toMatchObject({
            command: 'quit',
            dispatched: true,
            message: 'mpv quit: socket closed before reply',
        });
    });

    it('times out a reply that never comes', async () => {
        jest.useFakeTimers();
        const socket = nextSocket();
        const pending = sendMpvCommand(socketPath, 'loadfile', [streamUrl]);
        socket.emit('connect');
        let settled = false;
        void pending.catch(() => (settled = true));

        await jest.advanceTimersByTimeAsync(MPV_IPC_COMMAND_TIMEOUT_MS - 1);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(settled).toBe(true);
        await expect(pending).rejects.toMatchObject({
            dispatched: true,
            message: 'mpv loadfile: reply timed out',
        });
        expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    it('skips events, foreign replies and malformed lines, and joins split chunks', async () => {
        const socket = nextSocket();
        const pending = sendMpvCommand(socketPath, 'loadfile', [streamUrl]);
        socket.emit('connect');
        const requestId = writtenRequest(socket).request_id;
        let settled = false;
        void pending.then(
            () => (settled = true),
            () => (settled = true)
        );

        reply(
            socket,
            { event: 'start-file', playlist_entry_id: 1 },
            {
                event: 'end-file',
                reason: 'error',
                file_error: 'loading failed',
            },
            { request_id: requestId + 1, error: 'error running command' },
            'not json',
            '42'
        );
        await settle();
        expect(settled).toBe(false);

        const ownReply = JSON.stringify({
            request_id: requestId,
            error: 'success',
        });
        socket.emit('data', Buffer.from(ownReply.slice(0, 10)));
        await settle();
        expect(settled).toBe(false);
        socket.emit('data', Buffer.from(ownReply.slice(10) + '\n'));

        await expect(pending).resolves.toMatchObject({
            request_id: requestId,
            error: 'success',
        });
    });

    it('ignores data that arrives after settling', async () => {
        const socket = nextSocket();
        const pending = sendMpvCommand(socketPath, 'quit', []);
        socket.emit('connect');
        const requestId = writtenRequest(socket).request_id;
        reply(socket, { request_id: requestId, error: 'success' });
        await expect(pending).resolves.toMatchObject({ error: 'success' });

        expect(() =>
            reply(socket, { request_id: requestId, error: 'late failure' })
        ).not.toThrow();
        expect(() => socket.emit('close')).not.toThrow();
        expect(socket.destroy).toHaveBeenCalledTimes(1);
    });
});
