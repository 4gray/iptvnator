import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamVodDetails } from '../../../../shared/xtream-vod-details.interface';
import { SettingsStore } from '../../services/settings-store.service';
import { XtreamStore } from '../xtream.store';
import { SafePipe } from './safe.pipe';

@Component({
    templateUrl: './vod-details.component.html',
    styleUrls: ['../detail-view.scss'],
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
    private readonly xtreamStore = inject(XtreamStore);

    readonly theme = this.settingsStore.theme;

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
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);

        this.xtreamStore.openPlayer(
            streamUrl,
            vodItem.info.name ?? vodItem?.movie_data?.name,
            vodItem.info.movie_image
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
