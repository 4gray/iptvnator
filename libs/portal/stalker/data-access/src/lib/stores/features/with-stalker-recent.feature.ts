import { inject } from '@angular/core';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { PlaylistActions } from 'm3u-state';
import { PlaylistsService } from 'services';
import { PlaylistMeta, StalkerPortalItem } from 'shared-interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';

interface RecentStoreContext {
    currentPlaylist(): PlaylistMeta | undefined;
    selectedContentType(): string;
}

type RecentlyViewedPayload = StalkerPortalItem & {
    id?: string | number;
    title?: string;
};

function resolveCategoryId(value: unknown, fallback: string): string {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
}

function getSeriesRecentMetadata(selectedContentType: string): {
    category_id?: 'series';
    is_series?: true;
} {
    if (selectedContentType !== 'series') {
        return {};
    }

    return {
        category_id: 'series',
        is_series: true,
    };
}

/**
 * Recently-viewed concern methods.
 */
export function withStalkerRecent() {
    const logger = createLogger('withStalkerRecent');
    return signalStoreFeature(
        withMethods(
            (
                store,
                playlistService = inject(PlaylistsService),
                ngrxStore = inject(Store)
            ) => {
                const storeContext = store as unknown as RecentStoreContext;

                return {
                    addToRecentlyViewed(item: RecentlyViewedPayload) {
                        const portalId = storeContext.currentPlaylist()?._id;
                        const selectedContentType =
                            storeContext.selectedContentType();
                        const recentItem = {
                            ...item,
                            category_id: resolveCategoryId(
                                item.category_id,
                                selectedContentType
                            ),
                            ...getSeriesRecentMetadata(selectedContentType),
                            added_at: Date.now(),
                            id: item.id ?? item.stream_id ?? '',
                            title: item.title ?? item.name ?? item.o_name ?? '',
                        };
                        playlistService
                            .addPortalRecentlyViewed(portalId, recentItem)
                            .subscribe((updatedPlaylist) => {
                                ngrxStore.dispatch(
                                    PlaylistActions.updatePlaylistMeta({
                                        playlist: {
                                            _id: portalId,
                                            recentlyViewed:
                                                updatedPlaylist?.recentlyViewed,
                                        } as PlaylistMeta,
                                    })
                                );
                            });
                    },
                    removeFromRecentlyViewed(
                        itemId: string | number,
                        onComplete?: () => void
                    ) {
                        const portalId = storeContext.currentPlaylist()?._id;
                        playlistService
                            .removeFromPortalRecentlyViewed(portalId, itemId)
                            .subscribe({
                                next: (updatedPlaylist) => {
                                    ngrxStore.dispatch(
                                        PlaylistActions.updatePlaylistMeta({
                                            playlist: {
                                                _id: portalId,
                                                recentlyViewed:
                                                    updatedPlaylist?.recentlyViewed,
                                            } as PlaylistMeta,
                                        })
                                    );
                                    onComplete?.();
                                },
                                error: (error) =>
                                    logger.error(
                                        'Failed to remove item from recently viewed',
                                        error
                                    ),
                            });
                    },
                };
            }
        )
    );
}
