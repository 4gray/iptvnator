import { EventEmitter } from 'events';

export type MpvSocketMock = EventEmitter & {
    write: jest.Mock;
    end: jest.Mock;
    destroy: jest.Mock;
};

export interface MpvSocketMockOptions {
    /** Collects every chunk written to the socket. */
    written?: string[];
    /** Emit `connect` on the next tick; `false` leaves that to the test. */
    connect?: boolean;
    /**
     * mpv's `error` field for a written command, `'success'` by default.
     * `null` leaves the command unanswered.
     */
    reply?: (command: Array<string | number>) => string | null;
}

interface MpvIpcRequest {
    command: Array<string | number>;
    request_id: number;
}

/**
 * A reused-instance mpv IPC socket: records writes and answers each command
 * on the next tick with a reply carrying its `request_id`, as mpv does.
 */
export function createMpvSocketMock({
    written,
    connect = true,
    reply = () => 'success',
}: MpvSocketMockOptions = {}): MpvSocketMock {
    const socket: MpvSocketMock = Object.assign(new EventEmitter(), {
        write: jest.fn((chunk: string) => {
            written?.push(chunk);
            const request = JSON.parse(chunk.trim()) as MpvIpcRequest;
            const error = reply(request.command);
            if (error !== null) {
                const line =
                    JSON.stringify({ request_id: request.request_id, error }) +
                    '\n';
                setImmediate(() => socket.emit('data', Buffer.from(line)));
            }
            return true;
        }),
        end: jest.fn(),
        destroy: jest.fn(),
    });
    if (connect) {
        setImmediate(() => socket.emit('connect'));
    }
    return socket;
}
