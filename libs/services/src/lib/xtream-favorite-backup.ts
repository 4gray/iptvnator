import {
    ElectronBridgeXtreamFavorite,
    XtreamBackupFavoriteItem,
} from '@iptvnator/shared/interfaces';

/** Export the saved display snapshot, including records without catalog rows. */
export function toXtreamBackupFavorite(
    item: ElectronBridgeXtreamFavorite
): XtreamBackupFavoriteItem {
    return {
        xtreamId: item.xtream_id,
        contentType: item.type as XtreamBackupFavoriteItem['contentType'],
        ...(item.added_at ? { addedAt: item.added_at } : {}),
        ...(item.position !== undefined ? { position: item.position } : {}),
        ...(item.title
            ? {
                  snapshot: {
                      title: item.title,
                      ...(item.catalog_missing_reason === 'identity_conflict'
                          ? {
                                catalogStatus: 'missing' as const,
                                catalogMissingReason:
                                    'identity_conflict' as const,
                            }
                          : {}),
                      ...(item.poster_url != null
                          ? { posterUrl: item.poster_url }
                          : {}),
                      ...(item.backdrop_url != null
                          ? { backdropUrl: item.backdrop_url }
                          : {}),
                      ...(item.tmdb_id != null ? { tmdbId: item.tmdb_id } : {}),
                      ...(item.release_year != null
                          ? { releaseYear: item.release_year }
                          : {}),
                      ...(item.original_title != null
                          ? { originalTitle: item.original_title }
                          : {}),
                  },
              }
            : {}),
    };
}
