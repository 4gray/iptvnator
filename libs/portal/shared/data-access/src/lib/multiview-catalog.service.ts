import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    DataService,
    ParentalLockService,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    Channel,
    isCatalogUnavailable,
    Playlist,
    PlaylistMeta,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { sourceSortName } from '@iptvnator/playlist/shared/util';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import {
    executeStalkerRequest,
    loadStalkerItvGenre,
    StalkerItvChannel,
    StalkerItvCacheService,
    StalkerPortalRepairService,
    StalkerSessionService,
} from '@iptvnator/portal/stalker/data-access';
import { UnifiedFavoritesDataService } from './collection/unified-favorites-data.service';
import { StreamResolverService } from './collection/stream-resolver.service';

export interface MultiviewCatalogSource {
    id: string;
    name: string;
}
export interface MultiviewCatalogChannel {
    item: UnifiedCollectionItem;
    group: string;
}
export interface MultiviewCatalogSelection {
    item: UnifiedCollectionItem;
    playback: ResolvedPortalPlayback;
}
export interface MultiviewCatalog {
    groups: MultiviewCatalogSource[];
    channels: MultiviewCatalogChannel[];
}

/** Browses independently of the active provider store and player selection. */
@Injectable({ providedIn: 'root' })
export class MultiviewCatalogService {
    private readonly playlists = inject(PlaylistsService);
    private readonly favorites = inject(UnifiedFavoritesDataService);
    private readonly resolver = inject(StreamResolverService);
    private readonly xtream = inject(XTREAM_DATA_SOURCE);
    private readonly itv = inject(StalkerItvCacheService);
    private readonly locks = inject(ParentalLockService);
    private readonly stalkerDeps = {
        dataService: inject(DataService),
        stalkerSession: inject(StalkerSessionService),
        portalRepair: inject(StalkerPortalRepairService),
    };
    private readonly runtime = inject(RuntimeCapabilitiesService);
    readonly version = this.locks.version;

    async sources(): Promise<MultiviewCatalogSource[]> {
        const metas = await firstValueFrom(this.playlists.getAllPlaylists());
        return metas
            .filter((p) => p._id !== 'global-favorites')
            .map((p) => ({ id: p._id, name: sourceSortName(p) }));
    }

    async load(
        sourceId: string,
        signal: AbortSignal
    ): Promise<MultiviewCatalog> {
        if (this.locks.withholdsEverything())
            return { groups: [], channels: [] };
        if (!sourceId) {
            const items = await this.normalizeFavorites(
                await this.favorites.getFavorites('all')
            );
            const metas = await firstValueFrom(
                this.playlists.getAllPlaylists()
            );
            const names = new Map(metas.map((p) => [p._id, sourceSortName(p)]));
            const channels = items
                .filter(
                    (i) =>
                        i.contentType === 'live' &&
                        i.radio !== 'true' &&
                        this.isAllowed(i)
                )
                .map((item) => ({ item, group: item.playlistId }));
            return {
                groups: [...new Set(channels.map((c) => c.group))].map(
                    (id) => ({ id, name: names.get(id) ?? '' })
                ),
                channels,
            };
        }
        const playlist = await firstValueFrom(
            this.playlists.getPlaylistById(sourceId)
        );
        if (!playlist || signal.aborted) throw new Error('Source unavailable');
        if (playlist.macAddress) return this.stalker(playlist, signal);
        if (playlist.serverUrl) return this.xtreamCatalog(playlist, signal);
        const rows =
            (playlist as unknown as { playlist?: { items?: Channel[] } })
                .playlist?.items ?? [];
        const channels = rows
            .filter(
                (c) =>
                    c.radio !== 'true' &&
                    !playlist.hiddenGroupTitles?.includes(
                        c.group?.title ?? ''
                    ) &&
                    !this.locks.isM3uGroupLocked(
                        playlist._id,
                        c.group?.title ?? ''
                    )
            )
            .map((c) => ({
                group: c.group?.title ?? '',
                item: {
                    uid: `m3u::${playlist._id}::${c.id}`,
                    name: c.name,
                    logo: c.tvg?.logo,
                    sourceType: 'm3u' as const,
                    contentType: 'live' as const,
                    playlistId: playlist._id,
                    playlistName: sourceSortName(playlist),
                    channelId: c.id,
                    streamUrl: c.url,
                    m3uChannel: c,
                },
            }));
        return {
            groups: [...new Set(channels.map((c) => c.group))].map((id) => ({
                id,
                name: id,
            })),
            channels,
        };
    }

    async loadGroup(
        sourceId: string,
        groupId: string,
        signal: AbortSignal
    ): Promise<MultiviewCatalogChannel[]> {
        if (!sourceId || this.locks.withholdsEverything()) return [];
        const playlist = await firstValueFrom(
            this.playlists.getPlaylistById(sourceId)
        );
        if (
            !playlist?.macAddress ||
            this.locks.isStalkerCategoryLocked(sourceId, 'itv', groupId)
        )
            return [];
        const rows = await loadStalkerItvGenre(
            this.stalkerDeps,
            playlist,
            groupId,
            signal
        );
        return this.stalkerRows(playlist, rows);
    }

    async resolve(row: MultiviewCatalogChannel) {
        const item = row.item;
        if (!this.isAllowed(item)) throw new Error('Channel unavailable');
        const playback = await this.resolver.resolvePlayback(item);
        if (!this.isAllowed(item)) throw new Error('Channel unavailable');
        return playback;
    }

