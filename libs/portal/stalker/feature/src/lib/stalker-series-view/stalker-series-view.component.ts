import {
    Component,
    OnDestroy,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { Location } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FavoritesButtonComponent } from '../stalker-favorites-button/stalker-favorites-button.component';
import { StalkerCatalogFacadeService } from '../stalker-catalog-facade.service';
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
    buildSeriesWatchToggleRequest,
} from '@iptvnator/ui/components';
import {
    pickSeasonMarkedTitle,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    seriesStatusLabelKey,
    TmdbEnrichedCastMember,
    XtreamSerieEpisode,
    youtubeEmbedUrl,
} from '@iptvnator/shared/interfaces';
import { SafePipe } from '@iptvnator/pipes';
import {
    isLiveExternalPlayerSession,
    isPortalPlaybackWatched,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    createLogger,
    consumeStalkerReturnMarker,
    createDiscoverFacetNavigation,
    resolveStalkerBackNavigation,
} from '@iptvnator/portal/shared/util';
import {
    getVodSeriesSeasonKey,
    isVodSeriesItem,
    mapRegularSeriesEpisodes,
    mapRegularSeriesSeasons,
    mapVodSeriesEpisodes,
    mapVodSeriesSeasonsToVm,
    StalkerMappedEpisode,
    StalkerSeriesSeasonVm,
    VodSeriesSeasonVm,
    normalizeStalkerEntityId,
    normalizeStalkerVodDetailsItem,
    StalkerSelectedVodItem,
    StalkerStore,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import {
    buildUpNextRailItems,
    getSeriesEpisodeMetadata,
    getSeriesPlaybackNavigation,
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
    type SeriesPlaybackEpisodeState,
    type UpNextRailItem,
} from '@iptvnator/ui/playback';
import {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
    PlaybackPositionRuntimeBridgeService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { StalkerSeriesTmdbSeasonsService } from './stalker-series-tmdb-seasons.service';
import {
    getStalkerSeriesQuickStartButton,
    type StalkerQuickStartButton,
} from './stalker-series-quick-start';
import {
    clearStalkerSeriesPosition,
    reconcileStalkerSeriesPositions,
    saveStalkerSeriesPosition,
    StalkerSeriesPositionPartialSaveError,
} from './stalker-series-position-compatibility';
import {
    createStalkerSeriesDownloadAdapter,
    STALKER_SERIES_DOWNLOAD_MODES,
} from './stalker-series-download.adapter';
import {
    captureStalkerEpisodePlaybackSessionIdentity,
    resolveSelectedStalkerEpisodeState,
    resolveStalkerEpisodeStateByIdentity,
    resolveStalkerEpisodeStateByStructuralIdentity,
    toStalkerEpisodePlaybackStructuralIdentity,
    type StalkerEpisodePlaybackSessionIdentity,
    type StalkerEpisodePlaybackStructuralIdentity,
} from './stalker-episode-playback-session-key';

interface SeriesPositionContext {
    readonly generation: number;
    readonly playlistId: string;
    readonly seriesXtreamId: number;
    readonly mutationKey: string;
}

interface StalkerWatchToggleFeedback {
    readonly marked: string;
    readonly unmarked: string;
    readonly partialMarked: string;
    readonly partialUnmarked: string;
    readonly failed: string;
}

// The marked and partial keys are scope-generic on purpose ("{{count}}
// episodes marked as watched", "{{count}} marked · {{failed}} failed");
// only unmark-success and failure name their scope.
const SEASON_WATCH_FEEDBACK: StalkerWatchToggleFeedback = {
    marked: 'XTREAM.SEASON_MARKED_WATCHED',
    unmarked: 'XTREAM.SEASON_MARKED_UNWATCHED',
    partialMarked: 'XTREAM.SEASON_MARKED_WATCHED_PARTIAL',
    partialUnmarked: 'XTREAM.SEASON_MARKED_UNWATCHED_PARTIAL',
    failed: 'XTREAM.SEASON_WATCH_UPDATE_FAILED',
};

const SERIES_WATCH_FEEDBACK: StalkerWatchToggleFeedback = {
    marked: 'XTREAM.SEASON_MARKED_WATCHED',
    unmarked: 'XTREAM.SERIES_MARKED_UNWATCHED',
    partialMarked: 'XTREAM.SEASON_MARKED_WATCHED_PARTIAL',
    partialUnmarked: 'XTREAM.SEASON_MARKED_UNWATCHED_PARTIAL',
    failed: 'XTREAM.SERIES_WATCH_UPDATE_FAILED',
};

interface StalkerSeriesPlaybackRequestContext {
    readonly generation: number;
    readonly usesEmbeddedPlayer: boolean;
    readonly identity: StalkerEpisodePlaybackSessionIdentity | null;
}

/**
 * Component for displaying series/episodes for Stalker portal content.
 * Supports three modes:
 * 1. Regular series (type=series): Fetches seasons from API via serialSeasonsResource
 * 2. VOD with embedded series (vclub): Uses the series array from the vodWithSeries input
 * 3. VOD series (Ministra is_series=1): Fetches seasons/episodes using movie_id and season_id
 */
@Component({
    selector: 'app-stalker-series-view',
    templateUrl: './stalker-series-view.component.html',
    styleUrls: ['../styles/detail-view.scss'],
    imports: [
        FavoritesButtonComponent,
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        PortalDetailShellComponent,
        ViewInPortalActionComponent,
        PortalInlinePlayerComponent,
        SafePipe,
        TranslatePipe,
        SeasonContainerComponent,
        MatIcon,
    ],
    providers: [StalkerSeriesTmdbSeasonsService],
})
export class StalkerSeriesViewComponent implements OnDestroy {
    readonly stalkerStore = inject(StalkerStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly migrationPlaybackPositions = {
        savePlaybackPosition: (
            playlistId: string,
            data: PlaybackPositionData
        ) =>
            this.playbackPositions.savePlaybackPositionOrThrow(
                playlistId,
                data
            ),
        clearPlaybackPosition: (
            playlistId: string,
            contentXtreamId: number,
            contentType: 'vod' | 'episode'
        ) =>
            this.playbackPositions.clearPlaybackPositionOrThrow(
                playlistId,
                contentXtreamId,
                contentType
            ),
    };
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly router = inject(Router);
    private readonly location = inject(Location);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly playbackPositionBridge = inject(
        PlaybackPositionRuntimeBridgeService
    );
    private readonly snackBar = inject(MatSnackBar);
    // Optional: absent in collection-detail mounts outside the catalog.
    private readonly catalogFacade = inject(StalkerCatalogFacadeService, {
        optional: true,
    });
    private readonly translateService = inject(TranslateService);
    readonly backClicked = output<void>();
    private readonly logger = createLogger('StalkerSeriesView');
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly episodePlaybackPositions = signal<
        Map<number, PlaybackPositionData>
    >(new Map());
    private readonly rawSeriesPositions = signal<
        readonly PlaybackPositionData[]
    >([]);
    private readonly legacyPositionByTrackingId = signal<
        Map<number, PlaybackPositionData>
    >(new Map());
    private activeSeriesPositionContext: SeriesPositionContext | null = null;
    private seriesPositionContextGeneration = 0;
    private readonly seriesPositionMutationQueues = new Map<
        string,
        Promise<void>
    >();
    private readonly pendingSeriesPositionLoads = new Map<
        SeriesPositionContext,
        Set<number>
    >();
    private readonly seriesPositionReloadKeys = new Set<string>();
    private seriesPositionsLoadGeneration = 0;
    private seriesPlaybackRequestGeneration = 0;
    private currentSeriesPlaybackOwnerKey = '';
    private readonly inlinePlaybackEpisodeIdentity =
        signal<StalkerEpisodePlaybackStructuralIdentity | null>(null);
    private lastSaveTime = 0;
    private unsubscribePositionUpdates: (() => void) | null = null;
    readonly openingEpisodeId = signal<number | null>(null);
    readonly activeEpisodeId = signal<number | null>(null);
    readonly seasonWatchBatchRunning = signal(false);

    /**
     * Optional input for VOD items with embedded series array (vclub mode)
     * When provided, uses this instead of fetching seasons from API
     */
    readonly vodWithSeries = input<StalkerVodSource | null>(null);
    readonly providerOnly = input(false);

    readonly selectedItem = this.stalkerStore.selectedItem;

    private readonly tmdbSeasons = inject(StalkerSeriesTmdbSeasonsService);
    private readonly crossPortalSimilar = inject(CrossPortalSimilarService);

    /** Maps the status token to its translated label key */
    readonly seriesStatusLabelKey = seriesStatusLabelKey;

    /**
     * TMDB recommendations found in the user's Xtream portals (batched DB
     * match, Electron only) — Stalker catalogs are server-paginated, so
     * "Similar" can only point at OTHER portals' libraries.
     */
    readonly similarInPortals = signal<CrossPortalSimilarItem[]>([]);
    private readonly loadSimilarInPortals = effect(() => {
        const recommendations = this.displayItem()?.info?.tmdb_recommendations;
        untracked(() => {
            this.similarInPortals.set([]);
            if (
                !recommendations?.length ||
                !this.crossPortalSimilar.isAvailable
            ) {
                return;
            }
            void this.crossPortalSimilar
                .matchRecommendations(recommendations, 'series')
                .then((items) => {
                    if (
                        this.displayItem()?.info?.tmdb_recommendations ===
                        recommendations
                    ) {
                        this.similarInPortals.set(items);
                    }
                });
        });
    });

    /**
     * Season currently selected in the season container. Deliberately NOT
     * reset on detail-to-detail navigation: the season container keeps its
     * own selection and deduplicates `seasonSelected` emissions, so when
     * two items share the same season-key set (commonly just "1") it never
     * re-emits — a parent-side reset would leave the new item permanently
     * unenriched. Stale-context safety lives in the fetch effect's
     * coherence gates instead (see the constructor).
     */
    private readonly selectedSeasonKey = signal<string | null>(null);

    /** Season descriptions for the season tabs (TMDB overview per season). */
    readonly seasonDescriptions = computed<Record<string, string>>(() =>
        this.tmdbSeasons.descriptions(this.displayItem()?.info?.tmdb_id)
    );

    /**
     * Track VOD series seasons with their loaded episodes
     */
    readonly vodSeriesSeasons = signal<VodSeriesSeasonVm[]>([]);

    /**
     * Indicates if this is a VOD series item (Ministra is_series=1)
     * Note: is_series can be true, 1, or "1" depending on the source
     */
    readonly isVodSeries = computed(() => {
        return (
            this.stalkerStore.selectedContentType() === 'vod' &&
            isVodSeriesItem(this.displayItem())
        );
    });

    /**
     * Loading state for VOD series seasons
     */
    readonly isVodSeriesSeasonsLoading =
        this.stalkerStore.isVodSeriesSeasonsLoading;

    /**
     * Loading state for regular series seasons
     */
    readonly isSerialSeasonsLoading = this.stalkerStore.isSerialSeasonsLoading;

    constructor() {
        effect(() => {
            const ownerKey = this.seriesPlaybackOwnerKey();
            untracked(() => this.syncSeriesPlaybackOwner(ownerKey));
        });

        // TMDB season fetch, keyed on (tmdb_id, selected season). With season
        // tabs the first seasonSelected fires immediately when seasons load —
        // usually BEFORE the async show-level TMDB enrichment has written
        // tmdb_id — so the fetch must re-run when the match arrives, not only
        // on selection. fetchSeason is idempotent per (tmdbId, season).
        effect(() => {
            const item = this.displayItem();
            const tmdbId = item?.info?.tmdb_id;
            const seasonKey = this.selectedSeasonKey();
            // Coherence gates instead of timing assumptions. All inputs are
            // read TRACKED so the effect re-runs as each one settles:
            // - the season resource must not be mid-reload — during
            //   detail-to-detail navigation a reused component briefly
            //   pairs the NEW item's tmdb_id with the PREVIOUS item's map
            // - the selected key must exist in the map with episodes — an
            //   empty map would pass seasonCount 0 (suppressing the
            //   title-marker override), and a key retained from the
            //   previous item is only usable when the new item has that
            //   season too (otherwise the container's auto-select re-emits)
            // Re-running on overlay updates cannot loop (fetchSeason skips
            // when its entry already holds the resolved season), and a
            // fetch made with a stale snapshot is overwritten once the
            // real context re-resolves to a different season.
            const seasonsLoading = this.isVodSeries()
                ? this.isVodSeriesSeasonsLoading()
                : this.isSerialSeasonsLoading();
            const seasons = this.mappedSeasons();
            const episodes = seasonKey ? seasons[seasonKey] : undefined;
            if (tmdbId && seasonKey && !seasonsLoading && episodes?.length) {
                untracked(
                    () =>
                        void this.tmdbSeasons.fetchSeason(
                            tmdbId,
                            seasonKey,
                            episodes,
                            {
                                // The season marker can live in either title
                                // field (generic name + descriptive o_name)
                                rawTitle: pickSeasonMarkedTitle(
                                    item?.info?.name,
                                    item?.info?.o_name
                                ),
                                seasonCount: Object.keys(seasons).length,
                            }
                        )
                );
            }
        });

        // Effect to load VOD series seasons when a VOD series item is selected
        effect(() => {
            if (this.isVodSeries()) {
                // Get seasons from the resource
                const seasons = this.stalkerStore.getVodSeriesSeasonsResource();
                this.vodSeriesSeasons.set(
                    mapVodSeriesSeasonsToVm(seasons, this.seriesSeasonTitle())
                );
            } else {
                this.vodSeriesSeasons.set([]);
            }
        });

        // Effect to load playback positions for Stalker series
        effect(() => {
            const item = this.displayItem();
            const playlist = this.stalkerStore.currentPlaylist();
            const normalizedSeriesId = this.toSeriesId(item?.id ?? 0);
            if (item && playlist?._id && normalizedSeriesId > 0) {
                this.logger.debug('Loading positions for series', {
                    id: item.id,
                    seriesId: normalizedSeriesId,
                    isSeries: item.is_series,
                });
                this.rawSeriesPositions.set([]);
                this.episodePlaybackPositions.set(new Map());
                this.legacyPositionByTrackingId.set(new Map());
                const context = this.activateSeriesPositionContext(
                    playlist._id,
                    normalizedSeriesId
                );
                void this.loadSeriesPositions(context);
            } else {
                this.activeSeriesPositionContext = null;
                this.seriesPositionContextGeneration++;
                this.seriesPositionsLoadGeneration++;
            }
        });

        effect(() => {
            this.applyReconciledSeriesPositions();
        });

        effect(() => {
            const session = this.externalPlayback.activeSession();
            const item = this.displayItem();
            const playlistId = this.stalkerStore.currentPlaylist()?._id;
            const seriesId = item ? this.toSeriesId(item.id) : 0;

            if (
                !session?.contentInfo ||
                !playlistId ||
                !seriesId ||
                session.contentInfo.contentType !== 'episode' ||
                session.contentInfo.playlistId !== playlistId ||
                session.contentInfo.seriesXtreamId !== seriesId
            ) {
                this.openingEpisodeId.set(null);
                this.activeEpisodeId.set(null);
                return;
            }

            if (session.status === 'launching') {
                this.openingEpisodeId.set(session.contentInfo.contentXtreamId);
                this.activeEpisodeId.set(null);
                return;
            }

            if (isLiveExternalPlayerSession(session)) {
                this.openingEpisodeId.set(null);
                this.activeEpisodeId.set(session.contentInfo.contentXtreamId);
                return;
            }

            this.openingEpisodeId.set(null);
            this.activeEpisodeId.set(null);
        });

        this.unsubscribePositionUpdates =
            this.playbackPositionBridge.onPlaybackPositionUpdate(
                (data: PlaybackPositionData) => {
                    const playlistId = this.stalkerStore.currentPlaylist()?._id;
                    const item = this.displayItem();
                    const seriesId = item ? this.toSeriesId(item.id) : 0;

                    if (
                        !playlistId ||
                        data.contentType !== 'episode' ||
                        data.playlistId !== playlistId ||
                        data.seriesXtreamId !== seriesId
                    ) {
                        return;
                    }

                    // The facade/runtime already saved this row. Repeat the
                    // idempotent upsert because only this view owns the
                    // scoped-to-legacy cleanup mapping.
                    void this.persistSeriesPosition(playlistId, data).catch(
                        (error: unknown) => {
                            this.logger.error(
                                'Failed to persist runtime series position',
                                error
                            );
                        }
                    );
                }
            ) ?? null;
    }

    /**
     * For VOD with embedded series, we create a single "season" with the episodes
     * For regular series, we use the API-fetched seasons
     */
    readonly regularSeasons = computed<StalkerSeriesSeasonVm[]>(() =>
        mapRegularSeriesSeasons(
            this.vodWithSeries(),
            this.stalkerStore.getSerialSeasonsResource()
        )
    );

    /**
     * Get the item to display details for (either vodWithSeries or
     * selectedItem from store). When the input and the store hold the SAME
     * entity, the store copy wins — TMDB enrichment patches the store
     * asynchronously after selection, while the input is a snapshot.
     */
    readonly displayItem = computed<StalkerSelectedVodItem | null>(() => {
        const input = this.vodWithSeries();
        const fromStore = this.selectedItem();
        const sameEntity =
            input &&
            fromStore &&
            normalizeStalkerEntityId(input.id ?? input.stream_id) ===
                normalizeStalkerEntityId(fromStore.id ?? fromStore.stream_id);
        const item = sameEntity ? fromStore : input || fromStore;
        return item ? normalizeStalkerVodDetailsItem(item) : null;
    });

    readonly trailerEmbedUrl = computed(() =>
        youtubeEmbedUrl(this.displayItem()?.info?.tmdb_trailer)
    );

    private readonly seriesSeasonTitle = computed(() =>
        pickSeasonMarkedTitle(
            this.displayItem()?.info?.name,
            this.displayItem()?.info?.o_name
        )
    );

    readonly seriesMode = computed(() =>
        this.isVodSeries()
            ? STALKER_SERIES_DOWNLOAD_MODES.LazyVod
            : this.vodWithSeries()
              ? STALKER_SERIES_DOWNLOAD_MODES.EmbeddedVod
              : STALKER_SERIES_DOWNLOAD_MODES.RegularSeries
    );

    private readonly seriesPlaybackOwnerKey = computed(() => {
        const sourceId = this.stalkerStore.currentPlaylist()?._id?.trim() ?? '';
        const parentSeriesId = normalizeStalkerEntityId(this.displayItem()?.id);
        return sourceId && parentSeriesId
            ? JSON.stringify([sourceId, parentSeriesId, this.seriesMode()])
            : '';
    });

    readonly episodeDownloadAdapter = computed(() => {
        const playlist = this.stalkerStore.currentPlaylist();
        const item = this.displayItem();
        return createStalkerSeriesDownloadAdapter({
            playlist,
            item,
            language:
                this.translateService.currentLang ||
                this.translateService.defaultLang ||
                'en',
            seriesId: this.toSeriesId(item?.id ?? 0),
            seriesMode: this.seriesMode(),
            resolveUrl: (command, episodeNumber) =>
                this.stalkerStore.fetchLinkToPlay(
                    playlist?.portalUrl ?? '',
                    playlist?.macAddress ?? '',
                    command,
                    episodeNumber
                ),
        });
    });

    /**
     * Adapts both Regular and VOD series data into the format expected by SeasonContainerComponent.
     * Record<string, XtreamSerieEpisode[]> where string is season number/name.
     */
    readonly mappedSeasons = computed<Record<string, XtreamSerieEpisode[]>>(
        () => {
            const displayItem = this.displayItem();
            const base = this.isVodSeries()
                ? mapVodSeriesEpisodes(this.vodSeriesSeasons(), {
                      parentSeriesId: this.toSeriesId(displayItem?.id ?? 0),
                      fallbackPoster: displayItem?.info?.movie_image,
                  })
                : mapRegularSeriesEpisodes(
                      this.regularSeasons(),
                      displayItem?.info?.movie_image,
                      this.seriesSeasonTitle()
                  );

            // Overlay lazily fetched TMDB episode data (real names,
            // overviews, stills) — a no-op while nothing is fetched
            return this.tmdbSeasons.overlay(base, displayItem?.info?.tmdb_id);
        }
    );

    readonly quickStartAction = computed<StalkerQuickStartButton | null>(() => {
        return getStalkerSeriesQuickStartButton({
            isVodSeries: this.isVodSeries(),
            mappedSeasons: this.mappedSeasons(),
            playbackPositions: this.episodePlaybackPositions(),
            vodSeriesSeasons: this.vodSeriesSeasons(),
        });
    });
    readonly inlineEpisodeState = computed(() => {
        const identity = this.inlinePlaybackEpisodeIdentity();
        const sourceId = this.stalkerStore.currentPlaylist()?._id?.trim() ?? '';
        const parentSeriesId = normalizeStalkerEntityId(this.displayItem()?.id);
        if (
            !identity ||
            this.playbackSessionKey() !== identity.sessionKey ||
            sourceId !== identity.sourceId ||
            parentSeriesId !== identity.parentSeriesId ||
            this.seriesMode() !== identity.seriesMode
        ) {
            return null;
        }
        return resolveStalkerEpisodeStateByStructuralIdentity({
            episodesBySeason: this.mappedSeasons(),
            identity,
        });
    });
    readonly playbackSessionKey = signal('');
    readonly inlineEpisodeMetadata = computed(() =>
        getSeriesEpisodeMetadata(this.inlineEpisodeState())
    );
    readonly inlineSeriesNavigation = computed(() =>
        getSeriesPlaybackNavigation(this.inlineEpisodeState())
    );
    /** "Up Next" rail entries for the inline player (series only). */
    readonly upNextEpisodes = computed<UpNextRailItem[]>(() =>
        buildUpNextRailItems({
            episodesBySeason: this.mappedSeasons(),
            currentEpisodeId: this.inlineEpisodeState()?.episode.id,
            playbackPositions: this.episodePlaybackPositions(),
        })
    );

    /**
     * Seasons the portal has already answered for on the rail's behalf. An
     * answered-but-empty season is a real answer, so it is recorded here and
     * never asked for again — otherwise the effect below would re-request it
     * on every emission for as long as playback continues.
     */
    private readonly prefetchedSpilloverSeasonIds = new Set<string>();
    /**
     * The last spillover request that *failed*, tagged with the episode that
     * triggered it. A failure is not permanent (it may be a transient network
     * or authorization error), but retrying immediately would loop: the
     * failure itself flips `isLoading` and re-runs the effect. Pinning it to
     * the episode defers the retry to the next playback change instead.
     */
    private spilloverPrefetchFailure: {
        key: string;
        episodeId: string | number;
    } | null = null;

    /**
     * Ministra VOD-series seasons hold no episodes until their tab is opened,
     * so the rail's next-season spillover would silently stop at the end of
     * the playing season. While an episode plays inline, fetch the following
     * season's episodes so the spillover is actually there.
     */
    private readonly prefetchRailSpilloverSeason = effect(() => {
        const episodeState = this.inlineEpisodeState();
        const seasonKey = episodeState?.seasonKey;
        const seasons = this.vodSeriesSeasons();
        if (!this.isVodSeries() || !seasonKey) {
            return;
        }

        const currentIndex = seasons.findIndex(
            (season) => getVodSeriesSeasonKey(season) === seasonKey
        );
        const nextSeason =
            currentIndex >= 0 ? seasons[currentIndex + 1] : undefined;
        if (!nextSeason || nextSeason.isLoading || nextSeason.episodes.length) {
            return;
        }

        const prefetchKey = `${nextSeason.video_id}:${nextSeason.id}`;
        const episodeId = episodeState.episode.id;
        if (
            this.prefetchedSpilloverSeasonIds.has(prefetchKey) ||
            (this.spilloverPrefetchFailure?.key === prefetchKey &&
                this.spilloverPrefetchFailure.episodeId === episodeId)
        ) {
            return;
        }

        // Claim the season synchronously: awaiting first would let the
        // `isLoading` flip re-run this effect and fire a duplicate request
        // before the answer arrives. A failure releases the claim below.
        this.prefetchedSpilloverSeasonIds.add(prefetchKey);

        untracked(
            () =>
                void this.loadEpisodesForSeason(nextSeason).then((answered) => {
                    if (answered) {
                        this.spilloverPrefetchFailure = null;
                        return;
                    }

                    this.spilloverPrefetchFailure = {
                        key: prefetchKey,
                        episodeId,
                    };
                    this.prefetchedSpilloverSeasonIds.delete(prefetchKey);
                })
        );
    });

    /**
     * Handles season selection from the container.
     * For VOD Series, triggers lazy loading of episodes.
     */
    onSeasonSelected(seasonKey: string) {
        // The TMDB fetch itself runs from the constructor effect keyed on
        // (tmdb_id, selectedSeasonKey) — see the race note there.
        this.selectedSeasonKey.set(seasonKey);

        if (!this.isVodSeries()) return;

        const seasons = this.vodSeriesSeasons();
        const season = seasons.find(
            (s) => getVodSeriesSeasonKey(s) === seasonKey
        );

        if (season && season.episodes.length === 0) {
            this.loadEpisodesForSeason(season);
        }
    }

    private readonly vodSeasonEpisodeLoads = new Map<
        string,
        { season: VodSeriesSeasonVm; promise: Promise<boolean> }
    >();

    /**
     * Loads episodes for a specific VOD season.
     *
     * Single-flight per season: a tab click, the spillover prefetch, the
     * quick-start recursion, and the series-toggle hydration can all ask for
     * the same season — a second concurrent request would duplicate portal
     * traffic, and its failure could abort a series toggle whose original
     * request succeeded.
     */
    /** Resolves true when the portal answered, false when the request failed. */
    loadEpisodesForSeason(season: VodSeriesSeasonVm): Promise<boolean> {
        const key = JSON.stringify([
            this.seriesPlaybackOwnerKey(),
            season.video_id,
            season.id,
            getVodSeriesSeasonKey(season),
        ]);
        const inFlight = this.vodSeasonEpisodeLoads.get(key);
        if (inFlight && this.vodSeriesSeasons().includes(inFlight.season)) {
            return inFlight.promise;
        }
        const load = this.fetchEpisodesForSeason(season).finally(() => {
            if (this.vodSeasonEpisodeLoads.get(key)?.promise === load) {
                this.vodSeasonEpisodeLoads.delete(key);
            }
        });
        const loadingSeason = this.vodSeriesSeasons().find(
            (candidate) =>
                candidate.id === season.id &&
                candidate.video_id === season.video_id
        );
        if (loadingSeason) {
            this.vodSeasonEpisodeLoads.set(key, {
                season: loadingSeason,
                promise: load,
            });
        }
        return load;
    }

    private async fetchEpisodesForSeason(
        season: VodSeriesSeasonVm
    ): Promise<boolean> {
        // Set loading state in local signal
        const seasons = this.vodSeriesSeasons();
        const index = seasons.findIndex(
            (s) =>
                s.id === season.id &&
                s.video_id === season.video_id &&
                getVodSeriesSeasonKey(s) === getVodSeriesSeasonKey(season)
        );
        if (index === -1) return false;

        const updatedSeasons = [...seasons];
        const loadingSeason = { ...updatedSeasons[index], isLoading: true };
        updatedSeasons[index] = loadingSeason;
        this.vodSeriesSeasons.set(updatedSeasons);

        try {
            const episodes = await this.stalkerStore.fetchVodSeriesEpisodes(
                season.video_id,
                season.id
            );

            // Update with loaded episodes
            const newSeasons = [...this.vodSeriesSeasons()];
            // Only the exact loading VM owns this response. A navigation or
            // refresh can reuse provider ids while replacing the season list.
            const newIndex = newSeasons.indexOf(loadingSeason);
            if (newIndex !== -1) {
                newSeasons[newIndex] = {
                    ...newSeasons[newIndex],
                    episodes: episodes,
                    // Even an EMPTY answer marks the season loaded: the
                    // portal spoke, so it must stop counting as "unloaded"
                    // (label/verdict gating and series-toggle hydration).
                    episodesLoaded: true,
                    isLoading: false,
                };
                this.vodSeriesSeasons.set(newSeasons);
            }
            return newIndex !== -1;
        } catch (error) {
            this.logger.error('Failed to load episodes', error);
            const newSeasons = [...this.vodSeriesSeasons()];
            const newIndex = newSeasons.indexOf(loadingSeason);
            if (newIndex !== -1) {
                newSeasons[newIndex] = {
                    ...newSeasons[newIndex],
                    isLoading: false,
                };
                this.vodSeriesSeasons.set(newSeasons);
            }
            return false;
        }
    }

    /**
     * Determines if the current selected season is loading
     */
    isCurrentSeasonLoading(seasonKey?: string): boolean {
        if (!seasonKey) return false;
        if (!this.isVodSeries()) return false;
        const season = this.vodSeriesSeasons().find(
            (s) => getVodSeriesSeasonKey(s) === seasonKey
        );
        return season?.isLoading ?? false;
    }

    /**
     * Handles episode click from the container
     */
    onEpisodeClicked(episode: XtreamSerieEpisode) {
        const item = this.displayItem();
        const episodeState = resolveSelectedStalkerEpisodeState({
            episodesBySeason: this.mappedSeasons(),
            episode,
        });
        if (!item || !episodeState) return;
        this.syncSeriesPlaybackOwner(this.seriesPlaybackOwnerKey());

        const mappedEpisode = episodeState.episode as StalkerMappedEpisode;
        const isLazyVod = mappedEpisode.custom_sid === 'vod-series';
        const command = isLazyVod
            ? `/media/file_${mappedEpisode.originalId ?? ''}.mpg`
            : mappedEpisode.originalCmd;
        const title = isLazyVod
            ? `${item.info.name} - ${mappedEpisode.title || `Episode ${episodeState.episodeNumber}`}`
            : item.info.name;
        const trackingId = Number(mappedEpisode.id);
        const startTime =
            this.episodePlaybackPositions().get(trackingId)?.positionSeconds;

        void this.startPlayback(
            command,
            title,
            item.info.movie_image,
            episodeState,
            startTime
        );
    }

    async playQuickStartEpisode(): Promise<void> {
        const quickStart = this.quickStartAction();
        if (!quickStart || quickStart.disabled) {
            return;
        }

        if (quickStart.action) {
            this.onEpisodeClicked(quickStart.action.episode);
            return;
        }

        if (quickStart.lazySeason) {
            await this.loadAndPlayVodSeriesSeason(quickStart.lazySeason);
        }
    }

    openSimilarInPortals(item: CrossPortalSimilarItem): void {
        void this.router.navigate(this.crossPortalSimilar.buildLink(item));
    }

    openActor(member: TmdbEnrichedCastMember): void {
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (!playlistId || !member.tmdbPersonId) {
            return;
        }
        void this.router.navigate([
            '/workspace/stalker',
            playlistId,
            'actor',
            member.tmdbPersonId,
        ]);
    }

    /** Clickable year/genre/country chips (Discover pages) */
    private readonly tmdbEnrichment = inject(TmdbEnrichmentService);

    readonly discover = createDiscoverFacetNavigation(() => {
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        // Discover reads its results from TMDB, so a chip must not offer a
        // page that enrichment cannot fill
        return playlistId && this.tmdbEnrichment.isEnabled()
            ? { portal: 'stalker', mediaType: 'tv', playlistId }
            : null;
    });

    goBack() {
        const back = resolveStalkerBackNavigation(
            window.history.state,
            this.stalkerStore.selectedItem()
        );
        // Closing the detail is unconditional: a `none` decision (no return
        // target, or a marker left by an earlier handoff) still returns the
        // user to the category list — it only suppresses the navigation.
        this.closeInlinePlayer();
        this.backClicked.emit();
        this.stalkerStore.clearSelectedItem();

        if (back.kind === 'history-back') {
            // One-shot: retire the contract so a browser Forward onto this
            // entry cannot replay it for a freshly opened title.
            consumeStalkerReturnMarker();
            this.location.back();
        } else if (back.kind === 'navigate') {
            void this.router.navigateByUrl(back.url);
        }
    }

    toSeriesId(id: string | number): number {
        const raw = String(id ?? '').trim();
        if (!raw) return 0;
        const primary = raw.includes(':') ? raw.split(':')[0] : raw;
        const parsed = Number(primary);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    closeInlinePlayer(): void {
        this.seriesPlaybackRequestGeneration += 1;
        this.inlinePlayback.set(null);
        this.inlinePlaybackEpisodeIdentity.set(null);
        this.playbackSessionKey.set('');
        this.lastSaveTime = 0;
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.inlinePlayback();
        if (!playback?.contentInfo) return;

        const now = Date.now();
        if (now - this.lastSaveTime <= 15000) return;

        this.lastSaveTime = now;
        const position: PlaybackPositionData = {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        };
        void this.persistSeriesPosition(
            playback.contentInfo.playlistId,
            position
        ).catch((error: unknown) => {
            this.logger.error(
                'Failed to persist inline series position',
                error
            );
        });
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
        const launch = this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
        request.trackLaunch(launch);
        void launch;
    }

    playPreviousEpisode(): void {
        const previous = this.inlineEpisodeState()?.previous;
        if (!previous) {
            return;
        }
        this.onEpisodeClicked(previous);
    }

    playNextEpisode(): void {
        const next = this.inlineEpisodeState()?.next;
        if (!next) {
            return;
        }
        this.onEpisodeClicked(next);
    }

    playUpNextEpisode(item: UpNextRailItem): void {
        this.onEpisodeClicked(item.episode as XtreamSerieEpisode);
    }

    handleInlinePlaybackEnded(): void {
        const navigation = this.inlineSeriesNavigation();
        if (!navigation?.autoplayEnabled || !navigation.canNext) {
            return;
        }
        this.playNextEpisode();
    }

    private async startPlayback(
        cmd: string | undefined,
        title: string | undefined,
        thumbnail: string | undefined,
        episodeState: SeriesPlaybackEpisodeState<XtreamSerieEpisode>,
        startTime?: number
    ): Promise<void> {
        const generation = ++this.seriesPlaybackRequestGeneration;
        const episodeNum = episodeState.episodeNumber;
        const episodeId = Number(episodeState.episode.id);
        const request: StalkerSeriesPlaybackRequestContext = {
            generation,
            usesEmbeddedPlayer: this.portalPlayer.isEmbeddedPlayer(),
            identity: captureStalkerEpisodePlaybackSessionIdentity({
                sourceId: this.stalkerStore.currentPlaylist()?._id,
                parentSeriesId: this.displayItem()?.id,
                seriesMode: this.seriesMode(),
                episodeState,
            }),
        };
        if (request.usesEmbeddedPlayer && !request.identity) return;

        try {
            const playback = await this.stalkerStore.resolveVodPlayback(
                cmd,
                title,
                thumbnail,
                episodeNum,
                episodeId,
                startTime
            );
            if (!this.isPlaybackRequestCurrent(request)) return;

            const resolvedPlayback =
                episodeState && playback.contentInfo?.contentType === 'episode'
                    ? {
                          ...playback,
                          contentInfo: {
                              ...playback.contentInfo,
                              seasonNumber: episodeState.seasonNumber,
                              episodeNumber: episodeState.episodeNumber,
                          },
                      }
                    : playback;

            this.lastSaveTime = 0;
            if (request.usesEmbeddedPlayer && request.identity) {
                this.setInlinePlayback(resolvedPlayback, request.identity);
                return;
            }

            this.closeInlinePlayer();
            void this.portalPlayer.openResolvedPlayback(resolvedPlayback, true);
        } catch (error) {
            if (!this.isPlaybackRequestCurrent(request)) return;
            this.logger.error('Failed to start inline series playback', error);
            const errorMessage =
                error instanceof Error && error.message === 'nothing_to_play'
                    ? this.translateService.instant(
                          'PORTALS.CONTENT_NOT_AVAILABLE'
                      )
                    : this.translateService.instant('PORTALS.PLAYBACK_ERROR');
            this.snackBar.open(errorMessage, undefined, {
                duration: 3000,
            });
        }
    }

    private isPlaybackRequestCurrent(
        request: StalkerSeriesPlaybackRequestContext
    ): boolean {
        if (request.generation !== this.seriesPlaybackRequestGeneration) {
            return false;
        }
        if (!request.identity) return true;

        const identity = request.identity;
        const episodeState = resolveStalkerEpisodeStateByIdentity({
            episodesBySeason: this.mappedSeasons(),
            identity,
        });
        const currentIdentity = captureStalkerEpisodePlaybackSessionIdentity({
            sourceId: this.stalkerStore.currentPlaylist()?._id,
            parentSeriesId: this.displayItem()?.id,
            seriesMode: this.seriesMode(),
            episodeState,
        });
        return currentIdentity?.sessionKey === identity.sessionKey;
    }

    ngOnDestroy(): void {
        this.unsubscribePositionUpdates?.();
        this.closeInlinePlayer();
    }

    private setInlinePlayback(
        playback: ResolvedPortalPlayback,
        identity: StalkerEpisodePlaybackSessionIdentity
    ): void {
        this.playbackSessionKey.set(identity.sessionKey);
        this.inlinePlaybackEpisodeIdentity.set(
            toStalkerEpisodePlaybackStructuralIdentity(identity)
        );
        this.inlinePlayback.set(playback);
    }

    private syncSeriesPlaybackOwner(ownerKey: string): void {
        if (ownerKey === this.currentSeriesPlaybackOwnerKey) return;
        this.currentSeriesPlaybackOwnerKey = ownerKey;
        this.closeInlinePlayer();
    }

    async handlePlaybackToggleRequested(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (!playlistId) {
            return;
        }

        if (request.nextPosition) {
            await this.persistSeriesPosition(playlistId, request.nextPosition);
        } else {
            await this.clearSeriesPosition(playlistId, request.contentXtreamId);
        }
        // Keep the catalog grid's progress badge in sync (ownership-checked
        // inside the facade; no-op outside the catalog context). A failed
        // refresh keeps the cache populated-but-stale.
        await this.catalogFacade
            ?.refreshPositions(playlistId)
            .catch((error: unknown) =>
                this.logger.warn('Catalog position refresh failed', error)
            );
    }

    handlePlaybackToggleRequestedFromUi(
        request: SeasonContainerPlaybackToggleRequest
    ): void {
        void this.handlePlaybackToggleRequested(request).catch(
            (error: unknown) => {
                this.logger.error(
                    'Failed to update series playback position',
                    error
                );
            }
        );
    }

    async handleSeasonPlaybackToggleRequested(
        request: SeasonContainerSeasonPlaybackToggleRequest
    ): Promise<void> {
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (
            !playlistId ||
            request.requests.length === 0 ||
            this.seasonWatchBatchRunning()
        ) {
            return;
        }
        // The mutation context already keeps a stale batch out of the next
        // series' state; the snackbars need the same ownership so feedback
        // for the old season is not presented on a newly opened page.
        const seriesXtreamId = this.toSeriesId(this.displayItem()?.id ?? 0);
        const stillCurrent = () =>
            this.stalkerStore.currentPlaylist()?._id === playlistId &&
            this.toSeriesId(this.displayItem()?.id ?? 0) === seriesXtreamId;

        this.seasonWatchBatchRunning.set(true);
        try {
            await this.runWatchToggleBatch(
                request,
                playlistId,
                stillCurrent,
                SEASON_WATCH_FEEDBACK
            );
        } finally {
            this.seasonWatchBatchRunning.set(false);
        }
    }

    handleSeasonPlaybackToggleRequestedFromUi(
        request: SeasonContainerSeasonPlaybackToggleRequest
    ): void {
        void this.handleSeasonPlaybackToggleRequested(request).catch(
            (error: unknown) => {
                this.logger.error(
                    'Failed to toggle season watched state',
                    error
                );
            }
        );
    }

    /**
     * True for a season the portal has never answered for. A season that
     * answered with zero episodes is loaded-and-empty, not pending — treating
     * it as pending would keep the series label countless forever and make
     * every series toggle re-fetch it.
     */
    private isSeasonHydrationPending(season: VodSeriesSeasonVm): boolean {
        return season.episodes.length === 0 && !season.episodesLoaded;
    }

    /** Seasons whose episode lists still need a portal request (lazy VOD). */
    readonly hasUnloadedVodSeasons = computed(
        () =>
            this.isVodSeries() &&
            this.vodSeriesSeasons().some((season) =>
                this.isSeasonHydrationPending(season)
            )
    );

    async handleSeriesPlaybackToggleRequested(
        request: SeasonContainerSeriesPlaybackToggleRequest
    ): Promise<void> {
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (!playlistId || this.seasonWatchBatchRunning()) {
            return;
        }
        const pendingSeasons = this.isVodSeries()
            ? this.vodSeriesSeasons().filter((season) =>
                  this.isSeasonHydrationPending(season)
              )
            : [];
        // An empty request is only meaningful when unloaded seasons remain:
        // every loaded episode is watched, so the container could not build
        // a target list, but hydration below may still surface unwatched
        // episodes to mark.
        if (request.requests.length === 0 && pendingSeasons.length === 0) {
            return;
        }

        const seriesXtreamId = this.toSeriesId(this.displayItem()?.id ?? 0);
        const stillCurrent = () =>
            this.stalkerStore.currentPlaylist()?._id === playlistId &&
            this.toSeriesId(this.displayItem()?.id ?? 0) === seriesXtreamId;

        this.seasonWatchBatchRunning.set(true);
        try {
            let effective: SeasonContainerSeriesPlaybackToggleRequest | null =
                request;
            if (pendingSeasons.length > 0) {
                const hydrated = await this.hydrateSeasonsForSeriesToggle(
                    pendingSeasons,
                    stillCurrent
                );
                if (hydrated !== 'complete') {
                    if (hydrated === 'failed' && stillCurrent()) {
                        this.notifySeasonWatchToggle(
                            SERIES_WATCH_FEEDBACK.failed
                        );
                    }
                    return;
                }
                // The reconcile effect only flushes on the next change-
                // detection tick; rebuild the maps synchronously so the
                // batch below sees the hydrated episodes' scoped and legacy
                // rows (see applyReconciledSeriesPositions).
                this.applyReconciledSeriesPositions();
                effective = buildSeriesWatchToggleRequest({
                    seasons: this.mappedSeasons(),
                    seriesId: seriesXtreamId,
                    playlistId,
                    isEpisodeWatched: (episode) =>
                        isPortalPlaybackWatched(
                            this.episodePlaybackPositions().get(
                                Number(episode.id)
                            )
                        ),
                    excludedEpisodeIds: this.seriesWatchExcludedIds(),
                    // Keep the direction the user clicked; re-inference over
                    // the now-complete data could flip a "mark" into an
                    // unwatch when everything turned out watched.
                    markWatched: request.markWatched,
                });
                if (!effective) {
                    if (stillCurrent()) {
                        this.notifySeasonWatchToggle(
                            SERIES_WATCH_FEEDBACK.marked,
                            { count: 0 }
                        );
                    }
                    return;
                }
            }

            await this.runWatchToggleBatch(
                effective,
                playlistId,
                stillCurrent,
                SERIES_WATCH_FEEDBACK
            );
        } finally {
            this.seasonWatchBatchRunning.set(false);
        }
    }

    handleSeriesPlaybackToggleRequestedFromUi(
        request: SeasonContainerSeriesPlaybackToggleRequest
    ): void {
        void this.handleSeriesPlaybackToggleRequested(request).catch(
            (error: unknown) => {
                this.logger.error(
                    'Failed to toggle series watched state',
                    error
                );
            }
        );
    }

    /**
     * Sequential on purpose: loadEpisodesForSeason snapshots the season VM
     * array before its writes, so concurrent calls clobber each other's
     * loading flags; and one request at a time keeps the portal load bounded.
     */
    private async hydrateSeasonsForSeriesToggle(
        pendingSeasons: readonly VodSeriesSeasonVm[],
        stillCurrent: () => boolean
    ): Promise<'complete' | 'failed' | 'superseded'> {
        for (const season of pendingSeasons) {
            // A tab click may have loaded this season meanwhile.
            const current = this.vodSeriesSeasons().find(
                (candidate) => candidate.id === season.id
            );
            if (!current || !this.isSeasonHydrationPending(current)) {
                continue;
            }
            const answered = await this.loadEpisodesForSeason(current);
            if (!stillCurrent()) {
                return 'superseded';
            }
            if (!answered) {
                return 'failed';
            }
        }
        return 'complete';
    }

    /**
     * Mirrors the exclusions the template binds into the season container
     * (playingEpisodeId / activeEpisodeId / openingEpisodeId): the episode
     * playing or launching is never bulk-marked, because its live position
     * ticks would immediately overwrite the full-progress row.
     */
    private seriesWatchExcludedIds(): ReadonlySet<number> {
        const ids = [
            this.openingEpisodeId(),
            this.activeEpisodeId(),
            this.inlinePlayback()?.contentInfo?.contentXtreamId ?? null,
        ].filter((id): id is number => id !== null);
        return new Set(ids);
    }

    private async runWatchToggleBatch(
        request: SeasonContainerSeriesPlaybackToggleRequest,
        playlistId: string,
        stillCurrent: () => boolean,
        feedback: StalkerWatchToggleFeedback
    ): Promise<void> {
        // Enqueue every episode synchronously: each mutation chains on
        // the previous one's never-rejecting barrier, so the queue
        // serializes the writes (incl. per-episode legacy-row cleanup)
        // and reloads positions once after the whole chain drains.
        const outcomes = await Promise.all(
            request.requests.map((item) =>
                (item.nextPosition
                    ? this.persistSeriesPosition(playlistId, item.nextPosition)
                    : this.clearSeriesPosition(
                          playlistId,
                          item.contentXtreamId
                      )
                ).then(
                    () => true,
                    // The scoped watched row was saved and published —
                    // only the legacy-row cleanup failed. The episode IS
                    // watched, so it must not count against the batch.
                    (error: unknown) =>
                        error instanceof StalkerSeriesPositionPartialSaveError
                )
            )
        );

        const failed = outcomes.filter((ok) => !ok).length;
        const succeeded = outcomes.length - failed;
        if (failed > 0) {
            this.logger.error(
                `Watched toggle: ${failed} of ${outcomes.length} episodes failed`
            );
        }
        if (succeeded > 0) {
            // Partial successes changed rows too — the catalog badge
            // must follow even when the user already moved on. A failed
            // refresh must not break the feedback flow below.
            await this.catalogFacade
                ?.refreshPositions(playlistId)
                .catch((error: unknown) =>
                    this.logger.warn('Catalog position refresh failed', error)
                );
        }
        if (!stillCurrent()) {
            return;
        }

        if (failed === 0) {
            this.notifySeasonWatchToggle(
                request.markWatched ? feedback.marked : feedback.unmarked,
                { count: succeeded }
            );
        } else if (succeeded > 0) {
            this.notifySeasonWatchToggle(
                request.markWatched
                    ? feedback.partialMarked
                    : feedback.partialUnmarked,
                { count: succeeded, failed }
            );
        } else {
            this.notifySeasonWatchToggle(feedback.failed);
        }
    }

    /**
     * Maps the raw series position rows onto the currently mapped episodes
     * (scoped rows plus compatible legacy promotions). Runs reactively from
     * the constructor effect, and synchronously from the series-level watch
     * toggle right after it hydrates lazy seasons — the effect only re-runs
     * on the next change-detection tick, and enqueuing the batch against the
     * stale maps would miss the hydrated episodes' legacy rows (an unwatch
     * would leave rows behind that a later reconcile resurrects as watched).
     */
    private applyReconciledSeriesPositions(): void {
        const item = this.displayItem();
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        const seriesXtreamId = this.toSeriesId(item?.id ?? 0);
        const rawSeriesPositions = this.rawSeriesPositions();
        const episodesBySeason = this.mappedSeasons();

        if (!item || !playlistId || seriesXtreamId <= 0) {
            if (rawSeriesPositions.length > 0) {
                this.rawSeriesPositions.set([]);
            }
            if (this.episodePlaybackPositions().size > 0) {
                this.episodePlaybackPositions.set(new Map());
            }
            if (this.legacyPositionByTrackingId().size > 0) {
                this.legacyPositionByTrackingId.set(new Map());
            }
            return;
        }

        const reconciled = reconcileStalkerSeriesPositions({
            seriesXtreamId,
            episodesBySeason,
            seriesPositions: rawSeriesPositions,
        });
        if (
            rawSeriesPositions.length === 0 &&
            reconciled.positionsByTrackingId.size === 0 &&
            untracked(() => this.episodePlaybackPositions().size) > 0
        ) {
            return;
        }
        this.episodePlaybackPositions.set(reconciled.positionsByTrackingId);
        this.legacyPositionByTrackingId.set(
            reconciled.legacyPositionByTrackingId
        );
    }

    private notifySeasonWatchToggle(key: string, params?: object): void {
        this.snackBar.open(
            this.translateService.instant(key, params),
            undefined,
            { duration: 5000 }
        );
    }

    private async loadSeriesPositions(
        context: SeriesPositionContext
    ): Promise<void> {
        const generation = ++this.seriesPositionsLoadGeneration;
        this.trackPendingSeriesPositionLoad(context, generation);
        try {
            await this.waitForSeriesPositionMutations(context.mutationKey);

            if (
                generation !== this.seriesPositionsLoadGeneration ||
                !this.isSeriesPositionContextActive(context)
            ) {
                return;
            }

            const positions =
                await this.playbackPositions.getSeriesPlaybackPositions(
                    context.playlistId,
                    context.seriesXtreamId
                );

            if (
                generation !== this.seriesPositionsLoadGeneration ||
                !this.isSeriesPositionContextActive(context)
            ) {
                return;
            }

            this.rawSeriesPositions.set(positions);
        } finally {
            this.untrackPendingSeriesPositionLoad(context, generation);
        }
    }

    private activateSeriesPositionContext(
        playlistId: string,
        seriesXtreamId: number
    ): SeriesPositionContext {
        const context: SeriesPositionContext = {
            generation: ++this.seriesPositionContextGeneration,
            playlistId,
            seriesXtreamId,
            mutationKey: JSON.stringify([playlistId, seriesXtreamId]),
        };
        this.activeSeriesPositionContext = context;
        return context;
    }

    private isSeriesPositionContextActive(
        context: SeriesPositionContext
    ): boolean {
        const activeContext = this.activeSeriesPositionContext;
        return (
            activeContext === context &&
            activeContext.generation === context.generation &&
            this.stalkerStore.currentPlaylist()?._id === context.playlistId &&
            this.toSeriesId(this.displayItem()?.id ?? 0) ===
                context.seriesXtreamId
        );
    }

    private waitForSeriesPositionMutations(mutationKey: string): Promise<void> {
        return (
            this.seriesPositionMutationQueues.get(mutationKey) ??
            Promise.resolve()
        );
    }

    private trackPendingSeriesPositionLoad(
        context: SeriesPositionContext,
        generation: number
    ): void {
        const generations =
            this.pendingSeriesPositionLoads.get(context) ?? new Set<number>();
        generations.add(generation);
        this.pendingSeriesPositionLoads.set(context, generations);
    }

    private untrackPendingSeriesPositionLoad(
        context: SeriesPositionContext,
        generation: number
    ): void {
        const generations = this.pendingSeriesPositionLoads.get(context);
        generations?.delete(generation);
        if (generations?.size === 0) {
            this.pendingSeriesPositionLoads.delete(context);
        }
    }

    private hasCurrentPendingSeriesPositionLoad(
        context: SeriesPositionContext
    ): boolean {
        return Boolean(
            this.pendingSeriesPositionLoads
                .get(context)
                ?.has(this.seriesPositionsLoadGeneration)
        );
    }

    private enqueueSeriesPositionMutation(
        context: SeriesPositionContext,
        operation: () => Promise<void>
    ): Promise<void> {
        if (this.hasCurrentPendingSeriesPositionLoad(context)) {
            this.seriesPositionReloadKeys.add(context.mutationKey);
        }
        this.seriesPositionsLoadGeneration++;
        const previous = this.waitForSeriesPositionMutations(
            context.mutationKey
        );
        const result = previous.then(operation);
        const barrier = result.then(
            () => undefined,
            () => undefined
        );
        this.seriesPositionMutationQueues.set(context.mutationKey, barrier);
        void barrier.then(() => {
            if (
                this.seriesPositionMutationQueues.get(context.mutationKey) ===
                barrier
            ) {
                this.seriesPositionMutationQueues.delete(context.mutationKey);
                this.reloadSeriesPositionsAfterMutations(context.mutationKey);
            }
        });
        return result;
    }

    private reloadSeriesPositionsAfterMutations(mutationKey: string): void {
        if (!this.seriesPositionReloadKeys.delete(mutationKey)) {
            return;
        }
        const context = this.activeSeriesPositionContext;
        if (
            !context ||
            context.mutationKey !== mutationKey ||
            !this.isSeriesPositionContextActive(context) ||
            this.hasCurrentPendingSeriesPositionLoad(context)
        ) {
            return;
        }
        void this.loadSeriesPositions(context);
    }

    private getSeriesPositionMutationContext(
        playlistId: string,
        seriesXtreamId?: number | null
    ): SeriesPositionContext | null {
        const context = this.activeSeriesPositionContext;
        if (
            !context ||
            context.playlistId !== playlistId ||
            (seriesXtreamId != null &&
                context.seriesXtreamId !== seriesXtreamId)
        ) {
            return null;
        }
        return context;
    }

    private persistSeriesPosition(
        playlistId: string,
        position: PlaybackPositionData
    ): Promise<void> {
        const context = this.getSeriesPositionMutationContext(
            playlistId,
            position.seriesXtreamId
        );
        if (!context) {
            return Promise.resolve();
        }
        const legacyPosition = this.legacyPositionByTrackingId().get(
            position.contentXtreamId
        );
        return this.enqueueSeriesPositionMutation(context, async () => {
            let clearedLegacy: boolean;
            try {
                clearedLegacy = await saveStalkerSeriesPosition({
                    repository: this.migrationPlaybackPositions,
                    playlistId,
                    position,
                    legacyPosition,
                });
            } catch (error) {
                if (
                    error instanceof StalkerSeriesPositionPartialSaveError &&
                    this.isSeriesPositionContextActive(context)
                ) {
                    this.publishSavedSeriesPosition(
                        position,
                        legacyPosition,
                        false
                    );
                }
                throw error;
            }
            if (!this.isSeriesPositionContextActive(context)) {
                return;
            }
            this.publishSavedSeriesPosition(
                position,
                legacyPosition,
                clearedLegacy
            );
        });
    }

    private publishSavedSeriesPosition(
        position: PlaybackPositionData,
        legacyPosition: PlaybackPositionData | undefined,
        clearedLegacy: boolean
    ): void {
        const removedTrackingIds = new Set([position.contentXtreamId]);
        if (clearedLegacy && legacyPosition) {
            removedTrackingIds.add(legacyPosition.contentXtreamId);
            const legacyPositions = new Map(this.legacyPositionByTrackingId());
            legacyPositions.delete(position.contentXtreamId);
            this.legacyPositionByTrackingId.set(legacyPositions);
        }

        this.rawSeriesPositions.set([
            ...this.rawSeriesPositions().filter(
                (candidate) =>
                    !removedTrackingIds.has(candidate.contentXtreamId)
            ),
            position,
        ]);
        this.updateEpisodePlaybackPosition(position);
    }

    private clearSeriesPosition(
        playlistId: string,
        contentXtreamId: number
    ): Promise<void> {
        const context = this.getSeriesPositionMutationContext(playlistId);
        if (!context) {
            return Promise.resolve();
        }
        const position = this.episodePlaybackPositions().get(
            contentXtreamId
        ) ?? {
            contentXtreamId,
            contentType: 'episode',
            positionSeconds: 0,
            playlistId,
            seriesXtreamId: context.seriesXtreamId,
        };
        const legacyPosition =
            this.legacyPositionByTrackingId().get(contentXtreamId);
        return this.enqueueSeriesPositionMutation(context, async () => {
            const clearedLegacy = await clearStalkerSeriesPosition({
                repository: this.migrationPlaybackPositions,
                playlistId,
                position,
                legacyPosition,
            });
            if (!this.isSeriesPositionContextActive(context)) {
                return;
            }
            this.publishClearedSeriesPosition(
                contentXtreamId,
                legacyPosition,
                clearedLegacy
            );
        });
    }

    private publishClearedSeriesPosition(
        contentXtreamId: number,
        legacyPosition: PlaybackPositionData | undefined,
        clearedLegacy: boolean
    ): void {
        const removedTrackingIds = new Set([contentXtreamId]);
        if (clearedLegacy && legacyPosition) {
            removedTrackingIds.add(legacyPosition.contentXtreamId);
            const legacyPositions = new Map(this.legacyPositionByTrackingId());
            legacyPositions.delete(contentXtreamId);
            this.legacyPositionByTrackingId.set(legacyPositions);
        }

        this.rawSeriesPositions.set(
            this.rawSeriesPositions().filter(
                (candidate) =>
                    !removedTrackingIds.has(candidate.contentXtreamId)
            )
        );
        this.removeEpisodePlaybackPosition(contentXtreamId);
    }

    private async loadAndPlayVodSeriesSeason(
        season: VodSeriesSeasonVm,
        visitedSeasonIds = new Set<string>()
    ): Promise<void> {
        if (visitedSeasonIds.has(season.id)) {
            return;
        }
        visitedSeasonIds.add(season.id);

        if (season.episodes.length === 0) {
            await this.loadEpisodesForSeason(season);
        }

        const quickStart = this.quickStartAction();
        if (!quickStart || quickStart.disabled) {
            return;
        }

        if (quickStart.action) {
            this.onEpisodeClicked(quickStart.action.episode);
            return;
        }

        if (quickStart.lazySeason) {
            await this.loadAndPlayVodSeriesSeason(
                quickStart.lazySeason,
                visitedSeasonIds
            );
        }
    }

    private updateEpisodePlaybackPosition(
        position: PlaybackPositionData
    ): void {
        const updated = new Map(this.episodePlaybackPositions());
        updated.set(position.contentXtreamId, position);
        this.episodePlaybackPositions.set(updated);
    }

    private removeEpisodePlaybackPosition(contentXtreamId: number): void {
        const updated = new Map(this.episodePlaybackPositions());
        updated.delete(contentXtreamId);
        this.episodePlaybackPositions.set(updated);
    }
}
