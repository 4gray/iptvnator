import type {
    XtreamContentItem,
    XtreamFavoriteItem,
} from '@iptvnator/portal/xtream/data-access';
import type { Playlist, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import {
    m3uFavoriteReference,
    favoriteReferenceKey,
    parseFavoriteSnapshot,
    stalkerFavoriteReference,
    type FavoriteReference,
    type FavoriteSnapshot,
} from '@iptvnator/shared/interfaces/favorites-sync';
export interface LocalFavorite {
    reference: FavoriteReference;
    snapshot: FavoriteSnapshot;
    original: string | StalkerPortalItem;
    resolvedUrl?: string;
}
export function normalizeFavoriteTitle(title?: string): string | undefined {
    return typeof title === 'string'
        ? title
              .replace(/\p{Cc}/gu, ' ')
              .slice(0, 512)
              .trim()
        : undefined;
}
export async function playlistFavorite(
    playlist: Playlist,
    original: string | StalkerPortalItem
): Promise<LocalFavorite | null> {
    if (playlist.serverUrl) return null;
    if (playlist.macAddress || playlist.portalUrl) {
        if (typeof original !== 'object' || !original) return null;
        const reference = stalkerFavoriteReference(original);
        if (!reference) return null;
        if (reference.mode === 'embedded' && !Array.isArray(original.series))
            return null;
        const episodes =
            reference.mode === 'embedded'
                ? original.series
                      ?.filter(
                          (value) =>
                              typeof value === 'string' ||
                              typeof value === 'number'
                      )
                      .map(Number)
                      .filter(
                          (value) => Number.isSafeInteger(value) && value > 0
                      )
                : undefined;
        if (episodes && (!episodes.length || episodes.length > 2000))
            return null;
        const category =
            original.favoriteContentType ?? String(original.category_id ?? '');
        return {
            original,
            reference,
            snapshot: parseFavoriteSnapshot({
                title: normalizeFavoriteTitle(original.title ?? original.name),
                ...(category ? { categoryId: category } : {}),
                ...(episodes ? { episodes } : {}),
            }),
        };
    }
    if (typeof original !== 'string') return null;
    const channels = (playlist.playlist?.items ?? playlist.items ?? []) as {
        id?: string;
        channel_id?: string;
        url?: string;
        name?: string;
    }[];
    // A stored URL wins even if a legacy ID happens to equal it.
    let url = original.includes('://') ? original : undefined;
    if (!url) {
        const matches = channels.filter(
            (channel) =>
                channel.id === original || channel.channel_id === original
        );
        const urls = new Set(
            matches.map((channel) => channel.url).filter(Boolean)
        );
        if (urls.size !== 1) return null;
        url = [...urls][0];
    }
    if (!url) return null;
    const channel = channels.find((channel) => channel.url === url);
    return {
        original,
        resolvedUrl: url,
        reference: await m3uFavoriteReference(url),
        snapshot: parseFavoriteSnapshot({
            title: normalizeFavoriteTitle(channel?.name),
        }),
    };
}
export function stalkerFavorite(
    reference: Extract<FavoriteReference, { provider: 'stalker' }>,
    snapshot?: FavoriteSnapshot
): StalkerPortalItem {
    return {
        id: reference.id,
        ...(reference.kind === 'movie'
            ? { movie_id: reference.id }
            : reference.kind === 'series'
              ? reference.mode === 'regular'
                  ? { series_id: reference.id }
                  : {}
              : { stream_id: reference.id }),
        favoriteContentType:
            reference.kind === 'radio'
                ? 'radio'
                : reference.kind === 'live'
                  ? 'itv'
                  : reference.kind === 'movie' || reference.mode !== 'regular'
                    ? 'vod'
                    : 'series',
        title: snapshot?.title,
        category_id:
            reference.kind === 'radio'
                ? 'radio'
                : reference.kind === 'live'
                  ? 'itv'
                  : reference.kind === 'movie'
                    ? 'vod'
                    : reference.mode === 'regular'
                      ? 'series'
                      : 'vod',
        stream_type:
            reference.kind === 'live' || reference.kind === 'radio'
                ? 'live'
                : 'movie',
        ...(reference.kind === 'radio' ? { radio: 'true' } : {}),
        ...(reference.mode === 'lazy' ? { is_series: true } : {}),
        ...(reference.mode === 'embedded'
            ? { series: snapshot?.episodes ?? [] }
            : {}),
    };
}
export const favoriteKey = (item: LocalFavorite) =>
    favoriteReferenceKey(item.reference);

type XtreamRef = Extract<FavoriteReference, { provider: 'xtream' }>;
export function xtreamFavoriteReference(
    item: Pick<XtreamContentItem, 'type' | 'xtream_id'>
): XtreamRef {
    const kind = item.type === 'vod' ? 'movie' : item.type;
    if (
        !['live', 'movie', 'series'].includes(kind) ||
        !Number.isSafeInteger(item.xtream_id) ||
        item.xtream_id <= 0
    )
        throw new Error('Unresolved favorite identity');
    return {
        provider: 'xtream',
        kind: kind as XtreamRef['kind'],
        id: String(item.xtream_id),
    };
}
export function xtreamFavoriteSnapshot(
    item: Pick<
        XtreamFavoriteItem,
        'title' | 'tmdb_id' | 'release_year' | 'catalog_missing_reason'
    >
) {
    return parseFavoriteSnapshot({
        title: normalizeFavoriteTitle(item.title),
        ...(item.tmdb_id == null ? {} : { tmdbId: String(item.tmdb_id) }),
        ...(item.release_year == null
            ? {}
            : { releaseYear: String(item.release_year) }),
        ...(item.catalog_missing_reason === 'identity_conflict'
            ? { identityConflict: true }
            : {}),
    });
}
/** Shared identity guards also apply when exporting a retained local backup. */
export function hasXtreamFavoriteIdentityConflict(
    snapshot: FavoriteSnapshot | undefined,
    candidate?: Pick<
        XtreamFavoriteItem,
        'tmdb_id' | 'release_year' | 'catalog_missing_reason'
    > | null,
    requireConfirmation = false
): boolean {
    return !!(
        snapshot?.identityConflict ||
        candidate?.catalog_missing_reason === 'identity_conflict' ||
        (snapshot?.tmdbId &&
            (requireConfirmation || candidate?.tmdb_id != null) &&
            snapshot.tmdbId !== String(candidate?.tmdb_id)) ||
        (snapshot?.releaseYear &&
            (requireConfirmation || candidate?.release_year != null) &&
            snapshot.releaseYear !== String(candidate?.release_year))
    );
}
