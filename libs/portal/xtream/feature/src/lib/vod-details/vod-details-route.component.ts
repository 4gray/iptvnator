import { Location, SlicePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    OnInit,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    PortalDetailShellComponent,
    VodSourcesChipComponent,
} from '@iptvnator/ui/components';
import { SafePipe } from '@iptvnator/pipes';
import {
    createLogger,
    PORTAL_PLAYBACK_POSITIONS,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
} from '@iptvnator/ui/playback';
import {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
    DownloadsService,
    SettingsStore,
} from '@iptvnator/services';
import {
    getXtreamVodInfo,
    playlistDisplayLabel,
    normalizeTitleKeys,
    TmdbEnrichedCastMember,
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodInfo,
    XtreamVodStream,
    youtubeEmbedUrl,
    type VodSourceCandidate,
} from '@iptvnator/shared/interfaces';
import {
    SimilarCatalogItem,
    matchRecommendationsToCatalog,
} from '../tmdb-similar.util';
import {
    buildXtreamVodFallbackViewModel,
    hasUsableXtreamVodMetadata,
} from './vod-details-fallback.util';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';
import { resolveVodMultiSourceMovie } from './vod-multi-source-identity';

@Component({
    templateUrl: './vod-details-route.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
        './vod-details-route.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [VodDetailsPlaybackService, VodMultiSourceHostService],
    imports: [
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MatIcon,
        PortalDetailShellComponent,
        SafePipe,
        SlicePipe,
        TranslateModule,
        PortalInlinePlayerComponent,
        VodSourcesChipComponent,
    ],
})
export class VodDetailsRouteComponent implements OnInit, OnDestroy {
    private readonly location = inject(Location);
    private readonly settingsStore = inject(SettingsStore);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly crossPortalSimilar = inject(CrossPortalSimilarService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly downloadsService = inject(DownloadsService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly playback = inject(VodDetailsPlaybackService);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    /** Alternative sources for this movie in the user's other playlists */
    readonly multiSource = inject(VodMultiSourceHostService);
    private readonly logger = createLogger('VodDetailsRoute');
    /** `playlistId:vodId` of the last initialized detail view */
    private readonly lastInitKey = signal<string | null>(null);
    private readonly backdropBackfillKey = signal<string | null>(null);
    readonly inlinePlayback = this.playback.inlinePlayback;
    readonly vodPlaybackPosition = this.playback.vodPlaybackPosition;

    /**
     * Reactive route params: the component is reused when navigating
     * between two VOD details (e.g. via the Similar rail), so computeds
     * must not read the one-shot snapshot.
     */
    private readonly routeParams = toSignal(this.route.params, {
        initialValue: this.route.snapshot.params,
    });

    readonly theme = this.settingsStore.theme;
    readonly isElectron = this.downloadsService.isAvailable;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly selectedItem = computed(
        () =>
            this.xtreamStore.selectedItem() as unknown as XtreamVodDetails | null
    );
    readonly selectedVodId = computed(() => Number(this.routeParams().vodId));
    readonly selectedCategory = computed<Partial<XtreamCategory> | null>(() => {
        const categoryId = this.routeParams().categoryId;
        if (!categoryId) {
            return null;
        }

        return (
            this.xtreamStore.vodCategories().find(
                (category) =>
                    String(
                        (
                            category as XtreamCategory & {
                                id?: string | number;
                            }
                        ).category_id ??
                            (
                                category as XtreamCategory & {
                                    id?: string | number;
                                }
                            ).id
                    ) === String(categoryId)
            ) ?? null
        );
    });
    readonly selectedCatalogItem = computed<
        | (Partial<XtreamVodStream> & {
              id?: string | number;
              poster_url?: string;
              title?: string;
              xtream_id?: string | number;
          })
        | null
    >(() => {
        const vodId = this.selectedVodId();
        if (!Number.isFinite(vodId) || vodId <= 0) {
            return null;
        }

        return (
            this.xtreamStore.vodStreams().find(
                (item) =>
                    Number(
                        (
                            item as XtreamVodStream & {
                                id?: string | number;
                                xtream_id?: string | number;
                            }
                        ).xtream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).stream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).id
                    ) === vodId
            ) ?? null
        );
    });
    /** Movie identity for multi-source discovery; null until a title exists */
    private readonly multiSourceMovie = computed(() =>
        resolveVodMultiSourceMovie({
            playlistId: this.xtreamStore.currentPlaylist()?.id,
            // `title` is the alias the Xtream data source actually writes
            // (createPlaylist maps name -> title), so reading only `name`
            // would fall back to the raw playlist UUID in the sources list.
            playlistName:
                this.xtreamStore.currentPlaylist()?.name ??
                this.xtreamStore.currentPlaylist()?.title,
            vodId: this.selectedVodId(),
            vodInfo: this.selectedVodInfo(),
            catalogItem: this.selectedCatalogItem(),
        })
    );
    readonly selectedVodInfo = computed(() => {
        const item = this.selectedItem();
        return item && hasUsableXtreamVodMetadata(item)
            ? getXtreamVodInfo(item)
            : null;
    });
    readonly fallbackView = computed(() => {
        const item = this.selectedItem();
        if (!item || this.selectedVodInfo()) {
            return null;
        }

        return buildXtreamVodFallbackViewModel({
            vodDetails: item,
            catalogItem: this.selectedCatalogItem(),
            category: this.selectedCategory(),
            vodId: this.selectedVodId(),
        });
    });
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly matchedExternalPlayback = this.playback.matchedExternalPlayback;
    readonly externalPrimaryLabel = this.playback.externalPrimaryLabel;
    readonly externalPrimaryIcon = this.playback.externalPrimaryIcon;
    readonly isExternalLaunchPending = this.playback.isExternalLaunchPending;
    readonly isExternalStopAction = this.playback.isExternalStopAction;
    readonly externalPrimaryButtonState =
        this.playback.externalPrimaryButtonState;
    readonly vodPlaybackProgress = this.playback.vodPlaybackProgress;
    readonly hasPlaybackPosition = this.playback.hasPlaybackPosition;

