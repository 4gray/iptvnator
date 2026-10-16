/** Xtream's top-level catalogs, using the persisted content type names. */
export const XTREAM_CONTENT_TYPES = ['live', 'movie', 'series'] as const;
export type XtreamContentType = (typeof XTREAM_CONTENT_TYPES)[number];

/** Missing settings preserve legacy behavior; an explicit empty list loads nothing. */
export function normalizeXtreamContentTypes(
    value: unknown
): XtreamContentType[] {
    if (!Array.isArray(value)) return [...XTREAM_CONTENT_TYPES];
    return XTREAM_CONTENT_TYPES.filter((type) => value.includes(type));
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
