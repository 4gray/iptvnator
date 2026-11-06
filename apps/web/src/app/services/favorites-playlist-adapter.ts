import type { FavoritesLocalOrder } from './favorites-local-order';
import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    favoriteReferenceKey,
    m3uFavoriteReference,
    type FavoriteEntry,
} from '@iptvnator/shared/interfaces/favorites-sync';
import {
    captureFavoriteOwner,
    FavoriteSupersededError,
    type FavoritesSyncClient,
} from '@iptvnator/services/favorites-sync';
import {
    playlistFavorite,
    stalkerFavorite,
    favoriteKey,
    type LocalFavorite,
} from './favorites-reference-adapters';

/** Legacy documents remain the original archive; the sidecar owns only explicitly changed keys. */
export class FavoritesPlaylistAdapter {
    private readonly urlIndexes = new Map<
        string,
        {
            stamp: string;
            channels?: object;
            value: Promise<Map<string, string>>;
        }
    >();
    constructor(
        private readonly client: FavoritesSyncClient,
        private readonly enabled: () => boolean,
        private readonly catalog: (
            source: Playlist
        ) => Promise<Playlist> = async (source) => source,
        private readonly order?: FavoritesLocalOrder
    ) {}
    async local(
        playlist: Playlist
    ): Promise<{ items: LocalFavorite[]; unresolved: number }> {
        const items: LocalFavorite[] = [];
        let unresolved = 0;
        for (const original of playlist.favorites ?? []) {
            const item = await playlistFavorite(playlist, original);
            if (item) items.push(item);
            else unresolved++;
        }
        return { items, unresolved };
    }
    async project<T extends Playlist>(playlist: T): Promise<T> {
        if (!playlist || playlist.serverUrl) return playlist;
        const entries = await this.client.entries(playlist._id);
        const localOrder = this.order?.read(playlist._id) ?? [];
        if (!entries.length && !localOrder.length) return playlist;
        const source = await this.catalog(playlist);
        const local = await this.local(source);
        const mapped = new Map(
            local.items.map((item) => [
                favoriteKey(item),
                item.resolvedUrl ?? item.original,
            ])
        );
        const unresolved = (playlist.favorites ?? []).filter(
            (original) =>
                !local.items.some((item) => item.original === original)
        );
        const m3u = entries.find(
            (entry) => entry.address.content.provider === 'm3u'
        );
        const urls = m3u
            ? await this.m3uUrls(source, m3u.address.sourceIncarnation)
            : new Map<string, string>();
        for (const entry of entries) {
            const ref = entry.address.content;
            const key = favoriteReferenceKey(ref);
            const state = this.visible(entry);
            if (!state.member) {
                mapped.delete(key);
                continue;
            }
            if (ref.provider === 'stalker')
                mapped.set(
                    key,
                    mapped.get(key) ?? stalkerFavorite(ref, state.snapshot)
                );
            else if (ref.provider === 'm3u' && urls.has(key))
                mapped.set(key, urls.get(key)!);
        }
        const order = new Map(localOrder.map((key, index) => [key, index]));
        const favorites = [...mapped]
            .sort(
                ([a], [b]) =>
                    (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity)
            )
            .map(([, item]) => item);
        return { ...playlist, favorites: [...favorites, ...unresolved] };
    }
    private m3uUrls(
        source: Playlist,
        incarnation: string
    ): Promise<Map<string, string>> {
        const channels = (source.playlist?.items ?? source.items ?? []) as {
            url?: string;
        }[];
        const stamp = JSON.stringify([
            source._id,
            source.sourceSyncRevision,
            source.updateDate,
            source.count,
            incarnation,
        ]);
        const versioned =
            source.sourceSyncRevision !== undefined ||
            source.updateDate !== undefined;
        const cached = this.urlIndexes.get(source._id);
        if (
            cached?.stamp === stamp &&
            (versioned || cached.channels === channels)
        )
            return cached.value;
        const value = (async () => {
            const urls = new Map<string, string>();
            for (const channel of channels)
                if (channel.url)
                    urls.set(
                        favoriteReferenceKey(
                            await m3uFavoriteReference(channel.url)
                        ),
                        channel.url
                    );
            return urls;
        })();
        this.urlIndexes.set(source._id, {
            stamp,
            value,
            ...(!versioned ? { channels } : {}),
        });
        value.catch(() => {
            if (this.urlIndexes.get(source._id)?.value === value)
                this.urlIndexes.delete(source._id);
        });
        return value;
    }
    visible(entry: FavoriteEntry) {
        return entry.record.localOnly && entry.record.local
            ? entry.record.local
            : entry.record.state;
    }
    async mutate(
        playlist: Playlist,
        transform: (
            current: NonNullable<Playlist['favorites']>
        ) => NonNullable<Playlist['favorites']>,
        persistLocal?: (
            favorites: NonNullable<Playlist['favorites']>
        ) => Promise<void>
    ): Promise<Playlist> {
        const enabled = this.enabled();
        // Verify a new source before set() creates its context in the middle of this action.
        if (enabled && !this.client.contexts.has(playlist._id)) {
            const generation = this.client.generation();
            const context = await this.client.context(playlist._id, generation);
            this.client.current(generation);
            if (
                this.client.contexts.get(playlist._id)?.sourceIncarnation !==
                context.sourceIncarnation
            )
                throw new FavoriteSupersededError();
        }
        const assertCurrent = captureFavoriteOwner(this.client, playlist._id);
        const projected = await this.project(playlist);
        const before = await this.local(projected);
        const nextFavorites = transform(projected.favorites ?? []);
        const after = await this.local({
            ...playlist,
            favorites: nextFavorites,
        });
        const old = new Map(
            before.items.map((item) => [favoriteKey(item), item])
        );
        const next = new Map(
            after.items.map((item) => [favoriteKey(item), item])
        );
        const write = async (item: LocalFavorite, member: boolean) => {
            assertCurrent();
            if (enabled)
                await this.client.set(
                    playlist._id,
                    item.reference,
                    member,
                    item.snapshot
                );
            else
                await this.client.setLocal(
                    playlist._id,
                    item.reference,
                    member,
                    item.snapshot
                );
        };
        for (const [key, item] of old)
            if (!next.has(key)) await write(item, false);
        for (const [key, item] of next)
            if (!old.has(key)) await write(item, true);
        assertCurrent();
        const knownBefore = new Set(before.items.map((item) => item.original));
        const knownAfter = new Set(after.items.map((item) => item.original));
        const unknownBefore = (projected.favorites ?? []).filter(
            (item) => !knownBefore.has(item)
        );
        const unknownAfter = nextFavorites.filter(
            (item) => !knownAfter.has(item)
        );
        let retained = playlist;
        if (JSON.stringify(unknownBefore) !== JSON.stringify(unknownAfter)) {
            if (!persistLocal)
                throw new Error('Local favorite persistence unavailable');
            const favorites = [
                ...(playlist.favorites ?? []).filter(
                    (item) => !unknownBefore.includes(item)
                ),
                ...unknownAfter,
            ];
            await persistLocal(favorites);
            assertCurrent();
            retained = { ...playlist, favorites };
        }
        this.order?.write(playlist._id, after.items.map(favoriteKey));
        const result = await this.project(retained);
        assertCurrent();
        return result;
    }
}
