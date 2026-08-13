import { signal } from '@angular/core';
import {
    createPortalFavoritesResource,
    createRefreshTrigger,
    isSelectedStalkerVodFavorite,
    StalkerStore,
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';
import type { PlaylistsService } from '@iptvnator/services';
import {
    StalkerPortalItem,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';

interface StalkerCollectionFavoritesControllerConfig {
    playlistsService: PlaylistsService;
    stalkerStore: InstanceType<typeof StalkerStore>;
    vodDetailsItem: () => VodDetailsItem | null;
}

/**
 * Favorite state for the movie currently rendered by a collection detail.
 *
 * Must be constructed from an injection context — the underlying favorites
 * resource is an `rxResource`.
 */
export class StalkerCollectionFavoritesController {
    private readonly refreshTrigger = createRefreshTrigger();

    readonly isFavorite = signal(false);
    readonly resource: ReturnType<typeof createPortalFavoritesResource>;

    constructor(
        private readonly config: StalkerCollectionFavoritesControllerConfig
    ) {
        this.resource = createPortalFavoritesResource(
            config.playlistsService,
            () => config.stalkerStore.currentPlaylist()?._id,
            () => this.refreshTrigger.refreshVersion()
        );
    }

    sync(): void {
        this.isFavorite.set(
            isSelectedStalkerVodFavorite(
                this.config.vodDetailsItem(),
                this.resource.value() ?? []
            )
        );
    }

    reset(): void {
        this.isFavorite.set(false);
    }

    toggle(event: { item: VodDetailsItem; isFavorite: boolean }): void {
        toggleStalkerVodFavorite(event, {
            addToFavorites: (item, onDone) =>
                this.config.stalkerStore.addToFavorites(
                    item as StalkerPortalItem,
                    onDone
                ),
            removeFromFavorites: (favoriteId, onDone) =>
                this.config.stalkerStore.removeFromFavorites(
                    favoriteId,
                    onDone
                ),
            onComplete: () => {
                this.refreshTrigger.refresh();
                this.sync();
            },
        });
    }
}
