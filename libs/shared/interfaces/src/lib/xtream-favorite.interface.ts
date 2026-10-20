/** Catalog membership is separate from whether a stream can currently play. */
export const XTREAM_FAVORITE_CATALOG_STATUS = {
    PRESENT: 'present',
    MISSING: 'missing',
    UNKNOWN: 'unknown',
} as const;

export type XtreamFavoriteCatalogStatus =
    (typeof XTREAM_FAVORITE_CATALOG_STATUS)[keyof typeof XTREAM_FAVORITE_CATALOG_STATUS];

export interface XtreamFavoriteSnapshot {
    title: string;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    tmdbId?: number | null;
    releaseYear?: number | null;
    originalTitle?: string | null;
    /** Availability evidence, retained through backup and deferred restore. */
    catalogStatus?: XtreamFavoriteCatalogStatus;
    catalogMissingReason?: 'absent' | 'identity_conflict';
}

/** Numeric references are legacy catalog row IDs, never provider IDs. */
export type XtreamFavoriteRemovalRef = number | { favoriteId: number };

export const XTREAM_FAVORITE_IDENTITY_CONFLICT =
    'XTREAM_FAVORITE_IDENTITY_CONFLICT';

export function isCatalogUnavailable(item: {
    catalogStatus?: XtreamFavoriteCatalogStatus;
}): boolean {
    return item.catalogStatus === 'missing' || item.catalogStatus === 'unknown';
}
