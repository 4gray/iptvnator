/**
 * Ownership token for a "only the newest request may commit" sequence.
 *
 * Pages that re-issue the same request as the user navigates (catalog
 * matching on the actor and Discover pages) cannot key their in-flight
 * indicator on the SUBJECT of the request: when a replacement request is
 * never issued — the user switched away from the scope that needs it —
 * the obsolete response finds a changed subject and leaves the spinner
 * up forever. The guard separates the two questions: `isLatest` says
 * whether this response still owns the shared state, and the caller
 * keeps whatever subject check decides if the RESULT is still wanted.
 */
export interface LatestRequestGuard {
    /** Claims ownership for a new request and returns its token */
    start(): number;
    /** Whether `token` still belongs to the most recently started request */
    isLatest(token: number): boolean;
}

export function createLatestRequestGuard(): LatestRequestGuard {
    // Tokens start at 1 so the "nothing started yet" state cannot be
    // mistaken for ownership by a caller holding a zeroed token
    let latest = 0;
    return {
        start: () => ++latest,
        isLatest: (token: number) => token > 0 && token === latest,
    };
}