    private async normalizeFavorites(
        items: UnifiedCollectionItem[]
    ): Promise<UnifiedCollectionItem[]> {
        if (!this.runtime.supportsXtreamSqliteDataSource) return items;
        const ids = [
            ...new Set(
                items
                    .filter(
                        (i) =>
                            i.sourceType === 'xtream' &&
                            i.contentType === 'live'
                    )
                    .map((i) => i.playlistId)
            ),
        ];
        const categories = new Map(
            await Promise.all(
                ids.map(
                    async (id) =>
                        [
                            id,
                            await this.xtream.getAllCategories(id, 'live'),
                        ] as const
                )
            )
        );
        return items.map((item) =>
            item.sourceType !== 'xtream'
                ? item
                : {
                      ...item,
                      categoryId: categories
                          .get(item.playlistId)
                          ?.find((c) => c.id === Number(item.categoryId))
                          ?.xtream_id,
                  }
        );
    }

    isAllowed(item: UnifiedCollectionItem): boolean {
        this.version();
        if (this.locks.withholdsEverything() || isCatalogUnavailable(item))
            return false;
        if (item.sourceType === 'm3u')
            return !this.locks.isM3uGroupLocked(
                item.playlistId,
                item.m3uChannel?.group?.title ?? ''
            );
        if (item.sourceType === 'stalker') {
            const raw = item.stalkerItem as
                { tv_genre_id?: string | number } | undefined;
            return !this.locks.isStalkerCategoryLocked(
                item.playlistId,
                'itv',
                raw?.tv_genre_id ?? item.categoryId
            );
        }
        const categoryId = Number(item.categoryId);
        if (!Number.isFinite(categoryId) && this.locks.active()) {
            return (
                this.locks.lockedXtreamIds(item.playlistId, 'live').length === 0
            );
        }
        return !this.locks.isXtreamCategoryLocked(
            item.playlistId,
            'live',
            categoryId
        );
    }

    private async xtreamCatalog(
        playlist: Playlist,
        signal: AbortSignal
    ): Promise<MultiviewCatalog> {
        const source = await this.xtream.getPlaylist(playlist._id);
        if (!source) throw new Error('Source unavailable');
        const categories = await this.xtream.getCategories(
            playlist._id,
            source,
            'live',
            { signal }
        );
        const rows = await this.xtream.getContent(
            playlist._id,
            source,
            'live',
            undefined,
            undefined,
            { signal }
        );
        const groups = categories
            .filter((c) => !('hidden' in c && c.hidden))
            .map((c) => ({
                id: String('id' in c ? c.id : c.category_id),
                name: 'name' in c ? c.name : c.category_name,
                providerId: Number(
                    'xtream_id' in c ? c.xtream_id : c.category_id
                ),
            }));
        const allowed = new Map(
            groups
                .filter(
                    (c) =>
                        !this.locks.isXtreamCategoryLocked(
                            playlist._id,
                            'live',
                            c.providerId
                        )
                )
                .map((c) => [c.id, c])
        );
        const channels = rows
            .filter((c) => allowed.has(String(c.category_id)))
            .map((c) => ({
                group: String(c.category_id),
                item: {
                    uid: `xtream::${playlist._id}::live:${'xtream_id' in c ? c.xtream_id : 'stream_id' in c ? c.stream_id : undefined}`,
                    name: ('title' in c ? c.title : c.name) ?? '',
                    logo:
                        'poster_url' in c
                            ? c.poster_url
                            : 'stream_icon' in c
                              ? c.stream_icon
                              : undefined,
                    sourceType: 'xtream' as const,
                    contentType: 'live' as const,
                    playlistId: playlist._id,
                    playlistName: sourceSortName(playlist),
                    xtreamId:
                        'xtream_id' in c
                            ? c.xtream_id
                            : 'stream_id' in c
                              ? c.stream_id
                              : undefined,
                    categoryId: allowed.get(String(c.category_id))?.providerId,
                },
            }));
        return { groups: [...allowed.values()], channels };
    }

    private async stalker(
        playlist: PlaylistMeta,
        signal: AbortSignal
    ): Promise<MultiviewCatalog> {
        const [response] = await Promise.all([
            executeStalkerRequest<{
                js?: { id: string | number; title: string }[];
            }>(this.stalkerDeps, playlist, {
                type: 'itv',
                action: 'get_genres',
            }),
            this.itv.ensureLoaded(playlist),
        ]);
        if (signal.aborted) throw new Error('Cancelled');
        const rows = this.itv.getChannels(playlist) ?? [];
        if (!Array.isArray(response.js))
            throw new Error('Channel list unavailable');
        const groups = response.js
            .filter(
                (g) =>
                    String(g.id) !== '*' &&
                    !this.locks.isStalkerCategoryLocked(
                        playlist._id,
                        'itv',
                        g.id
                    )
            )
            .map((g) => ({ id: String(g.id), name: g.title }));
        return { groups, channels: this.stalkerRows(playlist, rows) };
    }

    private stalkerRows(
        playlist: PlaylistMeta,
        rows: StalkerItvChannel[]
    ): MultiviewCatalogChannel[] {
        return rows
            .filter(
                (c) =>
                    !this.locks.isStalkerCategoryLocked(
                        playlist._id,
                        'itv',
                        c.tv_genre_id
                    )
            )
            .map((c) => ({
                group: String(c.tv_genre_id ?? ''),
                item: {
                    uid: `stalker::${playlist._id}::${c.id}`,
                    name: c.name ?? c.o_name ?? '',
                    logo: c.logo,
                    sourceType: 'stalker' as const,
                    contentType: 'live' as const,
                    playlistId: playlist._id,
                    playlistName: sourceSortName(playlist),
                    stalkerId: c.id,
                    stalkerCmd: c.cmd,
                    stalkerItem: c,
                    categoryId: c.tv_genre_id,
                },
            }));
    }
}
