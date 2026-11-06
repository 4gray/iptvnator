import {
    extractStalkerItemId,
    normalizeStalkerDate,
    isM3uRecentlyViewedItem,
    type Playlist,
    type PlaylistRecentlyViewedItem,
    type PlaylistRecentIdentity,
    type M3uRecentlyViewedItem,
    type Channel,
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
    stalkerFavoriteReference,
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
type HistoryChannel = Partial<Channel> & Pick<Channel, 'url'>;
export class HistoryPlaylistAdapter {
    private readonly indexes = new Map<
        string,
        {
            stamp: string;
            channels: object;
            value: Promise<Map<string, HistoryChannel>>;
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
                const time = Date.parse(
                    normalizeStalkerDate(original.added_at)
                );
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
                const archived = isM3uRecentlyViewedItem(original)
                    ? original
                    : undefined;
                if (channel)
                    mapped.set(key, {
                        ...archived,
                        source: 'm3u',
                        id: channel.url,
                        url: channel.url,
                        channel_id: channel.id,
                        title: channel.name ?? item.snapshot?.title ?? '',
                        poster_url: channel.tvg?.logo || archived?.poster_url,
                        tvg_id: channel.tvg?.id || archived?.tvg_id,
                        tvg_name: channel.tvg?.name || archived?.tvg_name,
                        group_title:
                            channel.group?.title || archived?.group_title,
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
                    (Date.parse(normalizeStalkerDate(b.added_at)) || 0) -
                    (Date.parse(normalizeStalkerDate(a.added_at)) || 0)
            ),
        };
    }
    private urls(source: Playlist): Promise<Map<string, HistoryChannel>> {
        const channels = (source.playlist?.items ??
            source.items ??
            []) as Partial<Channel>[];
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
            const urls = new Map<string, HistoryChannel>();
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
    private matches(
        item: LocalHistoryItem,
        identity: PlaylistRecentIdentity
    ): boolean {
        if (typeof identity === 'object') {
            if (isM3uRecentlyViewedItem(identity))
                return (
                    isM3uRecentlyViewedItem(item.original) &&
                    identity.url === item.original.url
                );
            const reference = stalkerFavoriteReference(identity);
            return (
                !!reference &&
                favoriteReferenceKey(reference) ===
                    favoriteReferenceKey(item.reference)
            );
        }
        return isM3uRecentlyViewedItem(item.original)
            ? String(identity) === item.original.url
            : String(identity).split(':')[0] ===
                  extractStalkerItemId(item.original).split(':')[0];
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
            if (action.kind === 'remove')
                for (const id of action.identities)
                    if (
                        typeof id !== 'object' &&
                        local.items.filter((item) => this.matches(item, id))
                            .length > 1
                    )
                        throw new Error('History identity ambiguous');
            const items =
                action.kind === 'touch'
                    ? local.items
                    : local.items.filter((item) =>
                          action.identities.some((id) => this.matches(item, id))
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
