import { Location, SlicePipe } from '@angular/common';
import {
    Component,
    computed,
    effect,
    inject,
    OnDestroy,
    OnInit,
    signal,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    PortalDetailShellComponent,
    ViewInPortalActionComponent,
    SeasonContainerComponent,
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerSeasonPlaybackToggleRequest,
    SeasonContainerSeriesPlaybackToggleRequest,
} from '@iptvnator/ui/components';
import type { SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';
import {
    registerContentMetadataBackfill,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    buildUpNextRailItems,
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
    type UpNextRailItem,
} from '@iptvnator/ui/playback';
import {
    normalizeTitleKeys,
    seriesStatusLabelKey,
    TmdbEnrichedCastMember,
    XtreamSerieDetails,
    XtreamSerieEpisode,
    XtreamSerieInfo,
} from '@iptvnator/shared/interfaces';
import { buildSeasonDescriptions } from './season-descriptions.util';
import { isProviderOnlyDetailState } from '@iptvnator/portal/shared/util';
import {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
} from '@iptvnator/services';
import {
    SerialDetailsPlaybackService,
    type XtreamSerieDetailsView,
} from './serial-details-playback.service';
import { SerialDetailsSeasonWatchService } from './serial-details-season-watch.service';
import {
    SimilarCatalogItem,
    matchRecommendationsToCatalog,
} from '../tmdb-similar.util';
import { createXtreamSeriesDownloadMetadataContext } from './serial-download-metadata';
import { createXtreamSeriesDownloadAdapter } from './xtream-series-download.adapter';
import { createSerialPlaybackSessionKey } from './serial-playback-session-key';

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
    ],
    styles: [
        `
            :host {
                display: block;
                width: 100%;
                height: 100%;
                min-height: 0;
            }
        `,
    ],
    providers: [SerialDetailsPlaybackService, SerialDetailsSeasonWatchService],
    imports: [
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MatIcon,
        PortalDetailShellComponent,
        ViewInPortalActionComponent,
        PortalInlinePlayerComponent,
        SeasonContainerComponent,
        SlicePipe,
        TranslatePipe,
    ],
})
export class SerialDetailsComponent implements OnInit, OnDestroy {
    private readonly location = inject(Location);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly crossPortalSimilar = inject(CrossPortalSimilarService);

    /** Maps the status token to its translated label key */
    readonly seriesStatusLabelKey = seriesStatusLabelKey;
    private readonly xtreamStore = inject(XtreamStore);
    private readonly playback = inject(SerialDetailsPlaybackService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);

    readonly selectedItem = signal<XtreamSerieDetailsView | null>(null);
    readonly selectedContentType = this.xtreamStore.selectedContentType;
    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly currentPlaylistId = signal('');
    readonly episodeDownloadAdapter =
        computed<SeasonEpisodeDownloadAdapter | null>(() => {
            const playlist = this.xtreamStore.currentPlaylist();
            const item = this.selectedItem();
            if (!playlist || !item) {
                return null;
            }

            return createXtreamSeriesDownloadAdapter({
                playlistId: playlist.id,
                seriesId: Number(item.series_id),
                title: item.info.name,
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
                userAgent: playlist.userAgent,
                referrer: playlist.referrer,
                origin: playlist.origin,
                metadataContext: createXtreamSeriesDownloadMetadataContext(
                    item.info,
                    this.translateService.currentLang ||
                        this.translateService.defaultLang ||
                        'en'
                ),
            });
        });
    /** `playlistId:categoryId:serialId` of the last initialized view */
    private readonly lastInitKey = signal<string | null>(null);

    /**
     * Reactive route params: the component is reused when navigating
     * between two series details (e.g. via the Similar rail).
     */
    private readonly routeParams = toSignal(this.route.params, {
        initialValue: this.route.snapshot.params,
    });
    readonly providerOnly = computed(() => {
        this.routeParams();
        return isProviderOnlyDetailState(window.history.state);
    });

    // Episode playback state, re-exposed for the template.
    readonly inlinePlayback = this.playback.inlinePlayback;
    readonly episodePlaybackPositions = this.playback.episodePlaybackPositions;
    readonly openingEpisodeId = this.playback.openingEpisodeId;
    readonly seasonWatchBatchRunning = this.playback.seasonWatchBatchRunning;
    readonly activeEpisodeId = this.playback.activeEpisodeId;
    readonly quickStartAction = this.playback.quickStartAction;
    readonly inlineEpisodeMetadata = this.playback.inlineEpisodeMetadata;
    readonly inlineSeriesNavigation = this.playback.inlineSeriesNavigation;
    readonly playbackSessionKey = computed(() =>
        createSerialPlaybackSessionKey(
            this.xtreamStore.currentPlaylist()?.id,
            this.routeParams().serialId,
            this.playback.inlinePlaybackSessionEpisodeState()
        )
    );
    /** "Up Next" rail entries for the inline player (series only). */
    readonly upNextEpisodes = computed<UpNextRailItem[]>(() =>
        buildUpNextRailItems({
            episodesBySeason: this.selectedItem()?.episodes,
            currentEpisodeId: this.playback.inlineEpisodeState()?.episode.id,
            playbackPositions: this.episodePlaybackPositions(),
        })
    );

    /** Season currently selected in the season container. */
    private readonly selectedSeasonKey = signal<string | null>(null);

    /** Season descriptions (provider text, TMDB fallback, URL junk dropped). */
    readonly seasonDescriptions = computed<Record<string, string>>(() =>
        buildSeasonDescriptions(this.selectedItem())
    );

