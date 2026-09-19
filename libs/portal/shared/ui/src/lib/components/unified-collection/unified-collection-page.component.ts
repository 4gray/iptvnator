import { NgTemplateOutlet } from '@angular/common';
import {
    AfterContentInit,
    ChangeDetectionStrategy,
    Component,
    computed,
    contentChild,
    DestroyRef,
    ElementRef,
    HostListener,
    inject,
    input,
    signal,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconButton } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelListSkeletonComponent } from '@iptvnator/ui/components';
import {
    clearNavigationStateKeys,
    CollectionContentType,
    CollectionScope,
    FavoritesChannelSortMode,
    getOpenLiveCollectionItemState,
    isWorkspaceLayoutRoute,
    isTypingInInput,
    LiveLayoutSidebarStateService,
    OPEN_LIVE_COLLECTION_ITEM_STATE_KEY,
    queryParamSignal,
    routeParamSignal,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { EmptyStateComponent } from '@iptvnator/playlist/shared/ui';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';
import { UnifiedGridTabComponent } from './unified-grid-tab.component';
import {
    createClearCollectionAction,
    setupClearCollectionViewCommand,
} from './unified-collection-clear-action';
import { createCollectionContentTypeState } from './unified-collection-content-type';
import {
    CollectionLoadRequest,
    CollectionMode,
    UnifiedCollectionDataService,
} from './unified-collection-data.service';
import {
    buildCollectionDetailNavigation,
    buildCollectionPortalNavigation,
} from './unified-collection-detail-navigation';
import { createCollectionDetailState } from './unified-collection-detail-state';
import { createFavoritesSortState } from './unified-collection-favorites-sort';
import {
    CollectionViewStateHistory,
    pushOpenCollectionDetailState,
    setupCollectionViewStateSync,
} from './unified-collection-history';
import { createCollectionModeLabels } from './unified-collection-labels';
import { setupCollectionLoad } from './unified-collection-load';
import { createCollectionScopeState } from './unified-collection-scope';
import { UnifiedCollectionDetailDirective } from './unified-collection-detail.directive';

@Component({
    selector: 'app-unified-collection-page',
    templateUrl: './unified-collection-page.component.html',
    styleUrl: './unified-collection-page.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [UnifiedCollectionDataService],
    imports: [
        ChannelListSkeletonComponent,
        EmptyStateComponent,
        NgTemplateOutlet,
        MatButtonToggleModule,
        MatIconButton,
        MatIconModule,
        MatMenuModule,
        MatProgressBar,
        MatTooltip,
        TranslatePipe,
        UnifiedGridTabComponent,
        UnifiedLiveTabComponent,
    ],
})
export class UnifiedCollectionPageComponent implements AfterContentInit {
    readonly mode = input<CollectionMode>('favorites');
    readonly portalType = input<string>();
    readonly playlistIdInput = input<string | undefined>(undefined, {
        alias: 'playlistId',
    });
    readonly defaultScope = input<CollectionScope>();

    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private readonly data = inject(UnifiedCollectionDataService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly liveSidebarStateService = inject(
        LiveLayoutSidebarStateService
    );
    readonly detailTemplate = contentChild(UnifiedCollectionDetailDirective);
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    private readonly routeSearchTerm = queryParamSignal(
        this.route,
        'q',
        (value) => (value ?? '').trim()
    );
    private readonly routePlaylistId = routeParamSignal<string | undefined>(
        this.route,
        'id',
        (value) => value ?? undefined
    );
    readonly playlistId = computed(
        () => this.playlistIdInput() ?? this.routePlaylistId()
    );
    readonly workspaceSearchTerm = computed(() =>
        this.isWorkspaceLayout ? this.routeSearchTerm() : ''
    );
    private readonly viewStateHistory = new CollectionViewStateHistory();

    readonly isLoading = this.data.isLoading;
    readonly isReloading = this.data.isReloading;
    readonly showReloadIndicator = this.data.showReloadIndicator;
    readonly allItems = this.data.allItems;
    readonly favoriteUidSet = this.data.favoriteUidSet;
    readonly supportsEpg = this.runtime.supportsEpg;
    readonly skeletonRows = Array.from({ length: 12 }, (_, i) => i);
    readonly skeletonCards = Array.from({ length: 8 }, (_, i) => i);
    readonly pendingAutoOpenLiveItem = signal(
        getOpenLiveCollectionItemState(window.history.state)
    );

    private readonly contentType = createCollectionContentTypeState(
        this.allItems,
        this.viewStateHistory.current()?.selectedContentType ?? 'live'
    );
    readonly selectedContentType = this.contentType.selected;
    readonly liveItems = this.contentType.liveItems;
    readonly movieItems = this.contentType.movieItems;
    readonly seriesItems = this.contentType.seriesItems;
    readonly hasLive = this.contentType.hasLive;
    readonly hasMovies = this.contentType.hasMovies;
    readonly hasSeries = this.contentType.hasSeries;
    readonly showContentToggle = this.contentType.showToggle;
    readonly currentTypeItems = this.contentType.currentTypeItems;
    readonly currentTypeLabelKey = this.contentType.currentTypeLabelKey;

    readonly scopeKey = computed(() => this.mode());
    private readonly scopeState = createCollectionScopeState({
        scopeKey: this.scopeKey,
        playlistId: this.playlistId,
        defaultScope: this.defaultScope,
        historyScope: computed(() => this.viewStateHistory.current()?.scope),
    });
    readonly scope = this.scopeState.scope;
    readonly showScopeToggle = this.scopeState.showToggle;
    readonly effectiveScope = this.scopeState.effective;
    /**
     * Scope of the rows on screen. Every action on them (Clear, drag
     * reorder) uses this instead of `effectiveScope()`, which already names
     * the requested scope while a reload is in flight — "This playlist"
     * against global rows would delete other playlists' favorites or write
     * foreign URLs into this playlist.
     */
    private readonly mutationRequest = computed<CollectionLoadRequest>(
        () =>
            this.data.loadedRequest() ?? {
                scope: this.effectiveScope(),
                playlistId: this.playlistId(),
                portalType: this.portalType(),
            }
    );

    private readonly labels = createCollectionModeLabels(this.mode);
    readonly title = this.labels.title;
    readonly clearButtonTooltipKey = this.labels.clearTooltipKey;
    readonly emptyStateIcon = this.labels.emptyStateIcon;
    readonly emptyStateTitleKey = this.labels.emptyStateTitleKey;
    readonly emptyStateBodyKey = this.labels.emptyStateBodyKey;

    private readonly favoritesSort = createFavoritesSortState();
    readonly favSortMode = this.favoritesSort.mode;
    readonly favSortLabelKey = this.favoritesSort.labelKey;
    readonly favSortOptions = this.favoritesSort.options;
    readonly showFavSortButton = computed(
        () =>
            this.mode() === 'favorites' &&
            this.selectedContentType() === 'live' &&
            this.hasLive()
    );
    readonly isSidebarCollapsed =
        this.liveSidebarStateService.isCollapsedFor('collection');
    readonly showSidebarToggle = computed(
        () => this.selectedContentType() === 'live' && this.hasLive()
    );

    private readonly loadEffect = setupCollectionLoad({
        mode: this.mode,
        portalType: this.portalType,
        playlistId: this.playlistId,
        scope: this.effectiveScope,
        load: (request) => void this.loadData(request),
    });
    private readonly viewStateSync = setupCollectionViewStateSync({
        history: this.viewStateHistory,
        selectedContentType: this.selectedContentType,
        scope: computed(() =>
            this.showScopeToggle() ? this.scope() : undefined
        ),
    });
    private readonly clearAction = createClearCollectionAction({
        mode: this.mode,
        items: this.currentTypeItems,
        typeLabelKey: this.currentTypeLabelKey,
        isPlaylistScope: () => this.mutationRequest().scope === 'playlist',
        data: this.data,
        dropCurrentType: () => this.dropCurrentContentType(),
        reload: () =>
            this.loadData({
                mode: this.mode(),
                portalType: this.portalType(),
                playlistId: this.playlistId(),
                scope: this.effectiveScope(),
            }),
    });
    private readonly detailState = createCollectionDetailState({
        mode: this.mode,
        portalType: this.portalType,
        detailTemplate: this.detailTemplate,
        onOpen: (contentType) => this.selectedContentType.set(contentType),
        onClear: () => this.autoSelectContentType(),
    });
    readonly selectedDetailItem = this.detailState.item;
    readonly selectedDetailSeriesResume = this.detailState.seriesResume;
    readonly detailContext = this.detailState.context;

    constructor() {
        setupClearCollectionViewCommand({
            isWorkspaceLayout: this.isWorkspaceLayout,
            mode: this.mode,
            selectedContentType: this.selectedContentType,
            currentTypeItems: this.currentTypeItems,
            labelKey: this.clearButtonTooltipKey,
            typeLabelKey: this.currentTypeLabelKey,
            run: () => this.clearAllCurrent(),
        });

        if (typeof window !== 'undefined') {
            const onPopState = () => {
                this.viewStateSync.restore();
                this.detailState.syncFromHistory();
            };
            window.addEventListener('popstate', onPopState);
            this.destroyRef.onDestroy(() => {
                window.removeEventListener('popstate', onPopState);
            });
        }
    }

    ngAfterContentInit(): void {
        this.viewStateSync.restore();
        this.detailState.syncFromHistory();
    }

    onScopeChange(value: CollectionScope): void {
        this.scopeState.select(value);
    }

    onContentTypeChange(value: CollectionContentType): void {
        this.selectedContentType.set(value);
    }

    goToDashboard(): void {
        void this.router.navigate(['/workspace', 'dashboard']);
    }

    toggleSidebar(): void {
        this.liveSidebarStateService.toggle('collection');
    }

    /**
     * Cmd/Ctrl+B mirrors the routed live layouts (M3U, Xtream, Stalker): the
     * hidden-list state advertises the shortcut, so the collection live tab
     * must honour it too. Only while that tab, and therefore the rail, is on
     * screen; the movies/series grids have nothing to hide.
     */
    @HostListener('document:keydown', ['$event'])
    handleSidebarShortcut(event: KeyboardEvent): void {
        if (
            this.showSidebarToggle() &&
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'b' &&
            !isTypingInInput(event) &&
            // Behind the workspace's phone context drawer the route content
            // is inert; this document-level listener still fires, so it
            // opts out itself instead of toggling an obscured rail.
            !this.hostElement.nativeElement.closest('[inert]')
        ) {
            event.preventDefault();
            this.toggleSidebar();
        }
    }

    setFavSortMode(mode: FavoritesChannelSortMode): void {
        this.favoritesSort.setMode(mode);
    }

    onGridItemSelected(item: UnifiedCollectionItem): void {
        this.viewStateSync.commitCurrent();

        if (this.detailState.canOpen(item)) {
            pushOpenCollectionDetailState(item);
            this.detailState.open(item);
            return;
        }

        const navigation =
            buildCollectionDetailNavigation(this.mode(), item) ??
            buildCollectionPortalNavigation(item, this.router.url);
        if (!navigation) {
            return;
        }

        void this.router.navigate(navigation.link, {
            state: navigation.state,
        });
    }

    async onRemoveItem(item: UnifiedCollectionItem): Promise<void> {
        await this.data.removeItem(this.mode(), item);
    }

    async onFavoriteToggled(item: UnifiedCollectionItem): Promise<void> {
        if (this.mode() !== 'recent') {
            return;
        }

        await this.data.toggleFavorite(item);
    }

    clearAllCurrent(): void {
        this.clearAction.run();
    }

    async onReorder(items: UnifiedCollectionItem[]): Promise<void> {
        await this.data.reorder(items, this.mutationRequest());
    }

    onItemPlayed(item: UnifiedCollectionItem): void {
        if (this.mode() !== 'recent') {
            return;
        }

        this.data.promoteRecentItem(item);
    }

    onLiveAutoOpenHandled(): void {
        this.pendingAutoOpenLiveItem.set(null);
        clearNavigationStateKeys([OPEN_LIVE_COLLECTION_ITEM_STATE_KEY]);
    }

    /** Take the just-cleared tab off screen and move to a remaining one. */
    private dropCurrentContentType(): void {
        this.data.dropContentType(this.selectedContentType());
        this.contentType.autoSelect();
    }

    private async loadData(
        params: CollectionLoadRequest & { mode: CollectionMode }
    ): Promise<void> {
        const items = await this.data.load(params);
        if (!items) {
            return;
        }

        this.autoSelectContentType();
        if (
            this.pendingAutoOpenLiveItem() &&
            items.some((item) => item.contentType === 'live')
        ) {
            this.selectedContentType.set('live');
        }
    }

    /** Never moves off the tab an open inline detail belongs to. */
    private autoSelectContentType(): void {
        if (this.selectedDetailItem()) {
            return;
        }

        this.contentType.autoSelect();
    }
}
