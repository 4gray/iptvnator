import type { SourceHealthReason } from './source-health';

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

/** The last conclusive result kept for a source across restarts. */
export interface SourceHealthHistoryEntry {
    state: ConclusiveSourceReachability;
    checkedAt: number;
    /** When the current run of failed checks began; absent while `ok`. */
    failingSince?: number;
    lastSuccessAt?: number;
    /** The cause of the last failed check; absent while `ok`. */
    reason?: SourceHealthReason;
    /**
     * Fingerprint of the connection that was checked
     * (`sourceHealthFingerprint`): a result for an edited address or account
     * is not this source's any more.
     */
    connection?: string;
}
