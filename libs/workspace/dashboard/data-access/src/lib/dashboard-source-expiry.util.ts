/** Warn this many days before a portal subscription lapses. */
export const SOURCE_EXPIRY_WARNING_DAYS = 7;

/**
 * Longest wait before badge consumers re-check the wall clock even when no
 * badge boundary is due. A timer does not track wall-clock jumps (system
 * sleep, a changed clock), so it is re-armed at least this often.
 */
export const SOURCE_EXPIRY_MAX_WAIT_MS = 60 * 60_000;

const SECONDS_PER_DAY = 86_400;

/**
 * What a source's account facts say about its subscription lifetime.
 * `reportedExpired` covers portals that answer with an expired account
 * status without a usable timestamp; `expiresAtSeconds` is unix seconds
 * when the portal reports one.
 */
export interface SourceExpiryFacts {
    expiresAtSeconds: number | null;
    reportedExpired: boolean;
}

export type SourceExpiryBadge =
    { kind: 'expired' } | { kind: 'expiring'; daysLeft: number };

/**
 * Decides whether a source card should carry an expiry badge. Returns null
 * for unknown expirations and for subscriptions further out than
 * `warningDays` — the badge is a warning, not a countdown.
 */
export function resolveSourceExpiryBadge(
    facts: SourceExpiryFacts | null | undefined,
    nowMs: number,
    warningDays: number = SOURCE_EXPIRY_WARNING_DAYS
): SourceExpiryBadge | null {
    if (!facts) {
        return null;
    }
    if (facts.reportedExpired) {
        return { kind: 'expired' };
    }

    const expiresAt = facts.expiresAtSeconds;
    if (expiresAt === null || expiresAt <= 0) {
        return null;
    }

    const secondsLeft = expiresAt - nowMs / 1000;
    if (secondsLeft <= 0) {
        return { kind: 'expired' };
    }

    const daysLeft = Math.ceil(secondsLeft / SECONDS_PER_DAY);
    return daysLeft <= warningDays ? { kind: 'expiring', daysLeft } : null;
}

/**
 * The next instant (ms) at which {@link resolveSourceExpiryBadge} would answer
 * differently for these facts, or null when no boundary lies ahead: a
 * portal-reported expiry, or a timestamp already in the past (for as long as
 * the system clock only moves forward). The badge moves only at day
 * granularity: it appears `warningDays` days before expiry, counts down once
 * per day and turns into "expired" at expiry, so a consumer can wait for that
 * boundary instead of polling the clock.
 */
export function nextSourceExpiryChangeMs(
    facts: SourceExpiryFacts | null | undefined,
    nowMs: number,
    warningDays: number = SOURCE_EXPIRY_WARNING_DAYS
): number | null {
    if (!facts || facts.reportedExpired) {
        return null;
    }
    const expiresAt = facts.expiresAtSeconds;
    if (expiresAt === null || expiresAt <= 0) {
        return null;
    }
    const secondsLeft = expiresAt - nowMs / 1000;
    if (secondsLeft <= 0) {
        return null;
    }
    const daysLeft = Math.ceil(secondsLeft / SECONDS_PER_DAY);
    // The count drops by one each time another whole day has passed; above
    // the warning window only the day the badge appears matters.
    const nextDaysLeft = Math.min(daysLeft, warningDays + 1) - 1;
    return (expiresAt - nextDaysLeft * SECONDS_PER_DAY) * 1000;
}
