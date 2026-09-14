import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
    PORTAL_PLAYBACK_POSITIONS,
    VOD_WATCHED_FEEDBACK_KEYS,
    createLogger,
    createVodWatchedToggle,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    XtreamVodDetails,
    getXtreamVodInfo,
} from '@iptvnator/shared/interfaces';
import { VodDetailsPlaybackService } from './vod-details-playback.service';

/**
 * Manual watched toggle for the Xtream VOD details route, wrapping the
 * shared helper with this page's row, playback ownership and feedback.
 *
 * The toggle acts on the ROUTE copy's row only: positions are keyed by
 * (playlist, stream), so a pinned alternative in another playlist keeps its
 * own state, exactly as playback would leave it.
 */
@Injectable()
export class VodDetailsWatchedService {
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly playback = inject(VodDetailsPlaybackService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('VodDetailsWatched');

    private readonly toggle = createVodWatchedToggle({
        playbackPositions: this.playbackPositions,
        position: this.playback.routePlaybackPosition,
        applyPosition: (position) => {
            // A read still in flight started from the pre-write row; letting
            // it land would revert the toggle it never saw.
            this.playback.discardPendingPositionLoads();
            this.playback.routePlaybackPosition.set(position);
            this.playback.vodPlaybackPosition.set(position);
        },
        // Inline mounted, or an external session live/launching for this
        // movie: its next position tick would overwrite the written row.
        playingNow: computed(
            () =>
                this.playback.inlinePlayback() !== null ||
                this.playback.matchedExternalPlayback() !== null ||
                this.playback.isExternalLaunchPending() ||
                this.playback.playbackStartPending()
        ),
        positionReady: this.playback.positionLoaded,
        notify: (feedback) =>
            this.snackBar.open(
                this.translate.instant(VOD_WATCHED_FEEDBACK_KEYS[feedback]),
                undefined,
                { duration: 5000 }
            ),
        // Catalog cards read the store's position map, which only the
        // once-per-playlist load and external-player pushes fill. That map is
        // global and latest-load-wins, so a write that lands after the user
        // moved to another playlist must not reload the old one over it.
        onPersisted: (playlistId) =>
            this.xtreamStore.currentPlaylist()?.id === playlistId
                ? this.xtreamStore.loadAllPositions(playlistId)
                : undefined,
        logger: this.logger,
    });

    readonly isWatched = this.toggle.isWatched;
    readonly canToggle = this.toggle.enabled;

    /** The vod id the route currently shows; the host binds it once. */
    private readonly routeVodId = signal<Signal<number> | null>(null);

    bind(routeVodId: Signal<number>): void {
        this.routeVodId.set(routeVodId);
    }

    /** Flips the watched state of the movie the route currently shows. */
    async toggleWatched(vodItem: XtreamVodDetails | null): Promise<boolean> {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        const vodId = this.routeVodId()?.() ?? NaN;
        if (!playlistId || !Number.isFinite(vodId) || vodId <= 0) {
            return false;
        }

        const info = vodItem ? getXtreamVodInfo(vodItem) : null;
        return this.toggle.toggle({
            playlistId,
            contentXtreamId: vodId,
            durationSeconds: info?.duration_secs,
            stillCurrent: () =>
                this.xtreamStore.currentPlaylist()?.id === playlistId &&
                this.routeVodId()?.() === vodId,
        });
    }
}
