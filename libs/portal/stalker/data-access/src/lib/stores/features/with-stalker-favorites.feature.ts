import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from 'm3u-state';
import { PlaylistsService } from 'services';
import { PlaylistMeta, StalkerPortalItem } from 'shared-interfaces';

interface FavoritesStoreContext {
    currentPlaylist(): PlaylistMeta | undefined;
    selectedContentType(): string;
}

type FavoritePayload = StalkerPortalItem & {
    stream_id?: string | number;
    id?: string | number;
};

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
                translate = inject(TranslateService),
                ngrxStore = inject(Store)
            ) => {
                const storeContext = store as unknown as FavoritesStoreContext;
                return {
                    addToFavorites(item: FavoritePayload, onDone?: () => void) {
                        const portalId = storeContext.currentPlaylist()?._id;
                        playlistService
                            .addPortalFavorite(portalId, {
                                ...item,
                                category_id: storeContext.selectedContentType(),
                                added_at: Date.now(),
                                id: item.stream_id ?? item.id,
                            })
                            .subscribe((updatedPlaylist) => {
                                ngrxStore.dispatch(
                                    PlaylistActions.updatePlaylistMeta({
                                        playlist: {
                                            _id: portalId,
                                            favorites:
                                                updatedPlaylist?.favorites,
                                        } as PlaylistMeta,
                                    })
                                );
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
                        const portalId = storeContext.currentPlaylist()?._id;
                        playlistService
                            .removeFromPortalFavorites(portalId, favoriteId)
                            .subscribe((updatedPlaylist) => {
                                ngrxStore.dispatch(
                                    PlaylistActions.updatePlaylistMeta({
                                        playlist: {
                                            _id: portalId,
                                            favorites:
                                                updatedPlaylist?.favorites,
                                        } as PlaylistMeta,
                                    })
                                );
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
