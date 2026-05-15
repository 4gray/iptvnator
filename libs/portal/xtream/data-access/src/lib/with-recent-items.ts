import { inject, Signal } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { firstValueFrom, pipe, switchMap, tap } from 'rxjs';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import {
    buildPlaylistRecentItems,
    Playlist,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';

export interface RecentlyViewedItem extends PortalRecentItem {
    /** @deprecated Redundant — always equals `id`. Retained for compat. */
    content_id: number | string;
}

function resolveContentId(item: Record<string, unknown>): number | null {
    const rawId =
        item['id'] ??
        item['stream_id'] ??
        item['series_id'] ??
        item['xtream_id'];
    const id = Number(rawId);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function findLoadedContent(
    store: unknown,
    xtreamId: number,
    contentType: 'live' | 'movie' | 'series'
): Record<string, unknown> | null {
    const storeWithContent = store as {
        liveStreams?: () => Record<string, unknown>[];
        vodStreams?: () => Record<string, unknown>[];
        serialStreams?: () => Record<string, unknown>[];
    };
    const items =
        contentType === 'live'
            ? storeWithContent.liveStreams?.()
            : contentType === 'movie'
              ? storeWithContent.vodStreams?.()
              : storeWithContent.serialStreams?.();

    return (
        items?.find((item) => {
            const itemId = resolveContentId(item);
            return itemId === xtreamId;
        }) ?? null
    );
}

function mapDbRecentItem(
    item: {
        id?: number | string;
        title?: string;
        name?: string;
        type: string;
        poster_url?: string;
        stream_icon?: string;
        cover?: string;
        backdrop_url?: string | null;
        viewed_at?: string;
        xtream_id?: number | string;
        stream_id?: number | string;
        series_id?: number | string;
        category_id: number | string;
    },
    playlistId: string
): RecentlyViewedItem {
    const id = resolveContentId(item) ?? 0;

    return {
        id,
        title: item.title ?? item.name ?? 'Unknown',
        type: item.type as 'live' | 'movie' | 'series',
        poster_url: item.poster_url ?? item.stream_icon ?? item.cover ?? '',
        backdrop_url: item.backdrop_url ?? undefined,
        content_id: id,
        playlist_id: playlistId,
        viewed_at: item.viewed_at || '',
        xtream_id: Number(
            item.xtream_id ?? item.stream_id ?? item.series_id ?? id
        ),
        category_id: item.category_id,
    };
}

export const withRecentItems = function () {
    const logger = createLogger('withRecentItems');
    return signalStoreFeature(
        withState({
            recentItems: [],
        }),
        withMethods((store, dataSource = inject(XTREAM_DATA_SOURCE)) => ({
            loadRecentItems: rxMethod<{ id: string }>(
                pipe(
                    switchMap(async (playlist) => {
                        const items = await dataSource.getRecentItems(
                            playlist.id
                        );
                        return items.map((item) =>
                            mapDbRecentItem(item, playlist.id)
                        );
                    }),
                    tap((items: RecentlyViewedItem[]) =>
                        patchState(store, { recentItems: items })
                    )
                )
            ),
        })),
        withMethods(
            (
                store,
                dataSource = inject(XTREAM_DATA_SOURCE),
                dbService = inject(DatabaseService),
                playlistsService = inject(PlaylistsService)
            ) => ({
                addRecentItem: rxMethod<{
                    xtreamId: number;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string }>;
                    backdropUrl?: string;
                }>(
                    pipe(
                        switchMap(
                            async ({
                                xtreamId,
                                contentType,
                                playlist,
                                backdropUrl,
                            }) => {
                                const playlistId = playlist().id;
                                const content =
                                    (await dataSource.getContentByXtreamId(
                                        xtreamId,
                                        playlistId,
                                        contentType
                                    )) ??
                                    findLoadedContent(
                                        store,
                                        xtreamId,
                                        contentType
                                    );
                                const contentId = content
                                    ? resolveContentId(
                                          content as unknown as Record<
                                              string,
                                              unknown
                                          >
                                      )
                                    : null;
                                if (contentId) {
                                    await dataSource.addRecentItem(
                                        contentId,
                                        playlistId,
                                        backdropUrl
                                    );

                                    // Reload after add/update so re-watched items
                                    // immediately move to the top in recently-viewed.
                                    const items =
                                        await dataSource.getRecentItems(
                                            playlistId
                                        );
                                    patchState(store, {
                                        recentItems: items.map((item) =>
                                            mapDbRecentItem(item, playlistId)
                                        ),
                                    });
                                }
                            }
                        )
                    )
                ),
                async backfillContentBackdrop({
                    xtreamId,
                    contentType,
                    playlist,
                    backdropUrl,
                }: {
                    xtreamId: number;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string }>;
                    backdropUrl?: string;
                }): Promise<void> {
                    if (!window.electron) {
                        return;
                    }

                    const playlistId = playlist().id;
                    const normalizedBackdropUrl = backdropUrl?.trim();
                    if (!playlistId || !normalizedBackdropUrl) {
                        return;
                    }

                    const content = await dbService.getContentByXtreamId(
                        xtreamId,
                        playlistId,
                        contentType
                    );
                    if (!content) {
                        return;
                    }

                    await dbService.setContentBackdropIfMissing(
                        content.id,
                        normalizedBackdropUrl
                    );
                },
                clearRecentItems: rxMethod<{ id: string }>(
                    pipe(
                        switchMap(async (playlist) => {
                            await dataSource.clearRecentItems(playlist.id);
                            patchState(store, { recentItems: [] });
                        })
                    )
                ),
                removeRecentItem: rxMethod<{
                    itemId: number;
                    playlistId: string;
                }>(
                    pipe(
                        switchMap(async ({ itemId, playlistId }) => {
                            await dataSource.removeRecentItem(
                                itemId,
                                playlistId
                            );
                            // Reload recent items to update UI
                            const items =
                                await dataSource.getRecentItems(playlistId);
                            patchState(store, {
                                recentItems: items.map((item) =>
                                    mapDbRecentItem(item, playlistId)
                                ),
                            });
                        })
                    )
                ),
                async loadGlobalRecentItems() {
                    try {
                        const xtreamItems =
                            await dbService.getGlobalRecentlyViewed();
                        const playlists = (await firstValueFrom(
                            playlistsService.getAllPlaylists()
                        )) as Playlist[];
                        const playlistBackedItems = buildPlaylistRecentItems(
                            playlists,
                            {
                                stalker: 'Stalker Portal',
                                m3u: 'M3U',
                            }
                        ).map((item) => ({
                            ...item,
                            content_id: item.id,
                        })) as RecentlyViewedItem[];

                        const normalizedXtream: RecentlyViewedItem[] = (
                            xtreamItems || []
                        ).map((item) => ({
                            id: item.id,
                            title: item.title,
                            type: item.type as 'live' | 'movie' | 'series',
                            poster_url: item.poster_url,
                            backdrop_url: item.backdrop_url ?? undefined,
                            content_id: item.id,
                            playlist_id: item.playlist_id,
                            playlist_name: item.playlist_name,
                            viewed_at: item.viewed_at,
                            xtream_id: item.xtream_id,
                            category_id: item.category_id,
                            source: 'xtream',
                        }));

                        const items = [
                            ...normalizedXtream,
                            ...playlistBackedItems,
                        ].sort(
                            (a, b) =>
                                new Date(b.viewed_at).getTime() -
                                new Date(a.viewed_at).getTime()
                        );
                        patchState(store, {
                            recentItems: items,
                        });
                    } catch (error) {
                        logger.error(
                            'Error loading global recent items',
                            error
                        );
                        patchState(store, { recentItems: [] });
                    }
                },
                async clearGlobalRecentlyViewed() {
                    try {
                        await dbService.clearGlobalRecentlyViewed();
                        const playlists = (await firstValueFrom(
                            playlistsService.getAllPlaylists()
                        )) as Playlist[];
                        await Promise.all(
                            playlists
                                .filter(
                                    (playlist) =>
                                        Boolean(playlist.macAddress) ||
                                        !playlist.serverUrl
                                )
                                .map((playlist) =>
                                    firstValueFrom(
                                        playlistsService.clearPlaylistRecentlyViewed(
                                            playlist._id
                                        )
                                    )
                                )
                        );
                        patchState(store, { recentItems: [] });
                    } catch (error) {
                        logger.error(
                            'Error clearing global recently viewed',
                            error
                        );
                    }
                },
            })
        )
    );
};
