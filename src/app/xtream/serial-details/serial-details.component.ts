import { JsonPipe, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import {
    XtreamSerieDetails,
    XtreamSerieEpisode,
} from '../../../../shared/xtream-serie-details.interface';
import { PlaylistsService } from '../../services/playlists.service';
import { selectCurrentPlaylist } from '../../state/selectors';
import { PlayerDialogComponent } from '../player-dialog/player-dialog.component';
import { SeasonContainerComponent } from '../season-container/season-container.component';

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: ['../detail-view.scss'],
    standalone: true,
    imports: [
        JsonPipe,
        MatButtonModule,
        MatIconModule,
        NgIf,
        SeasonContainerComponent,
        PlayerDialogComponent,
    ],
})
export class SerialDetailsComponent {
    @Input({ required: true }) item: XtreamSerieDetails;
    @Input() seriesId: number;

    @Output() addToFavoritesClicked = new EventEmitter<any>();
    @Output() playClicked = new EventEmitter<XtreamSerieEpisode>();
    @Output() removeFromFavoritesClicked = new EventEmitter<number>();

    store = inject(Store);
    currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);
    private playlistService = inject(PlaylistsService);
    private route = inject(ActivatedRoute);
    private portalId = this.route.snapshot.paramMap.get('id');

    isFavorite = false;

    ngOnInit(): void {
        this.checkFavoriteStatus();
    }

    checkFavoriteStatus() {
        this.playlistService
            .getPortalFavorites(this.portalId)
            .subscribe((favorites) => {
                this.isFavorite = favorites.some(
                    (i) => (i as any).series_id === this.seriesId
                );
            });
    }

    toggleFavorite() {
        if (this.isFavorite) {
            this.removeFromFavoritesClicked.emit(this.seriesId);
        } else {
            this.addToFavoritesClicked.emit({
                name: this.item.info.name,
                series_id: this.seriesId,
                cover: this.item.info.cover,
            });
        }
        this.isFavorite = !this.isFavorite;
    }
}