    readonly isDownloaded = computed(() => {
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isDownloaded(vodId, playlistId, 'vod');
    });

    readonly isDownloading = computed(() => {
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isDownloading(vodId, playlistId, 'vod');
    });

    readonly isPausedDownload = computed(() => {
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isPaused(vodId, playlistId, 'vod');
    });

    readonly trailerEmbedUrl = computed(() =>
        youtubeEmbedUrl(this.selectedVodInfo()?.youtube_trailer)
    );

    /** TMDB recommendations matched against the loaded VOD catalog */
    readonly similarItems = computed<SimilarCatalogItem[]>(() => {
        const info = this.selectedVodInfo();
        if (!info?.tmdb_recommendations?.length) {
            return [];
        }
        return matchRecommendationsToCatalog(
            info.tmdb_recommendations,
            this.xtreamStore.vodStreams(),
            { excludeId: this.selectedVodId() }
        );
    });

    /** Recommendations found in the user's OTHER portals (Electron only) */
    private readonly crossPortalItems = signal<CrossPortalSimilarItem[]>([]);
    readonly similarInPortals = computed<CrossPortalSimilarItem[]>(() => {
        const localTitles = new Set(
            this.similarItems().map(
                (item) => normalizeTitleKeys(item.title).exact
            )
        );
        return this.crossPortalItems().filter(
            (item) => !localTitles.has(normalizeTitleKeys(item.title).exact)
        );
    });

    private readonly loadCrossPortalSimilar = effect(() => {
        const recommendations = this.selectedVodInfo()?.tmdb_recommendations;
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        untracked(() => {
            this.crossPortalItems.set([]);
            if (
                !recommendations?.length ||
                !this.crossPortalSimilar.isAvailable
            ) {
                return;
            }
            void this.crossPortalSimilar
                .matchRecommendations(recommendations, 'movie', {
                    excludePlaylistId: playlistId,
                })
                .then((items) => {
                    if (
                        this.selectedVodInfo()?.tmdb_recommendations ===
                        recommendations
                    ) {
                        this.crossPortalItems.set(items);
                    }
                });
        });
    });

    /**
     * The alternative the player is on, in playback's terms — null while the
     * route's own source is playing, which the matcher already recognises.
     */
    private readonly activeAlternativeSource = computed(() => {
        const active = this.multiSource.sources().find((s) => s.isActive);
        const routePlaylistId = this.xtreamStore.currentPlaylist()?.id;
        // Both halves: a pinned copy can now live in the route's OWN playlist,
        // and comparing the playlist alone would call it "the route source" —
        // losing the Stop state and every position update for it.
        if (
            !active ||
            (active.playlistId === routePlaylistId &&
                active.contentId === this.selectedVodId())
        ) {
            return null;
        }

        return {
            playlistId: active.playlistId,
            contentXtreamId: active.contentId,
            contentType: 'vod' as const,
        };
    });

