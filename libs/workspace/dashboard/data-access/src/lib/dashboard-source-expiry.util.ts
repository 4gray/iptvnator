/** Warn this many days before a portal subscription lapses. */
export const SOURCE_EXPIRY_WARNING_DAYS = 7;

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
    | { kind: 'expired' }
    | { kind: 'expiring'; daysLeft: number };

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
