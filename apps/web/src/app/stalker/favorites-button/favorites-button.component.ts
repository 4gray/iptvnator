import { AsyncPipe } from '@angular/common';
import { Component, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, map, switchMap } from 'rxjs';
import { PlaylistsService } from '../../services/playlists.service';

@Component({
    selector: 'app-favorites-button',
    templateUrl: './favorites-button.component.html',
    imports: [AsyncPipe, MatButtonModule, MatIconModule, TranslateModule],
})
export class FavoritesButtonComponent {
    private playlistService = inject(PlaylistsService);

    readonly itemId = input.required<string>();

    readonly addToFavoritesClicked = output<void>();
    readonly removeFromFavoritesClicked = output<void>();

    private readonly favoritesChanged$ = new BehaviorSubject<void>(undefined);

    readonly isFavorite$ = this.favoritesChanged$.pipe(
        switchMap(() => this.playlistService.getPortalFavorites()),
        map((favorites) =>
            favorites.some(
                (i) =>
                    (i as any).movie_id === this.itemId() ||
                    (i as any).id === this.itemId()
            )
        )
    );

    removeFromFavorites() {
        this.removeFromFavoritesClicked.emit();
        setTimeout(() => {
            this.favoritesChanged$.next();
        }, 100);
    }

    addToFavorites() {
        this.addToFavoritesClicked.emit();
        setTimeout(() => {
            this.favoritesChanged$.next();
        }, 100);
    }
}
