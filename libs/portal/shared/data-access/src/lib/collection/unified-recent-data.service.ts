import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { firstValueFrom, map } from 'rxjs';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    Channel,
    extractStalkerItemId,
    extractStalkerItemPoster,
    extractStalkerItemTitle,
    extractStalkerItemType,
    isStalkerRadioItem,
    isM3uRecentlyViewedItem,
    M3uRecentlyViewedItem,
    normalizeStalkerDate,
    Playlist,
    PlaylistMeta,
    PlaylistRecentlyViewedItem,
    PlaylistUpdateState,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import {
    buildCollectionUid,
    buildXtreamCollectionUid,
    CollectionScope,
    UnifiedCollectionItem,
    xtreamContentType,
} from '@iptvnator/portal/shared/util';
import {
    XTREAM_DATA_SOURCE,
    XtreamContentItem,
} from '@iptvnator/portal/xtream/data-access';

type PlaylistWithChannels = Omit<Playlist, 'playlist'> & {
    readonly playlist?: { readonly items?: Channel[] };
};

@Injectable({ providedIn: 'root' })
export class UnifiedRecentDataService {
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly xtreamDataSource = inject(XTREAM_DATA_SOURCE);

    async getRecentItems(
        scope: CollectionScope,
        playlistId?: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        if (scope === 'playlist' && playlistId) {
            return this.getPlaylistRecentItems(playlistId, portalType);
        }

        return this.getAllRecentItems();
    }

    async removeRecentItem(item: UnifiedCollectionItem): Promise<void> {
        if (item.sourceType === 'xtream') {
            if (item.contentId == null) {
                return;
            }

            if (this.hasPortalActivityStorage) {
                await this.dbService.removeRecentItem(
                    item.contentId,
                    item.playlistId
                );
                return;
            }

            await this.xtreamDataSource.removeRecentItem(
                item.contentId,
                item.playlistId
            );
            return;
        }

        if (item.sourceType === 'm3u') {
            const updatedPlaylist = await firstValueFrom(
                this.playlistsService.removeFromM3uRecentlyViewed(
                    item.playlistId,
                    item.streamUrl ?? item.uid.split('::')[2]
                )
            );
            this.dispatchPlaylistRecentUpdate(item.playlistId, updatedPlaylist);
            return;
        }

        const updatedPlaylist = await firstValueFrom(
            this.playlistsService.removeFromPortalRecentlyViewed(
                item.playlistId,
                item.stalkerId ?? item.uid.split('::')[2]
            )
        );
        this.dispatchPlaylistRecentUpdate(item.playlistId, updatedPlaylist);
    }

    /**
     * Bulk remove. Xtream items are batched into a single IPC call. m3u/stalker
     * items live in the playlist row's `recentlyViewed` JSON column, so we
     * group them by `playlistId` and do one read-filter-write per playlist —
     * a per-item Promise.all would race and clobber sibling deletions.
     */
    async removeRecentItemsBatch(
        items: UnifiedCollectionItem[]
    ): Promise<void> {
        if (items.length === 0) {
            return;
        }

        const xtreamBatch: { contentId: number; playlistId: string }[] = [];
        const groupedByPlaylist = new Map<string, (string | number)[]>();

        for (const item of items) {
            if (item.sourceType === 'xtream') {
                if (item.contentId != null) {
                    xtreamBatch.push({
                        contentId: item.contentId,
                        playlistId: item.playlistId,
                    });
                }
                continue;
            }

            const identity =
                item.sourceType === 'm3u'
                    ? (item.streamUrl ?? item.uid.split('::')[2])
                    : (item.stalkerId ?? item.uid.split('::')[2]);

            if (!identity) {
                continue;
            }

            const existing = groupedByPlaylist.get(item.playlistId) ?? [];
            existing.push(identity);
            groupedByPlaylist.set(item.playlistId, existing);
        }

        const tasks: Promise<unknown>[] = [];

        if (xtreamBatch.length > 0) {
            if (this.hasPortalActivityStorage) {
                tasks.push(this.dbService.removeRecentItemsBatch(xtreamBatch));
            } else {
                tasks.push(
                    ...xtreamBatch.map((item) =>
                        this.xtreamDataSource.removeRecentItem(
                            item.contentId,
                            item.playlistId
                        )
                    )
                );
            }
        }

        for (const [playlistId, identities] of groupedByPlaylist) {
            tasks.push(
                firstValueFrom(
                    this.playlistsService.removeFromPlaylistRecentlyViewedBatch(
                        playlistId,
                        identities
                    )
                ).then((updatedPlaylist) =>
                    this.dispatchPlaylistRecentUpdate(
                        playlistId,
                        updatedPlaylist
                    )
                )
            );
        }

        await Promise.all(tasks);
    }

