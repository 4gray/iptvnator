import {
    PortalActivityType,
    StalkerPortalItem,
} from './stalker-portal-item.interface';

const SQLITE_UTC_TIMESTAMP_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

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
 * - `itv` / `live` / radio → `'live'`
 * - `series` or `is_series` truthy → `'series'`
 * - everything else → `'movie'`
 */
export function extractStalkerItemType(
    item: StalkerPortalItem | Record<string, unknown>
): PortalActivityType {
    const raw = item as Record<string, unknown>;
    const categoryId = String(raw['category_id'] ?? '').toLowerCase();
    const streamType = String(raw['stream_type'] ?? '').toLowerCase();

    if (
        categoryId === 'itv' ||
        streamType === 'live' ||
        isStalkerRadioItem(raw)
    ) {
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
 * Detect radio station records from Stalker favorites/recently-viewed payloads.
 */
export function isStalkerRadioItem(
    item: StalkerPortalItem | Record<string, unknown>
): boolean {
    const raw = item as Record<string, unknown>;
    const radio = raw['radio'];
    const radioFlag =
        radio === true ||
        radio === 1 ||
        String(radio ?? '')
            .trim()
            .toLowerCase() === 'true' ||
        String(radio ?? '').trim() === '1';
    const categoryId = String(raw['category_id'] ?? '')
        .trim()
        .toLowerCase();
    const streamType = String(raw['stream_type'] ?? '')
        .trim()
        .toLowerCase();
    const cmd = String(raw['cmd'] ?? '')
        .trim()
        .toLowerCase();

    return (
        radioFlag ||
        categoryId === 'radio' ||
        streamType === 'radio' ||
        cmd.includes('://radio/')
    );
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
        const sqliteUtcIso = normalizeSqliteUtcTimestamp(trimmed);
        if (sqliteUtcIso) {
            return sqliteUtcIso;
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

function normalizeSqliteUtcTimestamp(value: string): string | null {
    const match = SQLITE_UTC_TIMESTAMP_PATTERN.exec(value);
    if (!match) {
        return null;
    }

    const [, year, month, day, hours, minutes, seconds, milliseconds = '0'] =
        match;

    const normalizedMs = milliseconds.padEnd(3, '0').slice(0, 3);
    return new Date(
        Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hours),
            Number(minutes),
            Number(seconds),
            Number(normalizedMs)
        )
    ).toISOString();
}
