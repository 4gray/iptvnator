import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions, selectAllPlaylistsMeta } from 'm3u-state';
import { firstValueFrom, map } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import {
    Channel,
    extractStalkerItemId,
    extractStalkerItemPoster,
    extractStalkerItemTitle,
    extractStalkerItemType,
    isStalkerRadioItem,
    normalizeStalkerDate,
    Playlist,
    PlaylistMeta,
    StalkerPortalItem,
} from 'shared-interfaces';
import {
    buildCollectionUid,
    buildXtreamCollectionUid,
    UnifiedCollectionItem,
} from './unified-collection-item.interface';
import { CollectionScope } from './scope-toggle.service';
import {
    isStalkerItem,
    xtreamContentType,
    XtreamFavoriteRow,
} from './collection-helpers';

const GLOBAL_FAVORITES_ORDER_KEY = 'global-favorites-channel-order-v1';

type PlaylistWithChannels = Playlist & {
    readonly playlist?: { readonly items?: Channel[] };
};
type StalkerPortalFavoriteItem = StalkerPortalItem & {
    category_id?: string;
    raw?: string;
    [key: string]: unknown;
};

@Injectable({ providedIn: 'root' })
export class UnifiedFavoritesDataService {
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly translate = inject(TranslateService);

    async getFavorites(
        scope: CollectionScope,
        playlistId?: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        if (scope === 'playlist' && playlistId) {
            return this.getPlaylistFavorites(playlistId, portalType);
        }
        return this.getAllFavorites();
    }

    async addFavorite(item: UnifiedCollectionItem): Promise<void> {
        switch (item.sourceType) {
            case 'm3u':
                await this.addM3uFavorite(item);
                break;
            case 'xtream':
                await this.addXtreamFavorite(item);
                break;
            case 'stalker':
                await this.addStalkerFavorite(item);
                break;
        }
    }

    async removeFavorite(item: UnifiedCollectionItem): Promise<void> {
        switch (item.sourceType) {
            case 'm3u': {
                const playlist = await firstValueFrom(
                    this.playlistsService.getPlaylistById(item.playlistId)
                );
                const filtered = (
                    (playlist.favorites as string[]) ?? []
                ).filter(
                    (favoriteId) =>
                        favoriteId !== item.streamUrl &&
                        favoriteId !== item.channelId
                );
                await this.setM3uFavorites(item.playlistId, filtered);
                break;
            }
            case 'xtream':
                if (window.electron && item.contentId != null) {
                    await window.electron.dbRemoveFavorite(
                        item.contentId,
                        item.playlistId
                    );
                }
                break;
            case 'stalker': {
                const sourceItemId = item.uid.split('::')[2];
                await firstValueFrom(
                    this.playlistsService.removeFromPortalFavorites(
                        item.playlistId,
                        sourceItemId
                    )
                );
                break;
            }
        }
    }

