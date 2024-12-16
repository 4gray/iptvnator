import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import {
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
} from '../../../../shared/ipc-commands';
import { XtreamVodDetails } from '../../../../shared/xtream-vod-details.interface';
import { DataService } from '../../services/data.service';
import { SettingsStore } from '../../services/settings-store.service';
import { VideoPlayer } from '../../settings/settings.interface';
import { ExternalPlayerInfoDialogComponent } from '../../shared/components/external-player-info-dialog/external-player-info-dialog.component';
import { selectActivePlaylist } from '../../state/selectors';
import {
    PlayerDialogComponent,
    PlayerDialogData,
} from '../player-dialog/player-dialog.component';
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
    private dataService = inject(DataService);
    private dialog = inject(MatDialog);
    private settingsStore = inject(SettingsStore);
    private route = inject(ActivatedRoute);
    private store = inject(Store);
    private readonly xtreamStore = inject(XtreamStore);

    readonly settings = this.settingsStore.getSettings();
    readonly selectedContentType = this.xtreamStore.selectedContentType();
    readonly hideExternalInfoDialog = this.xtreamStore.hideExternalInfoDialog;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly selectedItem = this.xtreamStore.selectedItem;

    ngOnInit(): void {
        const { categoryId, vodId } = this.route.snapshot.params;
        this.xtreamStore.getVodDetails(vodId).then((currentVod) => {
            this.xtreamStore.setSelectedCategory(Number(categoryId));
            this.xtreamStore.setSelectedItem(currentVod);
        });
        this.xtreamStore.checkFavoriteStatus();
    }

    ngOnDestroy() {
        this.xtreamStore.setSelectedItem(null);
    }

    playVod(vodItem: XtreamVodDetails) {
        this.addToRecentlyViewed(vodItem);
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
        const player = this.settings()?.player ?? VideoPlayer.VideoJs;
        if (player === VideoPlayer.MPV) {
            if (!this.hideExternalInfoDialog())
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                url: streamUrl,
                mpvPlayerPath: this.settings()?.mpvPlayerPath,
                title,
                thumbnail,
            });
        } else if (player === VideoPlayer.VLC) {
            if (!this.hideExternalInfoDialog())
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                url: streamUrl,
                vlcPlayerPath: this.settings()?.vlcPlayerPath,
            });
        } else {
            if (this.selectedContentType !== 'live') {
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

    toggleFavorite() {
        this.xtreamStore.toggleFavorite();
    }

    private addToRecentlyViewed(vodItem: any) {
        this.xtreamStore.addRecentItem({
            contentId:
                this.route.snapshot.params
                    .vodId /* vodItem.movie_data.stream_id */,
            playlist: this.xtreamStore.currentPlaylist,
        });
    }
}
