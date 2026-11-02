import type { StalkerPortalItem } from '../stalker-portal-item.interface';
import type { FavoriteReference } from './favorites-sync.contract';
/** Ambiguous historical rows remain local; names and commands never establish identity. */
export function stalkerFavoriteReference(
    item: StalkerPortalItem
): Extract<FavoriteReference, { provider: 'stalker' }> | null {
    const id = [item.stream_id, item.id, item.series_id, item.movie_id].find(
        (value) => value != null && String(value).trim()
    );
    if (id == null) return null;
    const category = item.favoriteContentType ?? String(item.category_id ?? '');
    const positive = (value: unknown) =>
        value === true || value === 1 || value === '1';
    const series =
        category === 'series' ||
        item.series_id != null ||
        positive(item.is_series) ||
        !!item.series?.length;
    const kind = series
        ? 'series'
        : category === 'radio' || positive(item.radio)
          ? 'radio'
          : category === 'itv' || item.stream_type === 'live'
            ? 'live'
            : category === 'vod' ||
                item.movie_id != null ||
                item.stream_type === 'movie'
              ? 'movie'
              : null;
    if (!kind) return null;
    const mode =
        category === 'series'
            ? 'regular'
            : item.series?.length
              ? 'embedded'
              : 'lazy';
    return {
        provider: 'stalker',
        kind,
        id: String(id).trim(),
        ...(series ? { mode } : {}),
    };
}
