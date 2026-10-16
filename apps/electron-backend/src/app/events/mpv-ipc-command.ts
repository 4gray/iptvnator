import { createConnection } from 'net';
import { traceExternalPlayer } from './external-player-runtime';

/**
 * Bounds connect, write and the wait for mpv's reply. It matches the IPC
 * quit bound the reuse teardown relies on before its exit windows start.
 */
export const MPV_IPC_COMMAND_TIMEOUT_MS = 2_000;

/** One newline-delimited JSON reply of mpv's IPC protocol. */
export interface MpvIpcReply {
    request_id: number;
    error: string;
    data?: unknown;
}

export interface MpvIpcCommandOptions {
    /** Checked once connected; a `false` skips the write and resolves `false`. */
    shouldDispatch?: () => boolean;
    /** Runs right after the command was written, before any reply. */
    onDispatched?: () => void;
}

/**
 * A command mpv answered with an error, or one whose reply never came.
 * `dispatched` tells whether the command reached the socket, so callers can
 * treat the player state as possibly changed. The message never carries
 * command arguments, which may include stream URLs.
 */
export class MpvIpcCommandError extends Error {
    constructor(
        readonly command: string,
        message: string,
        readonly dispatched: boolean,
        readonly mpvError: string | null = null
    ) {
        super(`mpv ${command}: ${message}`);
        this.name = 'MpvIpcCommandError';
    }
}

let nextRequestId = 1;

function parseReplyLine(line: string): Partial<MpvIpcReply> | null {
    try {
        const parsed: unknown = JSON.parse(line);
        return parsed && typeof parsed === 'object'
            ? (parsed as Partial<MpvIpcReply>)
            : null;
    } catch {
        return null;
    }
}

/**
 * Sends one command to a reused mpv over its IPC socket and resolves with
 * mpv's matching reply. Every command carries a `request_id`; event lines
 * and replies to other requests on the same connection are skipped. Resolves
 * `false` when `shouldDispatch` vetoed the write, and rejects with
 * {@link MpvIpcCommandError} on an error reply, a missing reply, or a socket
 * failure.
 */
export function sendMpvCommand(
    socketPath: string,
    command: string,
    args: Array<string | number>,
    options: MpvIpcCommandOptions = {}
): Promise<MpvIpcReply | false> {
    return new Promise((resolve, reject) => {
        const requestId = nextRequestId++;
        const client = createConnection(socketPath);
        const request =
            JSON.stringify({
                command: [command, ...args],
                request_id: requestId,
            }) + '\n';
        let settled = false;
        let dispatched = false;
        let buffered = '';
        let timeoutHandle: NodeJS.Timeout | null = null;
        const settle = (
            outcome: { reply: MpvIpcReply | false } | { error: Error }
        ) => {
            if (settled) return;
            settled = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (!client.destroyed) client.destroy();
            if ('error' in outcome) {
                reject(outcome.error);
            } else {
                resolve(outcome.reply);
            }
        };
        const fail = (message: string, mpvError: string | null = null) =>
            settle({
                error: new MpvIpcCommandError(
                    command,
                    message,
                    dispatched,
                    mpvError
                ),
            });
        const consumeLine = (line: string) => {
            const reply = parseReplyLine(line);
            if (!reply || reply.request_id !== requestId) return;
            // mpv always answers with a string `error`; anything else is not
            // a confirmation and must not skip the fallback.
            if (typeof reply.error !== 'string') {
                fail('malformed reply');
                return;
            }
            const error = reply.error;
            traceExternalPlayer('mpv ipc reply', { command, error });
            if (error === 'success') {
                settle({
                    reply: { request_id: requestId, error, data: reply.data },
                });
            } else {
                fail(error, error);
            }
        };

        client.on('connect', () => {
            if (options.shouldDispatch && !options.shouldDispatch()) {
                settle({ reply: false });
                return;
            }
            traceExternalPlayer('mpv ipc command', {
                command,
                argsCount: args.length,
            });
            try {
                client.write(request);
                dispatched = true;
                options.onDispatched?.();
            } catch (error) {
                fail(error instanceof Error ? error.message : String(error));
            }
        });
        client.on('data', (chunk) => {
            if (settled) return;
            buffered += chunk.toString();
            const lines = buffered.split('\n');
            buffered = lines.pop() ?? '';
            for (const line of lines) {
                if (line.trim()) consumeLine(line);
                if (settled) return;
            }
        });
        client.on('error', (error) => fail(error.message));
        client.on('close', () => fail('socket closed before reply'));
        timeoutHandle = setTimeout(
            () => fail('reply timed out'),
            MPV_IPC_COMMAND_TIMEOUT_MS
        );
        timeoutHandle.unref();
    });
}
