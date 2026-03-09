import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, map, switchMap } from 'rxjs';
import { PlaylistsService } from 'services';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    matchesFavoriteById,
    StalkerSelectedVodItem,
} from '@iptvnator/portal/stalker/data-access';

type FavoriteButtonItem = StalkerSelectedVodItem & {
    name?: string;
    o_name?: string;
    cover?: string;
};

@Component({
    selector: 'app-favorites-button',
    templateUrl: './stalker-favorites-button.component.html',
    styleUrls: ['./stalker-favorites-button.component.scss'],
    imports: [AsyncPipe, MatIconModule, TranslateModule],
})
export class FavoritesButtonComponent {
    private playlistService = inject(PlaylistsService);
    private stalkerStore = inject(StalkerStore);

    readonly itemId = input.required<string>();
    readonly item = input.required<FavoriteButtonItem>();

    private readonly favoritesChanged$ = new BehaviorSubject<void>(undefined);

    readonly isFavorite$ = this.favoritesChanged$.pipe(
        switchMap(() =>
            this.playlistService.getPortalFavorites(
                this.stalkerStore.currentPlaylist()?._id
            )
        ),
        map((favorites) =>
            favorites.some((favorite) =>
                matchesFavoriteById(favorite, this.itemId())
            )
        )
    );

    removeFromFavorites() {
        this.stalkerStore.removeFromFavorites(this.itemId(), () => {
            this.favoritesChanged$.next();
        });
    }

    addToFavorites() {
        const item = this.item();
        this.stalkerStore.addToFavorites(
            {
                ...item,
                title: item.info?.name ?? item.name ?? item.o_name,
                cover: item.info?.movie_image ?? item.cover,
                series_id: item.id,
                added_at: new Date().toISOString(),
                category_id: 'series',
            },
            () => {
                this.favoritesChanged$.next();
            }
        );
    }

    forceRefresh() {
        // Exposed for callers that need manual refresh after external updates.
        if (this.stalkerStore.currentPlaylist()?._id) {
            this.favoritesChanged$.next();
        }
    }
}
