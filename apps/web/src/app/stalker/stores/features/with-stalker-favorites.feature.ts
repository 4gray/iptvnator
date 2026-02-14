import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { withMethods, signalStoreFeature } from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistsService } from 'services';

/**
 * Favorites concern methods.
 */
export function withStalkerFavorites() {
    return signalStoreFeature(
        withMethods(
            (
                store,
                playlistService = inject(PlaylistsService),
                snackBar = inject(MatSnackBar),
                translate = inject(TranslateService)
            ) => {
                const storeAny = store as any;
                return {
                    addToFavorites(item: any, onDone?: () => void) {
                        playlistService
                            .addPortalFavorite(
                                storeAny.currentPlaylist()?._id,
                                {
                                    ...item,
                                    category_id:
                                        storeAny.selectedContentType(),
                                    added_at: Date.now(),
                                    id: item.stream_id ?? item.id,
                                }
                            )
                            .subscribe(() => {
                                snackBar.open(
                                    translate.instant(
                                        'PORTALS.ADDED_TO_FAVORITES'
                                    ),
                                    null,
                                    {
                                        duration: 1000,
                                    }
                                );
                                onDone?.();
                            });
                    },
                    removeFromFavorites(
                        favoriteId: string,
                        onDone?: () => void
                    ) {
                        playlistService
                            .removeFromPortalFavorites(
                                storeAny.currentPlaylist()?._id,
                                favoriteId
                            )
                            .subscribe(() => {
                                snackBar.open(
                                    translate.instant(
                                        'PORTALS.REMOVED_FROM_FAVORITES'
                                    ),
                                    null,
                                    {
                                        duration: 1000,
                                    }
                                );
                                onDone?.();
                            });
                    },
                };
            }
        )
    );
}