    /** TMDB recommendations matched against the loaded series catalog */
    readonly similarItems = computed<SimilarCatalogItem[]>(() => {
        const item = this.selectedItem();
        const recommendations = item?.info?.tmdb_recommendations;
        if (!recommendations?.length) {
            return [];
        }
        return matchRecommendationsToCatalog(
            recommendations,
            this.xtreamStore.serialStreams(),
            { excludeId: Number(item?.series_id) }
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
        const recommendations = this.selectedItem()?.info?.tmdb_recommendations;
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
                .matchRecommendations(recommendations, 'series', {
                    excludePlaylistId: playlistId,
                })
                .then((items) => {
                    if (
                        this.selectedItem()?.info?.tmdb_recommendations ===
                        recommendations
                    ) {
                        this.crossPortalItems.set(items);
                    }
                });
        });
    });

    constructor() {
        this.playback.bind({ selectedItem: this.selectedItem });

        // TMDB season enrichment, keyed on (tmdb_id, selected season). With
        // season tabs the first seasonSelected fires as soon as seasons load —
        // usually BEFORE the async show-level TMDB match has written
        // info.tmdb_id, and enrichSelectedSerialSeason no-ops without it. So
        // the call must re-run when the match arrives, not only on selection.
        // The store-side enrichment is idempotent per (serial, season).
        effect(() => {
            const tmdbId = this.selectedItem()?.info?.tmdb_id;
            const seasonKey = this.selectedSeasonKey();
            if (tmdbId && seasonKey) {
                untracked(() =>
                    this.xtreamStore.enrichSelectedSerialSeason(seasonKey)
                );
            }
        });

        effect(() => {
            const item = this.xtreamStore.selectedItem() as unknown as
                | (XtreamSerieDetails & {
                      readonly series_id?: string | number;
                  })
                | null;
            this.selectedItem.set(
                item
                    ? {
                          ...item,
                          series_id: Number(item.series_id),
                      }
                    : null
            );
        });

        effect(() => {
            const playlist = this.xtreamStore.currentPlaylist();
            this.currentPlaylistId.set(playlist?.id ?? '');
        });

        // Initializes on first render and RE-initializes when the route
        // params change while the component is reused (Similar rail).
        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const { categoryId, serialId } = this.routeParams();
            if (!playlistId || !serialId) {
                return;
            }

            const initKey = `${playlistId}:${categoryId}:${serialId}`;
            if (this.lastInitKey() === initKey) {
                return;
            }
            this.lastInitKey.set(initKey);

            this.playback.resetForNewSeries();
            this.initializeSerialDetails(playlistId, categoryId, serialId);
        });

        registerContentMetadataBackfill({
            store: this.xtreamStore,
            contentType: 'series',
            playlistId: () => this.currentPlaylistId(),
            xtreamId: () => Number(this.selectedItem()?.series_id ?? 0),
            info: () => this.selectedItem()?.info,
        });
    }

    ngOnInit(): void {
        // Initialization is handled by the params-driven effect in the
        // constructor; the hook remains for interface compatibility.
    }

    ngOnDestroy(): void {
        this.xtreamStore.cancelDetailsRequest();
        this.playback.closeInlinePlayer();
        this.xtreamStore.setSelectedItem(null);
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

    onSeasonSelected(seasonKey: string): void {
        // The enrichment call itself runs from the constructor effect keyed
        // on (tmdb_id, selectedSeasonKey) — see the race note there.
        this.selectedSeasonKey.set(seasonKey);
    }

    playEpisode(episode: XtreamSerieEpisode): void {
        this.playback.playEpisode(episode);
    }

    playQuickStartEpisode(): void {
        this.playback.playQuickStartEpisode();
    }

    playPreviousEpisode(): void {
        this.playback.playPreviousEpisode();
    }

    playNextEpisode(): void {
        this.playback.playNextEpisode();
    }

    playUpNextEpisode(item: UpNextRailItem): void {
        this.playback.playEpisode(item.episode as XtreamSerieEpisode);
    }

    handleInlinePlaybackEnded(): void {
        this.playback.handleInlinePlaybackEnded();
    }

    closeInlinePlayer(): void {
        this.playback.closeInlinePlayer();
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.playback.handleInlineTimeUpdate(event);
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        this.playback.handleExternalFallbackRequest(request);
    }

    handlePlaybackToggleRequested(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        return this.playback.handlePlaybackToggleRequested(request);
    }

    handleSeasonPlaybackToggleRequested(
        request: SeasonContainerSeasonPlaybackToggleRequest
    ): Promise<void> {
        return this.playback.handleWatchToggleRequested(request, 'season');
    }

    handleSeriesPlaybackToggleRequested(
        request: SeasonContainerSeriesPlaybackToggleRequest
    ): Promise<void> {
        return this.playback.handleWatchToggleRequested(request, 'series');
    }

    toggleFavorite(): void {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.serialId,
            playlist.id,
            'series',
            this.selectedItem()?.info?.backdrop_path?.[0]
        );
    }

    getBackdropUrl(info: XtreamSerieInfo): string | undefined {
        return info.backdrop_path?.[0];
    }

    goBack(): void {
        this.playback.closeInlinePlayer();
        this.location.back();
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

    private initializeSerialDetails(
        playlistId: string,
        categoryId: string | number,
        serialId: string
    ): void {
        this.xtreamStore.fetchSerialDetailsWithMetadata({
            serialId,
            categoryId: Number(categoryId),
        });
        const serialXtreamId = Number(serialId);
        this.xtreamStore.checkFavoriteStatus(
            serialXtreamId,
            playlistId,
            'series'
        );
        void this.playback.loadSeriesPlaybackPositions(
            playlistId,
            serialXtreamId
        );
    }
}
