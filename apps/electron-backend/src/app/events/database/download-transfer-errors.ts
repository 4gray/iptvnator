import {
    getPartialDownloadSize,
    type ReservedPartialDownloadFile,
} from './download-file-path';
import type { TransferProgress } from './download-task';

/**
 * Log transfer failures by message only: a raw AxiosError dumps its request
 * config, and download URLs can embed portal credentials.
 */
export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The response stream ended cleanly before the advertised representation
 * size was reached (e.g. a proxy that caps each response). The partial is
 * valid — the caller must retain it so a retry can continue via Range.
 */
export class TruncatedTransferError extends Error {
    constructor(readonly progress: TransferProgress) {
        super('Transfer ended before the advertised size');
    }
}

export class InterruptedTransferError extends Error {
    constructor(
        readonly progress: TransferProgress,
        networkCode: string
    ) {
        super(
            `DOWNLOAD_NETWORK_INTERRUPTED (${networkCode}): Retry to continue from the saved partial file`
        );
    }
}

/**
 * Mid-transfer codes plus connection-establishment failures: a reconnect
 * attempt against a rebooting host fails before any response, and deleting
 * a multi-gigabyte partial over that would be data loss, not cleanup.
 */
const RETAINABLE_NETWORK_ERROR_CODES = new Set([
    'EAI_AGAIN',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'ETIMEDOUT',
    'ERR_HTTP2_STREAM_CANCEL',
    'ERR_HTTP2_STREAM_ERROR',
    'ERR_STREAM_PREMATURE_CLOSE',
]);

export function getNetworkErrorCode(error: unknown): string {
    return error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
}

export function isRetainableNetworkCode(code: string): boolean {
    return RETAINABLE_NETWORK_ERROR_CODES.has(code);
}

export type RangeNotSatisfiableAction = 'complete' | 'restart' | 'retain';

/**
 * Decides what a 416 answer to a resume request proves. `complete` requires
 * an exact-EOF request with identity proof (If-Range, or the EOF probe that
 * follows a fully verified overlap replay) AND a stated length equal to the
 * partial — a bare length match on a rewound request proves nothing about
 * whose bytes are on disk. `restart` requires a stated total that proves the
 * entity shrank below the requested offset; everything ambiguous or
 * contradictory retains, because deleting bytes is the only unrecoverable
 * outcome.
 */
export function classifyRangeNotSatisfiable(input: {
    confirmedTotal: number | null;
    identityProven: boolean;
    resumeOffset: number;
    retainedOffset: number;
}): RangeNotSatisfiableAction {
    const { confirmedTotal, identityProven, resumeOffset, retainedOffset } =
        input;
    const atExactEof = resumeOffset === retainedOffset;
    if (atExactEof && identityProven && confirmedTotal === retainedOffset) {
        return 'complete';
    }
    if (confirmedTotal === null) {
        // Unsatisfiability alone never proves the entity shrank relative to
        // the retained bytes — the stated length is optional, and a request
        // at the entity's true end always collects a 416. Data safety wins.
        return 'retain';
    }
    if (
        confirmedTotal < resumeOffset ||
        (confirmedTotal === resumeOffset && !atExactEof)
    ) {
        // The stated entity end sits at or below the requested first byte of
        // a REWOUND request: the partial provably extends past the current
        // entity, so the representation changed. (Equality at an exact-EOF
        // request means the opposite — the partial IS the entity — and is
        // handled by the complete/retain branches.)
        return 'restart';
    }
    // Ambiguous or contradictory: an exact-EOF length match without identity
    // proof, or a stated total claiming the rewound range WAS satisfiable.
    return 'retain';
}

/** HTTP 416: the requested Range starts at or past the entity's end. */
export function isRangeNotSatisfiable(error: unknown): boolean {
    return (
        !!error &&
        typeof error === 'object' &&
        'response' in error &&
        (error as { response?: { status?: number } }).response?.status === 416
    );
}

/**
 * Wraps a request-phase failure (no response, e.g. a refused reconnect) into
 * the same retained-partial interruption as a mid-transfer reset, so the
 * bytes already on disk survive the failure. Returns null when the error or
 * the on-disk state does not justify retention.
 */
export function toRetainedInterruption(
    error: unknown,
    reservation: ReservedPartialDownloadFile,
    totalBytes: number | null | undefined
): InterruptedTransferError | null {
    const interrupted = getInterruptedTransferProgress(
        error,
        reservation,
        0,
        totalBytes ?? null
    );
    return interrupted
        ? new InterruptedTransferError(
              interrupted.progress,
              interrupted.networkCode
          )
        : null;
}

export function getInterruptedTransferProgress(
    error: unknown,
    reservation: ReservedPartialDownloadFile,
    initialBytes: number,
    totalBytes: number | null
): { networkCode: string; progress: TransferProgress } | null {
    const networkCode = getNetworkErrorCode(error);
    if (!RETAINABLE_NETWORK_ERROR_CODES.has(networkCode)) {
        return null;
    }

    const bytesDownloaded = getPartialDownloadSize(reservation.path);
    if (bytesDownloaded === 0 || bytesDownloaded < initialBytes) {
        return null;
    }
    if (totalBytes !== null && bytesDownloaded < totalBytes) {
        return { networkCode, progress: { bytesDownloaded, totalBytes } };
    }
    // Retention needs no further evidence: since overlap verification owns
    // resume correctness, the next attempt can safely prove, resume, or
    // restart over ANY retained partial — deleting bytes is the only
    // unrecoverable outcome. A total the bytes on disk have falsified is
    // persisted as unknown, never as the falsified value, which would let
    // the completed-partial shortcut finalize unverified bytes.
    return { networkCode, progress: { bytesDownloaded, totalBytes: null } };
}
