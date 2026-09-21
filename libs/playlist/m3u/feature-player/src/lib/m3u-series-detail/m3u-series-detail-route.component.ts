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
import {
    M3uCatalogIndexService,
    selectActivePlaylist,
} from '@iptvnator/m3u-state';
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
import { M3uSeries } from '@iptvnator/shared/m3u-utils';
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
    private readonly catalog = inject(M3uCatalogIndexService);
    private readonly positions = inject(M3uSeriesPositionsService);
    private readonly metadata = inject(M3uSeriesMetadataService);

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

            return buildM3uPlaybackPayload({
                channel,
                target: channel,
                playlistMeta: this.playlist(),
                // An episode is a finished file, never a live edge; this is
                // what gives the player a seekable timeline and a resume
                // position instead of live semantics.
                isLive: false,
                startTime: playing.startTime,
            });
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
    protected onEpisodeClicked(episode: XtreamSerieEpisode): void {
        const saved = this.playbackPositions().get(Number(episode.id));
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
    private channelOf(episode: XtreamSerieEpisode): Channel | null {
        const series = this.series();
        if (!series) {
            return null;
        }

        for (const episodes of series.seasons.values()) {
            for (const candidate of episodes) {
                if (candidate.channel.url === episode.direct_source) {
                    return candidate.channel;
                }
            }
        }

        return null;
    }
}
