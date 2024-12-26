import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamVodDetails } from '../../../../shared/xtream-vod-details.interface';
import { PlayerService } from '../../services/player.service';
import { SettingsStore } from '../../services/settings-store.service';
import { selectActivePlaylist } from '../../state/selectors';
import { XtreamStore } from '../xtream.store';
import { SafePipe } from './safe.pipe';

@Component({
    templateUrl: './vod-details.component.html',
    styleUrls: ['../detail-view.scss'],
    standalone: true,
    imports: [
        MatButton,
        MatIcon,
        SafePipe,
        TranslateModule,
        MatProgressSpinnerModule,
    ],
})
export class VodDetailsComponent implements OnInit, OnDestroy {
    private settingsStore = inject(SettingsStore);
    private route = inject(ActivatedRoute);
    private store = inject(Store);
    private readonly xtreamStore = inject(XtreamStore);
    private playerService = inject(PlayerService);

    readonly theme = this.settingsStore.theme;
    private readonly selectedContentType = this.xtreamStore.selectedContentType;
    private readonly hideExternalInfoDialog =
        this.xtreamStore.hideExternalInfoDialog;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly selectedItem = this.xtreamStore.selectedItem;

    ngOnInit(): void {
        const { categoryId, vodId } = this.route.snapshot.params;
        this.xtreamStore.fetchVodDetailsWithMetadata({ vodId, categoryId });
        this.xtreamStore.checkFavoriteStatus(
            vodId,
            this.xtreamStore.currentPlaylist().id
        );
    }

    ngOnDestroy() {
        this.xtreamStore.setSelectedItem(null);
    }

    playVod(vodItem: XtreamVodDetails) {
        this.addToRecentlyViewed();
        const currentPlaylist = this.store.selectSignal(selectActivePlaylist);
        const { serverUrl, username, password } = currentPlaylist();
        const streamUrl = `${serverUrl}/movie/${username}/${password}/${vodItem.movie_data.stream_id}.${vodItem.movie_data.container_extension}`;

        this.openPlayer(
            streamUrl,
            vodItem.info.name ?? vodItem?.movie_data?.name,
            vodItem.info.movie_image
        );
    }

    openPlayer(streamUrl: string, title: string, thumbnail: string) {
        this.playerService.openPlayer(
            streamUrl,
            title,
            thumbnail,
            this.hideExternalInfoDialog(),
            this.selectedContentType() === 'live'
        );
    }

    toggleFavorite() {
        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.vodId,
            this.xtreamStore.currentPlaylist().id
        );
    }

    private addToRecentlyViewed() {
        this.xtreamStore.addRecentItem({
            contentId: this.route.snapshot.params.vodId,
            playlist: this.xtreamStore.currentPlaylist,
        });
    }
}