    constructor() {
        this.playback.bind({
            vodId: this.selectedVodId,
            vodInfo: this.selectedVodInfo,
            activeSource: this.activeAlternativeSource,
        });

        effect(() => {
            const position = this.playback.vodPlaybackPosition();
            if (!position) {
                return;
            }

            if (this.inlinePlayback()) {
                // Seeding only: the inline player reports the live timecode
                // itself, and this stored value lags it by up to the save
                // throttle — applying it would rewind the switch. Before the
                // first timeupdate there is nothing to protect, so a switch
                // made straight off the Resume button still resumes.
                this.multiSource.seedResumePosition(position.positionSeconds);
                return;
            }

            // MPV and VLC have no timeupdate to report; this polled position
            // IS their live one, so a source switch after an hour in an
            // external player must not rewind to where it started.
            this.multiSource.reportPosition(position.positionSeconds);
        });
        this.multiSource.bind({
            // Route every switch through the same inline-vs-external fork a
            // normal Play uses, so the two paths cannot drift apart.
            startPlayback: (playback) =>
                this.playback.startResolvedPlayback(playback),
            movie: this.multiSourceMovie,
        });

        // Initializes on first render and RE-initializes when the route
        // params change while the component is reused (Similar rail).
        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = this.selectedVodId();
            if (!playlistId || !Number.isFinite(vodId) || vodId <= 0) return;

            const initKey = `${playlistId}:${vodId}`;
            if (this.lastInitKey() === initKey) return;
            this.lastInitKey.set(initKey);

            this.inlinePlayback.set(null);
            this.vodPlaybackPosition.set(null);
            this.initializeVodDetails(playlistId, vodId);
        });

        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = this.selectedVodId();
            const backdropUrl =
                this.selectedVodInfo()?.backdrop_path?.[0]?.trim();

            if (
                !playlistId ||
                !Number.isFinite(vodId) ||
                vodId <= 0 ||
                !backdropUrl
            ) {
                return;
            }

            const backfillKey = `${playlistId}:${vodId}:${backdropUrl}`;
            if (this.backdropBackfillKey() === backfillKey) {
                return;
            }

            this.backdropBackfillKey.set(backfillKey);
            void this.xtreamStore.backfillContentBackdrop({
                xtreamId: vodId,
                contentType: 'movie',
                playlist: this.xtreamStore.currentPlaylist,
                backdropUrl,
            });
        });
    }

    ngOnInit(): void {
        // Initialization is handled by the params-driven effect in the
        // constructor; the hook remains for interface compatibility.
        if (!this.xtreamStore.currentPlaylist()?.id) {
            this.logger.warn('Deferring VOD details init: playlist not ready');
        }
    }

    openSimilarInPortals(item: CrossPortalSimilarItem): void {
        void this.router.navigate(this.crossPortalSimilar.buildLink(item));
    }

    openSimilar(item: SimilarCatalogItem): void {
        void this.router.navigate(['../..', item.categoryId, item.id], {
            relativeTo: this.route,
        });
    }

    openActor(member: TmdbEnrichedCastMember): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId || !member.tmdbPersonId) {
            return;
        }
        void this.router.navigate([
            '/workspace/xtreams',
            playlistId,
            'actor',
            member.tmdbPersonId,
        ]);
    }

    ngOnDestroy(): void {
        this.playback.closeInlinePlayer();
        this.xtreamStore.setSelectedItem(null);
    }

    playVod(vodItem: XtreamVodDetails | null): void {
        // Restart means from the beginning. The controller still holds the
        // position this page was seeded with, and a failure before the first
        // timeupdate would otherwise resolve the next source back at it.
        this.multiSource.reportPosition(0);
        this.multiSource.markRouteSourceActive();
        this.playback.playVod(vodItem);
    }

    resumeVod(vodItem: XtreamVodDetails | null): void {
        this.multiSource.markRouteSourceActive();
        this.playback.resumeVod(vodItem);
    }

    async onPrimaryAction(vodItem: XtreamVodDetails | null): Promise<void> {
        // When the button reads Stop, it stops. Consulting the pin first would
        // make the control do the opposite of what it says — launching a
        // second player while the first keeps running.
        if (this.playback.isExternalStopAction()) {
            this.playback.onPrimaryAction(vodItem);
            return;
        }

        // A pinned source is an explicit "play this movie from here", so it
        // outranks the playlist the route happens to be on. Falls through to
        // the normal path when nothing is pinned or the pin cannot resolve.
        if (await this.multiSource.playPinnedSource(this.resumeSecondsFor)) {
            return;
        }

        // Falling through to the route's own stream: whatever alternative was
        // last active is not what will be playing.
        this.multiSource.markRouteSourceActive();
        this.playback.onPrimaryAction(vodItem);
    }

    /**
     * Where a specific source was last watched.
     *
     * Positions are keyed by (playlist, stream), so a pinned alternative has
     * its own row — the one this page loaded belongs to the route's copy.
     */
    private readonly resumeSecondsFor = async (
        source: VodSourceCandidate
    ): Promise<number | null> => {
        const position = await this.playbackPositions.getPlaybackPosition(
            source.playlistId,
            source.contentId,
            'vod'
        );
        return position?.positionSeconds ?? null;
    };

    stopExternalPlayback(): Promise<void> {
        return this.playback.stopExternalPlayback();
    }

    formatPosition(): string {
        return this.playback.formatPosition();
    }

    toggleFavorite(): void {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.vodId,
            playlist.id,
            'movie',
            this.selectedVodInfo()?.backdrop_path?.[0]
        );
    }

    getBackdropUrl(info: XtreamVodInfo): string | undefined {
        return info.backdrop_path?.[0];
    }

    goBack(): void {
        this.playback.closeInlinePlayer();
        this.location.back();
    }

    closeInlinePlayer(): void {
        this.playback.closeInlinePlayer();
    }

    /** Title shown in the sources popover header. */
    readonly multiSourceTitle = computed(
        () => this.multiSourceMovie()?.title ?? ''
    );

    /** The ".srcbar" caption under the action row: where this is playing from. */
    readonly activeSourceCaption = computed(() => {
        const active = this.multiSource.sources().find((s) => s.isActive);
        if (!active) {
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

    playFromSource(sourceId: string): void {
        void this.multiSource.play(sourceId);
    }

    pinSource(sourceId: string): void {
        void this.multiSource.togglePin(sourceId);
    }

    checkSource(sourceId: string): void {
        void this.multiSource.check(sourceId);
    }

    setAutoFailover(enabled: boolean): void {
        this.settingsStore.updateSettings({ vodAutoFailover: enabled });
    }

    /**
     * A source failed. With auto-failover on we move to the best untried
     * source and ANNOUNCE it; otherwise the player's own error overlay — which
     * is already showing the alternatives — is left to do its job.
     */
    async onPlaybackFailed(): Promise<void> {
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
                : (this.inlinePlayback()?.startTime ?? 0)
        );
    }

    showCopyNotification(): void {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            undefined,
            {
                duration: 2000,
            }
        );
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        this.playback.handleExternalFallbackRequest(request);
    }

    async resumePausedDownload(): Promise<void> {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) {
            return;
        }
        await this.downloadsService.resumeDownloadByContent(
            this.selectedVodId(),
            playlistId,
            'vod'
        );
    }

    async downloadVod(vodItem: XtreamVodDetails | null): Promise<void> {
        if (!vodItem) {
            return;
        }

        const info = getXtreamVodInfo(vodItem);
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);
        const routeVodId = this.route.snapshot.params.vodId;
        const id = routeVodId
            ? Number(routeVodId)
            : Number(
                  vodItem.movie_data?.stream_id ||
                      (vodItem as { stream_id?: number }).stream_id
              );

        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        await this.downloadsService.startDownload({
            playlistId: playlist.id,
            xtreamId: id,
            contentType: 'vod',
            title: info?.name ?? vodItem.movie_data?.name ?? 'Unknown',
            url: streamUrl,
            posterUrl: info?.movie_image,
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
        });
    }

    async playFromLocal(): Promise<void> {
        const vodId = Number(this.route.snapshot.params.vodId);
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return;

        const filePath = this.downloadsService.getDownloadedFilePath(
            vodId,
            playlistId,
            'vod'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }

    private initializeVodDetails(playlistId: string, vodId: number): void {
        const { categoryId } = this.route.snapshot.params;
        this.xtreamStore.fetchVodDetailsWithMetadata({
            vodId: String(vodId),
            categoryId,
        });
        this.xtreamStore.checkFavoriteStatus(vodId, playlistId, 'movie');
        void this.playback.loadPosition(playlistId, vodId);
    }
}
