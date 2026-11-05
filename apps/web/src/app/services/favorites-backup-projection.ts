import { hasXtreamFavoriteIdentityConflict } from './favorites-reference-adapters';
import type {
    Playlist,
    PlaylistBackupEntry,
    XtreamBackupFavoriteItem,
} from '@iptvnator/shared/interfaces';
import { favoriteReferenceKey } from '@iptvnator/shared/interfaces/favorites-sync';
import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import type { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
/** Export the visible durable copy without turning backup/restore into implicit NAS import. */
export async function projectFavoriteBackup(
    client: FavoritesSyncClient,
    adapter: FavoritesPlaylistAdapter,
    playlist: Playlist,
    entry: PlaylistBackupEntry
): Promise<PlaylistBackupEntry> {
    if (entry.portalType !== 'xtream') {
        const projected = await adapter.project(playlist);
        if (entry.portalType === 'm3u')
            return {
                ...entry,
                userState: {
                    ...entry.userState,
                    favorites: (projected.favorites ?? []).filter(
                        (item): item is string => typeof item === 'string'
                    ),
                },
            };
        return {
            ...entry,
            userState: {
                ...entry.userState,
                favorites: (projected.favorites ?? []).filter(
                    (item): item is Exclude<typeof item, string> =>
                        typeof item === 'object'
                ),
            },
        };
    }
    const favorites = new Map<string, XtreamBackupFavoriteItem>(
        entry.userState.favorites.map((item) => [
            favoriteReferenceKey({
                provider: 'xtream',
                kind: item.contentType,
                id: String(item.xtreamId),
            }),
            item,
        ])
    );
    for (const { address, record } of await client.entries(playlist._id)) {
        const ref = address.content;
        if (ref.provider !== 'xtream') continue;
        const state =
            record.localOnly && record.local ? record.local : record.state;
        const key = favoriteReferenceKey(ref);
        if (!state.member) {
            favorites.delete(key);
            continue;
        }
        const previous = favorites.get(key);
        const conflict = hasXtreamFavoriteIdentityConflict(state.snapshot, {
            tmdb_id: previous?.snapshot?.tmdbId,
            release_year: previous?.snapshot?.releaseYear,
            catalog_missing_reason: previous?.snapshot?.catalogMissingReason,
        });
        favorites.set(key, {
            ...previous,
            xtreamId: Number(ref.id),
            contentType: ref.kind,
            snapshot: {
                ...previous?.snapshot,
                title: state.snapshot?.title ?? previous?.snapshot?.title ?? '',
                catalogStatus: previous?.snapshot?.catalogStatus ?? 'unknown',
                ...(state.snapshot?.tmdbId
                    ? { tmdbId: Number(state.snapshot.tmdbId) }
                    : {}),
                ...(state.snapshot?.releaseYear
                    ? { releaseYear: Number(state.snapshot.releaseYear) }
                    : {}),
                ...(conflict
                    ? {
                          catalogStatus: 'missing',
                          catalogMissingReason: 'identity_conflict',
                      }
                    : {}),
            },
        });
    }
    return {
        ...entry,
        userState: { ...entry.userState, favorites: [...favorites.values()] },
    };
}
