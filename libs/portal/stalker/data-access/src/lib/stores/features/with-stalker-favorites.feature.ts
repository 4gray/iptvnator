import { inject } from '@angular/core';
import { NotificationService } from '@iptvnator/services/notifications';
import { FavoriteChannelMembershipEvents } from '@iptvnator/services/favorites-events';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { stalkerFavoriteReference } from '@iptvnator/shared/interfaces/favorites-sync';
import { firstNonBlankStalkerId } from '../../stalker-vod.utils';
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
                notifications = inject(NotificationService),
                translate = inject(TranslateService),
                ngrxStore = inject(Store),
                favoriteMembership = inject(FavoriteChannelMembershipEvents)
            ) => {
                const storeContext = store as typeof store &
                    FavoritesStoreContext;
                const notifyChannelChange = (
                    playlistId: string,
                    item: StalkerPortalItem
                ) => {
                    const reference = stalkerFavoriteReference(item);
                    if (
                        reference?.kind === 'live' ||
                        reference?.kind === 'radio'
                    ) {
                        favoriteMembership.notify({
                            sourceType: 'stalker',
                            playlistId,
                            stalkerId: reference.id,
                            radio:
                                reference.kind === 'radio' ? 'true' : undefined,
                        });
                    }
                };
                return {
                    addToFavorites(item: FavoritePayload, onDone?: () => void) {
                        const portalId = storeContext.currentPlaylist()?._id;
                        if (!portalId) {
                            return;
                        }

                        const favorite = {
                            ...item,
                            favoriteContentType:
                                storeContext.selectedContentType() as StalkerPortalItem['favoriteContentType'],
                            category_id: resolveStalkerCategoryId(
                                item.category_id,
                                storeContext.selectedContentType()
                            ),
                            added_at: Date.now(),
                            // First NON-BLANK: `??` keeps a blank
                            // `stream_id`, which would overwrite a valid
                            // `id` and leave the stored row with no
                            // provider identity at all — unremovable by
                            // id, and invisible to anything that looks
                            // the channel up again.
                            id: firstNonBlankStalkerId(item.stream_id, item.id),
                        };
                        playlistService
                            .addPortalFavorite(portalId, favorite)
                            .subscribe((updatedPlaylist) => {
                                notifyChannelChange(portalId, favorite);
                                dispatchStalkerPlaylistMetaUpdate(
                                    ngrxStore,
                                    portalId,
                                    {
                                        favorites: updatedPlaylist?.favorites,
                                    },
                                    false
                                );
                                notifications.success(
                                    'PORTALS.ADDED_TO_FAVORITES'
                                );
                                onDone?.();
                            });
                    },
                    removeFromFavorites(
                        favoriteId: string,
                        onDone?: () => void,
                        context?: StalkerPortalItem
                    ) {
                        const portalId = storeContext.currentPlaylist()?._id;
                        if (!portalId) {
                            return;
                        }

                        const typedContext = {
                            ...context,
                            favoriteContentType:
                                context?.favoriteContentType ??
                                (storeContext.selectedContentType() as StalkerPortalItem['favoriteContentType']),
                        };
                        playlistService
                            .removeFromPortalFavorites(
                                portalId,
                                favoriteId,
                                context ? typedContext : undefined
                            )
                            .subscribe((updatedPlaylist) => {
                                notifyChannelChange(portalId, {
                                    ...typedContext,
                                    id: favoriteId,
                                });
                                dispatchStalkerPlaylistMetaUpdate(
                                    ngrxStore,
                                    portalId,
                                    {
                                        favorites: updatedPlaylist?.favorites,
                                    },
                                    false
                                );
                                notifications.success(
                                    'PORTALS.REMOVED_FROM_FAVORITES'
                                );
                                onDone?.();
                            });
                    },
                };
            }
        )
    );
}
