import {
    createRandomId,
    type Playlist,
    type PlaylistBackupEntry,
    type XtreamBackupRecentlyViewedItem,
    isM3uRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import {
    emptyHistoryRecord,
    projectHistory,
    retainLocalHistory,
    parseHistoryOperation,
    type HistoryOperation,
} from '@iptvnator/shared/interfaces/history-sync';
import type { HistorySyncClient } from '@iptvnator/services/history-sync';
import type { HistoryPlaylistAdapter } from './history-playlist-adapter';
import {
    xtreamFavoriteReference,
    xtreamFavoriteSnapshot,
} from './favorites-reference-adapters';

export async function projectHistoryBackup(
    client: HistorySyncClient,
    adapter: HistoryPlaylistAdapter,
    playlist: Playlist,
    entry: PlaylistBackupEntry
): Promise<PlaylistBackupEntry> {
    const scope = client.contexts.get(playlist._id);
    if (!scope) return entry;
    const record = await client.store.read(scope);
    client.current(scope);
    if (!record) return entry;
    if (entry.portalType !== 'xtream') {
        const projected = await adapter.project({
            ...playlist,
            recentlyViewed: entry.userState.recentlyViewed,
        });
        return entry.portalType === 'm3u'
            ? {
                  ...entry,
                  userState: {
                      ...entry.userState,
                      recentlyViewed: (projected.recentlyViewed ?? []).filter(
                          isM3uRecentlyViewedItem
                      ),
                  },
              }
            : {
                  ...entry,
                  userState: {
                      ...entry.userState,
                      recentlyViewed: (projected.recentlyViewed ?? []).filter(
                          (item) => !isM3uRecentlyViewedItem(item)
                      ),
                  },
              };
    }
    const key = (item: XtreamBackupRecentlyViewedItem) =>
        `${item.contentType}:${item.xtreamId}`;
    const mapped = new Map(
        record.hideArchive
            ? []
            : entry.userState.recentlyViewed.map((item) => [key(item), item])
    );
    const state = projectHistory(record);
    for (const item of state.items) {
        const ref = item.reference;
        if (ref.provider !== 'xtream') continue;
        const id = `${ref.kind}:${ref.id}`;
        if (item.removed || item.revision <= state.cleared) {
            mapped.delete(id);
            continue;
        }
        const previous = mapped.get(id);
        mapped.set(id, {
            ...previous,
            contentType: ref.kind,
            xtreamId: Number(ref.id),
            viewedAt: new Date(item.viewedAt).toISOString(),
            collectionItem: {
                ...previous?.collectionItem,
                type: ref.kind,
                xtream_id: Number(ref.id),
                title:
                    item.snapshot?.title ??
                    previous?.collectionItem?.['title'] ??
                    '',
                ...(item.snapshot?.tmdbId
                    ? { tmdb_id: Number(item.snapshot.tmdbId) }
                    : {}),
                ...(item.snapshot?.releaseYear
                    ? { release_year: Number(item.snapshot.releaseYear) }
                    : {}),
            },
        });
    }
    return {
        ...entry,
        userState: {
            ...entry.userState,
            recentlyViewed: [...mapped.values()].sort(
                (a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt)
            ),
        },
    };
}

/** Backup restore replaces the local copy, while shared state and queued server commands retain their owners. */
export function createHistoryBackupRestorer(
    client: HistorySyncClient,
    adapter: HistoryPlaylistAdapter,
    read: (id: string) => Promise<Playlist>
) {
    const contexts = new Map(client.contexts);
    const generation = client.options.consent();
    return async (
        sourceId: string,
        entry: PlaylistBackupEntry
    ): Promise<void> => {
        const scope = contexts.get(sourceId);
        if (!scope) return;
        const current = () => {
            client.current(scope);
            if (client.options.consent() !== generation)
                throw new Error('History restore expired');
        };
        current();
        const items =
            entry.portalType === 'xtream'
                ? entry.userState.recentlyViewed.map((item) => ({
                      reference: xtreamFavoriteReference({
                          type: item.contentType,
                          xtream_id: item.xtreamId,
                      }),
                      snapshot: xtreamFavoriteSnapshot({
                          title: String(item.collectionItem?.['title'] ?? ''),
                          tmdb_id:
                              Number(item.collectionItem?.['tmdb_id']) ||
                              undefined,
                          release_year:
                              Number(item.collectionItem?.['release_year']) ||
                              undefined,
                      }),
                      viewedAt: Date.parse(item.viewedAt),
                  }))
                : (
                      await adapter.local({
                          ...(await read(sourceId)),
                          recentlyViewed: entry.userState.recentlyViewed,
                      })
                  ).items;
        current();
        const clear: HistoryOperation = {
            kind: 'clear',
            operationId: createRandomId(),
            deviceId: client.options.deviceId,
            baseRevision: 0,
            viewedAt: Date.now(),
        };
        const restored = items
            .sort((a, b) => a.viewedAt - b.viewedAt)
            .map((item) =>
                parseHistoryOperation({
                    ...clear,
                    kind: 'touch',
                    operationId: createRandomId(),
                    reference: item.reference,
                    snapshot: item.snapshot,
                    viewedAt: item.viewedAt,
                })
            );
        await client.store.mutate(scope, (value) => {
            current();
            const record = value ?? emptyHistoryRecord();
            const local = projectHistory(record).items.map((item) => ({
                ...clear,
                kind: 'remove' as const,
                reference: item.reference,
            }));
            const archive = [clear, ...restored];
            return {
                ...record,
                hideArchive: true,
                archive,
                local: restored.reduce(retainLocalHistory, local),
            };
        });
        client.options.changed();
    };
}
