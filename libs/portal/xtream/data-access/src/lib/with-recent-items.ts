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

function mapDbRecentItem(
    item: {
        id: number;
        title: string;
        type: string;
        poster_url: string;
        backdrop_url?: string | null;
        viewed_at?: string;
        xtream_id: number;
        category_id: number | string;
    },
    playlistId: string
): RecentlyViewedItem {
    return {
        id: item.id,
        title: item.title,
        type: item.type as 'live' | 'movie' | 'series',
        poster_url: item.poster_url,
        backdrop_url: item.backdrop_url ?? undefined,
        content_id: item.id,
        playlist_id: playlistId,
        viewed_at: item.viewed_at || '',
        xtream_id: item.xtream_id,
        category_id: item.category_id,
    };
}

export const withRecentItems = function () {
    const logger = createLogger('withRecentItems');
    return signalStoreFeature(
        withState<{ recentItems: RecentlyViewedItem[] }>({
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
                dbService = inject(DatabaseService),
                playlistsService = inject(PlaylistsService),
                dataSource = inject(XTREAM_DATA_SOURCE)
            ) => ({
                addRecentItem: rxMethod<{
                    xtreamId: number | string;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string } | null | undefined>;
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
                                const playlistId = playlist()?.id;
                                const normalizedXtreamId = Number(xtreamId);
                                if (
                                    !playlistId ||
                                    !Number.isFinite(normalizedXtreamId) ||
                                    normalizedXtreamId <= 0
                                ) {
                                    return;
                                }

                                const content =
                                    await dataSource.getContentByXtreamId(
                                        normalizedXtreamId,
                                        playlistId,
                                        contentType
                                    );
                                const contentId =
                                    content?.id ??
                                    (!window.electron
                                        ? normalizedXtreamId
                                        : null);

                                if (contentId != null) {
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
                    xtreamId: number | string;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string } | null | undefined>;
                    backdropUrl?: string;
                }): Promise<void> {
                    const playlistId = playlist()?.id;
                    const normalizedXtreamId = Number(xtreamId);
                    const normalizedBackdropUrl = backdropUrl?.trim();
                    if (
                        !playlistId ||
                        !Number.isFinite(normalizedXtreamId) ||
                        normalizedXtreamId <= 0 ||
                        !normalizedBackdropUrl
                    ) {
                        return;
                    }

                    const content = await dataSource.getContentByXtreamId(
                        normalizedXtreamId,
                        playlistId,
                        contentType
                    );
                    if (!content) {
                        return;
                    }

                    await dataSource.setContentBackdropIfMissing(
                        content.id,
                        playlistId,
                        normalizedBackdropUrl
                    );
                },
                clearRecentItems: rxMethod<{ id: string }>(
                    pipe(
                        switchMap(async (playlist) => {
                            if (window.electron) {
                                await dbService.clearPlaylistRecentItems(
                                    playlist.id
                                );
                            } else {
                                await dataSource.clearRecentItems(playlist.id);
                            }
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
                        if (window.electron) {
                            await dbService.clearGlobalRecentlyViewed();
                        }
                        const playlists = (await firstValueFrom(
                            playlistsService.getAllPlaylists()
                        )) as Playlist[];
                        await Promise.all(
                            playlists.map(async (playlist) => {
                                if (
                                    !window.electron &&
                                    playlist.serverUrl &&
                                    !playlist.macAddress
                                ) {
                                    await dataSource.clearRecentItems(
                                        playlist._id
                                    );
                                }

                                if (
                                    Boolean(playlist.macAddress) ||
                                    !playlist.serverUrl
                                ) {
                                    await firstValueFrom(
                                        playlistsService.clearPlaylistRecentlyViewed(
                                            playlist._id
                                        )
                                    );
                                }
                            })
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
