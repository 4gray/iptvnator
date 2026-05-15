import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { StalkerSelectionStoreContract } from '../stalker-store.contracts';
import {
    dispatchStalkerPlaylistMetaUpdate,
    resolveStalkerCategoryId,
} from '../utils';

interface FavoritesStoreContext {
    currentPlaylist(): PlaylistMeta | undefined;
    selectedContentType(): StalkerSelectionStoreContract['selectedContentType'] extends () => infer T
        ? T
        : string;
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
                const storeContext = store as typeof store &
                    FavoritesStoreContext;
                return {
                    addToFavorites(item: FavoritePayload, onDone?: () => void) {
                        const portalId = storeContext.currentPlaylist()?._id;
                        if (!portalId) {
                            return;
                        }

                        playlistService
                            .addPortalFavorite(portalId, {
                                ...item,
                                category_id: resolveStalkerCategoryId(
                                    item.category_id,
                                    storeContext.selectedContentType()
                                ),
                                added_at: Date.now(),
                                id: item.stream_id ?? item.id,
                            })
                            .subscribe((updatedPlaylist) => {
                                dispatchStalkerPlaylistMetaUpdate(
                                    ngrxStore,
                                    portalId,
                                    {
                                        favorites: updatedPlaylist?.favorites,
                                    }
                                );
                                snackBar.open(
                                    translate.instant(
                                        'PORTALS.ADDED_TO_FAVORITES'
                                    ),
                                    undefined,
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
                        if (!portalId) {
                            return;
                        }

                        playlistService
                            .removeFromPortalFavorites(portalId, favoriteId)
                            .subscribe((updatedPlaylist) => {
                                dispatchStalkerPlaylistMetaUpdate(
                                    ngrxStore,
                                    portalId,
                                    {
                                        favorites: updatedPlaylist?.favorites,
                                    }
                                );
                                snackBar.open(
                                    translate.instant(
                                        'PORTALS.REMOVED_FROM_FAVORITES'
                                    ),
                                    undefined,
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
