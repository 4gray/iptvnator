import { inject } from '@angular/core';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import { StalkerContentType } from '../stalker-store.contracts';
import {
    buildStalkerRecentlyViewedPayload,
    dispatchStalkerPlaylistMetaUpdate,
} from '../utils';

interface RecentStoreContext {
    currentPlaylist(): PlaylistMeta | undefined;
    selectedContentType(): StalkerContentType;
}

type RecentlyViewedPayload = StalkerPortalItem & {
    id?: string | number;
    title?: string;
};

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
                const storeContext = store as typeof store & RecentStoreContext;

                return {
                    addToRecentlyViewed(item: RecentlyViewedPayload) {
                        const portalId = storeContext.currentPlaylist()?._id;
                        if (!portalId) {
                            return;
                        }

                        const selectedContentType =
                            storeContext.selectedContentType();
                        const recentItem = buildStalkerRecentlyViewedPayload(
                            item,
                            selectedContentType
                        );
                        playlistService
                            .addPortalRecentlyViewed(portalId, recentItem)
                            .subscribe((updatedPlaylist) => {
                                dispatchStalkerPlaylistMetaUpdate(
                                    ngrxStore,
                                    portalId,
                                    {
                                        recentlyViewed:
                                            updatedPlaylist?.recentlyViewed,
                                    }
                                );
                            });
                    },
                    removeFromRecentlyViewed(
                        itemId: string | number,
                        onComplete?: () => void
                    ) {
                        const portalId = storeContext.currentPlaylist()?._id;
                        if (!portalId) {
                            return;
                        }

                        playlistService
                            .removeFromPortalRecentlyViewed(portalId, itemId)
                            .subscribe({
                                next: (updatedPlaylist) => {
                                    dispatchStalkerPlaylistMetaUpdate(
                                        ngrxStore,
                                        portalId,
                                        {
                                            recentlyViewed:
                                                updatedPlaylist?.recentlyViewed,
                                        }
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
