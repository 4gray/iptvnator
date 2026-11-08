import { PLAYBACK_ACTIVITY_EVENTS } from '@iptvnator/services/activity-events';
import { Injectable, Injector, inject, signal } from '@angular/core';
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
import { LazyMatDialog } from '@iptvnator/ui/components/lazy-dialog';
import { dialogSize } from '@iptvnator/ui/components/dialog-size';
import { SettingsStore } from './settings-store.service';

@Injectable({
    providedIn: 'root',
})
export class PlayerService {
    private readonly activity = inject(PLAYBACK_ACTIVITY_EVENTS, {
        optional: true,
    });
    private lazyDialog = inject(LazyMatDialog);
    private dataService = inject(DataService);
    private settingsStore = inject(SettingsStore);
    private readonly injector = inject(Injector);
    /**
     * The playback the most recent external launch sent, recorded before the
     * IPC call so a session update that arrives during it can still be
     * matched. Live failover replays it after the player reports the stream
     * unusable, so headers and credentials travel with the retry instead of
     * being rebuilt from the session snapshot (which has neither).
     */
    readonly lastExternalPlayback = signal<ResolvedPortalPlayback | null>(null);

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
            return await this.openExternalPlayback(
                playback,
                'mpv',
                !hideExternalInfoDialog
            );
        } else if (player === VideoPlayer.VLC) {
            return await this.openExternalPlayback(
                playback,
                'vlc',
                !hideExternalInfoDialog
            );
        }

        return;
    }

    /**
     * Loaded on demand: the dialog's Material checkbox brings @angular/forms,
     * and this service is created with the app, so a static import would put
     * both, and Material's dialog, on the initial path. Playback does not
     * wait for the dialog.
     */
    private showExternalPlayerInfoDialog(): void {
        Promise.all([
            this.lazyDialog.resolve(),
            this.loadExternalPlayerInfoDialog(),
        ])
            .then(([dialog, { ExternalPlayerInfoDialogComponent }]) =>
                dialog.open(ExternalPlayerInfoDialogComponent, dialogSize('sm'))
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
        player: ExternalPlayerName,
        showInfoDialog = false
    ): Promise<ExternalPlayerSession | void> {
        if (playback.contentInfo)
            void this.activity
                ?.begin(
                    playback.contentInfo,
                    playback.startTime,
                    playback.title
                )
                .catch(() => undefined);
        const ipcEvent = player === 'mpv' ? OPEN_MPV_PLAYER : OPEN_VLC_PLAYER;

        await this.ensureLiveFailoverListener();
        if (showInfoDialog) {
            this.showExternalPlayerInfoDialog();
        }
        this.lastExternalPlayback.set(playback);
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

    /** The dynamic import; a field so specs can substitute it. */
    loadLiveFailoverListener = () => import('./external-live-failover.service');

    /**
     * Live failover has to be listening before the first session update, so
     * the launch waits for it. It is imported on the first external launch:
     * this service is created with the app, so a static import would put the
     * listener on the initial path. Its cross-source search graph loads later
     * still, on the first live failure. A failed chunk load costs only the
     * failover, never the launch.
     */
    private ensureLiveFailoverListener(): Promise<void> {
        return this.loadLiveFailoverListener().then(
            ({ ExternalLiveFailoverService }) => {
                this.injector.get(ExternalLiveFailoverService);
            },
            (error: unknown) => {
                console.error('Could not load live channel failover:', error);
            }
        );
    }
}
