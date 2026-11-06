import { inject, Signal } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    ContentMetadataPatch,
    normalizeContentMetadataPatch,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import {
    XTREAM_DATA_SOURCE,
    type XtreamPlayedContent,
} from './data-sources/xtream-data-source.interface';

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
                dataSource = inject(XTREAM_DATA_SOURCE),
                runtime = inject(RuntimeCapabilitiesService)
            ) => ({
                addRecentItem: rxMethod<{
                    xtreamId: number | string;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string } | null | undefined>;
                    backdropUrl?: string;
                    playedContent?: XtreamPlayedContent;
                }>(
                    pipe(
                        switchMap(
                            async ({
                                xtreamId,
                                contentType,
                                playlist,
                                backdropUrl,
                                playedContent,
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

                                const identity = playedContent
                                    ? normalizeContentMetadataPatch({
                                          tmdbId:
                                              playedContent.tmdbId ?? undefined,
                                          releaseYear:
                                              playedContent.releaseYear ??
                                              undefined,
                                      })
                                    : null;
                                const content =
                                    await dataSource.getContentByXtreamId(
                                        normalizedXtreamId,
                                        playlistId,
                                        contentType,
                                        ...(runtime.supportsXtreamSqliteDataSource &&
                                        identity
                                            ? [identity]
                                            : [])
                                    );
                                const contentId =
                                    content?.id ??
                                    (!runtime.supportsXtreamSqliteDataSource
                                        ? normalizedXtreamId
                                        : null);

                                if (contentId != null) {
                                    await dataSource.addRecentItem(
                                        { id: contentId, type: contentType },
                                        playlistId,
                                        backdropUrl,
                                        ...(playedContent
                                            ? ([playedContent] as const)
                                            : [])
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
                async backfillContentMetadata({
                    xtreamId,
                    contentType,
                    playlist,
                    patch,
                }: {
                    xtreamId: number | string;
                    contentType: 'live' | 'movie' | 'series';
                    playlist: Signal<{ id: string } | null | undefined>;
                    patch: ContentMetadataPatch;
                }): Promise<void> {
                    const playlistId = playlist()?.id;
                    const normalizedXtreamId = Number(xtreamId);
                    const normalized = normalizeContentMetadataPatch(patch);
                    if (
                        !playlistId ||
                        !Number.isFinite(normalizedXtreamId) ||
                        normalizedXtreamId <= 0 ||
                        !normalized
                    ) {
                        return;
                    }

                    const content = await dataSource.getContentByXtreamId(
                        normalizedXtreamId,
                        playlistId,
                        contentType,
                        ...(runtime.supportsXtreamSqliteDataSource &&
                        (normalized.tmdbId != null ||
                            normalized.releaseYear != null)
                            ? [normalized]
                            : [])
                    );
                    const contentId =
                        content?.id ??
                        (!runtime.supportsXtreamSqliteDataSource
                            ? normalizedXtreamId
                            : null);
                    if (contentId == null) return;

                    await dataSource.setContentMetadataIfMissing(
                        { id: contentId, type: contentType },
                        playlistId,
                        normalized
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
                    contentType?: 'live' | 'movie' | 'series';
                    playlistId: string;
                }>(
                    pipe(
                        switchMap(
                            async ({ itemId, playlistId, contentType }) => {
                                await dataSource.removeRecentItem(
                                    contentType
                                        ? { id: itemId, type: contentType }
                                        : itemId,
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
                            }
                        )
                    )
                ),
            })
        )
    );
};
