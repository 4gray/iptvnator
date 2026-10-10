import { PlayerContentInfo } from './portal-playback.interface';

export type ExternalPlayerName = 'mpv' | 'vlc';

export type ExternalPlayerSessionStatus =
    'launching' | 'opened' | 'playing' | 'error' | 'closed';

/**
 * Why an external player failed. The main process classifies the failure and
 * the renderer translates it; the raw player output stays in `error`.
 */
export type ExternalPlayerErrorCode =
    | 'start-failed'
    | 'previous-closing'
    | 'closed-unexpectedly'
    | 'stream-open-failed'
    | 'unsupported-protocol'
    | 'connection-failed'
    | 'access-denied'
    | 'stream-not-found'
    | 'timed-out';

/** Translation keys for each code; a message may use `{{player}}`. */
export const EXTERNAL_PLAYER_ERROR_KEYS: Readonly<
    Record<ExternalPlayerErrorCode, string>
> = {
    'start-failed': 'EXTERNAL_PLAYER.ERRORS.START_FAILED',
    'previous-closing': 'EXTERNAL_PLAYER.ERRORS.PREVIOUS_CLOSING',
    'closed-unexpectedly': 'EXTERNAL_PLAYER.ERRORS.CLOSED_UNEXPECTEDLY',
    'stream-open-failed': 'EXTERNAL_PLAYER.ERRORS.STREAM_OPEN_FAILED',
    'unsupported-protocol': 'EXTERNAL_PLAYER.ERRORS.UNSUPPORTED_PROTOCOL',
    'connection-failed': 'EXTERNAL_PLAYER.ERRORS.CONNECTION_FAILED',
    'access-denied': 'EXTERNAL_PLAYER.ERRORS.ACCESS_DENIED',
    'stream-not-found': 'EXTERNAL_PLAYER.ERRORS.STREAM_NOT_FOUND',
    'timed-out': 'EXTERNAL_PLAYER.ERRORS.TIMED_OUT',
};

/** For output no code describes; takes `{{player}}` and the raw `{{error}}`. */
export const EXTERNAL_PLAYER_UNKNOWN_ERROR_KEY =
    'EXTERNAL_PLAYER.ERRORS.UNKNOWN';

/** For a rejected launch that carries no code; takes `{{player}}`. */
export const EXTERNAL_PLAYER_LAUNCH_FAILED_KEY =
    'EXTERNAL_PLAYER.ERRORS.LAUNCH_FAILED';

const EXTERNAL_PLAYER_ERROR_TAG = /\[iptvnator:external-player:([a-z-]+)\]/;

/**
 * Prefixes an error message with its code. A rejected IPC call reaches the
 * renderer as a message only, so the code has to travel inside it.
 */
export function tagExternalPlayerError(
    code: ExternalPlayerErrorCode,
    message: string
): string {
    return `[iptvnator:external-player:${code}] ${message}`;
}

/** Reads the code `tagExternalPlayerError` put into an error message. */
export function readExternalPlayerErrorCode(
    error: unknown
): ExternalPlayerErrorCode | null {
    const message =
        typeof error === 'string'
            ? error
            : (error as { message?: unknown } | null)?.message;
    const code =
        typeof message === 'string'
            ? EXTERNAL_PLAYER_ERROR_TAG.exec(message)?.[1]
            : undefined;
    return code &&
        Object.prototype.hasOwnProperty.call(EXTERNAL_PLAYER_ERROR_KEYS, code)
        ? (code as ExternalPlayerErrorCode)
        : null;
}

export interface ExternalPlayerSession {
    id: string;
    player: ExternalPlayerName;
    status: ExternalPlayerSessionStatus;
    title: string;
    thumbnail?: string | null;
    streamUrl: string;
    contentInfo?: PlayerContentInfo;
    startedAt: string;
    updatedAt: string;
    /** Raw failure detail; the dock translates `errorCode` instead. */
    error?: string;
    errorCode?: ExternalPlayerErrorCode;
    canClose: boolean;
    /** Exact failed replacement displaced by this restored live session. */
    restoredFromSessionId?: string;
}
