import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    StalkerPortalRepairService,
    StalkerSessionService,
} from '@iptvnator/portal/stalker/data-access';
import {
    DataService,
    ParentalLockService,
    PlaylistsService,
} from '@iptvnator/services';
import {
    ALL_CATEGORIES_WITHHELD,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import { ContentCardComponent } from '@iptvnator/portal/shared/ui';
import { SearchLayoutComponent } from '@iptvnator/portal/shared/ui';
import { StalkerInlineDetailComponent } from '../stalker-inline-detail/stalker-inline-detail.component';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    isWorkspaceLayoutRoute,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    StalkerSelectedVodItem,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import {
    buildStalkerSelectedVodItem,
    clearStalkerDetailViewState,
    createStalkerInlineDetailState,
    createPortalFavoritesResource,
    createRefreshTrigger,
    createStalkerDetailViewState,
    isSelectedStalkerVodFavorite,
    isStalkerSeriesFlag,
    normalizeStalkerEntityId,
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';
import { StalkerVodPlaybackController } from '../stalker-vod-playback-controller';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import { createStalkerVodDetailActions } from '../stalker-vod-detail-actions';
import { StalkerSearchPagingController } from './stalker-search-paging.controller';
import type { StalkerSearchContentType } from './stalker-search-results.util';

interface StalkerFilter {
    key: StalkerSearchContentType;
    label: string;
    translationKey: string;
}

@Component({
    selector: 'app-stalker-search',
    imports: [
        ContentCardComponent,
        FormsModule,
        MatButtonModule,
        MatCheckboxModule,
        SearchLayoutComponent,
        StalkerInlineDetailComponent,
        TranslatePipe,
    ],
    templateUrl: './stalker-search.component.html',
    styleUrl: './stalker-search.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerSearchComponent {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly location = inject(Location);
    private readonly dataService = inject(DataService);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly playlistService = inject(PlaylistsService);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly portalRepair = inject(StalkerPortalRepairService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly logger = createLogger('StalkerSearch');
    private readonly searchLayout = viewChild(SearchLayoutComponent);
    /**
     * The results offset captured when an inline detail opens: the layout
     * destroys the results container while the detail is shown and recreates
     * it at zero, so closing the detail must restore the spot explicitly.
     */
    private savedResultsScrollTop = 0;
    private currentPlaybackOwnerKey = '';

    readonly filters = signal<Record<StalkerSearchContentType, boolean>>({
        series: false,
        vod: true,
    });
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.activatedRoute);

    readonly filterConfig: StalkerFilter[] = [
        {
            key: 'vod',
            label: 'Movies',
            translationKey: 'PORTALS.SIDEBAR.MOVIES',
        },
        {
            key: 'series',
            label: 'Series',
            translationKey: 'PORTALS.SIDEBAR.SERIES',
        },
    ];

    readonly searchTerm = signal('');
    readonly routeSearchTerm = queryParamSignal(
        this.activatedRoute,
        'q',
        (value) => (value ?? '').trim()
    );

    private readonly currentPlaylist = computed(() => {
        const playlist = this.playlistContext.activePlaylist();
        return playlist?.macAddress ? playlist : null;
    });

    readonly selectedFilterType = signal<StalkerSearchContentType>('vod');
    private readonly favoritesRefresh = createRefreshTrigger();

    readonly itemDetails = signal<StalkerSelectedVodItem | null>(null);
    readonly vodDetailsItem = signal<VodDetailsItem | null>(null);
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly playbackSessionKey = computed(() => {
        const sourceId = this.currentPlaylist()?._id;
        const contentId = normalizeStalkerEntityId(this.itemDetails()?.id);
        return sourceId && contentId
            ? createPlaybackSessionKey({ kind: 'vod', sourceId, contentId })
            : '';
    });
    private readonly playbackOwnerKey = computed(() =>
        JSON.stringify([this.playbackSessionKey(), this.selectedFilterType()])
    );
    readonly selectedVodPosition = signal<PlaybackPositionData | null>(null);
    readonly selectedVodPlaybackDuration = computed<number | null>(
        () => this.selectedVodPosition()?.durationSeconds ?? null
    );
    readonly sourceLabel = computed(
        () => this.stalkerStore.currentPlaylist()?.title ?? null
    );
    readonly selectedVodPlaybackPosition = computed<number | null>(
        () => this.selectedVodPosition()?.positionSeconds ?? null
    );
    /** A Play/Resume or menu launch still resolving its stream. */
    readonly playbackStartPending = computed(() =>
        this.vodPlayback.playbackStartPending()
    );
    private readonly vodPlayback = new StalkerVodPlaybackController({
        inlinePlayback: this.inlinePlayback,
        selectedVodPosition: this.selectedVodPosition,
        playbackPositions: this.playbackPositions,
        portalPlayer: this.portalPlayer,
        snackBar: this.snackBar,
        translateService: this.translateService,
        logger: this.logger,
        playbackErrorLogMessage: 'Failed to start search VOD playback',
        playbackOwnerKey: () => this.playbackOwnerKey(),
    });

    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => this.currentPlaylist()?._id,
        () => this.favoritesRefresh.refreshVersion()
    );

    /** Result paging: the portal page, the accumulated list and its flags. */
    readonly paging = new StalkerSearchPagingController({
        searchTerm: this.searchTerm,
        selectedFilterType: this.selectedFilterType,
        currentPlaylist: this.currentPlaylist,
        dataService: this.dataService,
        parentalLock: this.parentalLock,
        stalkerSession: this.stalkerSession,
        portalRepair: this.portalRepair,
        logger: this.logger,
        closeWithheldDetail: (withheldCategoryIds) =>
            this.closeWithheldDetail(withheldCategoryIds),
    });
    readonly searchResults = this.paging.searchResults;
    readonly searchHasMore = this.paging.searchHasMore;
    readonly searchAppendError = this.paging.searchAppendError;
    readonly searchScrollResetKey = this.paging.searchScrollResetKey;
    readonly isInitialSearchLoading = this.paging.isInitialSearchLoading;
    readonly isAppendingSearchResults = this.paging.isAppendingSearchResults;

    loadMoreSearchResults(): void {
        this.paging.loadMoreSearchResults();
    }

    readonly isSelectedVodFavorite = signal<boolean>(false);

    constructor() {
        this.currentPlaybackOwnerKey = this.playbackOwnerKey();
        effect(() => {
            const ownerKey = this.playbackOwnerKey();
            untracked(() => this.syncPlaybackOwner(ownerKey));
        });

        effect(() => {
            const routeTerm = this.routeSearchTerm();
            if (routeTerm !== this.searchTerm()) {
                this.searchTerm.set(routeTerm);
            }
        });

        effect(() => {
            // Re-evaluate favorite state whenever favorites resource changes.
            this.portalFavorites.value();
            this.syncSelectedVodFavorite();
        });

        // TMDB enrichment patches the STORE's selected item asynchronously;
        // pull the enriched copy back into the local detail snapshots.
        effect(() => {
            const selected = this.stalkerStore.selectedItem();
            const current = this.itemDetails();
            if (!selected || !current || selected === current) {
                return;
            }
            const selectedId = normalizeStalkerEntityId(
                selected.id ?? selected.stream_id
            );
            if (
                !selectedId ||
                selectedId !== normalizeStalkerEntityId(current.id)
            ) {
                return;
            }

            const enriched = selected as StalkerSelectedVodItem;
            this.itemDetails.set(enriched);
            if (this.vodDetailsItem()) {
                this.vodDetailsItem.set(
                    createStalkerDetailViewState(
                        enriched,
                        this.currentPlaylist()?._id ?? ''
                    ).vodDetailsItem
                );
            }
        });
    }

    /** Check if showing item details */
    get showingDetails(): boolean {
        return this.inlineDetail().categoryId !== null;
    }

    /** Get results count for layout */
    get resultsCount(): number {
        return this.searchResults().length;
    }

    updateSearchTerm(term: string) {
        this.searchTerm.set(term);
    }

    updateFilter(key: StalkerSearchContentType, value: boolean) {
        if (value) {
            // Single selection mode - set clicked filter, disable others
            this.selectedFilterType.set(key);
            this.filters.update(() => {
                const newFilters: Record<StalkerSearchContentType, boolean> = {
                    series: false,
                    vod: false,
                };
                this.filterConfig.forEach((filter) => {
                    newFilters[filter.key] = filter.key === key;
                });
                return newFilters;
            });
        }
    }

    selectItem(item: StalkerVodSource) {
        this.savedResultsScrollTop =
            this.searchLayout()?.getResultsScrollTop() ?? 0;
        const filterType = this.selectedFilterType();
        const hasEmbeddedSeries = (item.series?.length ?? 0) > 0;
        const needsSeriesFetch =
            filterType === 'vod' &&
            !hasEmbeddedSeries &&
            isStalkerSeriesFlag(item.is_series);

        // The setSelectedItem hook gates TMDB enrichment on the CURRENT
        // content type — it must be up to date before the item is set,
        // otherwise the type of the previously open tab leaks in.
        if (filterType === 'vod' || filterType === 'series') {
            this.stalkerStore.setSelectedContentType(filterType);
        }

        this.itemDetails.set(
            buildStalkerSelectedVodItem(item, needsSeriesFetch)
        );

        this.stalkerStore.setSelectedItem(this.itemDetails());

        switch (filterType) {
            case 'vod':
                if (!hasEmbeddedSeries && !needsSeriesFetch) {
                    const detailViewState = createStalkerDetailViewState(
                        this.itemDetails()!,
                        this.currentPlaylist()?._id ?? ''
                    );
                    this.itemDetails.set(detailViewState.itemDetails);
                    this.vodDetailsItem.set(detailViewState.vodDetailsItem);
                    this.syncSelectedVodFavorite();
                    void this.loadSelectedVodPosition(
                        this.currentPlaylist()?._id ?? '',
                        Number(detailViewState.itemDetails?.id)
                    );
                } else {
                    const cleared = clearStalkerDetailViewState();
                    this.vodDetailsItem.set(cleared.vodDetailsItem);
                    this.isSelectedVodFavorite.set(false);
                    this.selectedVodPosition.set(null);
                }
                break;
            default:
                break;
        }
        this.syncPlaybackOwner(this.playbackOwnerKey());
    }

    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            void this.startStalkerVodPlayback(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image
            );
        }
    }

    onVodResume(event: {
        item: VodDetailsItem;
        positionSeconds: number;
    }): void {
        if (event.item.type === 'stalker') {
            void this.startStalkerVodPlayback(
                event.item.cmd,
                event.item.data.info?.name,
                event.item.data.info?.movie_image,
                event.positionSeconds
            );
        }
    }

    onVodFavoriteToggled(event: {
        item: VodDetailsItem;
        isFavorite: boolean;
    }): void {
        toggleStalkerVodFavorite(event, {
            addToFavorites: (item, onDone) => this.addToFavorites(item, onDone),
            removeFromFavorites: (favoriteId, onDone) =>
                this.removeFromFavorites(favoriteId, onDone),
            onComplete: () => {
                this.favoritesRefresh.refresh();
                this.syncSelectedVodFavorite();
            },
        });
    }

    /**
     * Closes the open detail when its genre is withheld by the parental
     * lock (Lock now, idle relock): the title, its playback actions and the
     * store's selected item must not outlive the list row.
     */
    closeWithheldDetail(withheldCategoryIds: ReadonlySet<string>): void {
        const details = this.itemDetails();
        if (!details) {
            return;
        }
        // A detail without a genre is withheld only in fail-closed mode
        // (`ALL_CATEGORIES_WITHHELD`): "unknown genre" is not "no locked
        // genre" while the locks themselves are unknown.
        const categoryId = details.category_id;
        const withheld =
            categoryId === undefined || categoryId === null || categoryId === ''
                ? withheldCategoryIds === ALL_CATEGORIES_WITHHELD
                : withheldCategoryIds.has(String(categoryId));
        if (!withheld) {
            return;
        }
        const cleared = clearStalkerDetailViewState();
        this.itemDetails.set(cleared.itemDetails);
        this.vodDetailsItem.set(cleared.vodDetailsItem);
        this.isSelectedVodFavorite.set(false);
        this.selectedVodPosition.set(null);
        this.closeInlinePlayer();
        this.stalkerStore.setSelectedItem(null);
    }

    /** Leave the search page (e.g. back to the actor page that opened it) */
    goBack(): void {
        this.location.back();
    }

    onVodBack(): void {
        const cleared = clearStalkerDetailViewState();
        this.itemDetails.set(cleared.itemDetails);
        this.vodDetailsItem.set(cleared.vodDetailsItem);
        this.isSelectedVodFavorite.set(false);
        this.selectedVodPosition.set(null);
        this.closeInlinePlayer();

        const scrollTop = this.savedResultsScrollTop;
        this.savedResultsScrollTop = 0;
        if (scrollTop > 0) {
            // Two frames: one for change detection to recreate the results
            // container, one to apply the offset to it.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.searchLayout()?.restoreResultsScrollTop(scrollTop);
                });
            });
        }
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.vodPlayback.handleInlineTimeUpdate(event);
    }

    closeInlinePlayer(): void {
        this.vodPlayback.closeInlinePlayer();
    }

    showCopyNotification(): void {
        this.vodPlayback.showCopyNotification();
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        this.vodPlayback.handleExternalFallbackRequest(request);
    }

    removeFromFavorites(favoriteId: string, onDone?: () => void) {
        this.stalkerStore.removeFromFavorites(favoriteId, onDone);
    }

    addToFavorites(item: Record<string, unknown>, onDone?: () => void) {
        this.stalkerStore.addToFavorites(item, onDone);
    }

    private syncSelectedVodFavorite(): void {
        const item = this.vodDetailsItem();
        this.isSelectedVodFavorite.set(
            isSelectedStalkerVodFavorite(
                item,
                this.portalFavorites.value() ?? []
            )
        );
    }

    private syncPlaybackOwner(ownerKey: string): void {
        if (ownerKey === this.currentPlaybackOwnerKey) return;
        // A start the left movie still resolves no longer applies; a return
        // to it must not find Play held by a hung request.
        this.vodPlayback.retirePendingStart(this.currentPlaybackOwnerKey);
        this.currentPlaybackOwnerKey = ownerKey;
        this.closeInlinePlayer();
    }

    inlineDetail() {
        return createStalkerInlineDetailState(
            this.itemDetails(),
            this.vodDetailsItem(),
            this.selectedFilterType() === 'series' ? 'series' : 'vod'
        );
    }

    readonly vodDetailActions = createStalkerVodDetailActions({
        resolvePlayback: (cmd, title, thumbnail, startTime) =>
            this.stalkerStore.resolveVodPlayback(
                cmd,
                title,
                thumbnail,
                undefined,
                undefined,
                startTime
            ),
        portalPlayer: this.portalPlayer,
        externalPlayback: this.externalPlayback,
        playbackPositions: this.playbackPositions,
        playlistId: () => this.stalkerStore.currentPlaylist()?._id,
        selectedVodId: () => {
            const item = this.vodDetailsItem();
            return item?.type === 'stalker'
                ? Number(item.data.id) || null
                : null;
        },
        selectedVodPosition: this.selectedVodPosition,
        discardPendingPositionLoad: () =>
            this.vodPlayback.discardPendingPositionLoad(),
        beginPendingStart: () => this.vodPlayback.beginPendingStart(),
        snackBar: this.snackBar,
        translate: this.translateService,
        logError: () => undefined,
    });

    private async startStalkerVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ): Promise<void> {
        await this.vodPlayback.startVodPlayback(() =>
            startTime === undefined
                ? this.stalkerStore.resolveVodPlayback(cmd, title, thumbnail)
                : this.stalkerStore.resolveVodPlayback(
                      cmd,
                      title,
                      thumbnail,
                      undefined,
                      undefined,
                      startTime
                  )
        );
    }

    private async loadSelectedVodPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        await this.vodPlayback.loadSelectedVodPosition(playlistId, vodId);
    }
}
