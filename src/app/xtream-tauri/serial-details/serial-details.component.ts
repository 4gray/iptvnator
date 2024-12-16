import { NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import {
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
} from '../../../../shared/ipc-commands';
import { XtreamSerieEpisode } from '../../../../shared/xtream-serie-details.interface';
import { DataService } from '../../services/data.service';
import { SettingsStore } from '../../services/settings-store.service';
import { VideoPlayer } from '../../settings/settings.interface';
import { ExternalPlayerInfoDialogComponent } from '../../shared/components/external-player-info-dialog/external-player-info-dialog.component';
import {
    selectActivePlaylist,
    selectCurrentPlaylist,
} from '../../state/selectors';
import {
    PlayerDialogComponent,
    PlayerDialogData,
} from '../player-dialog/player-dialog.component';
import { SeasonContainerComponent } from '../season-container/season-container.component';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: ['../detail-view.scss'],
    standalone: true,
    imports: [
        MatButton,
        MatIcon,
        NgIf,
        SeasonContainerComponent,
        TranslateModule,
    ],
})
export class SerialDetailsComponent {
    private dataService = inject(DataService);
    private dialog = inject(MatDialog);
    private readonly store = inject(Store);
    readonly currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);
    private readonly route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly settingsStore = inject(SettingsStore);

    readonly selectedItem = this.xtreamStore.selectedItem;
    readonly settings = this.settingsStore.getSettings();
    readonly selectedContentType = this.xtreamStore.selectedContentType;
    readonly isFavorite = this.xtreamStore.isFavorite;

    private readonly hideExternalInfoDialog =
        this.xtreamStore.hideExternalInfoDialog;

    ngOnInit(): void {
        const { categoryId, serialId } = this.route.snapshot.params;
        this.xtreamStore.getSerialDetails(serialId).then((currentSerial) => {
            this.xtreamStore.setSelectedCategory(Number(categoryId));
            this.xtreamStore.setSelectedItem({
                ...currentSerial,
                series_id: serialId,
            });
        });
        this.xtreamStore.checkFavoriteStatus();
    }

    playEpisode(episode: XtreamSerieEpisode) {
        this.addToRecentlyViewed(this.route.snapshot.params.serialId);
        const currentPlaylist = this.store.selectSignal(selectActivePlaylist);
        const { serverUrl, username, password } = currentPlaylist();
        const streamUrl = `${serverUrl}/series/${username}/${password}/${episode.id}.${episode.container_extension}`;

        this.openPlayer(streamUrl, episode.title);
    }

    openPlayer(streamUrl: string, title: string) {
        const player = this.settings()?.player ?? VideoPlayer.VideoJs;
        if (player === VideoPlayer.MPV) {
            if (!this.hideExternalInfoDialog())
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                url: streamUrl,
                mpvPlayerPath: this.settings()?.mpvPlayerPath,
                title: this.xtreamStore.selectedItem().info.name,
                thumbnail: this.xtreamStore.selectedItem().info.cover,
            });
        } else if (player === VideoPlayer.VLC) {
            if (!this.hideExternalInfoDialog())
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                url: streamUrl,
                vlcPlayerPath: this.settings()?.vlcPlayerPath,
            });
        } else {
            if (this.selectedContentType() !== 'live') {
                this.dialog.open<PlayerDialogComponent, PlayerDialogData>(
                    PlayerDialogComponent,
                    {
                        data: { streamUrl, title },
                        width: '80%',
                        maxWidth: '1200px',
                        maxHeight: '90vh',
                    }
                );
            }
        }
    }

    private addToRecentlyViewed(xtreamId: number) {
        this.xtreamStore.addRecentItem({
            contentId: xtreamId,
            playlist: this.xtreamStore.currentPlaylist,
        });
    }

    toggleFavorite() {
        this.xtreamStore.toggleFavorite();
    }
}
