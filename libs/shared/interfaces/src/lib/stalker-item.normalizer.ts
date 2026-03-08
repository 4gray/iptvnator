import {
    PortalActivityType,
    StalkerPortalItem,
} from './stalker-portal-item.interface';

/**
 * Extract a stable ID from an untyped Stalker portal item.
 *
 * Stalker portals use different id fields depending on the content type
 * (`id`, `stream_id`, `series_id`, `movie_id`). This function returns
 * the first non-empty one, or a generated fallback based on the playlist
 * id and index.
 */
export function extractStalkerItemId(
    item: StalkerPortalItem | Record<string, unknown>,
    fallbackPrefix = '',
    fallbackIndex = 0
): string {
    const raw = item as Record<string, unknown>;
    const id =
        raw['id'] ?? raw['stream_id'] ?? raw['series_id'] ?? raw['movie_id'];
    const idStr = String(id ?? '').trim();
    return idStr || `${fallbackPrefix}-${fallbackIndex}`;
}

/**
 * Extract a display title from a Stalker portal item.
 */
export function extractStalkerItemTitle(
    item: StalkerPortalItem | Record<string, unknown>
): string {
    const raw = item as Record<string, unknown>;
    return String(raw['title'] ?? raw['o_name'] ?? raw['name'] ?? 'Unknown');
}

/**
 * Extract a poster/cover URL from a Stalker portal item.
 */
export function extractStalkerItemPoster(
    item: StalkerPortalItem | Record<string, unknown>
): string {
    const raw = item as Record<string, unknown>;
    return String(raw['cover'] ?? raw['logo'] ?? raw['poster_url'] ?? '');
}

/**
 * Determine the normalised activity type of a Stalker item.
 *
 * - `itv` / `live` → `'live'`
 * - `series` or `is_series` truthy → `'series'`
 * - everything else → `'movie'`
 */
export function extractStalkerItemType(
    item: StalkerPortalItem | Record<string, unknown>
): PortalActivityType {
    const raw = item as Record<string, unknown>;
    const categoryId = String(raw['category_id'] ?? '').toLowerCase();
    const streamType = String(raw['stream_type'] ?? '').toLowerCase();

    if (categoryId === 'itv' || streamType === 'live') {
        return 'live';
    }

    if (
        categoryId === 'series' ||
        raw['is_series'] === true ||
        raw['is_series'] === 1 ||
        raw['is_series'] === '1'
    ) {
        return 'series';
    }

    return 'movie';
}

/**
 * Normalise a raw date value (epoch number, numeric string, or ISO string)
 * into a consistent ISO 8601 string.
 */
export function normalizeStalkerDate(value: unknown): string {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return '';
        const ms = value > 10_000_000_000 ? value : value * 1000;
        return new Date(ms).toISOString();
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^\d+$/.test(trimmed)) {
            const numeric = Number(trimmed);
            if (Number.isFinite(numeric)) {
                const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
                return new Date(ms).toISOString();
            }
        }
        const parsed = Date.parse(trimmed);
        if (!Number.isNaN(parsed)) {
            return new Date(parsed).toISOString();
        }
    }

    return '';
}

/**
 * Check whether a raw item from `Playlist.favorites` matches the given itemId.
 *
 * Used to filter stalker favorites/recently-viewed arrays when removing items.
 */
export function stalkerItemMatchesId(
    raw: unknown,
    targetId: string,
    fallbackPrefix = '',
    fallbackIndex = 0
): boolean {
    const item = (raw ?? {}) as Record<string, unknown>;
    const rawId = extractStalkerItemId(item, fallbackPrefix, fallbackIndex);
    return rawId === targetId;
}
