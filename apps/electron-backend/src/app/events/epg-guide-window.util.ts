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
    sourceUrls: string[];
}

function isUsableInstant(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= MAX_SERIALIZABLE_MS
    );
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
        sourceUrls,
    };
}

function escapeSqlLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

/**
 * Plain-SQL twin of the Drizzle overlap predicate, used to prove the
 * predicate's behaviour against a real SQLite engine rather than against a
 * restatement of the builder's own logic. Must stay in lockstep with
 * `guideWindowCondition`'s two `sql\`...\`` fragments.
 */
export function guideWindowOverlapSqlText(
    fromIso: string,
    toIso: string
): string {
    return (
        `datetime(start) < datetime('${escapeSqlLiteral(toIso)}') AND ` +
        `datetime(stop) > datetime('${escapeSqlLiteral(fromIso)}')`
    );
}
