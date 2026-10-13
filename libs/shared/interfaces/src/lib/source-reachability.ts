import type { SourceHealthReason, SourceHealthSnapshot } from './source-health';

/**
 * What a source list shows about one network source, folded from the six
 * health states: `ok` answers, `bad` does not, `expired` answers with an
 * expired account, `checking` is mid-check with nothing known yet, and
 * `unknown` was never checked or the check was inconclusive.
 */
export type SourceReachability =
    'ok' | 'bad' | 'expired' | 'checking' | 'unknown';

/** A reachability a check actually established. */
export type ConclusiveSourceReachability = Extract<
    SourceReachability,
    'ok' | 'bad' | 'expired'
>;

/** The two choices of a "responds / does not respond" status filter. */
export type SourceStatusBucket = 'ok' | 'bad';

/** A network source's status as a list shows it. */
export interface SourceStatus {
    reachability: SourceReachability;
    /** When the current run of failed checks began. */
    failingSince?: number;
    checkedAt?: number;
    /** A check is running; `reachability` is the last known result. */
    pending?: boolean;
    /**
     * Why the check concluded what it did (`auth`, `disabled`, `timeout`…),
     * when known; a list otherwise describes the reachability alone.
     */
    reason?: SourceHealthReason;
}

/**
 * Health reasons that mean the source itself did not answer properly. A
 * paused, cancelled or unknown check says nothing about the source.
 */
const UNREACHABLE_REASONS = new Set(['network', 'timeout', 'http', 'invalid']);

export function sourceReachabilityFromHealth(
    snapshot: Pick<SourceHealthSnapshot, 'state' | 'reason'> | undefined
): SourceReachability {
    switch (snapshot?.state) {
        case 'active':
            return 'ok';
        case 'expired':
            return 'expired';
        case 'inactive':
            return 'bad';
        case 'checking':
            return 'checking';
        case 'unavailable':
            return UNREACHABLE_REASONS.has(snapshot.reason) ? 'bad' : 'unknown';
        default:
            return 'unknown';
    }
}

/** The browser build's Xtream portal status, by the same rules. */
export function sourceReachabilityFromPortalStatus(
    status: 'active' | 'inactive' | 'expired' | 'unavailable' | 'checking'
): SourceReachability {
    switch (status) {
        case 'active':
            return 'ok';
        case 'expired':
            return 'expired';
        case 'checking':
            return 'checking';
        default:
            return 'bad';
    }
}

export function isConclusiveReachability(
    reachability: SourceReachability
): reachability is ConclusiveSourceReachability {
    return (
        reachability === 'ok' ||
        reachability === 'bad' ||
        reachability === 'expired'
    );
}

/**
 * Expired accounts count as not responding: the source answers, but the
 * account cannot play anything, which is what the filter is for.
 */
export function sourceStatusBucket(
    reachability: SourceReachability
): SourceStatusBucket | null {
    if (reachability === 'ok') {
        return 'ok';
    }
    return reachability === 'bad' || reachability === 'expired' ? 'bad' : null;
}

/** The last conclusive result kept for a source across restarts. */
export interface SourceHealthHistoryEntry {
    state: ConclusiveSourceReachability;
    checkedAt: number;
    /** When the current run of failed checks began; absent while `ok`. */
    failingSince?: number;
    lastSuccessAt?: number;
    /** The cause of the last failed check; absent while `ok`. */
    reason?: SourceHealthReason;
}

/**
 * Folds one check into the kept history. An inconclusive check keeps the
 * previous entry; a failure keeps the start of the current failing run, so
 * a source that has not answered for three days still says three days after
 * every later failed check.
 */
export function nextSourceHealthHistory(
    previous: SourceHealthHistoryEntry | undefined,
    reachability: SourceReachability,
    checkedAt: number,
    reason?: SourceHealthReason
): SourceHealthHistoryEntry | undefined {
    if (!isConclusiveReachability(reachability)) {
        return previous;
    }
    if (reachability === 'ok') {
        return { state: 'ok', checkedAt, lastSuccessAt: checkedAt };
    }
    const wasFailing = previous !== undefined && previous.state !== 'ok';
    return {
        state: reachability,
        checkedAt,
        failingSince: wasFailing
            ? (previous.failingSince ?? previous.checkedAt)
            : checkedAt,
        ...(previous?.lastSuccessAt !== undefined
            ? { lastSuccessAt: previous.lastSuccessAt }
            : {}),
        ...(reason ? { reason } : {}),
    };
}
