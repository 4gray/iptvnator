import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { XtreamSerieEpisode } from 'shared-interfaces';
import { SeasonContainerComponent } from '../season-container/season-container.component';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: ['../detail-view.scss'],
    imports: [MatButton, MatIcon, SeasonContainerComponent, TranslatePipe],
})
export class SerialDetailsComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);

    readonly selectedItem = this.xtreamStore.selectedItem;
    readonly selectedContentType = this.xtreamStore.selectedContentType;
    readonly isFavorite = this.xtreamStore.isFavorite;

    ngOnInit(): void {
        const { categoryId, serialId } = this.route.snapshot.params;
        this.xtreamStore.fetchSerialDetailsWithMetadata({
            serialId,
            categoryId,
        });
        this.xtreamStore.checkFavoriteStatus(
            serialId,
            this.xtreamStore.currentPlaylist().id
        );
    }

    playEpisode(episode: XtreamSerieEpisode) {
        this.addToRecentlyViewed(this.route.snapshot.params.serialId);

        const streamUrl = this.xtreamStore.constructEpisodeStreamUrl(episode);
        this.xtreamStore.openPlayer(
            streamUrl,
            episode.title,
            this.selectedItem().info.cover
        );
    }

    private addToRecentlyViewed(xtreamId: number) {
        this.xtreamStore.addRecentItem({
            contentId: xtreamId,
            playlist: this.xtreamStore.currentPlaylist,
        });
    }

    toggleFavorite() {
        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.serialId,
            this.xtreamStore.currentPlaylist().id
        );
    }
}