    async clearRecentItems(
        scope: CollectionScope,
        playlistId?: string
    ): Promise<void> {
        if (scope === 'playlist' && playlistId) {
            if (this.hasPortalActivityStorage) {
                await this.dbService.clearPlaylistRecentItems(playlistId);
            } else {
                await this.xtreamDataSource.clearRecentItems(playlistId);
            }
            const updatedPlaylist = await firstValueFrom(
                this.playlistsService.clearPlaylistRecentlyViewed(playlistId)
            );
            this.dispatchPlaylistRecentUpdate(playlistId, updatedPlaylist);
            return;
        }

        if (this.hasPortalActivityStorage) {
            await this.dbService.clearGlobalRecentlyViewed();
        } else {
            const allMeta = await this.getAllMeta();
            await Promise.all(
                allMeta
                    .filter((playlist) => playlist._id)
                    .filter((playlist) => this.isXtreamPlaylist(playlist))
                    .map((playlist) =>
                        this.xtreamDataSource.clearRecentItems(playlist._id)
                    )
            );
        }
        const playlists = (await firstValueFrom(
            this.playlistsService.getAllPlaylists()
        )) as Playlist[];

        await Promise.all(
            playlists.map(async (playlist) => {
                if (this.isPlaylistBackedRecentPlaylist(playlist)) {
                    const updatedPlaylist = await firstValueFrom(
                        this.playlistsService.clearPlaylistRecentlyViewed(
                            playlist._id
                        )
                    );
                    this.dispatchPlaylistRecentUpdate(
                        playlist._id,
                        updatedPlaylist
                    );
                }
            })
        );
    }

    async recordLivePlayback(
        item: UnifiedCollectionItem
    ): Promise<UnifiedCollectionItem> {
        const viewedAt = new Date().toISOString();

        if (item.sourceType === 'm3u') {
            if (!item.streamUrl) {
                return item;
            }

            const updatedPlaylist = await firstValueFrom(
                this.playlistsService.addM3uRecentlyViewed(item.playlistId, {
                    source: 'm3u',
                    id: item.streamUrl,
                    url: item.streamUrl,
                    title: item.name?.trim() || item.streamUrl,
                    channel_id: item.channelId,
                    poster_url: item.logo ?? undefined,
                    tvg_id: item.tvgId,
                    tvg_name: item.name,
                    category_id: 'live',
                    added_at: viewedAt,
                } satisfies M3uRecentlyViewedItem)
            );

            this.dispatchPlaylistRecentUpdate(item.playlistId, updatedPlaylist);

            return {
                ...item,
                viewedAt,
            };
        }

        if (item.sourceType === 'xtream') {
            const contentId =
                item.contentId ??
                (item.xtreamId != null
                    ? await this.resolveXtreamContentId(item)
                    : null);

            if (contentId != null) {
                if (this.hasPortalActivityStorage) {
                    await this.dbService.addRecentItem(
                        contentId,
                        item.playlistId
                    );
                } else {
                    await this.xtreamDataSource.addRecentItem(
                        contentId,
                        item.playlistId
                    );
                }
            }

            return {
                ...item,
                contentId: contentId ?? item.contentId,
                viewedAt,
            };
        }

        const stalkerItem =
            (item.stalkerItem as StalkerPortalItem | undefined) ?? {};
        const updatedPlaylist = await firstValueFrom(
            this.playlistsService.addPortalRecentlyViewed(item.playlistId, {
                ...stalkerItem,
                id:
                    item.stalkerId ??
                    extractStalkerItemId(stalkerItem) ??
                    item.uid.split('::')[2],
                cmd: item.stalkerCmd ?? stalkerItem.cmd,
                cover:
                    stalkerItem.cover ??
                    item.logo ??
                    item.posterUrl ??
                    undefined,
                logo:
                    stalkerItem.logo ??
                    item.logo ??
                    item.posterUrl ??
                    undefined,
                title: item.name,
                name: stalkerItem.name ?? item.name,
                o_name: stalkerItem.o_name ?? item.name,
                category_id: 'itv',
                added_at: Date.now(),
            })
        );

        this.dispatchPlaylistRecentUpdate(item.playlistId, updatedPlaylist);

        return {
            ...item,
            viewedAt,
        };
    }

