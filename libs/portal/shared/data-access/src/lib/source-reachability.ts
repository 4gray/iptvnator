import type {
    ConclusiveSourceReachability,
    SourceHealthHistoryEntry,
    SourceHealthReason,
    SourceHealthSnapshot,
    SourceReachability,
    SourceStatusBucket,
} from '@iptvnator/shared/interfaces';

// Runtime helpers live here, beside the lazily loaded services that use
// them: in `@iptvnator/shared/interfaces` they rode into a chunk the app
// preloads at startup.

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

/**
 * Folds one check into the kept history. An inconclusive check keeps the
 * previous entry; a failure keeps the start of the current failing run, so
 * a source that has not answered for three days still says three days after
 * every later failed check.
 */
export function nextSourceHealthHistory(
    kept: SourceHealthHistoryEntry | undefined,
    reachability: SourceReachability,
    checkedAt: number,
    detail: { reason?: SourceHealthReason; connection?: string } = {}
): SourceHealthHistoryEntry | undefined {
    const { reason, connection } = detail;
    // A check of another connection starts the history over.
    const previous =
        kept?.connection && connection && kept.connection !== connection
            ? undefined
            : kept;
    if (!isConclusiveReachability(reachability)) {
        return previous;
    }
    const checked = connection ? { connection } : {};
    if (reachability === 'ok') {
        return { state: 'ok', checkedAt, lastSuccessAt: checkedAt, ...checked };
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
        ...checked,
    };
}
