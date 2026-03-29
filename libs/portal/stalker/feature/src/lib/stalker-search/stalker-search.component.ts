import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    StalkerContentTypes,
    StalkerSelectedVodItem,
    StalkerSessionService,
    StalkerStore,
    StalkerVodSource,
    buildStalkerSelectedVodItem,
    clearStalkerDetailViewState,
    createPortalFavoritesResource,
    createRefreshTrigger,
    createStalkerDetailViewState,
    createStalkerInlineDetailState,
    isSelectedStalkerVodFavorite,
    isStalkerSeriesFlag,
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';
import {
    ContentCardComponent,
    SearchLayoutComponent,
} from '@iptvnator/portal/shared/ui';
import {
    createLogger,
    isWorkspaceLayoutRoute,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService } from 'services';
import {
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
    VodDetailsItem,
} from 'shared-interfaces';
import { firstValueFrom } from 'rxjs';
import { StalkerInlineDetailComponent } from '../stalker-inline-detail/stalker-inline-detail.component';

type StalkerSearchType = 'vod' | 'series';

type StalkerPlaylist = Playlist & {
    customPortalKey?: string;
    customPortalOriginalUrl?: string;
    isCustomPortal?: boolean;
};

interface StalkerFilter {
    key: StalkerSearchType;
    label: string;
    translationKey: string;
}

interface StalkerCategoryItem {
    category_id?: string | number;
    id?: string | number;
    title?: string;
    name?: string;
    category_name?: string;
}

interface StalkerCategoryResponse {
    js?:
    | StalkerCategoryItem[]
    | {
        data?: StalkerCategoryItem[];
        items?: StalkerCategoryItem[];
        categories?: StalkerCategoryItem[];
    };
}

interface StalkerSearchResponse {
    js?: {
        data?: StalkerVodSource[];
        items?: StalkerVodSource[];
        total_items?: number;
    };
    data?: StalkerVodSource[];
    message?: string;
    status?: number;
}

interface SearchResultItem {
    item: StalkerVodSource;
    resultType: StalkerSearchType;
}

interface RankedSearchResult {
    entry: SearchResultItem;
    score: number;
    dedupeKey: string;
    preferredType: StalkerSearchType;
    isSeasonLike: boolean;
}

