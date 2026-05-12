import type { WritableSignal } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import type {
    Logger,
    PortalPlaybackPositions,
    PortalPlayer,
} from '@iptvnator/portal/shared/util';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import {
    PlaybackPositionData,
    ResolvedPortalPlayback,
} from 'shared-interfaces';

interface StalkerVodPlaybackControllerConfig {
    inlinePlayback: WritableSignal<ResolvedPortalPlayback | null>;
    selectedVodPosition: WritableSignal<PlaybackPositionData | null>;
    playbackPositions: PortalPlaybackPositions;
    portalPlayer: PortalPlayer;
    snackBar: MatSnackBar;
    translateService: TranslateService;
    logger: Logger;
    playbackErrorLogMessage: string;
}

export class StalkerVodPlaybackController {
    private lastInlineSaveTime = 0;
    private loadSelectedVodPositionRequestId = 0;

    constructor(private readonly config: StalkerVodPlaybackControllerConfig) {}

    async startVodPlayback(
        resolvePlayback: () => Promise<ResolvedPortalPlayback>
    ): Promise<void> {
        try {
            const playback = await resolvePlayback();

            this.lastInlineSaveTime = 0;
            if (this.config.portalPlayer.isEmbeddedPlayer()) {
                this.config.inlinePlayback.set(playback);
                return;
            }

            this.closeInlinePlayer();
            void this.config.portalPlayer.openResolvedPlayback(playback, true);
        } catch (error) {
            this.config.logger.error(
                this.config.playbackErrorLogMessage,
                error
            );
            const errorMessage =
                error instanceof Error && error.message === 'nothing_to_play'
                    ? this.config.translateService.instant(
                          'PORTALS.CONTENT_NOT_AVAILABLE'
                      )
                    : this.config.translateService.instant(
                          'PORTALS.PLAYBACK_ERROR'
                      );
            this.config.snackBar.open(errorMessage, null, {
                duration: 3000,
            });
        }
    }

    async loadSelectedVodPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        const requestId = ++this.loadSelectedVodPositionRequestId;

        if (!playlistId || !Number.isFinite(vodId)) {
            this.config.selectedVodPosition.set(null);
            return;
        }

        const position =
            await this.config.playbackPositions.getPlaybackPosition(
                playlistId,
                vodId,
                'vod'
            );
        if (requestId !== this.loadSelectedVodPositionRequestId) {
            return;
        }

        this.config.selectedVodPosition.set(position ?? null);
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.config.inlinePlayback();
        if (!playback?.contentInfo) {
            return;
        }

        const now = Date.now();
        if (now - this.lastInlineSaveTime <= 15000) {
            return;
        }

        this.lastInlineSaveTime = now;
        const position: PlaybackPositionData = {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        };

        void this.config.playbackPositions.savePlaybackPosition(
            playback.contentInfo.playlistId,
            position
        );
        this.config.selectedVodPosition.set(position);
    }

    closeInlinePlayer(): void {
        this.config.inlinePlayback.set(null);
        this.lastInlineSaveTime = 0;
    }

    showCopyNotification(): void {
        this.config.snackBar.open(
            this.config.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            null,
            {
                duration: 2000,
            }
        );
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        void this.config.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
    }
}
