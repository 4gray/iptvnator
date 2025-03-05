import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamSerieEpisode } from '../../../../shared/xtream-serie-details.interface';
import { PlayerService } from '../../services/player.service';
import { SettingsStore } from '../../services/settings-store.service';
import { selectActivePlaylist } from '../../state/selectors';
import { SeasonContainerComponent } from '../season-container/season-container.component';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: ['../detail-view.scss'],
    standalone: true,
    imports: [MatButton, MatIcon, SeasonContainerComponent, TranslateModule],
})
export class SerialDetailsComponent {
    private readonly store = inject(Store);
    private readonly route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly settingsStore = inject(SettingsStore);
    private readonly playerService = inject(PlayerService);

    readonly selectedItem = this.xtreamStore.selectedItem;
    readonly settings = this.settingsStore.getSettings();
    readonly selectedContentType = this.xtreamStore.selectedContentType;
    readonly isFavorite = this.xtreamStore.isFavorite;

    private readonly hideExternalInfoDialog =
        this.xtreamStore.hideExternalInfoDialog;

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
        const currentPlaylist = this.store.selectSignal(selectActivePlaylist);
        const { serverUrl, username, password } = currentPlaylist();
        const streamUrl = `${serverUrl}/series/${username}/${password}/${episode.id}.${episode.container_extension}`;

        this.openPlayer(streamUrl, episode.title);
    }

    openPlayer(streamUrl: string, title: string) {
        this.playerService.openPlayer(
            streamUrl,
            title,
            this.xtreamStore.selectedItem().info.cover,
            this.hideExternalInfoDialog(),
            this.selectedContentType() === 'live'
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
