import { createConnection } from 'net';
import {
    externalPlayerSessions,
    traceExternalPlayer,
} from './external-player-runtime';
import { markExternalPlayerOpened } from './external-player-idle-monitor';

/**
 * Bounds connect, write and the wait for mpv's reply. It matches the IPC
 * quit bound the reuse teardown relies on before its exit windows start.
 */
export const MPV_IPC_COMMAND_TIMEOUT_MS = 2_000;
const MPV_MEDIA_OBSERVATION_TIMEOUT_MS = 30_000;

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
    media?: { signal: AbortSignal; onOutcome: (loaded: boolean) => void };
}

type MpvIpcMessage = Partial<MpvIpcReply> & {
    event?: string;
    playlist_entry_id?: number;
    reason?: string;
};

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

export function markMpvOpened(
    sessionId: string,
    socketPath?: string | null,
    hasOwner = () => true,
    confirmFreshMedia = false
) {
    if (
        socketPath &&
        confirmFreshMedia &&
        externalPlayerSessions.getSession(sessionId)?.status === 'launching'
    )
        externalPlayerSessions.updateSession(sessionId, { mediaLoaded: false });
    return markExternalPlayerOpened(
        sessionId,
        socketPath
            ? async (shouldDispatch) => {
                  if (!hasOwner()) return undefined;
                  const canRead = () => shouldDispatch() && hasOwner();
                  const reply = await sendMpvCommand(
                      socketPath,
                      'get_property',
                      ['idle-active'],
                      { shouldDispatch: canRead }
                  );
                  if (
                      confirmFreshMedia &&
                      reply &&
                      reply.data === false &&
                      !externalPlayerSessions.getSession(sessionId)
                          ?.mediaLoaded &&
                      canRead()
                  ) {
                      const playing = await sendMpvCommand(
                          socketPath,
                          'get_property',
                          ['core-idle'],
                          { shouldDispatch: canRead }
                      ).catch(() => false as const);
                      if (playing && playing.data === false && canRead())
                          externalPlayerSessions.updateSession(sessionId, {
                              mediaLoaded: true,
                          });
                  }
                  if (!canRead()) return undefined;
                  return reply && typeof reply.data === 'boolean'
                      ? reply.data
                      : null;
              }
            : undefined
    );
}

function parseReplyLine(line: string): MpvIpcMessage | null {
    try {
        const parsed: unknown = JSON.parse(line);
        return parsed && typeof parsed === 'object'
            ? (parsed as MpvIpcMessage)
            : null;
    } catch {
        return null;
    }
}

function readEntryId(value: unknown): number | undefined {
    if (
        value &&
        typeof value === 'object' &&
        'playlist_entry_id' in value &&
        typeof value.playlist_entry_id === 'number'
    )
        return value.playlist_entry_id;
    return undefined;
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
        const media = options.media;
        let expectedEntry: number | undefined;
        let startedEntry: number | undefined;
        let observed: { entry: number; loaded: boolean } | undefined;
        const disconnect = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            media?.signal.removeEventListener('abort', disconnect);
            expectedEntry = undefined;
            if (!client.destroyed) client.destroy();
        };
        const publishMedia = () => {
            if (
                expectedEntry === undefined ||
                observed?.entry !== expectedEntry
            )
                return;
            disconnect();
            if (!media?.signal.aborted) media?.onOutcome(observed.loaded);
        };
        const settle = (
            outcome: { reply: MpvIpcReply | false } | { error: Error }
        ) => {
            if (settled) return;
            settled = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if ('error' in outcome) {
                disconnect();
                reject(outcome.error);
            } else {
                expectedEntry =
                    media && !media.signal.aborted && outcome.reply
                        ? readEntryId(outcome.reply.data)
                        : undefined;
                if (expectedEntry === undefined) disconnect();
                else {
                    media?.signal.addEventListener('abort', disconnect, {
                        once: true,
                    });
                    timeoutHandle = setTimeout(
                        disconnect,
                        MPV_MEDIA_OBSERVATION_TIMEOUT_MS
                    ).unref();
                }
                resolve(outcome.reply);
                publishMedia();
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
            if (!reply) return;
            if (media && dispatched && reply.event) {
                if (reply.event === 'start-file')
                    startedEntry = readEntryId(reply);
                if (reply.event === 'file-loaded' && startedEntry !== undefined)
                    observed = { entry: startedEntry, loaded: true };
                if (reply.event === 'end-file' && reply.reason !== 'redirect') {
                    const entry = readEntryId(reply);
                    if (entry !== undefined)
                        observed = { entry, loaded: false };
                }
                publishMedia();
                return;
            }
            if (settled || reply.request_id !== requestId) return;
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
            try {
                if (options.shouldDispatch && !options.shouldDispatch()) {
                    settle({ reply: false });
                    return;
                }
                traceExternalPlayer('mpv ipc command', {
                    command,
                    argsCount: args.length,
                });
                client.write(request);
                dispatched = true;
                options.onDispatched?.();
            } catch (error) {
                fail(error instanceof Error ? error.message : String(error));
            }
        });
        client.on('data', (chunk) => {
            if (settled && expectedEntry === undefined) return;
            buffered += chunk.toString();
            const lines = buffered.split('\n');
            buffered = lines.pop() ?? '';
            for (const line of lines) {
                if (line.trim()) consumeLine(line);
                if (settled && expectedEntry === undefined) return;
            }
        });
        client.on('error', (error) =>
            settled ? disconnect() : fail(error.message)
        );
        client.on('close', () =>
            settled ? disconnect() : fail('socket closed before reply')
        );
        timeoutHandle = setTimeout(
            () => fail('reply timed out'),
            MPV_IPC_COMMAND_TIMEOUT_MS
        );
        timeoutHandle.unref();
    });
}
