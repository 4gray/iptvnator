export const STALKER_SIMILAR_ORIGIN = 'stalkerSimilarOrigin';
export const STALKER_SIMILAR_FRAGMENT = 'stalker-related-';

/** Local handoff data for returning to the inline detail behind a Similar card. */
export interface StalkerSimilarOrigin {
    playlistId: string;
    catalog: 'vod' | 'series';
    item: Record<string, unknown>;
    catalogReturnId?: number;
    search?: { scrollTop: number; pagingId?: number };
}

export function getStalkerSimilarOrigin(
    state: unknown
): StalkerSimilarOrigin | null {
    const origin = (state as Record<string, unknown> | null)?.[
        STALKER_SIMILAR_ORIGIN
    ] as StalkerSimilarOrigin | undefined;
    return typeof origin?.playlistId === 'string' &&
        origin.playlistId &&
        (origin.catalog === 'vod' || origin.catalog === 'series') &&
        origin.item &&
        typeof origin.item === 'object' &&
        (!origin.search || Number.isFinite(origin.search.scrollTop))
        ? origin
        : null;
}
