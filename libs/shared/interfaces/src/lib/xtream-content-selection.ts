/** Top-level catalogs in sidebar/display priority, using persisted type names. */
export const XTREAM_CONTENT_TYPES = ['movie', 'live', 'series'] as const;
export type XtreamContentType = (typeof XTREAM_CONTENT_TYPES)[number];

/** Missing settings preserve legacy behavior; an explicit empty list loads nothing. */
export function normalizeXtreamContentTypes(
    value: unknown
): XtreamContentType[] {
    if (!Array.isArray(value)) return [...XTREAM_CONTENT_TYPES];
    return XTREAM_CONTENT_TYPES.filter((type) => value.includes(type));
}

/** Choose the first enabled section in sidebar order; an empty selection has no target. */
export function getXtreamContentRoute(
    value: unknown
): 'vod' | 'live' | 'series' | null {
    const type = normalizeXtreamContentTypes(value)[0];
    return type === 'movie' ? 'vod' : (type ?? null);
}

export function newlyEnabledXtreamTypes(
    previous: unknown,
    next: unknown
): XtreamContentType[] {
    const enabled = new Set(normalizeXtreamContentTypes(previous));
    return normalizeXtreamContentTypes(next).filter(
        (type) => !enabled.has(type)
    );
}
