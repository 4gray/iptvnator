/** The renderer splits larger channel batches; anything beyond this is dropped. */
export const EPG_GUIDE_MAX_CHANNELS_PER_REQUEST = 100;

/**
 * Coverage checks are cheap (`selectDistinct` over an already-scoped id set)
 * and portal hosts may probe many more keys than a single guide screen shows
 * at once, so this cap is intentionally much larger than the programme cap.
 */
export const EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST = 2000;

/** Bound on how many distinct EPG source URLs one request may scope to. */
const MAX_SOURCE_URLS_PER_REQUEST = 50;

/** Largest |ms| `Date` can serialize; a corrupt payload must not throw in SQL. */
const MAX_SERIALIZABLE_MS = 8.64e15;

/**
 * Slack applied to the index-usable plain-string bounds
 * (`fromSlackIso`/`toSlackIso`) that `guideWindowCondition` puts beside its
 * exact `datetime()` overlap test.
 *
 * Stored `start`/`stop` are ISO-8601 strings, so a lexicographic compare
 * orders them by their local wall-clock prefix rather than by the instant
 * they denote. A provider offset shifts the true instant by at most 14 h, and
 * a same-day `'YYYY-MM-DD HH:MM'` vs `'…THH:MM'` format difference by less
 * than 24 h (a space sorts before 'T'), so 48 h of slack keeps the
 * prefilter a strict superset of the exact result — while cutting the
 * per-channel scan from the channel's whole retained history down to about
 * four days. Rows whose strings `datetime()` cannot parse fail the exact
 * predicate anyway, so the prefilter can never change the answer.
 */
const GUIDE_WINDOW_SLACK_MS = 48 * 60 * 60 * 1000;

export interface EpgGuideWindowRequest {
    channelIds: string[];
    /** Provider-clock instants (the renderer removes the display offset). */
    fromMs: number;
    toMs: number;
    sourceUrls?: string[];
}

export interface NormalizedGuideWindow {
    channelIds: string[];
    fromIso: string;
    toIso: string;
    /**
     * The same window widened by `GUIDE_WINDOW_SLACK_MS` on both sides, for
     * the plain-string prefilter that lets SQLite bound its
     * `(channel_id, start, stop)` index scan. Never a substitute for the
     * exact `datetime()` comparison against `fromIso`/`toIso`.
     */
    fromSlackIso: string;
    toSlackIso: string;
    sourceUrls: string[];
}

function isUsableInstant(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= MAX_SERIALIZABLE_MS
    );
}

/**
 * Serializes a widened bound. `toISOString()` throws past
 * `MAX_SERIALIZABLE_MS`, so the slack is clamped there. A bound that lands in
 * the extended `+YYYYYY-…` year form is one `datetime()` cannot parse, so the
 * exact predicate already excludes every row for such a window and the
 * narrower prefilter stays harmless.
 */
function slackIso(ms: number): string {
    const clamped = Math.min(
        Math.max(ms, -MAX_SERIALIZABLE_MS),
        MAX_SERIALIZABLE_MS
    );
    return new Date(clamped).toISOString();
}

/** Trims, drops blanks, de-duplicates (first-occurrence order) and caps. */
export function uniqueTrimmedStrings(values: unknown, max: number): string[] {
    if (!Array.isArray(values)) {
        return [];
    }
    const seen = new Set<string>();
    for (const value of values) {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (trimmed.length > 0) {
            seen.add(trimmed);
        }
    }
    return Array.from(seen).slice(0, max);
}

/** Validates and trims a request; `null` means "nothing to query". */
export function normalizeGuideWindow(
    request: EpgGuideWindowRequest,
    maxChannels = EPG_GUIDE_MAX_CHANNELS_PER_REQUEST
): NormalizedGuideWindow | null {
    if (
        !isUsableInstant(request.fromMs) ||
        !isUsableInstant(request.toMs) ||
        request.fromMs >= request.toMs ||
        !Array.isArray(request.channelIds)
    ) {
        return null;
    }
    const channelIds = uniqueTrimmedStrings(request.channelIds, maxChannels);
    if (channelIds.length === 0) {
        return null;
    }
    const sourceUrls = uniqueTrimmedStrings(
        request.sourceUrls ?? [],
        MAX_SOURCE_URLS_PER_REQUEST
    );
    return {
        channelIds,
        fromIso: new Date(request.fromMs).toISOString(),
        toIso: new Date(request.toMs).toISOString(),
        fromSlackIso: slackIso(request.fromMs - GUIDE_WINDOW_SLACK_MS),
        toSlackIso: slackIso(request.toMs + GUIDE_WINDOW_SLACK_MS),
        sourceUrls,
    };
}
