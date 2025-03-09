import { NgIf } from '@angular/common';
import {
    Component,
    EventEmitter,
    Input,
    OnInit,
    Output,
    inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon, MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamVodDetails } from '../../../../shared/xtream-vod-details.interface';
import { PlaylistsService } from '../../services/playlists.service';
import { SafePipe } from './safe.pipe';

@Component({
    selector: 'app-vod-details',
    templateUrl: './vod-details.component.html',
    styleUrls: ['../detail-view.scss'],
    standalone: true,
    imports: [
        MatButtonModule,
        MatIcon,
        NgIf,
        MatIconModule,
        SafePipe,
        TranslateModule,
        MatProgressSpinnerModule,
    ],
})
export class VodDetailsComponent implements OnInit {
    @Input({ required: true }) item: XtreamVodDetails;

    @Output() addToFavoritesClicked = new EventEmitter<any>();
    @Output() playClicked = new EventEmitter<XtreamVodDetails>();
    @Output() removeFromFavoritesClicked = new EventEmitter<number>();

    private playlistService = inject(PlaylistsService);
    private route = inject(ActivatedRoute);
    private portalId = this.route.snapshot.paramMap.get('id');

    isFavorite = false;
    isLoading = false;

    ngOnInit(): void {
        this.checkFavoriteStatus();
    }

    checkFavoriteStatus() {
        this.playlistService
            .getPortalFavorites(this.portalId)
            .subscribe((favorites) => {
                this.isFavorite = favorites.some((i) => {
                    const hasStreamId =
                        i?.stream_id !== undefined &&
                        this.item?.movie_data?.stream_id !== undefined;
                    const hasId =
                        (i as any)?.details?.id !== undefined &&
                        (this.item as any)?.id !== undefined;

                    return (
                        (hasStreamId &&
                            i.stream_id === this.item.movie_data.stream_id) ||
                        (hasId &&
                            (i as any).details.id === (this.item as any).id)
                    );
                });
            });
    }

    toggleFavorite() {
        if (this.isFavorite) {
            this.removeFromFavoritesClicked.emit(
                this.item?.movie_data?.stream_id || (this.item as any)?.id
            );
        } else {
            // stalker mode
            if ((this.item as any).cmd) {
                this.addToFavoritesClicked.emit({
                    name: this.item.info.name,
                    stream_id: (this.item as any).id,
                    cover: this.item.info.movie_image,
                    cmd: (this.item as any).cmd || '',
                    details: this.item,
                });
            } else {
                this.addToFavoritesClicked.emit({
                    name: this.item.movie_data.name,
                    stream_id: this.item.movie_data.stream_id,
                    container_extension:
                        this.item.movie_data.container_extension,
                    cover: this.item.info.movie_image,
                    stream_type: 'movie',
                });
            }
        }
        this.isFavorite = !this.isFavorite;
    }
}