    private async getAllRecentItems(): Promise<UnifiedCollectionItem[]> {
        const [xtream, m3u, stalker] = await Promise.all([
            this.getXtreamGlobalRecent(),
            this.getM3uGlobalRecent(),
            this.getStalkerGlobalRecent(),
        ]);

        return [...xtream, ...m3u, ...stalker].sort(
            (a, b) =>
                new Date(b.viewedAt ?? 0).getTime() -
                new Date(a.viewedAt ?? 0).getTime()
        );
    }

    private async getPlaylistRecentItems(
        playlistId: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        if (portalType === 'xtream') {
            return this.getXtreamPlaylistRecent(playlistId);
        }

        if (portalType === 'stalker') {
            return this.getStalkerPlaylistRecent(playlistId);
        }

        return this.getM3uPlaylistRecent(playlistId);
    }

    private get hasPortalActivityStorage(): boolean {
        return this.runtime.supportsPortalActivityStorage;
    }

    private async getXtreamGlobalRecent(): Promise<UnifiedCollectionItem[]> {
        if (!this.hasPortalActivityStorage) {
            const allMeta = await this.getAllMeta();
            const results: UnifiedCollectionItem[] = [];
            for (const meta of allMeta.filter(
                (playlist) => playlist._id && this.isXtreamPlaylist(playlist)
            )) {
                results.push(...(await this.getXtreamPlaylistRecent(meta._id)));
            }
            return results;
        }

        try {
            const rows = await this.dbService.getGlobalRecentlyViewed();
            return (rows || []).map((row) => ({
                uid: buildXtreamCollectionUid(
                    row.playlist_id,
                    xtreamContentType(row.type),
                    row.xtream_id
                ),
                name: row.title,
                contentType: xtreamContentType(row.type),
                sourceType: 'xtream' as const,
                playlistId: row.playlist_id,
                playlistName: row.playlist_name ?? 'Xtream',
                logo: row.type === 'live' ? (row.poster_url ?? null) : null,
                posterUrl:
                    row.type !== 'live' ? (row.poster_url ?? null) : null,
                xtreamId: row.xtream_id,
                categoryId: row.category_id,
                tvgId: row.type === 'live' ? String(row.xtream_id) : undefined,
                contentId: row.id,
                viewedAt: normalizeStalkerDate(row.viewed_at),
            }));
        } catch {
            return [];
        }
    }

    private async getXtreamPlaylistRecent(
        playlistId: string
    ): Promise<UnifiedCollectionItem[]> {
        try {
            const meta = await this.getPlaylistMeta(playlistId);
            if (!this.hasPortalActivityStorage) {
                const rows =
                    await this.xtreamDataSource.getRecentItems(playlistId);
                return rows.map((row) =>
                    this.mapXtreamContentItem(row, playlistId, meta?.title)
                );
            }

            const rows = await this.dbService.getRecentItems(playlistId);
            return (rows || []).map((row) => ({
                uid: buildXtreamCollectionUid(
                    playlistId,
                    xtreamContentType(row.type),
                    row.xtream_id
                ),
                name: row.title,
                contentType: xtreamContentType(row.type),
                sourceType: 'xtream' as const,
                playlistId,
                playlistName: meta?.title || 'Xtream',
                logo: row.type === 'live' ? (row.poster_url ?? null) : null,
                posterUrl:
                    row.type !== 'live' ? (row.poster_url ?? null) : null,
                xtreamId: row.xtream_id,
                categoryId: row.category_id,
                tvgId: row.type === 'live' ? String(row.xtream_id) : undefined,
                contentId: row.id,
                viewedAt: normalizeStalkerDate(row.viewed_at),
            }));
        } catch {
            return [];
        }
    }

    private async resolveXtreamContentId(
        item: UnifiedCollectionItem
    ): Promise<number | null> {
        if (item.xtreamId == null) {
            return null;
        }

        if (!this.hasPortalActivityStorage) {
            const content = await this.xtreamDataSource.getContentByXtreamId(
                item.xtreamId,
                item.playlistId,
                item.contentType
            );
            return content?.id ?? item.xtreamId;
        }

        const content = await this.dbService.getContentByXtreamId(
            item.xtreamId,
            item.playlistId,
            item.contentType
        );

        return content?.id ?? null;
    }

