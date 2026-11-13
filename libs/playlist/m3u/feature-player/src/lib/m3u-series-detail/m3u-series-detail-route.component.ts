import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    linkedSignal,
    signal,
    untracked,
    viewChild,
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
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    PortalDetailShellComponent,
    SeasonContainerComponent,
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerSeriesPlaybackToggleRequest,
    VodMoreMenuComponent,
} from '@iptvnator/ui/components';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import {
    Channel,
    PlaylistMeta,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    createLogger,
    isBeforeResumePoint,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { extractDrmFromRaw, isDashChannel } from '@iptvnator/shared/m3u-utils';
import { M3uSeries } from '@iptvnator/shared/m3u-utils/series';
import {
    createPlaybackSessionKey,
    type PlaybackFallbackRequest,
} from '@iptvnator/playback/util';
import { buildM3uPlaybackPayload } from '../m3u-playback-payload.util';
import { readStoredM3uVolume } from '../m3u-stored-volume.util';
import { M3uEpisodeAccessService } from './m3u-episode-access.service';
import { resumeOffsetOf } from './m3u-episode-resume.util';
import { toSeasonRecord } from './m3u-series-episode.adapter';
import { M3uSeriesMenuService } from './m3u-series-menu.service';
import { M3uSeriesMetadataService } from './m3u-series-metadata.service';
import { M3uSeriesPositionsService } from './m3u-series-positions.service';

interface PlayingEpisode {
    readonly episode: XtreamSerieEpisode;
    /**
     * The playlist row, captured when the episode was chosen. Sync and
     * refresh re-publish the rows and a lock flip rebuilds the catalog; a
     * row looked up again would give the player a new payload each time,
     * and it would remount at the offset the episode was opened at.
     */
    readonly channel: Channel;
    /** Seconds to open at; `undefined` starts from the beginning. */
    readonly startTime: number | undefined;
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
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        PortalDetailShellComponent,
        PortalInlinePlayerComponent,
        SeasonContainerComponent,
        TranslatePipe,
        VodMoreMenuComponent,
    ],
    templateUrl: './m3u-series-detail-route.component.html',
    providers: [
        M3uEpisodeAccessService,
        M3uSeriesMenuService,
        M3uSeriesMetadataService,
        M3uSeriesPositionsService,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class M3uSeriesDetailRouteComponent {
    private readonly logger = createLogger('M3uSeriesDetail');
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly catalog = inject(M3uSeriesCatalogService);
    private readonly positions = inject(M3uSeriesPositionsService);
    private readonly metadata = inject(M3uSeriesMetadataService);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly access = inject(M3uEpisodeAccessService);
    protected readonly menu = inject(M3uSeriesMenuService);
    private readonly seasonContainer =
        viewChild<SeasonContainerComponent>('seasonContainer');

    private readonly playlist = this.store.selectSignal(selectActivePlaylist);

    /**
     * The playlist fields playback reads (its default request headers).
     * Recording an episode in Recently viewed rewrites the playlist meta;
     * a payload rebuilt from that would look like a new source to the
     * player and remount it mid-episode.
     */
    private readonly playbackPlaylist = computed<PlaylistMeta | null>(
        () => {
            const playlist = this.playlist();
            return playlist
                ? ({
                      _id: playlist._id,
                      userAgent: playlist.userAgent,
                      referrer: playlist.referrer,
                      origin: playlist.origin,
                  } as PlaylistMeta)
                : null;
        },
        {
            equal: (a, b) =>
                a?._id === b?._id &&
                a?.userAgent === b?.userAgent &&
                a?.referrer === b?.referrer &&
                a?.origin === b?.origin,
        }
    );

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
    /** Latches once the mounted episode reaches its resume point. */
    private resumeSettled = false;

    protected readonly playingEpisodeId = computed(() => {
        const id = Number(this.playing()?.episode.id ?? '');
        return Number.isFinite(id) && id > 0 ? id : null;
    });

    protected readonly playback = computed<ResolvedPortalPlayback | null>(
        () => {
            const playing = this.playing();
            if (!playing) {
                return null;
            }
            const channel = playing.channel;

            return {
                ...buildM3uPlaybackPayload({
                    channel,
                    target: channel,
                    playlistMeta: this.playbackPlaylist(),
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
    protected readonly playbackSessionKey = computed(() =>
        this.sessionKeyOf(this.playingEpisodeId())
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
    protected readonly watchBatchRunning = this.positions.toggleRunning;

    constructor() {
        this.menu.connect(this.seasonContainer);

        // Reads the ids only, not the series: a catalog rebuild must not
        // re-read the positions, which also releases the progress throttle.
        effect(() => {
            const playlistId = this.playlistId();
            const seriesId = this.seriesId();
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
            });
        });

        effect(() => {
            const series = this.series();
            untracked(() => {
                if (series) {
                    this.metadata.load(series);
                } else {
                    this.metadata.reset();
                }
            });
        });

        // A relock, or a lock added while an episode plays, stops it: the
        // inline player is this page's own state, which the app-wide
        // enforcement (it watches the store's active channel) never sees.
        // Asked of the row the episode was opened with: the series can be
        // momentarily empty while the rows reload, which is not a lock.
        effect(() => {
            this.access.lockVersion();
            const playing = this.playing();
            untracked(() => {
                if (
                    playing &&
                    this.access.isWithheld(this.playlistId(), playing.channel)
                ) {
                    this.onPlayerClosed();
                }
            });
        });
    }

    /** One episode's toggle, or the menu's season or series batch. */
    protected onWatchToggled(
        request:
            | SeasonContainerPlaybackToggleRequest
            | SeasonContainerSeriesPlaybackToggleRequest
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
        const playing = this.playing();
        const episode = playing?.episode;
        if (!episode || !Number.isFinite(update.currentTime)) {
            return;
        }
        // A tick at ~0 before the seek to `startTime` would overwrite the
        // saved point; once reached, a seek back is saved as usual.
        if (!this.resumeSettled) {
            if (isBeforeResumePoint(playing.startTime, update)) {
                return;
            }
            this.resumeSettled = true;
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
     * The level the viewer left the M3U player at, re-read for each episode
     * as the `:view` player re-reads it per channel; the inline player's
     * own default is full volume.
     */
    protected readonly volume = linkedSignal({
        source: () => this.playing(),
        computation: () => readStoredM3uVolume(),
    });

    /**
     * "Open in MPV/VLC" from the player's failure overlay. Sent without the
     * episode identity: an external launch stays untracked, like one made
     * from the episode card.
     */
    protected onExternalFallbackRequested(
        request: PlaybackFallbackRequest
    ): void {
        const playback = { ...request.playback };
        delete playback.contentInfo;
        // The inline attempt's history write waits on its session key, which
        // an external player never confirms; MPV/VLC confirm by URL.
        const channel = this.playing()?.channel;
        if (channel) {
            this.access.recordWhenPlayed(this.playlistId(), channel, null);
        }
        request.trackLaunch(
            this.portalPlayer.openExternalPlayback(playback, request.player)
        );
    }

    /** An episode chosen in the player's fullscreen panel. */
    protected onPanelEpisodeSelected(item: { episode: unknown }): void {
        this.onEpisodeClicked(item.episode as XtreamSerieEpisode);
    }

    private shownSeriesKey = '';

    /** "Play from beginning" on an episode with saved progress. */
    protected onEpisodeRestartRequested(episode: XtreamSerieEpisode): void {
        this.openEpisode(episode, true);
    }

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

    private openEpisode(episode: XtreamSerieEpisode, fromStart = false): void {
        const channel = this.channelOf(episode);
        if (!channel) {
            return;
        }
        const playlistId = this.playlistId();
        if (!this.access.isWithheld(playlistId, channel)) {
            this.play(episode, channel, playlistId, fromStart);
            return;
        }

        // A locked group asks for the PIN first, as the channel list does;
        // the answer can arrive after the viewer has moved on.
        const key = this.shownSeriesKey;
        void this.access.requestAccess(playlistId, channel).then((granted) => {
            if (granted && key === this.shownSeriesKey) {
                this.play(episode, channel, playlistId, fromStart);
            }
        });
    }

    private play(
        episode: XtreamSerieEpisode,
        channel: Channel,
        playlistId: string,
        fromStart: boolean
    ): void {
        const startTime = fromStart
            ? undefined
            : resumeOffsetOf(this.playbackPositions().get(Number(episode.id)));
        if (this.playsExternally(channel)) {
            this.onPlayerClosed();
            this.access.recordWhenPlayed(playlistId, channel, null);
            void this.portalPlayer
                .openResolvedPlayback(
                    buildM3uPlaybackPayload({
                        channel,
                        target: channel,
                        playlistMeta: this.playbackPlaylist(),
                        isLive: false,
                        startTime,
                    }),
                    true
                )
                .catch((error: unknown) =>
                    // The error can carry the configured player path.
                    this.logger.warn('External episode launch failed', error)
                );
            return;
        }

        this.resumeSettled = false;
        this.access.recordWhenPlayed(
            playlistId,
            channel,
            this.sessionKeyOf(Number(episode.id))
        );
        this.playing.set({ episode, channel, startTime });
        this.positions.releaseProgressThrottle();
    }

    /** The playback session of one episode, scoped to its playlist. */
    private sessionKeyOf(episodeId: number | null): string {
        return createPlaybackSessionKey({
            kind: 'episode',
            sourceId: this.playlistId(),
            contentId: episodeId ?? 'none',
            seriesId: this.seriesId(),
        });
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
     * way the `:view` player hands them a channel. DASH and any row with
     * DRM — stated, or kept in the raw block by older imports — stay inline
     * under every setting: the external players cannot carry KODIPROP keys.
     */
    private playsExternally(channel: Channel): boolean {
        return (
            !this.portalPlayer.isEmbeddedPlayer() &&
            !isDashChannel(channel) &&
            !(channel.drm ?? extractDrmFromRaw(channel.raw))
        );
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