    private async addM3uFavorite(item: UnifiedCollectionItem): Promise<void> {
        const favoriteId = item.streamUrl ?? item.channelId;
        if (!favoriteId) {
            return;
        }

        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(item.playlistId)
        )) as Playlist | undefined;
        const currentFavorites = Array.isArray(playlist?.favorites)
            ? playlist.favorites.filter(
                  (favorite): favorite is string => typeof favorite === 'string'
              )
            : [];

        if (currentFavorites.includes(favoriteId)) {
            return;
        }

        await this.setM3uFavorites(item.playlistId, [
            ...currentFavorites,
            favoriteId,
        ]);
    }

    private async addXtreamFavorite(
        item: UnifiedCollectionItem
    ): Promise<void> {
        if (!window.electron) {
            return;
        }

        const contentId =
            item.contentId ??
            (item.xtreamId != null
                ? (
                      await this.dbService.getContentByXtreamId(
                          item.xtreamId,
                          item.playlistId,
                          item.contentType
                      )
                  )?.id
                : null);

        if (contentId == null) {
            return;
        }

        await window.electron.dbAddFavorite(
            contentId,
            item.playlistId,
            item.posterUrl ?? item.logo ?? undefined
        );
    }

    private async addStalkerFavorite(
        item: UnifiedCollectionItem
    ): Promise<void> {
        const stalkerItem: StalkerPortalItem =
            (item.stalkerItem as StalkerPortalItem | undefined) ?? {};
        const favorite: StalkerPortalFavoriteItem = {
            ...stalkerItem,
            id:
                item.stalkerId ??
                extractStalkerItemId(stalkerItem) ??
                item.uid.split('::')[2],
            cmd: item.stalkerCmd ?? stalkerItem.cmd,
            title: item.name,
            name: stalkerItem.name ?? item.name,
            o_name: stalkerItem.o_name ?? item.name,
            category_id: String(
                item.categoryId ??
                    stalkerItem.category_id ??
                    (item.radio === 'true' || isStalkerRadioItem(stalkerItem)
                        ? 'radio'
                        : 'itv')
            ),
            cover:
                stalkerItem.cover ?? item.logo ?? item.posterUrl ?? undefined,
            logo: stalkerItem.logo ?? item.logo ?? item.posterUrl ?? undefined,
            radio:
                item.radio === 'true' || isStalkerRadioItem(stalkerItem)
                    ? true
                    : undefined,
            added_at: new Date().toISOString(),
        };

        await firstValueFrom(
            this.playlistsService.addPortalFavorite(item.playlistId, favorite)
        );
    }

    async clearFavorites(items: UnifiedCollectionItem[]): Promise<void> {
        if (items.length === 0) {
            return;
        }

        await Promise.all([
            this.clearM3uFavorites(
                items.filter((item) => item.sourceType === 'm3u')
            ),
            this.clearXtreamFavorites(
                items.filter((item) => item.sourceType === 'xtream')
            ),
            this.clearStalkerFavorites(
                items.filter((item) => item.sourceType === 'stalker')
            ),
        ]);
    }

    async reorder(
        items: UnifiedCollectionItem[],
        options?: {
            scope: CollectionScope;
            playlistId?: string;
            portalType?: string;
        }
    ): Promise<void> {
        if (
            options?.scope === 'playlist' &&
            options.playlistId &&
            options.portalType === 'm3u'
        ) {
            await this.setM3uFavorites(
                options.playlistId,
                items
                    .map((item) => item.streamUrl ?? item.channelId ?? '')
                    .filter((value) => value.length > 0)
            );
            return;
        }

        if (
            options?.scope === 'playlist' &&
            options.playlistId &&
            options.portalType === 'stalker'
        ) {
            const playlist = (await firstValueFrom(
                this.playlistsService.getPlaylistById(options.playlistId)
            )) as Playlist | undefined;
            const currentFavorites = Array.isArray(playlist?.favorites)
                ? playlist.favorites.filter(isStalkerItem)
                : [];
            const favoritesById = new Map(
                currentFavorites.map((favorite) => [
                    this.getStalkerFavoriteId(favorite),
                    favorite,
                ])
            );
            const reorderedFavorites = items
                .map(
                    (item) =>
                        favoritesById.get(this.getStalkerFavoriteId(item)) ??
                        null
                )
                .filter(
                    (favorite): favorite is StalkerPortalItem =>
                        favorite !== null
                );
            await firstValueFrom(
                this.playlistsService.setPortalFavorites(
                    options.playlistId,
                    reorderedFavorites
                )
            );
            return;
        }

        const xtreamUpdates = this.buildXtreamPositionUpdates(items);

        if (
            options?.scope === 'playlist' &&
            options.playlistId &&
            options.portalType === 'xtream'
        ) {
            if (xtreamUpdates.length > 0 && window.electron) {
                await window.electron.dbReorderGlobalFavorites(xtreamUpdates);
            }
            return;
        }

        await Promise.all([
            xtreamUpdates.length > 0 && window.electron
                ? window.electron.dbReorderGlobalFavorites(xtreamUpdates)
                : Promise.resolve(),
            this.saveOrder(items.map((item) => item.uid)),
        ]);
    }

    private async getAllFavorites(): Promise<UnifiedCollectionItem[]> {
        const [m3u, xtream, stalker, order] = await Promise.all([
            this.getM3uFavorites(),
            this.getXtreamAllFavorites(),
            this.getStalkerAllFavorites(),
            this.getSavedOrder(),
        ]);
        return this.applyOrder([...m3u, ...xtream, ...stalker], order);
    }

    private async clearM3uFavorites(
        items: UnifiedCollectionItem[]
    ): Promise<void> {
        const groupedItems = this.groupItemsByPlaylist(items);

        await Promise.all(
            Array.from(groupedItems.entries()).map(
                async ([playlistId, playlistItems]) => {
                    const playlist = (await firstValueFrom(
                        this.playlistsService.getPlaylistById(playlistId)
                    )) as Playlist | undefined;
                    const targetIds = new Set<string>();
                    playlistItems.forEach((item) => {
                        [item.streamUrl, item.channelId].forEach((value) => {
                            const normalized = value?.trim();
                            if (normalized) {
                                targetIds.add(normalized);
                            }
                        });
                    });
                    const currentFavorites = Array.isArray(playlist?.favorites)
                        ? playlist.favorites.filter(
                              (favorite): favorite is string =>
                                  typeof favorite === 'string'
                          )
                        : [];
                    const nextFavorites = currentFavorites.filter(
                        (favorite) => !targetIds.has(favorite.trim())
                    );

                    await this.setM3uFavorites(playlistId, nextFavorites);
                }
            )
        );
    }

    private async clearXtreamFavorites(
        items: UnifiedCollectionItem[]
    ): Promise<void> {
        if (!window.electron) {
            return;
        }

        await Promise.all(
            items
                .filter((item) => item.contentId != null)
                .map((item) =>
                    window.electron!.dbRemoveFavorite(
                        item.contentId!,
                        item.playlistId
                    )
                )
        );
    }

    private async clearStalkerFavorites(
        items: UnifiedCollectionItem[]
    ): Promise<void> {
        const groupedItems = this.groupItemsByPlaylist(items);

        await Promise.all(
            Array.from(groupedItems.entries()).map(
                async ([playlistId, playlistItems]) => {
                    const playlist = (await firstValueFrom(
                        this.playlistsService.getPlaylistById(playlistId)
                    )) as Playlist | undefined;
                    const targetIds = new Set(
                        playlistItems.map((item) =>
                            this.getStalkerFavoriteId(item)
                        )
                    );
                    const currentFavorites = Array.isArray(playlist?.favorites)
                        ? playlist.favorites.filter(isStalkerItem)
                        : [];
                    const nextFavorites = currentFavorites.filter(
                        (favorite) =>
                            !targetIds.has(this.getStalkerFavoriteId(favorite))
                    );

                    await firstValueFrom(
                        this.playlistsService.setPortalFavorites(
                            playlistId,
                            nextFavorites
                        )
                    );
                }
            )
        );
    }

    private async getPlaylistFavorites(
        playlistId: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        if (portalType === 'xtream')
            return this.getXtreamPlaylistFavorites(playlistId);
        if (portalType === 'stalker')
            return this.getStalkerPlaylistFavorites(playlistId);
        return this.getM3uPlaylistFavorites(playlistId);
    }

    private async getM3uFavorites(): Promise<UnifiedCollectionItem[]> {
        const allMeta = await this.getAllMeta();
        const results: UnifiedCollectionItem[] = [];
        for (const meta of allMeta.filter(
            (p) => p._id && !p.serverUrl && !p.macAddress
        )) {
            results.push(...(await this.extractM3uFavorites(meta)));
        }
        return results;
    }

    private async getM3uPlaylistFavorites(
        id: string
    ): Promise<UnifiedCollectionItem[]> {
        const meta = await this.getPlaylistMeta(id);
        return meta ? this.extractM3uFavorites(meta) : [];
    }

    private async extractM3uFavorites(
        meta: PlaylistMeta
    ): Promise<UnifiedCollectionItem[]> {
        if (!meta.favorites?.length) return [];
        const favoriteIds = (meta.favorites as string[]).map(String);
        let playlist: PlaylistWithChannels | undefined;
        try {
            playlist = (await firstValueFrom(
                this.playlistsService.getPlaylistById(meta._id)
            )) as PlaylistWithChannels | undefined;
        } catch {
            return [];
        }
        const channels = playlist?.playlist?.items ?? [];
        const channelsByFavoriteId = new Map<string, Channel>();
        channels.forEach((channel) => {
            if (channel.url?.trim()) {
                channelsByFavoriteId.set(channel.url.trim(), channel);
            }
            if (channel.id?.trim()) {
                channelsByFavoriteId.set(channel.id.trim(), channel);
            }
        });

        const seenUrls = new Set<string>();
        return favoriteIds
            .map((favoriteId, index) => {
                const channel = channelsByFavoriteId.get(favoriteId.trim());
                if (!channel?.url || seenUrls.has(channel.url)) {
                    return null;
                }
                seenUrls.add(channel.url);
                const sourceItemId = channel.url?.trim() || channel.id?.trim();
                if (!sourceItemId) {
                    return null;
                }

                return {
                    uid: buildCollectionUid('m3u', meta._id, sourceItemId),
                    name: channel.name,
                    contentType: 'live' as const,
                    sourceType: 'm3u' as const,
                    playlistId: meta._id,
                    playlistName: meta.title || meta.filename || 'M3U',
                    logo: channel.tvg?.logo ?? null,
                    streamUrl: channel.url,
                    channelId: channel.id,
                    radio: channel.radio,
                    m3uChannel: channel,
                    tvgId: channel.tvg?.id || channel.tvg?.name || channel.name,
                    addedAt: new Date(0).toISOString(),
                    position: index,
                } satisfies UnifiedCollectionItem;
            })
            .filter((channel) => channel !== null) as UnifiedCollectionItem[];
    }

    private async getXtreamAllFavorites(): Promise<UnifiedCollectionItem[]> {
        if (!window.electron?.dbGetAllGlobalFavorites) return [];
        try {
            const rows =
                (await this.dbService.getAllGlobalFavorites()) as XtreamFavoriteRow[];
            return rows.map((r) => this.mapXtreamRow(r));
        } catch {
            return [];
        }
    }

    private async getXtreamPlaylistFavorites(
        playlistId: string
    ): Promise<UnifiedCollectionItem[]> {
        if (!window.electron) return [];
        try {
            const rows = await this.dbService.getFavorites(playlistId);
            const meta = await this.getPlaylistMeta(playlistId);
            return (rows as unknown as XtreamFavoriteRow[]).map((r) => ({
                ...this.mapXtreamRow(r),
                playlistId,
                playlistName: meta?.title || 'Xtream',
            }));
        } catch {
            return [];
        }
    }

    private mapXtreamRow(row: XtreamFavoriteRow): UnifiedCollectionItem {
        const ct = xtreamContentType(row.type);
        return {
            uid: buildXtreamCollectionUid(row.playlist_id, ct, row.xtream_id),
            name: row.title,
            contentType: ct,
            sourceType: 'xtream',
            playlistId: row.playlist_id,
            playlistName: row.playlist_name ?? 'Xtream',
            logo: ct === 'live' ? (row.poster_url ?? null) : null,
            posterUrl: ct !== 'live' ? (row.poster_url ?? null) : null,
            xtreamId: row.xtream_id,
            categoryId: row.category_id,
            tvgId: ct === 'live' ? String(row.xtream_id) : undefined,
            rating: row.rating ?? undefined,
            addedAt:
                normalizeStalkerDate(row.added_at) || new Date(0).toISOString(),
            position: row.position ?? 0,
            contentId: row.id,
        };
    }

    private async getStalkerAllFavorites(): Promise<UnifiedCollectionItem[]> {
        const allMeta = await this.getAllMeta();
        const results: UnifiedCollectionItem[] = [];
        for (const meta of allMeta.filter((p) => p._id && p.macAddress)) {
            results.push(...(await this.extractStalkerFavorites(meta)));
        }
        return results;
    }

    private async getStalkerPlaylistFavorites(
        id: string
    ): Promise<UnifiedCollectionItem[]> {
        const meta = await this.getPlaylistMeta(id);
        return meta ? this.extractStalkerFavorites(meta) : [];
    }

    private async extractStalkerFavorites(
        meta: PlaylistMeta
    ): Promise<UnifiedCollectionItem[]> {
        if (!meta.favorites?.length) return [];
        let playlist: Playlist | undefined;
        try {
            playlist = (await firstValueFrom(
                this.playlistsService.getPlaylistById(meta._id)
            )) as Playlist | undefined;
        } catch {
            return [];
        }
        const favs = Array.isArray(playlist?.favorites)
            ? playlist.favorites.filter(isStalkerItem)
            : [];

        return favs.map((fav, index) => {
            const ct = extractStalkerItemType(fav);
            const isRadio = isStalkerRadioItem(fav);
            const stalkerId = extractStalkerItemId(fav, meta._id, index);
            const poster = extractStalkerItemPoster(fav) || null;
            return {
                uid: buildCollectionUid('stalker', meta._id, stalkerId),
                name:
                    extractStalkerItemTitle(fav) ||
                    this.translate.instant(
                        'WORKSPACE.GLOBAL_FAVORITES.UNKNOWN_CHANNEL'
                    ),
                contentType: ct,
                sourceType: 'stalker' as const,
                playlistId: meta._id,
                playlistName:
                    meta.title ||
                    meta.filename ||
                    this.translate.instant(
                        'WORKSPACE.DASHBOARD.STALKER_PORTAL'
                    ),
                logo: ct === 'live' ? poster : null,
                posterUrl: ct !== 'live' ? poster : null,
                tvgId: ct === 'live' ? stalkerId : undefined,
                radio: isRadio ? 'true' : undefined,
                stalkerId,
                stalkerCmd: fav.cmd,
                stalkerPortalUrl: playlist?.portalUrl ?? playlist?.url,
                stalkerMacAddress: playlist?.macAddress,
                categoryId: fav.category_id,
                stalkerItem: fav,
                addedAt:
                    normalizeStalkerDate(fav.added_at) ||
                    new Date(0).toISOString(),
                position: index,
            };
        });
    }

    private async getAllMeta(): Promise<PlaylistMeta[]> {
        return firstValueFrom(
            this.store
                .select(selectAllPlaylistsMeta)
                .pipe(map((m) => m as PlaylistMeta[]))
        );
    }

    private async getPlaylistMeta(
        id: string
    ): Promise<PlaylistMeta | undefined> {
        return (await this.getAllMeta()).find((p) => p._id === id);
    }

    private async getSavedOrder(): Promise<string[]> {
        if (!window.electron?.dbGetAppState) return [];
        try {
            const raw = await window.electron.dbGetAppState(
                GLOBAL_FAVORITES_ORDER_KEY
            );
            return raw ? (JSON.parse(raw) as string[]) : [];
        } catch {
            return [];
        }
    }

    private async saveOrder(uidOrder: string[]): Promise<void> {
        if (!window.electron?.dbSetAppState) return;
        try {
            await window.electron.dbSetAppState(
                GLOBAL_FAVORITES_ORDER_KEY,
                JSON.stringify(uidOrder)
            );
        } catch {
            /* ignore */
        }
    }

    private async setM3uFavorites(
        playlistId: string,
        favorites: string[]
    ): Promise<void> {
        await firstValueFrom(
            this.playlistsService.setFavorites(playlistId, favorites)
        );
        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: playlistId,
                    favorites,
                } as PlaylistMeta,
            })
        );
    }

    private applyOrder(
        items: UnifiedCollectionItem[],
        savedOrder: string[]
    ): UnifiedCollectionItem[] {
        if (!savedOrder.length) {
            return items.slice().sort((a, b) => {
                const pa = a.position ?? 0;
                const pb = b.position ?? 0;
                if (pa !== pb) return pa - pb;
                return (
                    new Date(b.addedAt ?? 0).getTime() -
                    new Date(a.addedAt ?? 0).getTime()
                );
            });
        }
        const orderMap = new Map(savedOrder.map((uid, i) => [uid, i]));
        const ordered: UnifiedCollectionItem[] = [];
        const unordered: UnifiedCollectionItem[] = [];
        for (const item of items) {
            const pos = orderMap.get(item.uid);
            pos != null
                ? ordered.push({ ...item, position: pos })
                : unordered.push(item);
        }
        ordered.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        unordered.sort(
            (a, b) =>
                new Date(b.addedAt ?? 0).getTime() -
                new Date(a.addedAt ?? 0).getTime()
        );
        return [...ordered, ...unordered];
    }

    private buildXtreamPositionUpdates(items: UnifiedCollectionItem[]) {
        return items
            .filter(
                (item) => item.sourceType === 'xtream' && item.contentId != null
            )
            .map((item, index) => ({
                content_id: item.contentId!,
                position: index,
            }));
    }

    private groupItemsByPlaylist(
        items: UnifiedCollectionItem[]
    ): Map<string, UnifiedCollectionItem[]> {
        return items.reduce((groups, item) => {
            const group = groups.get(item.playlistId);
            if (group) {
                group.push(item);
            } else {
                groups.set(item.playlistId, [item]);
            }

            return groups;
        }, new Map<string, UnifiedCollectionItem[]>());
    }

    private getStalkerFavoriteId(
        favorite:
            | Pick<UnifiedCollectionItem, 'stalkerId' | 'uid'>
            | StalkerPortalItem
    ): string {
        if ('uid' in favorite) {
            return String(
                favorite.stalkerId ?? favorite.uid.split('::')[2] ?? ''
            ).trim();
        }

        return extractStalkerItemId(favorite);
    }
}
