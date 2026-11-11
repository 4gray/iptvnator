import { createConnection } from 'net';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import {
    externalPlayerSessions,
    traceExternalPlayer,
} from './external-player-runtime';
import {
    allowExternalPlayerMediaDispatch,
    markExternalPlayerOpened,
} from './external-player-idle-monitor';

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

type MpvMediaOutcome = boolean | 'unsupported' | undefined;

export interface MpvIpcCommandOptions {
    /** Checked once connected; a `false` skips the write and resolves `false`. */
    shouldDispatch?: () => boolean;
    /** Runs right after the command was written, before any reply. */
    onDispatched?: () => void;
    media?: {
        signal: AbortSignal;
        onOutcome: (loaded: MpvMediaOutcome) => void;
    };
}

type MpvIpcMessage = Partial<MpvIpcReply> & {
    event?: string;
    playlist_entry_id?: number;
    reason?: string;
    playlist_insert_id?: number;
    playlist_insert_num_entries?: number;
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

export function publishMpvMediaOutcome(
    sessionId: string,
    loaded: MpvMediaOutcome
): void {
    const current = externalPlayerSessions.getSession(sessionId);
    if (!current || current.status === 'closed' || current.status === 'error')
        return;
    externalPlayerSessions.updateSession(
        sessionId,
        loaded === undefined || loaded === 'unsupported'
            ? {
                  playbackUnverified: true,
                  ...(loaded === 'unsupported' && {
                      mediaObservationUnavailable: true,
                  }),
              }
            : loaded
              ? {
                    mediaLoaded: true,
                    playbackIdle: false,
                    playbackUnverified: undefined,
                }
              : { playbackIdle: true }
    );
}

export function markMpvOpened(
    sessionId: string,
    socketPath?: string | null,
    hasOwner = () => true,
    confirmFreshMedia = false
) {
    const current = externalPlayerSessions.getSession(sessionId);
    if (
        confirmFreshMedia &&
        current?.status === 'launching' &&
        current.mediaLoaded !== true
    )
        externalPlayerSessions.updateSession(sessionId, {
            mediaLoaded: false,
            playbackUnverified: socketPath ? current.playbackUnverified : true,
            mediaObservationUnavailable: socketPath
                ? current.mediaObservationUnavailable
                : true,
        });
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
                  if (!canRead()) return undefined;
                  return reply && typeof reply.data === 'boolean'
                      ? reply.data
                      : null;
              }
            : undefined
    );
}

export async function completeFreshMpvLaunch(
    session: ExternalPlayerSession,
    socketPath: string | null,
    hasOwner: () => boolean,
    guideLaunch: boolean,
    signal?: AbortSignal
): Promise<ExternalPlayerSession | null> {
    if (socketPath && signal && !signal.aborted) {
        const current = externalPlayerSessions.getSession(session.id);
        if (current?.status === 'launching')
            externalPlayerSessions.updateSession(session.id, {
                mediaLoaded: false,
            });
        if (
            !(await loadFreshMpvGuideMedia(
                session.id,
                socketPath,
                session.streamUrl,
                hasOwner,
                signal
            ))
        )
            return null;
    }
    if (signal?.aborted)
        return externalPlayerSessions.getSession(session.id) ?? session;
    markMpvOpened(
        session.id,
        guideLaunch && !signal ? null : socketPath,
        hasOwner,
        guideLaunch
    );
    return externalPlayerSessions.getSession(session.id) ?? session;
}

