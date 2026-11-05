import {
    extractStalkerItemId,
    isM3uRecentlyViewedItem,
    type Playlist,
    type PlaylistRecentlyViewedItem,
    type M3uRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import type { HistorySyncClient } from '@iptvnator/services/history-sync';
import type { HistoryPlaylistAction } from '@iptvnator/services/history-events';
import {
    visibleHistory,
    type HistoryReference,
    type HistorySnapshot,
} from '@iptvnator/shared/interfaces/history-sync';
import {
    favoriteReferenceKey,
    m3uFavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import {
    playlistFavorite,
    stalkerFavorite,
} from './favorites-reference-adapters';
export interface LocalHistoryItem {
    reference: HistoryReference;
    snapshot: HistorySnapshot;
    original: PlaylistRecentlyViewedItem;
    viewedAt: number;
}
export class HistoryPlaylistAdapter {
    private readonly indexes = new Map<
        string,
        {
            stamp: string;
            channels: object;
            value: Promise<
                Map<string, { url: string; id?: string; name?: string }>
            >;
        }
    >();
    constructor(
        private readonly client: HistorySyncClient,
        private readonly catalog: (playlist: Playlist) => Promise<Playlist>
    ) {}
    async local(
        playlist: Playlist
    ): Promise<{ items: LocalHistoryItem[]; unresolved: number }> {
        const items: LocalHistoryItem[] = [];
        let unresolved = 0;
        for (const original of playlist.recentlyViewed ?? []) {
            try {
                const favorite = await playlistFavorite(
                    playlist,
                    isM3uRecentlyViewedItem(original) ? original.url : original
                );
                if (!favorite) {
                    unresolved++;
                    continue;
                }
                const time = new Date(original.added_at ?? '').getTime();
                items.push({
                    reference: favorite.reference,
                    snapshot: favorite.snapshot,
                    original,
                    viewedAt: Number.isFinite(time) ? time : 0,
                });
            } catch {
                unresolved++;
            }
        }
        return { items, unresolved };
    }
    async project<T extends Playlist>(playlist: T): Promise<T> {
        if (!playlist || playlist.serverUrl) return playlist;
        const scope = this.client.contexts.get(playlist._id);
        const state = await this.client.state(playlist._id);
        if (!state) return playlist;
        const source = await this.catalog(playlist);
        const local = await this.local(source);
        const mapped = new Map(
            state.hideArchive
                ? []
                : local.items.map((item) => [
                      favoriteReferenceKey(item.reference),
                      item.original,
                  ])
        );
        const originals = new Set(local.items.map((item) => item.original));
        const unresolved = state.hideArchive
            ? []
            : (playlist.recentlyViewed ?? []).filter(
                  (item) => !originals.has(item)
              );
        const urls = state.items.some(
            (item) => item.reference.provider === 'm3u'
        )
            ? await this.urls(source)
            : new Map();
        const visible = new Map(
            visibleHistory(state).map((item) => [
                favoriteReferenceKey(item.reference),
                item,
            ])
        );
        for (const item of state.items) {
            const key = favoriteReferenceKey(item.reference);
            if (!visible.has(key)) {
                mapped.delete(key);
                continue;
            }
            const original = local.items.find(
                (local) => favoriteReferenceKey(local.reference) === key
            )?.original;
            const ref = item.reference;
            const date = new Date(item.viewedAt).toISOString();
            if (ref.provider === 'stalker')
                mapped.set(key, {
                    ...(original ?? stalkerFavorite(ref, item.snapshot)),
                    added_at: date,
                });
            else if (ref.provider === 'm3u') {
                const channel = urls.get(key);
                if (channel)
                    mapped.set(key, {
                        ...(isM3uRecentlyViewedItem(original) ? original : {}),
                        source: 'm3u',
                        id: channel.url,
                        url: channel.url,
                        channel_id: channel.id,
                        title: channel.name ?? item.snapshot?.title ?? '',
                        category_id: 'live',
                        added_at: date,
                    } as M3uRecentlyViewedItem);
                else mapped.delete(key);
            }
        }
        this.client.current(scope);
        return {
            ...playlist,
            recentlyViewed: [...mapped.values(), ...unresolved].sort(
                (a, b) =>
                    new Date(b.added_at ?? '').getTime() -
                    new Date(a.added_at ?? '').getTime()
            ),
        };
    }
    private urls(
        source: Playlist
    ): Promise<Map<string, { url: string; id?: string; name?: string }>> {
        const channels = (source.playlist?.items ?? source.items ?? []) as {
            url?: string;
            id?: string;
            name?: string;
        }[];
        const stamp = JSON.stringify([
            source.sourceSyncRevision,
            source.updateDate,
            source.count,
            this.client.contexts.get(source._id)?.sourceIncarnation,
        ]);
        const cached = this.indexes.get(source._id);
        if (
            cached?.stamp === stamp &&
            (source.sourceSyncRevision !== undefined ||
                source.updateDate !== undefined ||
                cached.channels === channels)
        )
            return cached.value;
        const value = (async () => {
            const urls = new Map<
                string,
                { url: string; id?: string; name?: string }
            >();
            for (const channel of channels)
                if (channel.url)
                    urls.set(
                        favoriteReferenceKey(
                            await m3uFavoriteReference(channel.url)
                        ),
                        { ...channel, url: channel.url }
                    );
            return urls;
        })();
        this.indexes.set(source._id, { stamp, channels, value });
        value.catch(() => {
            if (this.indexes.get(source._id)?.value === value)
                this.indexes.delete(source._id);
        });
        return value;
    }
    async mutate(
        playlist: Playlist,
        action: HistoryPlaylistAction
    ): Promise<Playlist | null> {
        if (playlist.serverUrl) return null;
        const generation = this.client.options.consent();
        let scope;
        // A source never verified by history retains its ordinary local archive when offline.
        try {
            scope = await this.client.scope(playlist._id);
        } catch {
            this.client.current();
            return null;
        }
        if (action.kind === 'clear')
            await this.client.command(
                playlist._id,
                { kind: 'clear' },
                this.client.options.consent() !== generation
            );
        else {
            const projected =
                action.kind === 'touch'
                    ? { ...playlist, recentlyViewed: [action.item] }
                    : await this.project(playlist);
            const local = await this.local(projected);
            const items =
                action.kind === 'touch'
                    ? local.items
                    : local.items.filter((item) =>
                          action.identities.some((id) =>
                              isM3uRecentlyViewedItem(item.original)
                                  ? String(id) === item.original.url
                                  : String(id).split(':')[0] ===
                                    extractStalkerItemId(item.original).split(
                                        ':'
                                    )[0]
                          )
                      );
            if (action.kind === 'touch' && !items.length) return null;
            for (const item of items) {
                this.client.current(scope);
                await this.client.command(
                    playlist._id,
                    {
                        kind: action.kind,
                        reference: item.reference,
                        snapshot: item.snapshot,
                    },
                    this.client.options.consent() !== generation
                );
            }
        }
        if (action.kind === 'remove' && (await this.local(playlist)).unresolved)
            return null;
        return this.project(playlist);
    }
}
