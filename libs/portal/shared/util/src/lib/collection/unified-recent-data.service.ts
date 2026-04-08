import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
    PlaylistActions,
    selectAllPlaylistsMeta,
} from 'm3u-state';
import { firstValueFrom, map } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import {
    Channel,
    extractStalkerItemId,
    extractStalkerItemPoster,
    extractStalkerItemTitle,
    extractStalkerItemType,
    isM3uRecentlyViewedItem,
    M3uRecentlyViewedItem,
    Playlist,
    PlaylistMeta,
    PlaylistRecentlyViewedItem,
    PlaylistUpdateState,
    StalkerPortalItem,
    normalizeStalkerDate,
} from 'shared-interfaces';
import {
    buildCollectionUid,
    UnifiedCollectionItem,
} from './unified-collection-item.interface';
import { CollectionScope } from './scope-toggle.service';
import { xtreamContentType } from './collection-helpers';

type PlaylistWithChannels = Playlist & {
    readonly playlist?: { readonly items?: Channel[] };
};

@Injectable({ providedIn: 'root' })
export class UnifiedRecentDataService {
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);

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

            await this.dbService.removeRecentItem(item.contentId, item.playlistId);
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

    async clearRecentItems(
        scope: CollectionScope,
        playlistId?: string
    ): Promise<void> {
        if (scope === 'playlist' && playlistId) {
            await this.dbService.clearPlaylistRecentItems(playlistId);
            const updatedPlaylist = await firstValueFrom(
                this.playlistsService.clearPlaylistRecentlyViewed(playlistId)
            );
            this.dispatchPlaylistRecentUpdate(playlistId, updatedPlaylist);
            return;
        }

        await this.dbService.clearGlobalRecentlyViewed();
        const playlists = (await firstValueFrom(
            this.playlistsService.getAllPlaylists()
        )) as Playlist[];

        await Promise.all(
            playlists
                .filter((playlist) => Boolean(playlist.macAddress) || !playlist.serverUrl)
                .map(async (playlist) => {
                    const updatedPlaylist = await firstValueFrom(
                        this.playlistsService.clearPlaylistRecentlyViewed(
                            playlist._id
                        )
                    );
                    this.dispatchPlaylistRecentUpdate(
                        playlist._id,
                        updatedPlaylist
                    );
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
                    ? (
                          await this.dbService.getContentByXtreamId(
                              item.xtreamId,
                              item.playlistId
                          )
                      )?.id
                    : null);

            if (contentId != null) {
                await this.dbService.addRecentItem(contentId, item.playlistId);
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

    private async getXtreamGlobalRecent(): Promise<UnifiedCollectionItem[]> {
        try {
            const rows = await this.dbService.getGlobalRecentlyViewed();
            return (rows || []).map((row) => ({
                uid: buildCollectionUid('xtream', row.playlist_id, row.xtream_id),
                name: row.title,
                contentType: xtreamContentType(row.type),
                sourceType: 'xtream' as const,
                playlistId: row.playlist_id,
                playlistName: row.playlist_name ?? 'Xtream',
                logo: row.type === 'live' ? (row.poster_url ?? null) : null,
                posterUrl: row.type !== 'live' ? (row.poster_url ?? null) : null,
                xtreamId: row.xtream_id,
                categoryId: row.category_id,
                tvgId: row.type === 'live' ? String(row.xtream_id) : undefined,
                contentId: row.id,
                viewedAt: row.viewed_at,
            }));
        } catch {
            return [];
        }
    }

    private async getXtreamPlaylistRecent(
        playlistId: string
    ): Promise<UnifiedCollectionItem[]> {
        try {
            const rows = await this.dbService.getRecentItems(playlistId);
            const meta = await this.getPlaylistMeta(playlistId);

            return (rows || []).map((row) => ({
                uid: buildCollectionUid('xtream', playlistId, row.xtream_id),
                name: row.title,
                contentType: xtreamContentType(row.type),
                sourceType: 'xtream' as const,
                playlistId,
                playlistName: meta?.title || 'Xtream',
                logo: row.type === 'live' ? (row.poster_url ?? null) : null,
                posterUrl: row.type !== 'live' ? (row.poster_url ?? null) : null,
                xtreamId: row.xtream_id,
                categoryId: row.category_id,
                tvgId: row.type === 'live' ? String(row.xtream_id) : undefined,
                contentId: row.id,
                viewedAt: row.viewed_at ?? '',
            }));
        } catch {
            return [];
        }
    }

    private async getM3uGlobalRecent(): Promise<UnifiedCollectionItem[]> {
        const allMeta = await this.getAllMeta();
        const results: UnifiedCollectionItem[] = [];

        for (const meta of allMeta.filter((playlist) => this.isM3uPlaylist(playlist))) {
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

        for (const meta of allMeta.filter((playlist) => Boolean(playlist.macAddress))) {
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
        return (await this.getAllMeta()).find((playlist) => playlist._id === id);
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
}
