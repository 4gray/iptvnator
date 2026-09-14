import { type WritableSignal, computed } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import {
    type Logger,
    type PortalPlaybackPositions,
    type PortalPlayer,
    createPendingPlaybackStart,
} from '@iptvnator/portal/shared/util';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import {
    PlaybackPositionData,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';

interface StalkerVodPlaybackControllerConfig {
    inlinePlayback: WritableSignal<ResolvedPortalPlayback | null>;
    selectedVodPosition: WritableSignal<PlaybackPositionData | null>;
    playbackPositions: PortalPlaybackPositions;
    portalPlayer: PortalPlayer;
    snackBar: MatSnackBar;
    translateService: TranslateService;
    logger: Logger;
    playbackErrorLogMessage: string;
    playbackOwnerKey?: () => string;
}

export class StalkerVodPlaybackController {
    /**
     * The start still waiting on the portal between the click and playback,
     * keyed by its owner: a stale resolution for the previous item must not
     * hold the next item's watched toggle hostage.
     */
    private readonly pendingStart = createPendingPlaybackStart<
        string | undefined
    >();
    readonly playbackStartPending = computed(() =>
        this.pendingStart.isPendingFor(this.config.playbackOwnerKey?.())
    );
    private lastInlineSaveTime = 0;
    private loadSelectedVodPositionRequestId = 0;
    private playbackRequestId = 0;

    constructor(private readonly config: StalkerVodPlaybackControllerConfig) {}

    async startVodPlayback(
        resolvePlayback: () => Promise<ResolvedPortalPlayback>
    ): Promise<void> {
        const requestId = ++this.playbackRequestId;
        const usesEmbeddedPlayer = this.config.portalPlayer.isEmbeddedPlayer();
        const playbackOwnerKey = this.config.playbackOwnerKey?.();
        const startId = this.pendingStart.begin(playbackOwnerKey);
        try {
            const playback = await resolvePlayback();
            if (!this.isPlaybackRequestCurrent(requestId, playbackOwnerKey)) {
                return;
            }

            this.lastInlineSaveTime = 0;
            if (usesEmbeddedPlayer) {
                this.config.inlinePlayback.set(playback);
                return;
            }

            this.closeInlinePlayer();
            void this.config.portalPlayer.openResolvedPlayback(playback, true);
        } catch (error) {
            if (!this.isPlaybackRequestCurrent(requestId, playbackOwnerKey)) {
                return;
            }
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
            this.config.snackBar.open(errorMessage, undefined, {
                duration: 3000,
            });
        } finally {
            this.pendingStart.settle(startId);
        }
    }

    /** Retires a stored-position read still in flight (a row was written since). */
    discardPendingPositionLoad(): void {
        this.loadSelectedVodPositionRequestId++;
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
        this.playbackRequestId += 1;
        this.config.inlinePlayback.set(null);
        this.lastInlineSaveTime = 0;
    }

    private isPlaybackRequestCurrent(
        requestId: number,
        playbackOwnerKey: string | undefined
    ): boolean {
        return (
            requestId === this.playbackRequestId &&
            (this.config.playbackOwnerKey === undefined ||
                this.config.playbackOwnerKey() === playbackOwnerKey)
        );
    }

    showCopyNotification(): void {
        this.config.snackBar.open(
            this.config.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            undefined,
            {
                duration: 2000,
            }
        );
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        const launch = this.config.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
        request.trackLaunch(launch);
        void launch;
    }
}