    private mapXtreamContentItem(
        item: XtreamContentItem,
        playlistId: string,
        playlistName?: string
    ): UnifiedCollectionItem {
        const contentType = xtreamContentType(item.type);

        return {
            uid: buildXtreamCollectionUid(
                playlistId,
                contentType,
                item.xtream_id
            ),
            name: item.title,
            contentType,
            sourceType: 'xtream',
            playlistId,
            playlistName: playlistName ?? item.playlist_name ?? 'Xtream',
            logo: contentType === 'live' ? (item.poster_url ?? null) : null,
            posterUrl:
                contentType !== 'live' ? (item.poster_url ?? null) : null,
            xtreamId: item.xtream_id,
            categoryId: item.category_id,
            tvgId: contentType === 'live' ? String(item.xtream_id) : undefined,
            contentId: item.id,
            viewedAt: normalizeStalkerDate(item.viewed_at),
        };
    }

    private async getM3uGlobalRecent(): Promise<UnifiedCollectionItem[]> {
        const allMeta = await this.getAllMeta();
        const results: UnifiedCollectionItem[] = [];

        for (const meta of allMeta.filter((playlist) =>
            this.isM3uPlaylist(playlist)
        )) {
            results.push(...(await this.extractM3uRecent(meta)));
        }

        return results;
    }

    private async getM3uPlaylistRecent(
        playlistId: string
    ): Promise<UnifiedCollectionItem[]> {
        const meta = await this.getPlaylistMeta(playlistId);
        return meta ? this.extractM3uRecent(meta) : [];
    }

    private async getStalkerGlobalRecent(): Promise<UnifiedCollectionItem[]> {
        const allMeta = await this.getAllMeta();
        const results: UnifiedCollectionItem[] = [];

        for (const meta of allMeta.filter((playlist) =>
            Boolean(playlist.macAddress)
        )) {
            results.push(...(await this.extractStalkerRecent(meta)));
        }

        return results;
    }

    private async getStalkerPlaylistRecent(
        playlistId: string
    ): Promise<UnifiedCollectionItem[]> {
        const meta = await this.getPlaylistMeta(playlistId);
        return meta ? this.extractStalkerRecent(meta) : [];
    }

    private async extractM3uRecent(
        meta: PlaylistMeta
    ): Promise<UnifiedCollectionItem[]> {
        const recentItems = this.sortRecentItems(meta.recentlyViewed).filter(
            isM3uRecentlyViewedItem
        );

        if (recentItems.length === 0) {
            return [];
        }

        let playlist: PlaylistWithChannels | undefined;
        try {
            playlist = (await firstValueFrom(
                this.playlistsService.getPlaylistById(meta._id)
            )) as PlaylistWithChannels | undefined;
        } catch {
            return [];
        }

        const channels = playlist?.playlist?.items ?? [];
        const channelsByUrl = new Map<string, Channel>(
            channels
                .filter((channel) => channel.url?.trim())
                .map((channel) => [channel.url.trim(), channel] as const)
        );
        const channelsById = new Map<string, Channel>(
            channels
                .filter((channel) => channel.id?.trim())
                .map((channel) => [channel.id.trim(), channel] as const)
        );
        const seenUrls = new Set<string>();

        return recentItems
            .map((recentItem) => {
                const channel =
                    channelsByUrl.get(recentItem.url.trim()) ||
                    (recentItem.channel_id
                        ? channelsById.get(String(recentItem.channel_id).trim())
                        : undefined);
                const fallbackSourceId =
                    recentItem.url?.trim() ||
                    String(recentItem.channel_id ?? '').trim();

                if (!channel?.url || seenUrls.has(channel.url)) {
                    return null;
                }

                seenUrls.add(channel.url);

                return {
                    uid: buildCollectionUid(
                        'm3u',
                        meta._id,
                        fallbackSourceId || channel.url || channel.id
                    ),
                    name:
                        recentItem.title?.trim() ||
                        channel.name ||
                        recentItem.tvg_name?.trim() ||
                        recentItem.url,
                    contentType: 'live' as const,
                    sourceType: 'm3u' as const,
                    playlistId: meta._id,
                    playlistName: meta.title || meta.filename || 'M3U',
                    logo: channel.tvg?.logo ?? recentItem.poster_url ?? null,
                    streamUrl: channel.url,
                    channelId: channel.id,
                    radio: channel.radio,
                    m3uChannel: channel,
                    tvgId:
                        channel.tvg?.id ||
                        recentItem.tvg_id ||
                        recentItem.tvg_name ||
                        channel.tvg?.name ||
                        channel.name,
                    categoryId: recentItem.category_id,
                    viewedAt: normalizeStalkerDate(recentItem.added_at),
                } satisfies UnifiedCollectionItem;
            })
            .filter((item) => item !== null) as UnifiedCollectionItem[];
    }

