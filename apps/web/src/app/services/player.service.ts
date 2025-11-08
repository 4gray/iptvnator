import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { DataService } from 'services';
import {
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    VideoPlayer,
} from 'shared-interfaces';
import { ExternalPlayerInfoDialogComponent } from '../shared/components/external-player-info-dialog/external-player-info-dialog.component';
import {
    PlayerDialogComponent,
    PlayerDialogData,
} from '../xtream-tauri/player-dialog/player-dialog.component';
import { SettingsStore } from './settings-store.service';

@Injectable({
    providedIn: 'root',
})
export class PlayerService {
    private dialog = inject(MatDialog);
    private dataService = inject(DataService);
    private settingsStore = inject(SettingsStore);

    openPlayer(
        streamUrl: string,
        title: string,
        thumbnail?: string,
        hideExternalInfoDialog = true,
        isLiveContent = false,
        userAgent?: string,
        referer?: string,
        origin?: string
    ) {
        const player = this.settingsStore.player() ?? VideoPlayer.VideoJs;

        if (player === VideoPlayer.MPV) {
            if (!hideExternalInfoDialog) {
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            }
            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                url: streamUrl,
                title,
                thumbnail,
                'user-agent': userAgent,
                referer: referer,
                origin: origin,
            });
        } else if (player === VideoPlayer.VLC) {
            if (!hideExternalInfoDialog) {
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            }
            this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                url: streamUrl,
                title,
                thumbnail,
                'user-agent': userAgent,
                referer: referer,
                origin: origin,
            });
        } else if (!isLiveContent) {
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
