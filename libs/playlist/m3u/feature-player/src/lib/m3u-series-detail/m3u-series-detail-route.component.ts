import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { tmdbBackdropUrl, tmdbPosterUrl } from '@iptvnator/services';
import { selectActivePlaylist } from '@iptvnator/m3u-state';
import { M3uSeriesCatalogService } from '@iptvnator/m3u-state/series-catalog';
import { Store } from '@ngrx/store';
import {
    DetailMetaTemplateDirective,
    PortalDetailShellComponent,
    SeasonContainerComponent,
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerSeriesPlaybackToggleRequest,
} from '@iptvnator/ui/components';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import {
    Channel,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { isDashChannel } from '@iptvnator/shared/m3u-utils';
import { M3uSeries } from '@iptvnator/shared/m3u-utils/series';
import { buildM3uPlaybackPayload } from '../m3u-playback-payload.util';
import { toSeasonRecord } from './m3u-series-episode.adapter';
import { M3uSeriesMetadataService } from './m3u-series-metadata.service';
import { M3uSeriesPositionsService } from './m3u-series-positions.service';

interface PlayingEpisode {
    readonly episode: XtreamSerieEpisode;
    /** Seconds to open at; `undefined` starts from the beginning. */
    readonly startTime: number | undefined;
}

/** How close to the end still counts as finished rather than resumable. */
const RESUME_TAIL_SECONDS = 15;

function resumeOffsetOf(
    saved: PlaybackPositionData | undefined
): number | undefined {
    const seconds = saved?.positionSeconds;
    if (
        typeof seconds !== 'number' ||
        !Number.isFinite(seconds) ||
        seconds <= 0
    ) {
        return undefined;
    }

    const duration = saved?.durationSeconds;
    if (
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration > 0 &&
        seconds >= duration - RESUME_TAIL_SECONDS
    ) {
        return undefined;
    }

    return seconds;
}

/**
 * The detail page for one aggregated M3U series.
 *
 * It fills the portal shell the Xtream and Stalker series pages already
 * use — nothing in `PortalDetailShellComponent`, `SeasonContainerComponent`
 * or `PortalInlinePlayerComponent` is changed or forked. Everything those
 * components need is already an input; the work is producing their shapes.
 *
 * Modelled on the M3U movie detail rather than on the Xtream series page:
 * that page needs six collaborator services for downloads, similar items,
 * multi-source pins and a provider `info` payload, none of which an M3U
 * playlist has.
 */
@Component({
    selector: 'app-m3u-series-detail-route',
    imports: [
        DetailMetaTemplateDirective,
        PortalDetailShellComponent,
        PortalInlinePlayerComponent,
        SeasonContainerComponent,
        TranslatePipe,
    ],
    templateUrl: './m3u-series-detail-route.component.html',
    providers: [M3uSeriesMetadataService, M3uSeriesPositionsService],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class M3uSeriesDetailRouteComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly catalog = inject(M3uSeriesCatalogService);
    private readonly positions = inject(M3uSeriesPositionsService);
    private readonly metadata = inject(M3uSeriesMetadataService);
    private readonly portalPlayer = inject(PORTAL_PLAYER);

    private readonly playlist = this.store.selectSignal(selectActivePlaylist);

    protected readonly seriesId = toSignal(
        this.route.paramMap.pipe(
            map((params) => Number(params.get('seriesId') ?? ''))
        ),
        { initialValue: 0 }
    );

    protected readonly series = computed<M3uSeries<Channel> | undefined>(() =>
        this.catalog.seriesById().get(this.seriesId())
    );

    protected readonly playlistId = computed(() => this.playlist()?._id ?? '');

    protected readonly seasons = computed(() => {
        const series = this.series();
        return series ? toSeasonRecord(series) : {};
    });

    protected readonly seasonCount = computed(
        () => Object.keys(this.seasons()).length
    );

    protected readonly episodeCount = computed(
        () => this.series()?.episodeCount ?? 0
    );

    /**
     * The episode currently mounted in the inline player, if any, together
     * with the offset it was opened at.
     *
     * The offset is captured once, at selection, rather than read live from
     * the positions map. The map is patched by this episode's own progress
     * ticks, so a live read would feed the player a `startTime` that chases
     * playback and re-seeks it on every tick.
     */
    private readonly playing = signal<PlayingEpisode | null>(null);

    protected readonly playingEpisodeId = computed(() => {
        const id = Number(this.playing()?.episode.id ?? '');
        return Number.isFinite(id) && id > 0 ? id : null;
    });

    protected readonly playback = computed<ResolvedPortalPlayback | null>(
        () => {
            const playing = this.playing();
            const channel = playing ? this.channelOf(playing.episode) : null;
            if (!playing || !channel) {
                return null;
            }

            return {
                ...buildM3uPlaybackPayload({
                    channel,
                    target: channel,
                    playlistMeta: this.playlist(),
                    // An episode is a finished file, never a live edge;
                    // this is what gives the player a seekable timeline and
                    // a resume position instead of live semantics.
                    isLive: false,
                    startTime: playing.startTime,
                }),
                // Which episode is on screen. The shared player offers its
                // fullscreen episode panel only for a playback that says
                // so; the seasons and positions it is handed are not
                // enough on their own. Inline only: an external launch
                // stays untracked, as before.
                contentInfo: {
                    playlistId: this.playlistId(),
                    contentXtreamId: Number(playing.episode.id),
                    contentType: 'episode',
                    seriesXtreamId: this.seriesId(),
                    seasonNumber: playing.episode.season,
                    episodeNumber: playing.episode.episode_num,
                },
            };
        }
    );

    /**
     * Identifies the mounted content for the player. Changing it tears the
     * engine down, so it has to move exactly when the episode does — not
     * when unrelated series state changes.
     */
    protected readonly playbackSessionKey = computed(
        () =>
            `m3u-series:${this.seriesId()}:${this.playingEpisodeId() ?? 'none'}`
    );

    private readonly tmdb = computed(() => this.metadata.state().details);

    /**
     * Provider data renders immediately and TMDB patches the same view when
     * it lands, so a missing or failed match simply leaves the thin
     * provider presentation in place — no layout jump, no spinner over
     * content that is already correct.
     */
    protected readonly seriesTitle = computed(
        () => this.tmdb()?.name?.trim() || this.series()?.title || ''
    );

    protected readonly overview = computed(
        () => this.tmdb()?.overview?.trim() ?? ''
    );

    protected readonly backdropUrl = computed(
        () => tmdbBackdropUrl(this.tmdb()?.backdrop_path) ?? undefined
    );

    /** Watch progress the shared season grid renders as badges and bars. */
    protected readonly playbackPositions = this.positions.byEpisodeId;

    constructor() {
        effect(() => {
            const playlistId = this.playlistId();
            const seriesId = this.seriesId();
            const series = this.series();
            untracked(() => {
                // The component is reused when only `:seriesId` changes.
                // The episode playing belongs to the series being left:
                // kept, it would remount on the way back without a click,
                // and its late ticks would be filed under the new series.
                const key = `${playlistId}\u0000${seriesId}`;
                if (key !== this.shownSeriesKey) {
                    this.shownSeriesKey = key;
                    this.playing.set(null);
                }
                void this.positions.load(playlistId, seriesId);
                if (series) {
                    this.metadata.load(series);
                } else {
                    this.metadata.reset();
                }
            });
        });
    }

    protected onEpisodeWatchToggled(
        request: SeasonContainerPlaybackToggleRequest
    ): void {
        void this.positions.applyToggle(
            this.playlistId(),
            this.seriesId(),
            request
        );
    }

    protected onBulkWatchToggled(
        request: SeasonContainerSeriesPlaybackToggleRequest
    ): void {
        void this.positions.applyToggle(
            this.playlistId(),
            this.seriesId(),
            request
        );
    }

    /**
     * Progress ticks from the inline player. The episode currently mounted
     * is the one they belong to; a tick that arrives after the viewer moved
     * on would otherwise be filed against the wrong episode.
     */
    protected onTimeUpdate(update: {
        currentTime: number;
        duration: number;
    }): void {
        const episode = this.playing()?.episode;
        if (!episode || !Number.isFinite(update.currentTime)) {
            return;
        }

        void this.positions.recordProgress(this.playlistId(), {
            contentXtreamId: Number(episode.id),
            contentType: 'episode',
            seriesXtreamId: this.seriesId(),
            seasonNumber: episode.season,
            episodeNumber: episode.episode_num,
            positionSeconds: Math.floor(update.currentTime),
            durationSeconds: Number.isFinite(update.duration)
                ? Math.floor(update.duration)
                : undefined,
            playlistId: this.playlistId(),
        });
    }

    protected readonly posterUrl = computed(
        () =>
            tmdbPosterUrl(this.tmdb()?.poster_path) ??
            this.series()?.posterUrl ??
            undefined
    );

    /**
     * Opens an episode at the offset storage remembers for it.
     *
     * A row at or past the end starts over instead: resuming three seconds
     * before the credits is not resuming, and the watched badge on the row
     * already says it was finished.
     */
    /** An episode chosen in the player's fullscreen panel. */
    protected onPanelEpisodeSelected(item: { episode: unknown }): void {
        this.onEpisodeClicked(item.episode as XtreamSerieEpisode);
    }

    private shownSeriesKey = '';

    protected onEpisodeClicked(episode: XtreamSerieEpisode): void {
        // The resume point comes from the positions map, and a click can
        // beat the read that fills it. Wait for the read rather than start
        // at zero and let the first tick overwrite what was saved.
        const pending = this.positions.whenLoaded();
        if (!pending) {
            this.openEpisode(episode);
            return;
        }

        const key = this.shownSeriesKey;
        void pending.then(() => {
            if (key === this.shownSeriesKey) {
                this.openEpisode(episode);
            }
        });
    }

    private openEpisode(episode: XtreamSerieEpisode): void {
        const saved = this.playbackPositions().get(Number(episode.id));
        const channel = this.channelOf(episode);
        if (channel && this.playsExternally(channel)) {
            this.onPlayerClosed();
            void this.portalPlayer
                .openResolvedPlayback(
                    buildM3uPlaybackPayload({
                        channel,
                        target: channel,
                        playlistMeta: this.playlist(),
                        isLive: false,
                        startTime: resumeOffsetOf(saved),
                    }),
                    true
                )
                .catch((error) =>
                    console.warn('External episode launch failed', error)
                );
            return;
        }

        this.playing.set({
            episode,
            startTime: resumeOffsetOf(saved),
        });
        this.positions.releaseProgressThrottle();
    }

    protected onPlayerClosed(): void {
        this.playing.set(null);
        this.positions.releaseProgressThrottle();
    }

    protected onBack(): void {
        // Relative to the PARENT, not to this route: `series/:seriesId` is a
        // two-segment path, so `..` from here lands on `/series` and adding
        // `series` again would ask for `/series/series` — which the generic
        // `:view` player route answers, not the catalog.
        void this.router.navigate(['series'], {
            relativeTo: this.route.parent,
        });
    }

    /**
     * The adapter put the row's own URL in `direct_source`, so the channel
     * behind an episode is found by it rather than by a parallel lookup
     * table that could drift out of step with the catalog.
     */
    /**
     * MPV and VLC have no inline engine: mounting the inline player for them
     * gives an empty stage and launches nothing. They get the episode the
     * way the `:view` player hands them a channel. DASH stays inline under
     * every setting, as it does there — the external players cannot carry
     * its KODIPROP keys.
     */
    private playsExternally(channel: Channel): boolean {
        return !this.portalPlayer.isEmbeddedPlayer() && !isDashChannel(channel);
    }

    private channelOf(episode: XtreamSerieEpisode): Channel | null {
        const series = this.series();
        if (!series) {
            return null;
        }

        // By the episode's own id, which the adapter carried over: two rows
        // can share a URL and differ in headers, DRM or artwork, and a URL
        // match would then play the first of them for either card.
        for (const episodes of series.seasons.values()) {
            for (const candidate of episodes) {
                if (String(candidate.id) === String(episode.id)) {
                    return candidate.channel;
                }
            }
        }

        return null;
    }
}