/** Dispatch once the new child exposes IPC, then observe the exact loadfile entry. */
export async function loadFreshMpvGuideMedia(
    sessionId: string,
    socketPath: string,
    url: string,
    hasOwner: () => boolean,
    signal: AbortSignal
): Promise<boolean> {
    const deadline = Date.now() + MPV_IPC_COMMAND_TIMEOUT_MS;
    const shouldDispatch = () => {
        const status = externalPlayerSessions.getSession(sessionId)?.status;
        return (
            !signal.aborted &&
            hasOwner() &&
            (status === 'launching' ||
                status === 'opened' ||
                status === 'playing')
        );
    };
    while (shouldDispatch()) {
        try {
            await sendMpvCommand(socketPath, 'loadfile', [url, 'replace'], {
                shouldDispatch: () =>
                    shouldDispatch() &&
                    allowExternalPlayerMediaDispatch(sessionId),
                media: {
                    signal,
                    onOutcome: (loaded) => {
                        if (shouldDispatch())
                            publishMpvMediaOutcome(sessionId, loaded);
                    },
                },
            });
            return true;
        } catch (error) {
            if (
                error instanceof MpvIpcCommandError &&
                !error.dispatched &&
                shouldDispatch()
            ) {
                if (Date.now() >= deadline) return false;
                await new Promise<void>((resolve) =>
                    setTimeout(resolve, 50).unref()
                );
                continue;
            }
            if (shouldDispatch()) publishMpvMediaOutcome(sessionId, undefined);
            return true;
        }
    }
    return true;
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
        let expected: { first: number; last: number }[] | undefined;
        let startedEntry: number | undefined;
        const earlyEvents: MpvIpcMessage[] = [];
        const disconnect = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            media?.signal.removeEventListener('abort', disconnect);
            expected = undefined;
            if (!client.destroyed) client.destroy();
        };
        const finishMedia = (loaded: MpvMediaOutcome) => {
            disconnect();
            if (!media?.signal.aborted) media?.onOutcome(loaded);
        };
        const observe = (event: MpvIpcMessage) => {
            if (!expected) return;
            if (event.event === 'start-file') startedEntry = readEntryId(event);
            const entry =
                event.event === 'file-loaded'
                    ? startedEntry
                    : readEntryId(event);
            if (entry === undefined) return;
            const index = expected.findIndex(
                ({ first, last }) => entry >= first && entry <= last
            );
            if (index < 0) return;
            if (event.event === 'file-loaded') finishMedia(true);
            else if (event.event === 'end-file') {
                const [range] = expected.splice(index, 1);
                if (range.first < entry)
                    expected.push({ first: range.first, last: entry - 1 });
                if (entry < range.last)
                    expected.push({ first: entry + 1, last: range.last });
                const first = event.playlist_insert_id;
                const count = event.playlist_insert_num_entries;
                if (event.reason === 'redirect') {
                    if (
                        typeof first === 'number' &&
                        typeof count === 'number' &&
                        Number.isSafeInteger(first) &&
                        Number.isSafeInteger(count) &&
                        first > 0 &&
                        count > 0 &&
                        Number.isSafeInteger(first + count - 1)
                    )
                        expected.push({ first, last: first + count - 1 });
                    else finishMedia(undefined);
                } else if (expected.length === 0) finishMedia(false);
            }
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
                const entry =
                    media && !media.signal.aborted && outcome.reply
                        ? readEntryId(outcome.reply.data)
                        : undefined;
                if (entry === undefined) {
                    if (outcome.reply && media) finishMedia('unsupported');
                    else disconnect();
                } else {
                    expected = [{ first: entry, last: entry }];
                    media?.signal.addEventListener('abort', disconnect, {
                        once: true,
                    });
                    timeoutHandle = setTimeout(
                        () => finishMedia(undefined),
                        MPV_MEDIA_OBSERVATION_TIMEOUT_MS
                    ).unref();
                }
                resolve(outcome.reply);
                earlyEvents.splice(0).forEach(observe);
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
                if (settled) observe(reply);
                else if (
                    earlyEvents.length < 16 &&
                    ['start-file', 'file-loaded', 'end-file'].includes(
                        reply.event
                    )
                )
                    earlyEvents.push(reply);
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
            if (settled && !expected) return;
            buffered += chunk.toString();
            const lines = buffered.split('\n');
            buffered = lines.pop() ?? '';
            for (const line of lines) {
                if (line.trim()) consumeLine(line);
                if (settled && !expected) return;
            }
        });
        client.on('error', (error) =>
            settled
                ? expected
                    ? finishMedia(undefined)
                    : disconnect()
                : fail(error.message)
        );
        client.on('close', () =>
            settled
                ? expected
                    ? finishMedia(undefined)
                    : disconnect()
                : fail('socket closed before reply')
        );
        timeoutHandle = setTimeout(
            () => fail('reply timed out'),
            MPV_IPC_COMMAND_TIMEOUT_MS
        );
        timeoutHandle.unref();
    });
}
