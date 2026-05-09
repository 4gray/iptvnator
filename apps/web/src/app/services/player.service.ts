import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ExternalPlayerInfoDialogComponent } from '@iptvnator/ui/playback/external-player-info-dialog';
import { DataService } from 'services';
import {
    ExternalPlayerSession,
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    VideoPlayer,
} from 'shared-interfaces';
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
        const {
            streamUrl,
            title,
            thumbnail,
            userAgent,
            referer,
            origin,
            headers,
            contentInfo,
            startTime,
        } = playback;

        if (player === VideoPlayer.MPV) {
            if (!hideExternalInfoDialog) {
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            }
            return await this.dataService.sendIpcEvent<ExternalPlayerSession>(
                OPEN_MPV_PLAYER,
                {
                    url: streamUrl,
                    title,
                    thumbnail,
                    'user-agent': userAgent,
                    referer: referer,
                    origin: origin,
                    headers,
                    contentInfo,
                    startTime,
                }
            );
        } else if (player === VideoPlayer.VLC) {
            if (!hideExternalInfoDialog) {
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            }
            return await this.dataService.sendIpcEvent<ExternalPlayerSession>(
                OPEN_VLC_PLAYER,
                {
                    url: streamUrl,
                    title,
                    thumbnail,
                    'user-agent': userAgent,
                    referer: referer,
                    origin: origin,
                    headers,
                    contentInfo,
                    startTime,
                }
            );
        }

        return import('@iptvnator/portal/xtream/feature').then(
            ({ PlayerDialogComponent }) => {
                this.dialog.open(PlayerDialogComponent, {
                    data: {
                        streamUrl,
                        title,
                        contentInfo,
                        startTime,
                        playback,
                    },
                    width: '80%',
                    maxWidth: '1200px',
                    maxHeight: '90vh',
                });
            }
        );
    }
}