    private async extractStalkerRecent(
        meta: PlaylistMeta
    ): Promise<UnifiedCollectionItem[]> {
        const recentItems = this.sortRecentItems(meta.recentlyViewed).filter(
            (item): item is StalkerPortalItem => !isM3uRecentlyViewedItem(item)
        );

        if (recentItems.length === 0) {
            return [];
        }

        let playlist: Playlist | undefined;
        try {
            playlist = (await firstValueFrom(
                this.playlistsService.getPlaylistById(meta._id)
            )) as Playlist | undefined;
        } catch {
            return [];
        }

        return recentItems.map((item, index) => {
            const stalkerId = extractStalkerItemId(item, meta._id, index);
            const contentType = extractStalkerItemType(item);
            const isRadio = isStalkerRadioItem(item);
            const imageUrl = extractStalkerItemPoster(item) || null;

            return {
                uid: buildCollectionUid('stalker', meta._id, stalkerId),
                name: extractStalkerItemTitle(item),
                contentType,
                sourceType: 'stalker' as const,
                playlistId: meta._id,
                playlistName: meta.title || meta.filename || 'Stalker Portal',
                logo: contentType === 'live' ? imageUrl : null,
                posterUrl: contentType !== 'live' ? imageUrl : null,
                tvgId: contentType === 'live' ? stalkerId : undefined,
                radio: isRadio ? 'true' : undefined,
                stalkerId,
                stalkerCmd: item.cmd,
                stalkerPortalUrl: playlist?.portalUrl ?? playlist?.url,
                stalkerMacAddress: playlist?.macAddress,
                categoryId: item.category_id,
                stalkerItem: item,
                viewedAt: normalizeStalkerDate(item.added_at),
            } satisfies UnifiedCollectionItem;
        });
    }

    private async getPlaylistMeta(
        id: string
    ): Promise<PlaylistMeta | undefined> {
        return (await this.getAllMeta()).find(
            (playlist) => playlist._id === id
        );
    }

    private async getAllMeta(): Promise<PlaylistMeta[]> {
        return firstValueFrom(
            this.store
                .select(selectAllPlaylistsMeta)
                .pipe(map((playlists) => playlists as PlaylistMeta[]))
        );
    }

    private sortRecentItems(
        items: PlaylistMeta['recentlyViewed']
    ): PlaylistRecentlyViewedItem[] {
        if (!Array.isArray(items)) {
            return [];
        }

        return [...items].sort(
            (a, b) =>
                new Date(normalizeStalkerDate(b.added_at ?? '')).getTime() -
                new Date(normalizeStalkerDate(a.added_at ?? '')).getTime()
        );
    }

    private dispatchPlaylistRecentUpdate(
        playlistId: string,
        updatedPlaylist: Partial<Pick<Playlist, 'recentlyViewed'>> | undefined
    ): void {
        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: playlistId,
                    recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                    updateState: PlaylistUpdateState.UPDATED,
                } as PlaylistMeta,
            })
        );
    }

    private isM3uPlaylist(
        playlist: Pick<PlaylistMeta, 'serverUrl' | 'macAddress'>
    ): boolean {
        return !playlist.serverUrl && !playlist.macAddress;
    }

    private isXtreamPlaylist(
        playlist: Pick<PlaylistMeta, 'serverUrl' | 'macAddress'>
    ): boolean {
        return Boolean(playlist.serverUrl) && !playlist.macAddress;
    }

    private isPlaylistBackedRecentPlaylist(
        playlist: Pick<PlaylistMeta, 'serverUrl' | 'macAddress'>
    ): boolean {
        return Boolean(playlist.macAddress) || this.isM3uPlaylist(playlist);
    }
}
