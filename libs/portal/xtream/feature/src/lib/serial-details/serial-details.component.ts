import { Location } from '@angular/common';
import {
    Component,
    computed,
    effect,
    inject,
    OnDestroy,
    signal,
    ChangeDetectionStrategy,
    viewChild,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    CastCrewRowComponent,
    DetailActionButtonComponent,
    DetailActionsTemplateDirective,
    DetailCreditsComponent,
    DetailIconButtonComponent,
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
    TmdbEnrichedCastMember,
    XtreamSerieDetails,
    XtreamSerieEpisode,
    XtreamSerieInfo,
} from '@iptvnator/shared/interfaces';
import { injectXtreamDetailNavigation } from '../xtream-detail-navigation';
import {
    SerialDetailsPlaybackService,
    type XtreamSerieDetailsView,
} from './serial-details-playback.service';
import { SerialDetailsRouteService } from './serial-details-route.service';
import { SerialDetailsSeasonWatchService } from './serial-details-season-watch.service';
import { SerialDetailsSeasonsService } from './serial-details-seasons.service';
import { SerialDetailsSimilarService } from './serial-details-similar.service';
import { createSerialPlaybackSessionKey } from './serial-playback-session-key';
import { SerialDetailsHeroPresenter } from './serial-details-hero.presenter';
import { SerialDetailsMenuService } from './serial-details-menu.service';
import { SerialDetailsDownloadAdapterService } from './serial-details-download-adapter.service';

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
    providers: [
        SerialDetailsPlaybackService,
        SerialDetailsRouteService,
        SerialDetailsSeasonWatchService,
        SerialDetailsSeasonsService,
        SerialDetailsSimilarService,
        SerialDetailsHeroPresenter,
        SerialDetailsMenuService,
        SerialDetailsDownloadAdapterService,
    ],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [
        CastCrewRowComponent,
        DetailActionButtonComponent,
        DetailActionsTemplateDirective,
        DetailCreditsComponent,
        DetailIconButtonComponent,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MetaChipComponent,
        PortalDetailShellComponent,
        PortalInlinePlayerComponent,
        SeasonContainerComponent,
        SimilarRailComponent,
        TranslatePipe,
        ViewInPortalActionComponent,
        VodMoreMenuComponent,
    ],
})
export class SerialDetailsComponent implements OnDestroy {
    private readonly location = inject(Location);
    private readonly route = inject(ActivatedRoute);
    private readonly navigation = injectXtreamDetailNavigation('tv');

    private readonly xtreamStore = inject(XtreamStore);
    private readonly playback = inject(SerialDetailsPlaybackService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);

    readonly heroPresenter = inject(SerialDetailsHeroPresenter);
    readonly menu = inject(SerialDetailsMenuService);
    readonly seasonContainer =
        viewChild<SeasonContainerComponent>('seasonContainer');

    readonly selectedItem = signal<XtreamSerieDetailsView | null>(null);
    readonly selectedContentType = this.xtreamStore.selectedContentType;
    readonly scrollToCast = scrollToCastCrewRow;
    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly currentPlaylistId = signal('');
    private readonly downloadAdapter = inject(
        SerialDetailsDownloadAdapterService
    );
    readonly episodeDownloadAdapter = this.downloadAdapter.adapter;
    private readonly routeState = inject(SerialDetailsRouteService);
    private readonly routeParams = this.routeState.params;
    readonly providerOnly = this.routeState.providerOnly;

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
            this.routeParams()['serialId'],
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

    /** The "Similar" rail: catalog matches plus cross-portal matches */
    private readonly similar = inject(SerialDetailsSimilarService);
    readonly similarItems = this.similar.similarItems;
    readonly similarInPortals = this.similar.similarInPortals;

    /**
     * Season descriptions and posters, and the selected season's enrichment.
     * Injected after the other services that register effects: its enrichment
     * effect then runs after theirs and before the constructor's.
     */
    private readonly seasons = inject(SerialDetailsSeasonsService);
    readonly seasonDescriptions = this.seasons.descriptions;
    readonly seasonPosters = this.seasons.posters;

    /** Clickable year/genre/country chips (Discover pages) */
    readonly discover = this.navigation.discover;

    constructor() {
        this.playback.bind({ selectedItem: this.selectedItem });
        this.similar.bind({ selectedItem: this.selectedItem });
        this.seasons.bind({ selectedItem: this.selectedItem });
        this.downloadAdapter.bind(this.selectedItem);
        this.heroPresenter.bind({
            selectedItem: this.selectedItem,
            quickStart: this.quickStartAction,
            yearLabel: (releaseDate) => this.discover.yearLabel(releaseDate),
            similarItems: this.similarItems,
            similarInPortals: this.similarInPortals,
            openSimilar: (item) => this.navigation.openSimilar(item),
            openSimilarInPortals: (item) =>
                this.navigation.openSimilarInPortals(item),
        });
        this.menu.bind({
            selectedItem: this.selectedItem,
            quickStart: this.quickStartAction,
            seasonContainer: this.seasonContainer,
            categoryId: computed(() =>
                String(this.routeParams()['categoryId'] ?? '')
            ),
            episodePositions: this.episodePlaybackPositions,
            playbackActive: computed(
                () =>
                    this.inlinePlayback() !== null ||
                    this.playback.forcedLaunchPending() ||
                    this.playback.openingEpisodeId() !== null ||
                    this.playback.activeEpisodeId() !== null
            ),
            startPending: this.playback.forcedLaunchPending,
            pageToken: () => this.playback.pageToken(),
            resetProgress: () => this.resetProgress(),
            openEpisodeExternally: (episode, player) =>
                this.playback.playEpisode(episode, player),
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
        effect(() => this.routeState.loadAddressedSeries());

        registerContentMetadataBackfill({
            store: this.xtreamStore,
            contentType: 'series',
            playlistId: () => this.currentPlaylistId(),
            xtreamId: () => Number(this.selectedItem()?.series_id ?? 0),
            info: () => this.selectedItem()?.info,
        });
    }

    ngOnDestroy(): void {
        this.xtreamStore.cancelDetailsRequest();
        this.playback.closeInlinePlayer();
        this.xtreamStore.setSelectedItem(null);
    }

    /** Clears every saved episode position of the series. */
    resetProgress(): Promise<void> {
        const request =
            this.seasonContainer()?.watchPresenter.buildResetRequest();
        return request
            ? this.playback.handleWatchToggleRequested(request, 'series')
            : Promise.resolve();
    }

    openActor(member: TmdbEnrichedCastMember): void {
        this.navigation.openActor(member);
    }

    onSeasonSelected(seasonKey: string): void {
        this.seasons.select(seasonKey);
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
            this.route.snapshot.params['serialId'],
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
}