@Component({
    selector: 'app-stalker-search',
    standalone: true,
    imports: [
        ContentCardComponent,
        FormsModule,
        MatCheckboxModule,
        SearchLayoutComponent,
        StalkerInlineDetailComponent,
        TranslatePipe,
    ],
    template: `
        <app-search-layout
            [searchTerm]="searchTerm()"
            [resultsCount]="resultsCount"
            [isLoading]="showMainSpinner()"
            [showCloseButton]="false"
            [showResultsCount]="true"
            [showSearchInput]="!isWorkspaceLayout"
            [showDetails]="showingDetails"
            (searchTermChange)="updateSearchTerm($event)"
        >
            <ng-container details>
                @if (showingDetails) {
                    <div class="details-view">
                        <app-stalker-inline-detail
                            [categoryId]="inlineDetail().categoryId"
                            [seriesItem]="inlineDetail().seriesItem"
                            [isSeries]="inlineDetail().isSeries"
                            [vodDetailsItem]="inlineDetail().vodDetailsItem"
                            [isFavorite]="isSelectedVodFavorite()"
                            (backClicked)="onVodBack()"
                            (playClicked)="onVodPlay($event)"
                            (favoriteToggled)="onVodFavoriteToggled($event)"
                        />
                    </div>
                }
            </ng-container>

            <ng-container filters>
                @for (filter of filterConfig; track filter.key) {
                    <mat-checkbox
                        [ngModel]="filters()[filter.key]"
                        (ngModelChange)="updateFilter(filter.key, $event)"
                    >
                        {{ filter.translationKey | translate }}
                    </mat-checkbox>
                }
            </ng-container>

            <ng-container subheader>
                @if (isCustomPortal()) {
                    <div class="search-helper-note">
                        Busca local na biblioteca desta playlist.
                    </div>
                }
                @if (isIndexingCatalog()) {
                    <div class="search-helper-note">
                        Indexando {{ selectedTypesLabel() }}...
                        @if (searchResults().length > 0) {
                            <span>Resultados parciais já apareceram abaixo.</span>
                        } @else {
                            <span>
                                Ainda não apareceu coincidência no trecho já indexado.
                            </span>
                        }
                    </div>
                }
                @if (!isIndexingCatalog() && !isSearching() && searchTerm().trim().length >= 3 && searchResults().length === 0 && !searchError()) {
                    <div class="search-helper-note">
                        Nenhum título encontrado com esse texto no filtro atual.
                    </div>
                }
                @if (searchError()) {
                    <div class="search-helper-note search-helper-note--error">
                        {{ searchError() }}
                    </div>
                }
            </ng-container>

            <ng-container results>
                <div class="results-grid">
                    @for (result of searchResults(); track trackItem(result)) {
                        <app-content-card
                            [posterUrl]="getPosterUrl(result.item)"
                            [title]="getItemTitle(result.item)"
                            [type]="getCardType(result)"
                            [showPlaceholder]="true"
                            (cardClick)="selectItem(result)"
                        />
                    }
                </div>
            </ng-container>
        </app-search-layout>
    `,
    styleUrl: './stalker-search.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerSearchComponent {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly dataService = inject(DataService);
    private readonly playlistService = inject(PlaylistsService);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly logger = createLogger('StalkerSearch');

    private readonly playlistId = computed(
        () => this.activatedRoute.parent?.snapshot.paramMap.get('id') ?? ''
    );

    readonly filters = signal<Record<StalkerSearchType, boolean>>({
        vod: true,
        series: true,
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
    readonly routeSearchTerm = queryParamSignal(
        this.activatedRoute,
        'q',
        (value) => (value ?? '').trim()
    );
    readonly searchTerm = signal('');
    readonly currentPlaylist = signal<StalkerPlaylist | null>(null);
    readonly searchResults = signal<SearchResultItem[]>([]);
    readonly isSearching = signal(false);
    readonly searchActivityStarted = signal(false);
    readonly activeCatalogBuilds = signal(0);
    readonly isIndexingCatalog = computed(() => this.activeCatalogBuilds() > 0);
    readonly searchError = signal('');
    readonly isCustomPortal = computed(() =>
        this.isCustomVodPortalPlaylist(this.currentPlaylist())
    );
    readonly selectedItemType = signal<StalkerSearchType>('vod');

    private readonly favoritesRefresh = createRefreshTrigger();
    private readonly cachedCatalogs = signal<Record<string, StalkerVodSource[]>>(
        {}
    );
    private readonly completedCatalogs = signal<Record<string, boolean>>({});
    private readonly buildCatalogPromises = new Map<
        string,
        Promise<StalkerVodSource[]>
    >();
    private readonly catalogProgressListeners = new Map<
        string,
        Set<() => void>
    >();
    private latestSearchRequestId = 0;

    itemDetails: StalkerSelectedVodItem | null = null;
    vodDetailsItem: VodDetailsItem | null = null;

    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => this.currentPlaylist()?._id,
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly isSelectedVodFavorite = signal<boolean>(false);

    constructor() {
        effect(() => {
            const playlistId = this.playlistId();
            void this.loadPlaylist(playlistId);
        });

        effect(() => {
            const routeTerm = this.routeSearchTerm();
            if (routeTerm !== this.searchTerm()) {
                this.searchTerm.set(routeTerm);
            }
        });

        effect(() => {
            const playlist = this.currentPlaylist();
            const term = this.searchTerm().trim();
            const filters = this.filters();
            void this.executeSearch(playlist, filters, term);
        });

        effect(() => {
            this.portalFavorites.value();
            this.syncSelectedVodFavorite();
        });
    }

    get showingDetails(): boolean {
        return this.inlineDetail().categoryId !== null;
    }

    get resultsCount(): number {
        return this.searchResults().length;
    }

    showMainSpinner(): boolean {
        return (
            this.isSearching() &&
            this.searchResults().length === 0 &&
            !this.searchActivityStarted()
        );
    }

    selectedTypesLabel(): string {
        const types = this.getSelectedTypes(this.filters());
        if (types.length === 2) {
            return 'filmes e séries';
        }

        return types[0] === 'series' ? 'séries' : 'filmes';
    }

    updateSearchTerm(term: string): void {
        this.searchTerm.set(term.trim());
    }

    updateFilter(key: StalkerSearchType, value: boolean): void {
        const nextFilters = {
            ...this.filters(),
            [key]: value,
        };

        if (!nextFilters.vod && !nextFilters.series) {
            return;
        }

        this.filters.set(nextFilters);
        this.clearSelection();
    }

    selectItem(result: SearchResultItem): void {
        const item = result.item;
        const itemType = result.resultType;
        const hasEmbeddedSeries = item.series?.length
            ? item.series.length > 0
            : false;
        const needsSeriesFetch =
            itemType === 'vod' &&
            !hasEmbeddedSeries &&
            isStalkerSeriesFlag(item.is_series);

        this.selectedItemType.set(itemType);
        this.itemDetails = buildStalkerSelectedVodItem(item, needsSeriesFetch);
        this.stalkerStore.setSelectedItem(this.itemDetails);

        if (itemType === 'series') {
            this.stalkerStore.setSelectedContentType('series');
            return;
        }

        this.stalkerStore.setSelectedContentType('vod');
        if (!hasEmbeddedSeries && !needsSeriesFetch) {
            const detailViewState = createStalkerDetailViewState(
                this.itemDetails,
                this.currentPlaylist()?._id ?? ''
            );
            this.itemDetails = detailViewState.itemDetails;
            this.vodDetailsItem = detailViewState.vodDetailsItem;
            this.syncSelectedVodFavorite();
            return;
        }

        const cleared = clearStalkerDetailViewState();
        this.vodDetailsItem = cleared.vodDetailsItem;
        this.isSelectedVodFavorite.set(false);
    }

    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            this.stalkerStore.createLinkToPlayVod(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image
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

    onVodBack(): void {
        this.clearSelection();
    }

    addToFavorites(item: Record<string, unknown>, onDone?: () => void): void {
        this.stalkerStore.addToFavorites(item, onDone);
    }

    removeFromFavorites(favoriteId: string, onDone?: () => void): void {
        this.stalkerStore.removeFromFavorites(favoriteId, onDone);
    }

    inlineDetail() {
        return createStalkerInlineDetailState(
            this.itemDetails,
            this.vodDetailsItem,
            this.selectedItemType() === 'series' ? 'series' : 'vod'
        );
    }

    getPosterUrl(item: StalkerVodSource): string {
        return (
            item.screenshot_uri ??
            item.cover ??
            item.logo ??
            item.info?.movie_image ??
            ''
        );
    }

    getItemTitle(item: StalkerVodSource): string {
        return String(
            item.name ?? item.o_name ?? item.title ?? item.info?.name ?? 'Untitled'
        ).trim();
    }

    getCardType(result: SearchResultItem): string {
        return result.resultType === 'series' || isStalkerSeriesFlag(result.item.is_series)
            ? 'series'
            : 'movie';
    }

    trackItem(result: SearchResultItem): string {
        return `${result.resultType}:${String(
            result.item.id ??
            result.item.movie_id ??
            result.item.stream_id ??
            result.item.series_id ??
            result.item.video_id ??
            this.getItemTitle(result.item)
        )}`;
    }

    private async loadPlaylist(playlistId: string): Promise<void> {
        if (!playlistId) {
            this.currentPlaylist.set(null);
            return;
        }

        const current = this.currentPlaylist();
        if (current?._id === playlistId) {
            return;
        }

        try {
            const playlist = await firstValueFrom(
                this.playlistService.getPlaylistById(playlistId)
            );
            this.currentPlaylist.set((playlist as StalkerPlaylist) ?? null);
        } catch (error) {
            this.logger.error('Failed to load playlist for search view', error);
            this.currentPlaylist.set(null);
        }
    }

    private async executeSearch(
        playlist: StalkerPlaylist | null,
        filters: Record<StalkerSearchType, boolean>,
        term: string
    ): Promise<void> {
        const normalizedTerm = term.trim();
        const requestId = ++this.latestSearchRequestId;
        const selectedTypes = this.getSelectedTypes(filters);

        if (normalizedTerm.length < 3 || !playlist || selectedTypes.length === 0) {
            this.searchResults.set([]);
            this.searchError.set('');
            this.isSearching.set(false);
            this.searchActivityStarted.set(false);
            return;
        }

        this.isSearching.set(true);
        this.searchError.set('');
        this.searchActivityStarted.set(false);

        const removeProgressListeners = selectedTypes.map((type) => {
            const cacheKey = this.getCatalogCacheKey(playlist, type);
            return this.addCatalogProgressListener(cacheKey, () => {
                if (requestId !== this.latestSearchRequestId) {
                    return;
                }

                this.searchActivityStarted.set(true);
                this.refreshLocalResults(playlist, selectedTypes, normalizedTerm);
            });
        });

        try {
            let results: SearchResultItem[];
            if (this.isCustomVodPortalPlaylist(playlist)) {
                results = this.refreshLocalResults(playlist, selectedTypes, normalizedTerm);

                const hasWarmCache = selectedTypes.some((type) => {
                    const cacheKey = this.getCatalogCacheKey(playlist, type);
                    return (this.cachedCatalogs()[cacheKey] ?? []).length > 0;
                });
                if (hasWarmCache) {
                    this.searchActivityStarted.set(true);
                }

                await Promise.all(
                    selectedTypes.map((type) => this.getOrBuildCatalog(playlist, type))
                );
                results = this.refreshLocalResults(playlist, selectedTypes, normalizedTerm);
            } else {
                const batches = await Promise.all(
                    selectedTypes.map(async (type) => {
                        const items = await this.searchRemoteCatalog(
                            playlist,
                            type,
                            normalizedTerm
                        );
                        return items.map((item) => ({ item, resultType: type }));
                    })
                );
                this.searchActivityStarted.set(true);
                const mergedBatches: SearchResultItem[] = [];
                for (const batch of batches) {
                    mergedBatches.push(...batch);
                }
                results = this.filterResultEntriesLocally(
                    mergedBatches,
                    normalizedTerm
                );
            }

            if (requestId !== this.latestSearchRequestId) {
                return;
            }

            this.searchResults.set(results);
        } catch (error) {
            this.logger.error('Search failed', error);
            if (requestId !== this.latestSearchRequestId) {
                return;
            }
            this.searchResults.set([]);
            this.searchError.set(
                'A busca não conseguiu carregar os resultados desta playlist.'
            );
        } finally {
            removeProgressListeners.forEach((removeListener) => removeListener());
            if (requestId === this.latestSearchRequestId) {
                this.isSearching.set(false);
            }
        }
    }

    private refreshLocalResults(
        playlist: StalkerPlaylist,
        selectedTypes: StalkerSearchType[],
        term: string
    ): SearchResultItem[] {
        const cachedCatalogs = this.cachedCatalogs();
        const entries: SearchResultItem[] = [];

        for (const type of selectedTypes) {
            const cacheKey = this.getCatalogCacheKey(playlist, type);
            const cachedItems = cachedCatalogs[cacheKey] ?? [];

            for (const item of cachedItems) {
                entries.push({
                    item,
                    resultType: type,
                });
            }
        }

        const filteredResults = this.filterResultEntriesLocally(entries, term);
        this.searchResults.set(filteredResults);
        return filteredResults;
    }

    private async getOrBuildCatalog(
        playlist: StalkerPlaylist,
        type: StalkerSearchType
    ): Promise<StalkerVodSource[]> {
        const cacheKey = this.getCatalogCacheKey(playlist, type);
        const cached = this.cachedCatalogs()[cacheKey];
        const isComplete = this.completedCatalogs()[cacheKey] === true;

        if (cached && isComplete) {
            return cached;
        }

        const existingPromise = this.buildCatalogPromises.get(cacheKey);
        if (existingPromise) {
            return existingPromise;
        }

        const promise = this.buildCatalogIndex(playlist, type, cacheKey)
            .then((items) => {
                this.cachedCatalogs.update((current) => ({
                    ...current,
                    [cacheKey]: items,
                }));
                this.completedCatalogs.update((current) => ({
                    ...current,
                    [cacheKey]: true,
                }));
                this.emitCatalogProgress(cacheKey);
                this.buildCatalogPromises.delete(cacheKey);
                return items;
            })
            .catch((error) => {
                this.buildCatalogPromises.delete(cacheKey);
                throw error;
            });

        this.buildCatalogPromises.set(cacheKey, promise);
        return promise;
    }

    private async buildCatalogIndex(
        playlist: StalkerPlaylist,
        type: StalkerSearchType,
        cacheKey: string
    ): Promise<StalkerVodSource[]> {
        this.activeCatalogBuilds.update((value) => value + 1);
        try {
            const categories = await this.loadCategories(playlist, type);
            const usableCategories = categories.filter((category) => {
                const id = this.readCategoryId(category);
                return !!id && id !== '*';
            });

            const uniqueItems = new Map<string, StalkerVodSource>();
            const categoryIds = usableCategories.length
                ? usableCategories.map((category) => this.readCategoryId(category))
                : ['*'];

            for (const categoryId of categoryIds) {
                let page = 1;
                let totalItems = Number.POSITIVE_INFINITY;
                let fetchedCount = 0;

                while (fetchedCount < totalItems) {
                    const response = await this.fetchOrderedListPage(
                        playlist,
                        type,
                        categoryId,
                        page,
                        100
                    );

                    const pageItems = response.items;
                    totalItems = response.totalItems ?? pageItems.length;

                    if (pageItems.length === 0) {
                        break;
                    }

                    for (const item of pageItems) {
                        uniqueItems.set(this.getItemCacheKey(item), item);
                    }

                    const partialItems = Array.from(uniqueItems.values());
                    this.cachedCatalogs.update((current) => ({
                        ...current,
                        [cacheKey]: partialItems,
                    }));
                    this.emitCatalogProgress(cacheKey);

                    fetchedCount += pageItems.length;
                    page += 1;

                    if (pageItems.length < 100) {
                        break;
                    }
                }
            }

            return Array.from(uniqueItems.values());
        } finally {
            this.activeCatalogBuilds.update((value) => Math.max(0, value - 1));
        }
    }

    private async loadCategories(
        playlist: StalkerPlaylist,
        type: StalkerSearchType
    ): Promise<StalkerCategoryItem[]> {
        const storeCategories =
            type === 'vod'
                ? this.stalkerStore.vodCategories?.() ?? []
                : this.stalkerStore.seriesCategories?.() ?? [];

        if (Array.isArray(storeCategories) && storeCategories.length > 0) {
            return storeCategories as StalkerCategoryItem[];
        }

        const queryParams: Record<string, string | number> = {
            action: StalkerContentTypes[type].getCategoryAction,
            type,
        };

        if (playlist.customPortalKey) {
            queryParams['customPortalKey'] = playlist.customPortalKey;
        }

        const response = await this.sendPortalRequest<StalkerCategoryResponse>(
            playlist,
            queryParams
        );
        const js = response?.js;

        if (Array.isArray(js)) {
            return js;
        }

        if (js?.data && Array.isArray(js.data)) {
            return js.data;
        }

        if (js?.items && Array.isArray(js.items)) {
            return js.items;
        }

        if (js?.categories && Array.isArray(js.categories)) {
            return js.categories;
        }

        return [];
    }

    private async fetchOrderedListPage(
        playlist: StalkerPlaylist,
        type: StalkerSearchType,
        categoryId: string,
        page: number,
        limit: number
    ): Promise<{ items: StalkerVodSource[]; totalItems?: number }> {
        const queryParams: Record<string, string | number> = {
            action: StalkerPortalActions.GetOrderedList,
            type,
            sortby: 'added',
            p: page,
            limit,
        };

        if (playlist.customPortalKey) {
            queryParams['customPortalKey'] = playlist.customPortalKey;
        }

        if (type === 'vod') {
            queryParams['genre'] = '0';
            queryParams['category'] = categoryId || '*';
        } else {
            queryParams['category'] = categoryId || '*';
        }

        const response = await this.sendPortalRequest<StalkerSearchResponse>(
            playlist,
            queryParams
        );
        return this.normalizeOrderedListResponse(response, playlist.portalUrl);
    }

    private async searchRemoteCatalog(
        playlist: StalkerPlaylist,
        type: StalkerSearchType,
        term: string
    ): Promise<StalkerVodSource[]> {
        const response = await this.sendPortalRequest<StalkerSearchResponse>(playlist, {
            action: StalkerContentTypes[type].getContentAction,
            type,
            search: term,
            max_page_items: 100,
        });

        return this.normalizeOrderedListResponse(response, playlist.portalUrl).items;
    }

    private async sendPortalRequest<T>(
        playlist: StalkerPlaylist,
        params: Record<string, string | number>
    ): Promise<T> {
        if (playlist.isFullStalkerPortal) {
            return this.stalkerSession.makeAuthenticatedRequest<T>(playlist, params);
        }

        const payload: Record<string, unknown> = {
            url: playlist.portalUrl,
            macAddress: playlist.macAddress,
            params,
        };

        if (playlist.customPortalKey) {
            payload['customPortalKey'] = playlist.customPortalKey;
        }

        return this.dataService.sendIpcEvent<T>(STALKER_REQUEST, payload);
    }

    private normalizeOrderedListResponse(
        response: StalkerSearchResponse | null | undefined,
        portalUrl: string
    ): { items: StalkerVodSource[]; totalItems?: number } {
        const js = response?.js;
        let items: StalkerVodSource[] = [];
        let totalItems: number | undefined;

        if (js?.data && Array.isArray(js.data)) {
            items = js.data;
            totalItems = js.total_items;
        } else if (js?.items && Array.isArray(js.items)) {
            items = js.items;
            totalItems = js.total_items;
        } else if (Array.isArray(response?.data)) {
            items = response?.data ?? [];
        }

        const normalizedItems = items
            .map((item) => this.processItemUrls(item, portalUrl))
            .filter((item) => this.normalize(this.getItemTitle(item)) !== 'next');

        return {
            items: normalizedItems,
            totalItems,
        };
    }

    private filterResultEntriesLocally(
        entries: SearchResultItem[],
        term: string
    ): SearchResultItem[] {
        const normalizedTerm = this.normalize(term);
        const queryTokens = normalizedTerm
            .split(/\s+/)
            .map((token) => token.trim())
            .filter(Boolean);

        if (!normalizedTerm || queryTokens.length === 0) {
            return [];
        }

        const rankedResults = entries
            .map((entry) => this.rankSearchResult(entry, normalizedTerm, queryTokens))
            .filter((candidate) => candidate.score > 0);

        const dedupedResults = new Map<string, RankedSearchResult>();

        for (const candidate of rankedResults) {
            const existing = dedupedResults.get(candidate.dedupeKey);
            if (!existing || this.shouldReplaceDedupedResult(existing, candidate)) {
                dedupedResults.set(candidate.dedupeKey, candidate);
            }
        }

        return Array.from(dedupedResults.values())
            .sort((left, right) => this.compareRankedResults(left, right))
            .map((candidate) => candidate.entry);
    }

    private rankSearchResult(
        entry: SearchResultItem,
        normalizedTerm: string,
        queryTokens: string[]
    ): RankedSearchResult {
        return {
            entry,
            score: this.getSearchMatchScore(entry.item, normalizedTerm, queryTokens),
            dedupeKey: this.getResultDedupeKey(entry),
            preferredType: this.getPreferredResultType(entry),
            isSeasonLike: this.isSeasonLikeTitle(this.getItemTitle(entry.item)),
        };
    }

    private shouldReplaceDedupedResult(
        current: RankedSearchResult,
        candidate: RankedSearchResult
    ): boolean {
        if (candidate.score !== current.score) {
            return candidate.score > current.score;
        }

        const currentMatchesPreferred =
            current.entry.resultType === current.preferredType;
        const candidateMatchesPreferred =
            candidate.entry.resultType === candidate.preferredType;

        if (candidateMatchesPreferred !== currentMatchesPreferred) {
            return candidateMatchesPreferred;
        }

        const currentTypeWeight = this.getTypePreferenceWeight(current);
        const candidateTypeWeight = this.getTypePreferenceWeight(candidate);
        if (candidateTypeWeight !== currentTypeWeight) {
            return candidateTypeWeight > currentTypeWeight;
        }

        return (
            this.compareTitlesNatural(
                this.getItemTitle(candidate.entry.item),
                this.getItemTitle(current.entry.item)
            ) < 0
        );
    }

    private compareRankedResults(
        left: RankedSearchResult,
        right: RankedSearchResult
    ): number {
        if (right.score !== left.score) {
            return right.score - left.score;
        }

        if (left.isSeasonLike !== right.isSeasonLike) {
            return left.isSeasonLike ? 1 : -1;
        }

        const leftTypeWeight = this.getTypePreferenceWeight(left);
        const rightTypeWeight = this.getTypePreferenceWeight(right);
        if (rightTypeWeight !== leftTypeWeight) {
            return rightTypeWeight - leftTypeWeight;
        }

        const byTitle = this.compareTitlesNatural(
            this.getItemTitle(left.entry.item),
            this.getItemTitle(right.entry.item)
        );
        if (byTitle !== 0) {
            return byTitle;
        }

        return this.compareTitlesNatural(
            this.getPosterUrl(left.entry.item),
            this.getPosterUrl(right.entry.item)
        );
    }

    private getResultDedupeKey(entry: SearchResultItem): string {
        const titleKey = this.normalize(this.getItemTitle(entry.item));
        const posterKey = this.normalizePosterKey(this.getPosterUrl(entry.item));
        const cmdKey = this.normalizeCmdKey(entry.item.cmd);
        const rawYear = entry.item.year ?? entry.item.releasedate ?? entry.item.info?.releasedate ?? '';
        const yearKey = this.normalize(String(rawYear).match(/\d{4}/)?.[0] ?? String(rawYear));

        return [titleKey, posterKey, cmdKey, yearKey].filter(Boolean).join('::');
    }

    private getPreferredResultType(entry: SearchResultItem): StalkerSearchType {
        if (
            entry.resultType === 'series' ||
            isStalkerSeriesFlag(entry.item.is_series) ||
            this.isSeasonLikeTitle(this.getItemTitle(entry.item))
        ) {
            return 'series';
        }

        return 'vod';
    }

    private getTypePreferenceWeight(result: RankedSearchResult): number {
        if (result.entry.resultType === result.preferredType) {
            return 2;
        }

        return result.entry.resultType === 'vod' ? 1 : 0;
    }

    private isSeasonLikeTitle(title: string): boolean {
        const normalizedTitle = this.normalize(title);

        return /(\bseason\b|сезон|temporada|stagione|staffel|s\d{1,2}\b)/u.test(
            normalizedTitle
        );
    }

    private compareTitlesNatural(left: string, right: string): number {
        return left.localeCompare(right, undefined, {
            sensitivity: 'base',
            numeric: true,
        });
    }

    private normalizePosterKey(value: string): string {
        const normalizedValue = String(value ?? '').trim();
        if (!normalizedValue) {
            return '';
        }

        const withoutQuery = normalizedValue.split('?')[0];
        const segments = withoutQuery.split('/').filter(Boolean);
        return this.normalize(segments[segments.length - 1] ?? withoutQuery);
    }

    private normalizeCmdKey(value: unknown): string {
        const normalizedValue = String(value ?? '').trim();
        if (!normalizedValue) {
            return '';
        }

        const withoutParams = normalizedValue.split(' ').pop() ?? normalizedValue;
        const withoutQuery = withoutParams.split('?')[0];
        const segments = withoutQuery.split('/').filter(Boolean);
        return this.normalize(segments[segments.length - 1] ?? withoutQuery);
    }

    private getSearchMatchScore(
        item: StalkerVodSource,
        normalizedTerm: string,
        queryTokens: string[]
    ): number {
        const candidates = this.getNormalizedTitleCandidates(item);
        if (candidates.length === 0) {
            return 0;
        }

        let bestScore = 0;

        for (const candidate of candidates) {
            if (!queryTokens.every((token) => candidate.includes(token))) {
                continue;
            }

            if (candidate === normalizedTerm) {
                bestScore = Math.max(bestScore, 500);
                continue;
            }

            if (candidate.startsWith(normalizedTerm)) {
                bestScore = Math.max(bestScore, 400);
                continue;
            }

            if (
                candidate
                    .split(/[^\p{L}\p{N}]+/u)
                    .some((word) => word.startsWith(normalizedTerm))
            ) {
                bestScore = Math.max(bestScore, 300);
                continue;
            }

            if (candidate.includes(normalizedTerm)) {
                bestScore = Math.max(bestScore, 200);
            }
        }

        return bestScore;
    }

    private getNormalizedTitleCandidates(item: StalkerVodSource): string[] {
        return Array.from(
            new Set(
                [item.name, item.o_name, item.title, item.info?.name]
                    .map((value) => this.normalize(String(value ?? '')))
                    .filter(Boolean)
            )
        );
    }

    private normalize(value: string): string {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .trim()
            .toLowerCase();
    }

    private readCategoryId(category: StalkerCategoryItem): string {
        return String(category.category_id ?? category.id ?? '').trim();
    }

    private getCatalogCacheKey(
        playlist: StalkerPlaylist,
        type: StalkerSearchType
    ): string {
        return `${playlist._id}:${type}`;
    }

    private addCatalogProgressListener(
        cacheKey: string,
        listener: () => void
    ): () => void {
        const listeners = this.catalogProgressListeners.get(cacheKey) ?? new Set();
        listeners.add(listener);
        this.catalogProgressListeners.set(cacheKey, listeners);

        return () => {
            const currentListeners = this.catalogProgressListeners.get(cacheKey);
            if (!currentListeners) {
                return;
            }

            currentListeners.delete(listener);
            if (currentListeners.size === 0) {
                this.catalogProgressListeners.delete(cacheKey);
            }
        };
    }

    private emitCatalogProgress(cacheKey: string): void {
        const listeners = this.catalogProgressListeners.get(cacheKey);
        if (!listeners || listeners.size === 0) {
            return;
        }

        for (const listener of listeners) {
            listener();
        }
    }

    private getSelectedTypes(
        filters: Record<StalkerSearchType, boolean>
    ): StalkerSearchType[] {
        return (Object.entries(filters) as Array<[StalkerSearchType, boolean]>)
            .filter(([, enabled]) => enabled)
            .map(([type]) => type);
    }

    private getItemCacheKey(item: StalkerVodSource): string {
        return String(
            item.id ??
            item.movie_id ??
            item.stream_id ??
            item.series_id ??
            item.video_id ??
            this.getItemTitle(item)
        );
    }

    private syncSelectedVodFavorite(): void {
        this.isSelectedVodFavorite.set(
            isSelectedStalkerVodFavorite(
                this.vodDetailsItem,
                this.portalFavorites.value() ?? []
            )
        );
    }

    private clearSelection(): void {
        const cleared = clearStalkerDetailViewState();
        this.itemDetails = cleared.itemDetails;
        this.vodDetailsItem = cleared.vodDetailsItem;
        this.isSelectedVodFavorite.set(false);
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

        if (processed.cover) {
            processed.cover = this.makeAbsoluteUrl(portalUrl, processed.cover);
        }

        if (processed.logo) {
            processed.logo = this.makeAbsoluteUrl(portalUrl, processed.logo);
        }

        return processed;
    }

    private makeAbsoluteUrl(baseUrl: string, relativePath: string): string {
        if (!relativePath) {
            return '';
        }

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

    private isCustomVodPortalPlaylist(
        playlist: StalkerPlaylist | null | undefined
    ): boolean {
        if (!playlist?.macAddress) {
            return false;
        }

        const originalUrl = String(playlist.customPortalOriginalUrl ?? '').trim();
        const portalUrl = String(playlist.portalUrl ?? '').trim();

        return Boolean(
            playlist.customPortalKey ||
            playlist.isCustomPortal ||
            /\/api\/v1\/?$/i.test(originalUrl) ||
            /\/api\/v1\/?$/i.test(portalUrl)
        );
    }
}