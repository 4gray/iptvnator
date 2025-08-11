import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamVodDetails } from '../../../../shared/xtream-vod-details.interface';
import { SettingsStore } from '../../services/settings-store.service';
import { VideoPreBufferService } from '../../services/video-prebuffer.service';
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
    private readonly preBufferService = inject(VideoPreBufferService);

    readonly theme = this.settingsStore.theme;
    private readonly selectedContentType = this.xtreamStore.selectedContentType;

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
        // Clean up any pre-buffered videos for this component
        this.preBufferService.cleanupAll();
    }

    playVod(vodItem: XtreamVodDetails) {
        this.addToRecentlyViewed();
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);

        // Start pre-buffering the video immediately when play button is clicked
        this.preBufferService.startPreBuffering(streamUrl).subscribe({
            next: (preBufferedVideo) => {
                if (preBufferedVideo?.isReady) {
                    console.log('Video pre-buffered successfully, opening player');
                }
            },
            error: (error) => {
                console.warn('Video pre-buffering failed:', error);
            }
        });

        // Open the player dialog (this will now use pre-buffered data if available)
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
