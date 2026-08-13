import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    linkedSignal,
    resource,
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
    executeStalkerRequest,
    StalkerPortalRepairService,
    StalkerSessionService,
} from '@iptvnator/portal/stalker/data-access';
import {
    DataService,
    PlaylistsService,
    resetHostConnectivityGuard,
} from '@iptvnator/services';
import {
    PlaybackPositionData,
    ResolvedPortalPlayback,
    StalkerPortalActions,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import { ContentCardComponent } from '@iptvnator/portal/shared/ui';
import { SearchLayoutComponent } from '@iptvnator/portal/shared/ui';
import { StalkerInlineDetailComponent } from '../stalker-inline-detail/stalker-inline-detail.component';
import { StalkerContentTypes } from '@iptvnator/portal/stalker/data-access';
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

interface StalkerFilter {
    key: StalkerSearchContentType;
    label: string;
    translationKey: string;
}

type StalkerSearchContentType = 'vod' | 'series';

interface StalkerSearchResponse {
    js?: {
        data?: StalkerVodSource[];
        total_items?: number;
    };
    message?: string;
    status?: number;
}

/** Portals can shift items between pages mid-append — drop duplicate ids. */
function dedupeSearchResults(items: StalkerVodSource[]): StalkerVodSource[] {
    const seenIds = new Set<string>();
    return items.filter((item) => {
        const id =
            item.id === undefined || item.id === null ? null : String(item.id);
        if (id === null) {
            return true;
        }
        if (seenIds.has(id)) {
            return false;
        }
        seenIds.add(id);
        return true;
    });
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
    readonly selectedVodPlaybackPosition = computed<number | null>(
        () => this.selectedVodPosition()?.positionSeconds ?? null
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

    /**
     * Portal page for the current term+filter+portal; resets when any of
     * them changes. The playlist belongs to the identity: Angular reuses the
     * search route across `/stalker/A/search` -> `/stalker/B/search`, and a
     * surviving page number would append portal B's later page onto portal
     * A's accumulated results while skipping B's first page.
     */
    readonly searchPage = linkedSignal({
        source: () => ({
            term: this.searchTerm(),
            type: this.selectedFilterType(),
            playlistId: this.currentPlaylist()?._id ?? null,
        }),
        computation: () => 1,
    });
    /** Pages accumulated into one continuous, deduplicated result list. */
    private readonly accumulatedSearchResults = signal<StalkerVodSource[]>([]);
    readonly searchResults = this.accumulatedSearchResults.asReadonly();
    readonly searchHasMore = signal(false);
    /**
     * A failed append page. The next near-end RETRIES that page instead of
     * advancing — incrementing past it would silently omit its results.
     */
    readonly searchAppendError = signal(false);

    readonly searchResultsResource = resource({
        params: () => ({
            contentType: this.selectedFilterType(),
            search: this.searchTerm(),
            page: this.searchPage(),
            playlistId: this.currentPlaylist()?._id ?? null,
            action: StalkerPortalActions.GetOrderedList,
        }),
        loader: async ({ params }) => {
            if (params.search.length < 3) {
                this.resetSearchAccumulator();
                return [];
            }
            const playlist = this.currentPlaylist();
            if (!playlist) {
                // A reused route can land on a deleted/unresolved portal —
                // the previous portal's cards must not keep rendering.
                this.resetSearchAccumulator();
                return [];
            }
            const { portalUrl, macAddress } = playlist;
            if (!portalUrl || !macAddress) {
                this.resetSearchAccumulator();
                return [];
            }
            const contentType = params.contentType;

            // Mirror the catalog request shape: many Ministra portals
            // return an empty list for get_ordered_list without the
            // category/genre/sortby params the STB client always sends.
            // `max_page_items` is a HINT — plenty of portals ignore it and
            // return their own page size, which is why paging cannot rely
            // on it (progress and `total_items` decide hasMore instead).
            const requestParams: Record<string, string | number> = {
                action: StalkerContentTypes[contentType].getContentAction,
                type: contentType,
                sortby: 'added',
                search: params.search,
                p: params.page,
                max_page_items: 100,
                category: '*',
                ...(contentType === 'vod' ? { genre: '0' } : {}),
            };

            // A stale response (term/filter/page/portal moved on while this
            // page was in flight) must not clobber the accumulated list.
            const isCurrent = (): boolean =>
                params.search === this.searchTerm() &&
                params.contentType === this.selectedFilterType() &&
                params.page === this.searchPage() &&
                params.playlistId === (this.currentPlaylist()?._id ?? null);

            try {
                // executeStalkerRequest owns the portal-mode decision (shared
                // predicate with URL fallback for legacy rows) and the lazy
                // portal repair, so search cannot drift from the catalog
                // paths.
                const response =
                    await executeStalkerRequest<StalkerSearchResponse>(
                        {
                            dataService: this.dataService,
                            stalkerSession: this.stalkerSession,
                            portalRepair: this.portalRepair,
                        },
                        playlist,
                        requestParams
                    );
                const items = (response.js?.data || []).map(
                    (item: StalkerVodSource) =>
                        this.processItemUrls(item, portalUrl)
                );

                if (!isCurrent()) {
                    return items;
                }

                return this.applySearchPageSuccess(
                    params.page,
                    items,
                    response.js?.total_items
                );
            } catch (error) {
                this.logger.warn('Stalker search page failed', {
                    page: params.page,
                    error,
                });
                if (!isCurrent()) {
                    return this.accumulatedSearchResults();
                }

                return this.applySearchPageFailure(params.page);
            }
        },
    });

    /**
     * Empties the accumulator and every paging flag — used whenever there is
     * no searchable portal (short term, missing playlist, malformed row).
     */
    resetSearchAccumulator(): void {
        this.accumulatedSearchResults.set([]);
        this.searchHasMore.set(false);
        this.searchAppendError.set(false);
    }

    /** Merges a successful portal page into the accumulated result list. */
    applySearchPageSuccess(
        page: number,
        items: StalkerVodSource[],
        totalItems: number | undefined
    ): StalkerVodSource[] {
        const previous = page === 1 ? [] : this.accumulatedSearchResults();
        const merged =
            page === 1 ? items : dedupeSearchResults([...previous, ...items]);
        // Paging continues only while pages make progress — with OR without
        // a reported total. Dedup after mid-list portal mutations can leave
        // the unique list permanently shorter than total_items, and a
        // repeated page dedupes to no growth; either way a no-progress
        // append is the practical end of the results.
        const madeProgress = page === 1 || merged.length > previous.length;
        this.searchHasMore.set(
            madeProgress &&
                (typeof totalItems === 'number' && totalItems >= 0
                    ? merged.length < totalItems
                    : items.length > 0)
        );
        this.searchAppendError.set(false);
        this.accumulatedSearchResults.set(merged);
        return merged;
    }

    /**
     * A failed FRESH search (page 1) must not keep rendering the previous
     * query's cards; a failed append keeps the accumulated pages and flags
     * the error so the next near-end retries this page instead of advancing.
     */
    applySearchPageFailure(page: number): StalkerVodSource[] {
        if (page === 1) {
            this.accumulatedSearchResults.set([]);
            this.searchHasMore.set(false);
            this.searchAppendError.set(false);
            return [];
        }

        this.searchAppendError.set(true);
        return this.accumulatedSearchResults();
    }

    /**
     * Result-set identity for the layout's near-end latch and auto-fill
     * budget — term, filter, and portal, mirroring the paging identity.
     */
    readonly searchScrollResetKey = computed(() =>
        [
            this.searchTerm(),
            this.selectedFilterType(),
            this.currentPlaylist()?._id ?? '',
        ].join('|')
    );

    readonly isInitialSearchLoading = computed(
        () => this.searchResultsResource.isLoading() && this.searchPage() === 1
    );
    readonly isAppendingSearchResults = computed(
        () => this.searchResultsResource.isLoading() && this.searchPage() > 1
    );

    loadMoreSearchResults(): void {
        if (this.searchResultsResource.isLoading() || !this.searchHasMore()) {
            return;
        }

        if (this.searchAppendError()) {
            // Retry the SAME page — advancing would permanently omit it.
            void this.retrySearchPage();
            return;
        }

        this.searchPage.update((page) => page + 1);
    }

    /**
     * Two failed search pages are exactly what opens the main process'
     * connectivity guard, so the reset has to precede the reload — otherwise
     * this retry fast-fails without contacting a portal that may have
     * recovered, and keeps repeating the same error until the window expires.
     */
    private async retrySearchPage(): Promise<void> {
        // Clear the flag synchronously: awaiting first would leave this branch
        // re-enterable, and the next `nearEnd` event would fire a second retry.
        this.searchAppendError.set(false);
        await resetHostConnectivityGuard(
            this.dataService,
            this.currentPlaylist()?.portalUrl
        );
        this.searchResultsResource.reload();
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

    private processItemUrls(
        item: StalkerVodSource,
        portalUrl: string
    ): StalkerVodSource {
        const processed = { ...item };

        if (processed.screenshot_uri) {
            processed.screenshot_uri = this.makeAbsoluteUrl(
                portalUrl,
                processed.screenshot_uri
            );
        }

        return processed;
    }

    private makeAbsoluteUrl(baseUrl: string, relativePath: string): string {
        if (!relativePath) return '';
        if (
            relativePath.startsWith('http://') ||
            relativePath.startsWith('https://')
        ) {
            return relativePath;
        }
        try {
            const url = new URL(baseUrl);
            const path = relativePath.startsWith('/')
                ? relativePath
                : `/${relativePath}`;
            return `${url.origin}${path}`;
        } catch {
            return relativePath;
        }
    }

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
