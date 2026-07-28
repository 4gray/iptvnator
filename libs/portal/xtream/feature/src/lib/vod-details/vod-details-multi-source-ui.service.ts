import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { SettingsStore } from '@iptvnator/services';
import {
    PlaybackPositionData,
    PlayerContentInfo,
    playlistDisplayLabel,
    reportsPlaybackFailures,
    type VodSourceCandidate,
    type VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';
import {
    createPrimaryActionPosition,
    formatPlaybackPosition,
} from './vod-primary-action-position';

/**
 * The VOD details route's multi-source concerns.
 *
 * Everything here answers one of two questions: what is TRUE about playback
 * right now, and what does the primary button act on. Both are easy to get
 * subtly wrong — the controller's "active source" means selected rather than
 * playing, and positions are keyed per (playlist, stream) so the row the page
 * loaded is not necessarily the one a click will start.
 *
 * Component-provided, like the host service whose session it reads.
 */
@Injectable()
export class VodDetailsMultiSourceUiService {
    private readonly multiSource = inject(VodMultiSourceHostService);
    private readonly playback = inject(VodDetailsPlaybackService);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly settingsStore = inject(SettingsStore);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);

    /** The vod id the route is showing; bound once by the host component. */
    private routeContentId: Signal<number> = signal(NaN);
    /** The movie identity, for the sources popover header. */
    private movieTitle: Signal<string> = signal('');

    bind(bindings: {
        routeContentId: Signal<number>;
        movieTitle: Signal<string>;
    }): void {
        this.routeContentId = bindings.routeContentId;
        this.movieTitle = bindings.movieTitle;
    }

    /** True from a playback failure until something plays again. */
    private readonly playbackFailed = signal(false);

    /**
     * Cleared on every start; set by the first timeupdate.
     *
     * `inlinePlayback()` is the REQUEST to play — it is non-null while the
     * engine is still opening the stream, and stays non-null after it fails.
     * A timeupdate is the engine reporting that it is producing frames, which
     * is the only evidence the page has that something is really playing.
     */
    private readonly inlineTimeSeen = signal(false);

    /**
     * Whether a stream is on screen right now.
     *
     * Both the "Playing from" caption and the row's Playing badge are claims
     * about the present, and discovery marks a source active the moment the
     * page opens — long before anything plays, and again after the player is
     * closed. Gating both on this keeps them from lying.
     */
    readonly playbackLive = computed(() => {
        if (this.playback.inlinePlayback()) {
            return !this.playbackFailed() && this.inlineTimeSeen();
        }

        // The external player is a window of its own: once it is open the film
        // is on screen, and only 'launching' means it is not there yet.
        const status = this.playback.matchedExternalPlayback()?.status;
        return status === 'opened' || status === 'playing';
    });

    /**
     * The source playing when it is NOT the route's own.
     *
     * Both halves of the comparison matter: a pinned copy can live in the
     * route's OWN playlist, and matching on playlist alone would call it "the
     * route source" — losing the Stop state and every position update for it.
     */
    readonly activeAlternativeSource = computed<PlayerContentInfo | null>(
        () => {
            const active = this.multiSource
                .sources()
                .find((source) => source.isActive);
            const routePlaylistId = this.xtreamStore.currentPlaylist()?.id;

            if (
                !active ||
                (active.playlistId === routePlaylistId &&
                    active.contentId === this.routeContentId())
            ) {
                return null;
            }

            return {
                playlistId: active.playlistId,
                contentXtreamId: active.contentId,
                contentType: 'vod' as const,
            };
        }
    );

    private readonly primaryAction = createPrimaryActionPosition({
        sources: this.multiSource.sources,
        routePlaylistId: computed(() => this.xtreamStore.currentPlaylist()?.id),
        routeContentId: computed(() => this.routeContentId()),
        routePosition: this.playback.routePlaybackPosition,
        livePosition: this.playback.vodPlaybackPosition,
        load: (source) => this.positionFor(source),
    });

    readonly hasPlaybackPosition = this.primaryAction.hasPosition;

    formatPosition(): string {
        return formatPlaybackPosition(this.primaryAction.position());
    }

    /**
     * Where a specific source was last watched.
     *
     * Positions are keyed by (playlist, stream), so a pinned alternative has
     * its own row — the one this page loaded belongs to the route's copy.
     */
    readonly positionFor = (
        source: VodSourceCandidate | VodSourceDescriptor
    ): Promise<PlaybackPositionData | null> =>
        this.playbackPositions.getPlaybackPosition(
            source.playlistId,
            source.contentId,
            'vod'
        );

    readonly resumeSecondsFor = async (
        source: VodSourceCandidate
    ): Promise<number | null> =>
        (await this.positionFor(source))?.positionSeconds ?? null;

    /** Title shown in the sources popover header. */
    readonly multiSourceTitle = computed(() => this.movieTitle());

    /** The ".srcbar" caption under the action row: where this is playing from. */
    readonly activeSourceCaption = computed(() => {
        const active = this.multiSource
            .sources()
            .find((source) => source.isActive);
        // "Playing from" only while something actually is. Discovery marks a
        // source active as soon as the page opens, so gating on that alone
        // makes the line a claim about a player that has not started, one the
        // user has since closed, or one that failed and is showing an error.
        if (!active || !this.playbackLive()) {
            return null;
        }

        // Only FACTS reach the caption. A guessed quality would read as a
        // claim about the stream the user is watching right now.
        const facts = [
            active.quality?.provenance !== 'parsed'
                ? active.quality?.value
                : null,
            active.container?.provenance !== 'parsed'
                ? active.container?.value
                : null,
        ].filter(Boolean);

        return {
            // Never the raw playlist name: it is routinely the pasted URL,
            // credentials and all, and this line sits in the open on every
            // screenshot of the detail page.
            source: [
                playlistDisplayLabel(active.playlistName, active.playlistId),
                ...facts,
            ].join(' · '),
            // The caption speaks of PLAYLISTS ("also found in 2 others"), so
            // three copies inside one portal must not read as three portals.
            alternativeCount: this.multiSource.alternativePlaylistCount(),
        };
    });

    /**
     * Only the built-in web players raise a playback diagnostic, so on MPV,
     * VLC or Embedded MPV nothing would ever call `onPlaybackFailed()`. The
     * toggle is hidden there rather than left promising a switch that cannot
     * happen.
     */
    readonly autoFailoverSupported = computed(() =>
        reportsPlaybackFailures(this.settingsStore.player?.())
    );

    /** A new stream is starting: nothing yet vouches for it. */
    beginPlayback(): void {
        this.playbackFailed.set(false);
        this.inlineTimeSeen.set(false);
    }

    /** Route reuse — the previous movie's evidence must not carry over. */
    reset(): void {
        this.inlineTimeSeen.set(false);
    }

    playFromSource(sourceId: string): void {
        // Only once the switch actually starts something. A source picked off
        // the error screen that cannot be resolved leaves the diagnostic up,
        // and clearing eagerly would have the caption claim playback again.
        void this.multiSource.play(sourceId).then((switched) => {
            if (switched) {
                this.playbackFailed.set(false);
            }
        });
    }

    pinSource(sourceId: string): void {
        void this.multiSource.togglePin(sourceId);
    }

    checkSource(sourceId: string): void {
        void this.multiSource.check(sourceId);
    }

    setAutoFailover(enabled: boolean): void {
        // `updateSettings` patches memory first and REJECTS if the write
        // fails, so without this the toggle looks saved, reverts on restart,
        // and the rejection surfaces only as an unhandled promise.
        this.settingsStore
            .updateSettings({ vodAutoFailover: enabled })
            .catch(() =>
                this.snackBar.open(
                    this.translateService.instant(
                        'SETTINGS.SETTINGS_SAVE_FAILED'
                    ),
                    this.translateService.instant('CLOSE'),
                    { duration: 10000 }
                )
            );
    }

    /**
     * A source failed. With auto-failover on we move to the best untried
     * source and ANNOUNCE it; otherwise the player's own error overlay — which
     * is already showing the alternatives — is left to do its job.
     */
    async onPlaybackFailed(): Promise<void> {
        // The error screen is up: nothing is playing from anywhere until a
        // source actually starts again.
        this.playbackFailed.set(true);
        const notice = await this.multiSource.failover();
        if (!notice) {
            return;
        }

        this.snackBar
            .open(
                this.translateService.instant(
                    'PORTALS.MULTI_SOURCE.SWITCHED_TO',
                    { playlist: notice.playlistName }
                ) +
                    (notice.audioMayDiffer
                        ? ` — ${this.translateService.instant(
                              'PORTALS.MULTI_SOURCE.SWITCH_AUDIO_WARNING'
                          )}`
                        : ''),
                this.translateService.instant('PORTALS.MULTI_SOURCE.UNDO'),
                { duration: 10000 }
            )
            .onAction()
            .subscribe(() => this.undoFailover());
    }

    /** Return to the source that was playing before the automatic switch. */
    private undoFailover(): void {
        const previousId = this.multiSource.previousSourceId();
        if (previousId) {
            void this.multiSource.play(previousId);
        }
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        // The engine is producing time, so whatever failed before is over.
        this.playbackFailed.set(false);
        this.inlineTimeSeen.set(true);
        const settled = this.playback.handleInlineTimeUpdate(event);

        // Ahead of the service's 15s persistence throttle, so a source switch
        // resumes from where playback actually is rather than up to 15s back.
        //
        // Until the engine has finished seeking to the resume point it reports
        // ~0, and that is not where the film is — it is where it has not got
        // to yet. Feeding it to multi-source would make a switch or a failure
        // during those first seconds restart the movie from the beginning, so
        // the position we asked the engine for stands in until it arrives.
        this.multiSource.reportPosition(
            settled
                ? event.currentTime
                : (this.playback.inlinePlayback()?.startTime ?? 0)
        );
    }
}
