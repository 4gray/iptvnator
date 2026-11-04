import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import type {
    Playlist,
    PlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { normalizeXtreamPendingRestoreState } from '@iptvnator/shared/interfaces';
import { favoriteReferenceKey } from '@iptvnator/shared/interfaces/favorites-sync';
import type { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
import {
    xtreamFavoriteReference,
    xtreamFavoriteSnapshot,
} from './favorites-reference-adapters';

/** A restore replaces matching local choices, never queued/shared server state. */
export function createFavoriteBackupRestorer(
    client: FavoritesSyncClient,
    adapter: FavoritesPlaylistAdapter,
    read: (sourceId: string) => Promise<Playlist>
) {
    const consent = client.options.consent();
    const contexts = new Map(client.contexts);
    const assertCurrent = (sourceId: string) => {
        if (
            client.options.profileActive?.() === false ||
            client.options.consent() !== consent ||
            client.contexts.get(sourceId)?.sourceIncarnation !==
                contexts.get(sourceId)?.sourceIncarnation
        )
            throw new Error('Favorite restore expired');
    };
    return async (
        sourceId: string,
        entry: PlaylistBackupEntry
    ): Promise<void> => {
        assertCurrent(sourceId);
        if (!contexts.has(sourceId)) return;
        const local = new Set(
            (await client.entries(sourceId))
                .filter(({ record }) => record.local)
                .map(({ address }) => favoriteReferenceKey(address.content))
        );
        if (!local.size) return;
        const items =
            entry.portalType === 'xtream'
                ? normalizeXtreamPendingRestoreState(entry.userState)
                      .favorites.filter(
                          (item) =>
                              Number.isSafeInteger(item.xtreamId) &&
                              item.xtreamId > 0
                      )
                      .map((item) => ({
                          reference: xtreamFavoriteReference({
                              type: item.contentType,
                              xtream_id: item.xtreamId,
                          }),
                          snapshot: xtreamFavoriteSnapshot({
                              title: item.snapshot?.title ?? '',
                              tmdb_id: item.snapshot?.tmdbId,
                              release_year: item.snapshot?.releaseYear,
                              catalog_missing_reason:
                                  item.snapshot?.catalogMissingReason,
                          }),
                      }))
                : (
                      await adapter.local({
                          ...(await read(sourceId)),
                          favorites: entry.userState.favorites,
                      })
                  ).items;
        for (const item of items) {
            if (!local.has(favoriteReferenceKey(item.reference))) continue;
            assertCurrent(sourceId);
            await client.setLocal(
                sourceId,
                item.reference,
                true,
                item.snapshot,
                consent !== null
            );
        }
    };
}
