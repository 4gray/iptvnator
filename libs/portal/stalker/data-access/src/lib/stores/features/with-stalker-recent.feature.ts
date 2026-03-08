import { inject } from '@angular/core';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { PlaylistActions } from 'm3u-state';
import { PlaylistsService } from 'services';
import { PlaylistMeta } from 'shared-interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';

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
                const storeAny = store as any;

                return {
                    addToRecentlyViewed(item: any) {
                        const portalId = storeAny.currentPlaylist()?._id;
                        playlistService
                            .addPortalRecentlyViewed(portalId, {
                                ...item,
                                category_id: storeAny.selectedContentType(),
                                added_at: Date.now(),
                            })
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
                        const portalId = storeAny.currentPlaylist()?._id;
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
