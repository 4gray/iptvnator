import { inject } from '@angular/core';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { PlaylistsService } from 'services';
import { createLogger } from '../../../shared/utils/logger';

/**
 * Recently-viewed concern methods.
 */
export function withStalkerRecent() {
    const logger = createLogger('withStalkerRecent');
    return signalStoreFeature(
        withMethods((store, playlistService = inject(PlaylistsService)) => {
            const storeAny = store as any;

            return {
                addToRecentlyViewed(item: any) {
                    playlistService
                        .addPortalRecentlyViewed(
                            storeAny.currentPlaylist()?._id,
                            {
                                ...item,
                                category_id: storeAny.selectedContentType(),
                                added_at: Date.now(),
                            }
                        )
                        .subscribe();
                },
                removeFromRecentlyViewed(
                    itemId: string | number,
                    onComplete?: () => void
                ) {
                    playlistService
                        .removeFromPortalRecentlyViewed(
                            storeAny.currentPlaylist()?._id,
                            itemId
                        )
                        .subscribe({
                            next: () => onComplete?.(),
                            error: (error) =>
                                logger.error(
                                    'Failed to remove item from recently viewed',
                                    error
                                ),
                        });
                },
            };
        })
    );
}
