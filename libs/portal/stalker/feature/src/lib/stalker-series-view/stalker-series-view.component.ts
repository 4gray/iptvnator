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
    ChangeDetectionStrategy,
    viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FavoritesButtonComponent } from '../stalker-favorites-button/stalker-favorites-button.component';
import {
    findStalkerResumeLazySeason,
    resolveStalkerResumeEpisode,
    STALKER_SERIES_RESUME_TARGET,
    StalkerResumeSeasonHydration,
    stalkerSeriesResumeKey,
} from './stalker-series-resume';
import {
    CastCrewRowComponent,
    DetailActionButtonComponent,
    DetailActionsTemplateDirective,
    DetailCreditsComponent,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    MetaChipComponent,
    PortalDetailShellComponent,
    SeasonContainerComponent,
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerSeasonPlaybackToggleRequest,
    SeasonContainerSeriesPlaybackToggleRequest,
    SimilarRailComponent,
    ViewInPortalActionComponent,
    VodMoreMenuComponent,
    scrollToCastCrewRow,
} from '@iptvnator/ui/components';
import {
    ExternalPlayerName,
    ExternalPlayerSession,
    PlaybackPositionData,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    TmdbEnrichedCastMember,
    XtreamSerieEpisode,
    pickSeasonMarkedTitle,
    seriesStatusLabelKey,
} from '@iptvnator/shared/interfaces';
import {
    isLiveExternalPlayerSession,
    replaceOwnedExternalSession,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYER,
    createLogger,
    consumeStalkerReturnMarker,
    createDiscoverFacetNavigation,
    resolveStalkerBackNavigation,
} from '@iptvnator/portal/shared/util';
import {
    getVodSeasonLoadStates,
    getVodSeriesSeasonKey,
    isVodSeasonHydrationPending,
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
import { StalkerSeriesHeroPresenter } from './stalker-series-hero.presenter';
import { StalkerSeriesLaunchQueue } from './stalker-series-launch-queue';
import { StalkerSeriesMenuService } from './stalker-series-menu.service';
import {
    getStalkerSeriesQuickStartButton,
    type StalkerQuickStartButton,
} from './stalker-series-quick-start';
import { toStalkerSeriesId } from './stalker-series-id';
import { StalkerSeriesPositionsService } from './stalker-series-positions.service';
import { StalkerSeriesWatchToggleService } from './stalker-series-watch-toggle.service';
import { StalkerVodSeasonEpisodeLoader } from './stalker-vod-season-episode-loader';
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
        CastCrewRowComponent,
        DetailActionButtonComponent,
        DetailActionsTemplateDirective,
        DetailCreditsComponent,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MetaChipComponent,
        PortalDetailShellComponent,
        SimilarRailComponent,
        ViewInPortalActionComponent,
        VodMoreMenuComponent,
        PortalInlinePlayerComponent,
        TranslatePipe,
        SeasonContainerComponent,
    ],
    changeDetection: ChangeDetectionStrategy.Eager,
    providers: [
        StalkerSeriesTmdbSeasonsService,
        StalkerSeriesHeroPresenter,
        StalkerSeriesMenuService,
        StalkerSeriesPositionsService,
        StalkerSeriesWatchToggleService,
    ],
})
export class StalkerSeriesViewComponent implements OnDestroy {
    readonly stalkerStore = inject(StalkerStore);
    readonly heroPresenter = inject(StalkerSeriesHeroPresenter);
    readonly menu = inject(StalkerSeriesMenuService);
    private readonly seasonContainerRef =
        viewChild<SeasonContainerComponent>('seasonContainer');
    private readonly positions = inject(StalkerSeriesPositionsService);
    private readonly watchToggle = inject(StalkerSeriesWatchToggleService);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly router = inject(Router);
    private readonly location = inject(Location);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly playbackPositionBridge = inject(
        PlaybackPositionRuntimeBridgeService
    );
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    readonly backClicked = output<void>();
    private readonly logger = createLogger('StalkerSeriesView');
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly episodePlaybackPositions = this.positions.episodePlaybackPositions;
    private readonly seriesResumeTarget = inject(STALKER_SERIES_RESUME_TARGET);
    private consumedSeriesResumeKey: string | null = null;
    private readonly seriesResumeSeasonHydration =
        new StalkerResumeSeasonHydration();
    private seriesPlaybackRequestGeneration = 0;
    private currentSeriesPlaybackOwnerKey = '';
    private readonly inlinePlaybackEpisodeIdentity =
        signal<StalkerEpisodePlaybackStructuralIdentity | null>(null);
    private lastSaveTime = 0;
    private unsubscribePositionUpdates: (() => void) | null = null;
    readonly openingEpisodeId = signal<number | null>(null);
    readonly activeEpisodeId = signal<number | null>(null);
    /**
     * `playlist:series` keys of starts still resolving their stream
     * (`create_link` round trips): only the series on screen counts as
     * starting. Provider series ids are playlist-scoped.
     */
    private readonly pendingStartSeriesIds = signal<readonly string[]>([]);
    /** Episode choices made while a forced MPV/VLC launch is mid-flight. */
    private readonly launchQueue = new StalkerSeriesLaunchQueue();
    /** `playlist:series` of the series on screen; provider ids collide across playlists. */
    readonly currentSeriesKey = computed(
        () =>
            `${this.stalkerStore.currentPlaylist()?._id ?? ''}:${this.displayItem()?.id ?? ''}`
    );
    /** A start of the series on screen that has not settled. */
    readonly startPending = computed(() =>
        this.pendingStartSeriesIds().includes(this.currentSeriesKey())
    );
    readonly seasonWatchBatchRunning = this.watchToggle.seasonWatchBatchRunning;

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
    private readonly similarInPortalsMatched = signal<CrossPortalSimilarItem[]>(
        []
    );
    /** Filtered on read: a relock hides matches cached while unlocked. */
    readonly similarInPortals = computed(() =>
        this.crossPortalSimilar.visible(this.similarInPortalsMatched())
    );
    private readonly loadSimilarInPortals = effect(() => {
        const recommendations = this.displayItem()?.info?.tmdb_recommendations;
        untracked(() => {
            this.similarInPortalsMatched.set([]);
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
                        this.similarInPortalsMatched.set(items);
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

    /** Season posters for the season cover and the fullscreen episode panel. */
    readonly seasonPosters = computed<Record<string, string>>(() =>
        this.tmdbSeasons.posters(this.displayItem()?.info?.tmdb_id)
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
        this.heroPresenter.bind({
            displayItem: this.displayItem,
            quickStart: this.quickStartButton,
            yearLabel: (releaseDate) => this.discover.yearLabel(releaseDate),
            similarInPortals: this.similarInPortals,
            openSimilarInPortals: (item) => this.openSimilarInPortals(item),
        });
        this.menu.bind({
            quickStart: this.quickStartAction,
            seasonContainer: this.seasonContainerRef,
            hasProgress: computed(
                () => this.episodePlaybackPositions().size > 0
            ),
            playbackActive: computed(
                () =>
                    this.startPending() ||
                    this.inlinePlayback() !== null ||
                    this.openingEpisodeId() !== null ||
                    this.activeEpisodeId() !== null
            ),
            startPending: this.startPending,
            resetProgress: () => this.resetProgress(),
            openExternal: (player) => this.openQuickStartExternally(player),
        });
        this.positions.bind({
            displayItem: this.displayItem,
            mappedSeasons: this.mappedSeasons,
        });
        this.watchToggle.bind({
            displayItem: this.displayItem,
            currentSeriesKey: this.currentSeriesKey,
            isVodSeries: this.isVodSeries,
            vodSeriesSeasons: this.vodSeriesSeasons,
            mappedSeasons: this.mappedSeasons,
            excludedEpisodeIds: () => this.seriesWatchExcludedIds(),
            loadEpisodesForSeason: (season) =>
                this.loadEpisodesForSeason(season),
        });
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
            this.positions.loadShownSeries();
        });

        effect(() => {
            this.positions.applyReconciledSeriesPositions();
        });

        // Dashboard "Continue watching" handoff: once the persisted
        // positions for THIS series are in (so the episode resumes at its
        // saved offset, not from zero) and the target episode is on the
        // page, play it exactly once. A lazy Ministra season the target
        // lives in is hydrated first; the effect re-runs when its episodes
        // land. Mirrors the Xtream serial-details resume effect.
        effect(() => {
            const target = this.seriesResumeTarget();
            const item = this.displayItem();
            const playlistId = this.stalkerStore.currentPlaylist()?._id;
            const seriesXtreamId = this.toSeriesId(item?.id ?? 0);
            const episodesBySeason = this.mappedSeasons();
            const seasons = this.vodSeriesSeasons();
            // Read so the effect re-runs after reconciliation, which is
            // what `onEpisodeClicked` takes the start offset from.
            this.episodePlaybackPositions();
            if (
                !target ||
                !item ||
                !playlistId ||
                seriesXtreamId <= 0 ||
                target.seriesXtreamId !== seriesXtreamId ||
                this.positions.seriesPositionsLoadedKey() !==
                    this.positions.seriesPositionsKey(
                        playlistId,
                        seriesXtreamId
                    )
            ) {
                return;
            }

            const resumeKey = stalkerSeriesResumeKey(playlistId, target);
            if (this.consumedSeriesResumeKey === resumeKey) {
                return;
            }

            const episode = resolveStalkerResumeEpisode({
                target,
                episodesBySeason,
            });
            if (episode) {
                this.consumedSeriesResumeKey = resumeKey;
                // Reconciliation attaches positions by exact or legacy
                // tracking id only; an episode found by coordinates still
                // resumes at the offset the dashboard card displayed.
                const savedOffset = this.positions
                    .rawSeriesPositions()
                    .find(
                        (position) =>
                            position.contentXtreamId === target.contentXtreamId
                    )?.positionSeconds;
                untracked(() => this.onEpisodeClicked(episode, savedOffset));
                return;
            }

            const lazySeason = this.isVodSeries()
                ? findStalkerResumeLazySeason({ target, seasons })
                : null;
            if (
                !lazySeason ||
                !this.seriesResumeSeasonHydration.canRequest(resumeKey)
            ) {
                return;
            }
            this.seriesResumeSeasonHydration.begin(resumeKey);
            untracked(
                () =>
                    void this.loadEpisodesForSeason(lazySeason).then(
                        (answered) =>
                            this.seriesResumeSeasonHydration.settle(
                                resumeKey,
                                answered
                            )
                    )
            );
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
                    void this.positions
                        .persistSeriesPosition(playlistId, data)
                        .catch((error: unknown) => {
                            this.logger.error(
                                'Failed to persist runtime series position',
                                error
                            );
                        });
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
    /** The hero's button: held while a start is pending, a second press would double it. */
    readonly quickStartButton = computed<StalkerQuickStartButton | null>(() => {
        const button = this.quickStartAction();
        return button && (this.startPending() || this.seasonWatchBatchRunning())
            ? { ...button, disabled: true }
            : button;
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

    private readonly vodSeasonLoader = new StalkerVodSeasonEpisodeLoader({
        seasons: this.vodSeriesSeasons,
        ownerKey: () => this.seriesPlaybackOwnerKey(),
        fetchEpisodes: (videoId, seasonId) =>
            this.stalkerStore.fetchVodSeriesEpisodes(videoId, seasonId),
        logError: (message, error) => this.logger.error(message, error),
    });

    /** Resolves true when the portal answered, false when the request failed. */
    loadEpisodesForSeason(season: VodSeriesSeasonVm): Promise<boolean> {
        return this.vodSeasonLoader.load(season);
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
    /**
     * `startTimeOverride` lets the dashboard resume handoff carry the saved
     * offset for an episode whose position row the page could not attach
     * (matched by coordinates only), so it resumes where the card said.
     */
    onEpisodeClicked(
        episode: XtreamSerieEpisode,
        startTimeOverride?: number,
        forcePlayer?: ExternalPlayerName
    ) {
        if (this.seasonWatchBatchRunning()) {
            // The batch rewrites the very rows a start resumes from: the
            // choice waits for it, like the Reset and watched rows do.
            this.watchToggle.holdChoice(() =>
                this.onEpisodeClicked(episode, startTimeOverride, forcePlayer)
            );
            return;
        }
        const seriesKey = this.currentSeriesKey();
        if (this.launchQueue.isLaunching(seriesKey)) {
            // The launch cannot be cancelled: the choice replaces its player
            // once it settled.
            this.launchQueue.hold(seriesKey, () =>
                this.startEpisode(episode, startTimeOverride, forcePlayer)
            );
            return;
        }
        this.startEpisode(episode, startTimeOverride, forcePlayer);
    }

    private startEpisode(
        episode: XtreamSerieEpisode,
        startTimeOverride?: number,
        forcePlayer?: ExternalPlayerName
    ): void {
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
            this.episodePlaybackPositions().get(trackingId)?.positionSeconds ??
            startTimeOverride;

        void this.startPlayback(
            command,
            title,
            item.info.movie_image,
            episodeState,
            startTime,
            forcePlayer
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

    readonly scrollToCast = scrollToCastCrewRow;

    /** Clears every saved episode position of the series. */
    async resetProgress(): Promise<void> {
        const request =
            this.seasonContainerRef()?.watchPresenter.buildResetRequest();
        if (request) {
            await this.handleSeriesPlaybackToggleRequestedFromUi(request);
        }
    }

    /** "Open in external player": the next episode, straight to MPV/VLC. */
    async openQuickStartExternally(player: ExternalPlayerName): Promise<void> {
        const quickStart = this.quickStartAction();
        const episode = quickStart?.disabled
            ? undefined
            : quickStart?.action?.episode;
        if (episode) {
            this.onEpisodeClicked(episode, undefined, player);
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
        return toStalkerSeriesId(id);
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
        void this.positions
            .persistSeriesPosition(playback.contentInfo.playlistId, position)
            .catch((error: unknown) => {
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

    /**
     * The "…" menu's MPV/VLC launch: an episode of this series still running
     * externally is closed first, never doubled; a failed close or a page
     * that moved on meanwhile keeps the running player.
     */
    private async openEpisodeExternally(
        playback: ResolvedPortalPlayback,
        player: ExternalPlayerName,
        request: StalkerSeriesPlaybackRequestContext
    ): Promise<void> {
        // `closeInlinePlayer()` just retired `request`'s generation; a fresh
        // one covers the close round trip, the identity check the series.
        const generation = this.seriesPlaybackRequestGeneration;
        const replaced = await this.replaceOwnExternalSession(
            playback.contentInfo
        );
        if (
            !replaced ||
            !this.isPlaybackRequestCurrent({ ...request, generation })
        ) {
            return;
        }
        let session: ExternalPlayerSession | void;
        try {
            session = await this.portalPlayer.openExternalPlayback(
                playback,
                player
            );
        } catch (error) {
            // The caller's catch would read the retired generation and stay
            // silent; the user chose this launch and gets its failure.
            if (generation !== this.seriesPlaybackRequestGeneration) return;
            this.logger.error('External episode launch failed', error);
            this.snackBar.open(
                this.translateService.instant('PORTALS.PLAYBACK_ERROR'),
                undefined,
                { duration: 3000 }
            );
            return;
        }
        // The viewer left the series, or started something else, while the
        // launch sat inside the player IPC: the player it opened must not
        // stay beside what they chose since.
        if (
            session &&
            !this.isPlaybackRequestCurrent({ ...request, generation })
        ) {
            await this.externalPlayback
                .closeSession(session)
                .catch((error: unknown) =>
                    this.logger.warn(
                        'Closing a superseded external player failed',
                        error
                    )
                );
        }
    }

    /** Closes an episode of this series still running externally; false keeps it. */
    private replaceOwnExternalSession(
        own: PlayerContentInfo | undefined
    ): Promise<boolean> {
        return replaceOwnedExternalSession(
            this.externalPlayback,
            (info) =>
                info.contentType === 'episode' &&
                info.playlistId === own?.playlistId &&
                info.seriesXtreamId === own?.seriesXtreamId,
            (message, error) => this.logger.warn(message, error)
        );
    }

    private async startPlayback(
        cmd: string | undefined,
        title: string | undefined,
        thumbnail: string | undefined,
        episodeState: SeriesPlaybackEpisodeState<XtreamSerieEpisode>,
        startTime?: number,
        forcePlayer?: ExternalPlayerName
    ): Promise<void> {
        const generation = ++this.seriesPlaybackRequestGeneration;
        const episodeNum = episodeState.episodeNumber;
        const episodeId = Number(episodeState.episode.id);
        const request: StalkerSeriesPlaybackRequestContext = {
            generation,
            usesEmbeddedPlayer:
                !forcePlayer && this.portalPlayer.isEmbeddedPlayer(),
            identity: captureStalkerEpisodePlaybackSessionIdentity({
                sourceId: this.stalkerStore.currentPlaylist()?._id,
                parentSeriesId: this.displayItem()?.id,
                seriesMode: this.seriesMode(),
                episodeState,
            }),
        };
        if (request.usesEmbeddedPlayer && !request.identity) return;

        const pendingSeriesId = this.currentSeriesKey();
        this.pendingStartSeriesIds.update((ids) => [...ids, pendingSeriesId]);
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
            if (forcePlayer) {
                // Awaited so the start stays pending through the close of the
                // previous player and the launch itself.
                await this.launchQueue.run(
                    pendingSeriesId,
                    () =>
                        this.openEpisodeExternally(
                            resolvedPlayback,
                            forcePlayer,
                            request
                        ),
                    {
                        stillShown: () =>
                            this.currentSeriesKey() === pendingSeriesId,
                        replacePlayer: () =>
                            this.replaceOwnExternalSession(
                                resolvedPlayback.contentInfo
                            ),
                    }
                );
            } else {
                void this.portalPlayer.openResolvedPlayback(
                    resolvedPlayback,
                    true
                );
            }
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
        } finally {
            this.pendingStartSeriesIds.update((ids) => {
                const index = ids.indexOf(pendingSeriesId);
                return index < 0
                    ? ids
                    : [...ids.slice(0, index), ...ids.slice(index + 1)];
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

    handlePlaybackToggleRequested(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        return this.watchToggle.handlePlaybackToggleRequested(request);
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

    handleSeasonPlaybackToggleRequested(
        request: SeasonContainerSeasonPlaybackToggleRequest
    ): Promise<void> {
        return this.watchToggle.handleSeasonPlaybackToggleRequested(request);
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
        return isVodSeasonHydrationPending(season);
    }

    /** Seasons whose episode lists still need a portal request (lazy VOD). */
    readonly hasUnloadedVodSeasons = computed(
        () =>
            this.isVodSeries() &&
            this.vodSeriesSeasons().some((season) =>
                this.isSeasonHydrationPending(season)
            )
    );

    /** Per-season load state for the fullscreen episode panel (lazy VOD). */
    readonly vodSeasonLoadStates = computed(() =>
        this.isVodSeries()
            ? getVodSeasonLoadStates(this.vodSeriesSeasons())
            : {}
    );

    handleSeriesPlaybackToggleRequested(
        request: SeasonContainerSeriesPlaybackToggleRequest
    ): Promise<void> {
        return this.watchToggle.handleSeriesPlaybackToggleRequested(request);
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
}
