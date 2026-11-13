export type HeaderOverride = {
    authorization?: string;
    cookie?: string;
    /**
     * Origin the credentials belong to — always the stream URL's own origin.
     * Cookie/Authorization are attached only on an exact match, never on the
     * broader `scopeOrigins` set that User-Agent/Referer/Origin use.
     */
    credentialOrigin?: string;
    origin?: string;
    referer?: string;
    scopeOrigins?: Set<string>;
    userAgent?: string;
};

/** A scoped override together with what decides its precedence. */
export type ScopedHeaderOverride = HeaderOverride & {
    /** Stream URL the override was configured for, see `toComparableUrl`. */
    scopeUrl: string;
    /** Grows with every configure call; higher means configured later. */
    sequence: number;
};

export function normalizeHeaderValue(
    value?: string | null
): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    // A control character in a header value is never legitimate and could
    // otherwise smuggle extra headers into the raw request.
    // eslint-disable-next-line no-control-regex
    if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) {
        return undefined;
    }

    return trimmed;
}

export function getOrigin(value?: string | null): string | undefined {
    const normalizedValue = normalizeHeaderValue(value);

    if (!normalizedValue) {
        return undefined;
    }

    try {
        return new URL(normalizedValue).origin;
    } catch {
        return undefined;
    }
}

/**
 * The form Chromium reports request URLs in, so a configured stream URL can
 * be compared with `details.url`. Unparseable input matches no request.
 */
export function toComparableUrl(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    try {
        return new URL(value.trim()).href;
    } catch {
        return '';
    }
}

export function shouldApplyOverride(
    url: string,
    override: HeaderOverride
): boolean {
    if (!override.scopeOrigins) {
        return true;
    }

    const requestOrigin = getOrigin(url);
    return Boolean(requestOrigin && override.scopeOrigins.has(requestOrigin));
}

/**
 * Scoped overrides that apply to a request, weakest first: callers apply
 * them in order, so the last one wins a header both set.
 *
 * With a single override — every surface outside multiview — this is that
 * override or nothing. With several owners on one origin, a request for an
 * owner's exact stream URL gets that owner's headers; any other request on
 * the origin (segments, keys) cannot be attributed to an owner, so the most
 * recently configured override wins.
 */
export function selectScopedOverrides(
    url: string,
    overrides: Iterable<ScopedHeaderOverride>
): ScopedHeaderOverride[] {
    const matching: ScopedHeaderOverride[] = [];
    for (const override of overrides) {
        if (shouldApplyOverride(url, override)) {
            matching.push(override);
        }
    }

    if (matching.length < 2) {
        return matching;
    }

    return matching.sort((left, right) => {
        const leftExact = left.scopeUrl === url ? 1 : 0;
        const rightExact = right.scopeUrl === url ? 1 : 0;
        return leftExact - rightExact || left.sequence - right.sequence;
    });
}
