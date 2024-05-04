import { NgIf } from '@angular/common';
import { Component, OnInit, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistsService } from '../../services/playlists.service';

@Component({
    standalone: true,
    selector: 'app-favorites-button',
    templateUrl: './favorites-button.component.html',
    imports: [MatButtonModule, MatIconModule, NgIf, TranslateModule],
})
export class FavoritesButtonComponent implements OnInit {
    private playlistService = inject(PlaylistsService);
    private route = inject(ActivatedRoute);
    private snackBar = inject(MatSnackBar);
    private translateService = inject(TranslateService);

    portalId = this.route.snapshot.paramMap.get('id');
    serialMeta = input.required<{
        movie_id: string;
        name: string;
        cover: string;
    }>();

    isFavorite = false;

    ngOnInit() {
        this.checkFavoriteStatus();
    }

    checkFavoriteStatus() {
        this.playlistService
            .getPortalFavorites(this.portalId)
            .subscribe((favorites) => {
                this.isFavorite = favorites.some(
                    (i) => (i as any).movie_id === this.serialMeta().movie_id
                );
            });
    }

    toggleFavorites(isFav: boolean) {
        if (isFav) this.removeFromFavorites();
        else this.addToFavorites();
    }

    removeFromFavorites() {
        this.playlistService
            .removeFromPortalFavorites(
                this.portalId,
                this.serialMeta().movie_id
            )
            .subscribe(() => {
                this.snackBar.open(
                    this.translateService.instant(
                        'PORTALS.REMOVED_FROM_FAVORITES'
                    ),
                    null,
                    {
                        duration: 1000,
                    }
                );
                this.checkFavoriteStatus();
            });
    }

    addToFavorites() {
        this.playlistService
            .addPortalFavorite(this.portalId, this.serialMeta())
            .subscribe(() => {
                this.snackBar.open(
                    this.translateService.instant('PORTALS.ADDED_TO_FAVORITES'),
                    null,
                    {
                        duration: 1000,
                    }
                );
                this.checkFavoriteStatus();
            });
    }
}
