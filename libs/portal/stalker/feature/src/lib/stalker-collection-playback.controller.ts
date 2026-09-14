import { computed, signal } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import type {
    Logger,
    PortalPlaybackPositions,
    PortalPlayer,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    normalizeStalkerEntityId,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import {
    PlaybackPositionData,
    ResolvedPortalPlayback,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import { StalkerVodPlaybackController } from './stalker-vod-playback-controller';
import { createStalkerVodWatchedToggle } from './stalker-vod-watched-toggle';

interface StalkerCollectionPlaybackOwner {
    readonly sourceId: string;
    readonly contentId: string;
    readonly sessionKey: string;
}

interface StalkerCollectionPlaybackControllerConfig {
    item: () => UnifiedCollectionItem | null;
    stalkerStore: InstanceType<typeof StalkerStore>;
    playbackPositions: PortalPlaybackPositions;
    portalPlayer: PortalPlayer;
    snackBar: MatSnackBar;
    translateService: TranslateService;
    logger: Logger;
}

/**
 * Owns inline playback for a collection detail: which item the current player
 * session belongs to, the resume position shown next to the play action, and
 * the handoff to an external player.
 */
export class StalkerCollectionPlaybackController {
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);

    private readonly selectedVodPosition = signal<PlaybackPositionData | null>(
        null
    );
    readonly selectedVodPlaybackPosition = computed<number | null>(
        () => this.selectedVodPosition()?.positionSeconds ?? null
    );

    private readonly playbackOwner = computed(() =>
        captureStalkerCollectionPlaybackOwner(this.config.item())
    );
    readonly playbackSessionKey = computed(
        () => this.playbackOwner()?.sessionKey ?? ''
    );

    private readonly vodPlayback: StalkerVodPlaybackController;

    readonly playbackStartPending = computed(() =>
        this.vodPlayback.playbackStartPending()
    );
    readonly positionLoaded = computed(() => this.vodPlayback.positionLoaded());

    /** Manual watched toggle; the child gates it on live playback itself. */
    readonly watchedToggle = createStalkerVodWatchedToggle({
        owner: () => {
            const owner = this.playbackOwner();
            return owner
                ? { playlistId: owner.sourceId, vodId: Number(owner.contentId) }
                : null;
        },
        playbackPositions: this.config.playbackPositions,
        position: this.selectedVodPosition,
        playingNow: computed(
            () => this.inlinePlayback() !== null || this.playbackStartPending()
        ),
        positionReady: this.positionLoaded,
        applyPosition: (position) => {
            // A read still in flight started from the pre-write row; letting
            // it land would revert the toggle it never saw.
            this.vodPlayback.discardPendingPositionLoad();
            this.selectedVodPosition.set(position);
        },
        snackBar: this.config.snackBar,
        translateService: this.config.translateService,
        logger: this.config.logger,
    });

    constructor(
        private readonly config: StalkerCollectionPlaybackControllerConfig
    ) {
        this.vodPlayback = new StalkerVodPlaybackController({
            inlinePlayback: this.inlinePlayback,
            selectedVodPosition: this.selectedVodPosition,
            playbackPositions: config.playbackPositions,
            portalPlayer: config.portalPlayer,
            snackBar: config.snackBar,
            translateService: config.translateService,
            logger: config.logger,
            playbackErrorLogMessage: 'Failed to start collection VOD playback',
            playbackOwnerKey: () => this.playbackSessionKey(),
        });
    }

    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            void this.startVodPlayback(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image
            );
        }
    }

    onVodResume(event: {
        item: VodDetailsItem;
        positionSeconds: number;
    }): void {
        if (event.item.type === 'stalker') {
            void this.startVodPlayback(
                event.item.cmd,
                event.item.data.info?.name,
                event.item.data.info?.movie_image,
                event.positionSeconds
            );
        }
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.vodPlayback.handleInlineTimeUpdate(event);
    }

    closeInlinePlayer(): void {
        this.vodPlayback.closeInlinePlayer();
    }

    showCopyNotification(): void {
        this.vodPlayback.showCopyNotification();
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        this.vodPlayback.handleExternalFallbackRequest(request);
    }

    async loadSelectedVodPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        await this.vodPlayback.loadSelectedVodPosition(playlistId, vodId);
    }

    /**
     * Mirrors an external player's position into the row while it owns
     * this item. Persistence already has it; without this the row shown
     * here (and the watched toggle's direction) would stay at what the
     * one-time read returned before MPV/VLC played.
     */
    applyRuntimePosition(data: PlaybackPositionData): void {
        const owner = this.playbackOwner();
        if (
            !owner ||
            data.contentType !== 'vod' ||
            data.playlistId !== owner.sourceId ||
            String(data.contentXtreamId) !== owner.contentId
        ) {
            return;
        }
        // A live tick is newer than any stored read still in flight.
        this.vodPlayback.discardPendingPositionLoad();
        this.selectedVodPosition.set(data);
        this.vodPlayback.positionLoaded.set(true);
    }

    clearSelectedVodPosition(): void {
        this.vodPlayback.discardPendingPositionLoad();
        this.vodPlayback.positionLoaded.set(false);
        this.selectedVodPosition.set(null);
    }

    toggleSelectedVodWatched(event: { item: VodDetailsItem }): void {
        void this.watchedToggle.toggleItem(event.item);
    }

    private async startVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ): Promise<void> {
        await this.vodPlayback.startVodPlayback(() =>
            startTime === undefined
                ? this.config.stalkerStore.resolveVodPlayback(
                      cmd,
                      title,
                      thumbnail
                  )
                : this.config.stalkerStore.resolveVodPlayback(
                      cmd,
                      title,
                      thumbnail,
                      undefined,
                      undefined,
                      startTime
                  )
        );
    }
}

function captureStalkerCollectionPlaybackOwner(
    item: UnifiedCollectionItem | null
): StalkerCollectionPlaybackOwner | null {
    if (!item) return null;

    const sourceId = item.playlistId.trim();
    const providerItem = item.stalkerItem as
        { id?: unknown; stream_id?: unknown } | undefined;
    const uidParts = item.uid.split('::');
    const contentId = normalizeStalkerEntityId(
        providerItem?.id ??
            providerItem?.stream_id ??
            item.stalkerId ??
            uidParts[uidParts.length - 1]
    );
    if (!sourceId || !contentId) return null;

    return Object.freeze({
        sourceId,
        contentId,
        sessionKey: createPlaybackSessionKey({
            kind: 'vod',
            sourceId,
            contentId,
        }),
    });
}
