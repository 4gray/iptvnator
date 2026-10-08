import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { DataService } from '@iptvnator/services';
import {
    ExternalPlayerSession,
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import type { ExternalPlayerName } from '@iptvnator/shared/interfaces';
import { SettingsStore } from './settings-store.service';

@Injectable({
    providedIn: 'root',
})
export class PlayerService {
    private dialog = inject(MatDialog);
    private dataService = inject(DataService);
    private settingsStore = inject(SettingsStore);

    isEmbeddedPlayer(
        player = this.settingsStore.player() ?? VideoPlayer.VideoJs
    ): boolean {
        return (
            player === VideoPlayer.VideoJs ||
            player === VideoPlayer.Html5Player ||
            player === VideoPlayer.ArtPlayer ||
            player === VideoPlayer.EmbeddedMpv
        );
    }

    openPlayer(
        streamUrl: string,
        title: string,
        thumbnail?: string,
        hideExternalInfoDialog = true,
        isLiveContent = false,
        userAgent?: string,
        referer?: string,
        origin?: string,
        contentInfo?: PlayerContentInfo,
        startTime?: number,
        headers?: Record<string, string>
    ): Promise<ExternalPlayerSession | void> {
        return this.openResolvedPlayback(
            {
                streamUrl,
                title,
                thumbnail,
                isLive: isLiveContent,
                startTime,
                contentInfo,
                headers,
                userAgent,
                referer,
                origin,
            },
            hideExternalInfoDialog
        );
    }

    async openResolvedPlayback(
        playback: ResolvedPortalPlayback,
        hideExternalInfoDialog = true
    ): Promise<ExternalPlayerSession | void> {
        const player = this.settingsStore.player() ?? VideoPlayer.VideoJs;

        if (player === VideoPlayer.MPV) {
            if (!hideExternalInfoDialog) {
                this.showExternalPlayerInfoDialog();
            }
            return await this.openExternalPlayback(playback, 'mpv');
        } else if (player === VideoPlayer.VLC) {
            if (!hideExternalInfoDialog) {
                this.showExternalPlayerInfoDialog();
            }
            return await this.openExternalPlayback(playback, 'vlc');
        }

        return;
    }

    /**
     * Loaded on demand: the dialog's Material checkbox brings @angular/forms,
     * and this service is created with the app, so a static import would put
     * both on the initial path. Playback does not wait for the dialog.
     */
    private showExternalPlayerInfoDialog(): void {
        this.loadExternalPlayerInfoDialog()
            .then(({ ExternalPlayerInfoDialogComponent }) =>
                this.dialog.open(ExternalPlayerInfoDialogComponent)
            )
            .catch((error: unknown) => {
                // Informational only: playback is already starting.
                console.error(
                    'Could not load the external player info dialog:',
                    error
                );
            });
    }

    /** The dynamic import; a field so specs can substitute it. */
    loadExternalPlayerInfoDialog = () =>
        import('./external-player-info-dialog.lazy');

    async openExternalPlayback(
        playback: ResolvedPortalPlayback,
        player: ExternalPlayerName
    ): Promise<ExternalPlayerSession | void> {
        const ipcEvent = player === 'mpv' ? OPEN_MPV_PLAYER : OPEN_VLC_PLAYER;

        return await this.dataService.sendIpcEvent<ExternalPlayerSession>(
            ipcEvent,
            {
                url: playback.streamUrl,
                title: playback.title,
                thumbnail: playback.thumbnail,
                'user-agent': playback.userAgent,
                referer: playback.referer,
                origin: playback.origin,
                headers: playback.headers,
                contentInfo: playback.contentInfo,
                startTime: playback.startTime,
            }
        );
    }
}
