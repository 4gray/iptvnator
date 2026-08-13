import {
    GlobalFavoriteItem as DbGlobalFavoriteItem,
    GlobalRecentlyAddedItem as DbGlobalRecentlyAddedItem,
    GlobalRecentItem as DbGlobalRecentItem,
} from '@iptvnator/services';
import {
    PortalAddedItem,
    PlaylistMeta,
    PortalActivityItem,
    PortalActivityType,
    PortalFavoriteItem,
    PortalRecentItem,
    normalizeContentMetadataPatch,
    extractStalkerItemId,
    extractStalkerItemPoster,
    extractStalkerItemTitle,
    extractStalkerItemTmdbHints,
    extractStalkerItemType,
    normalizeStalkerDate,
} from '@iptvnator/shared/interfaces';

// ────── Type / label helpers ──────

export function normalizeActivityType(value: string): PortalActivityType {
    return value === 'live' || value === 'series' ? value : 'movie';
}

export function getActivityTypeLabelKey(type: PortalActivityType): string {
    if (type === 'live') return 'WORKSPACE.DASHBOARD.TYPE_LIVE';
    if (type === 'series') return 'WORKSPACE.DASHBOARD.TYPE_SERIES';
    return 'WORKSPACE.DASHBOARD.TYPE_MOVIE';
}

// ────── Xtream DB → ViewModel ──────

/**
 * The TMDB identity a detail view left on the `content` row, if any.
 *
 * Read through the same normalizer the write path uses, so a legacy row, a
 * row whose detail page has never been opened, and a row carrying a value the
 * provider fabricated all collapse to the same thing: absent fields, and a
 * caller that falls back to the display title.
 */
function readContentTmdbIdentity(item: {
    tmdb_id?: number | null;
    release_year?: number | null;
    original_title?: string | null;
}): Pick<PortalActivityItem, 'tmdb_id' | 'release_year' | 'original_title'> {
    const identity = normalizeContentMetadataPatch({
        tmdbId: item.tmdb_id ?? undefined,
        releaseYear: item.release_year ?? undefined,
        originalTitle: item.original_title ?? undefined,
    });

    return identity
        ? {
              tmdb_id: identity.tmdbId,
              release_year: identity.releaseYear,
              original_title: identity.originalTitle,
          }
        : {};
}

export function mapDbFavoriteToItem(
    item: DbGlobalFavoriteItem
): PortalFavoriteItem {
    return {
        id: item.id,
        title: item.title,
        type: normalizeActivityType(item.type),
        playlist_id: item.playlist_id,
        playlist_name: item.playlist_name,
        added_at: normalizeStalkerDate(item.added_at),
        category_id: item.category_id,
        xtream_id: item.xtream_id,
        poster_url: item.poster_url,
        backdrop_url: item.backdrop_url ?? undefined,
        ...readContentTmdbIdentity(item),
        source: 'xtream',
    };
}

export function mapDbRecentToItem(item: DbGlobalRecentItem): PortalRecentItem {
    return {
        id: item.id,
        title: item.title,
        type: normalizeActivityType(item.type),
        playlist_id: item.playlist_id,
        playlist_name: item.playlist_name,
        viewed_at: normalizeStalkerDate(item.viewed_at),
        category_id: item.category_id,
        xtream_id: item.xtream_id,
        poster_url: item.poster_url,
        backdrop_url: item.backdrop_url ?? undefined,
        ...readContentTmdbIdentity(item),
        source: 'xtream',
    };
}

export function mapDbRecentlyAddedToItem(
    item: DbGlobalRecentlyAddedItem
): PortalAddedItem {
    return {
        id: item.id,
        title: item.title,
        type: normalizeActivityType(item.type),
        playlist_id: item.playlist_id,
        playlist_name: item.playlist_name,
        added_at: normalizeStalkerDate(item.added_at),
        category_id: item.category_id,
        xtream_id: item.xtream_id,
        poster_url: item.poster_url,
        source: 'xtream',
    };
}

// ────── Stalker playlist → ViewModel ──────

export function buildStalkerFavoriteItems(
    playlists: PlaylistMeta[],
    defaultPlaylistName: string
): PortalFavoriteItem[] {
    return playlists
        .filter((playlist) => Boolean(playlist.macAddress))
        .reduce<PortalFavoriteItem[]>((acc, playlist) => {
            const favorites = Array.isArray(playlist.favorites)
                ? playlist.favorites
                : [];

            const mapped = favorites.map((item, index) => {
                const raw = (item ?? {}) as Record<string, unknown>;
                const id = extractStalkerItemId(raw, playlist._id, index);

                return {
                    id,
                    title: extractStalkerItemTitle(raw),
                    type: extractStalkerItemType(raw),
                    playlist_id: playlist._id,
                    playlist_name: playlist.title || defaultPlaylistName,
                    added_at: normalizeStalkerDate(raw['added_at']),
                    category_id: String(raw['category_id'] ?? ''),
                    xtream_id: id,
                    poster_url: extractStalkerItemPoster(raw),
                    // Same source as the recent-items mapper: Stalker keeps
                    // the enriched backdrop inside the stored entry.
                    backdrop_url: extractStalkerItemTmdbHints(raw).backdropUrl,
                    source: 'stalker' as const,
                    stalker_item: item,
                } as PortalFavoriteItem;
            });

            acc.push(...mapped);
            return acc;
        }, []);
}

// ────── Timestamp helpers ──────

export function toDateTimestamp(value: unknown): number {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return 0;
        return value > 10_000_000_000 ? value : value * 1000;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^\d+$/.test(trimmed)) {
            const numeric = Number(trimmed);
            if (Number.isFinite(numeric) && numeric > 0) {
                return numeric > 10_000_000_000 ? numeric : numeric * 1000;
            }
            return 0;
        }
        const parsed = Date.parse(normalizeStalkerDate(trimmed) || trimmed);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    return 0;
}

export function toTimestamp(value?: string | number): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(normalizeStalkerDate(value) || value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}
