import { NgTemplateOutlet } from '@angular/common';
import {
    AfterContentInit,
    ChangeDetectionStrategy,
    Component,
    computed,
    contentChild,
    DestroyRef,
    effect,
    inject,
    linkedSignal,
    input,
    signal,
    untracked,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconButton } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ChannelListSkeletonComponent, DialogService } from '@iptvnator/ui/components';
import {
    buildGlobalCollectionDetailNavigationTarget,
    buildCollectionViewState,
    buildOpenCollectionDetailItemState,
    clearNavigationStateKeys,
    COLLECTION_VIEW_STATE_KEY,
    CollectionContentType,
    CollectionScope,
    CollectionViewState,
    FavoritesChannelSortMode,
    getFavoritesChannelSortModeTranslationKey,
    getOpenCollectionDetailItemState,
    getCollectionViewState,
    getOpenLiveCollectionItemState,
    getUnifiedCollectionNavigation,
    isWorkspaceLayoutRoute,
    LiveLayoutSidebarStateService,
    OPEN_COLLECTION_DETAIL_STATE_KEY,
    OPEN_LIVE_COLLECTION_ITEM_STATE_KEY,
    persistFavoritesChannelSortMode,
    queryParamSignal,
    restoreFavoritesChannelSortMode,
    routeParamSignal,
    ScopeToggleService,
    STALKER_RETURN_TO_STATE_KEY,
    UnifiedCollectionItem,
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
    WorkspaceViewCommandService,
} from '@iptvnator/portal/shared/util';
import { selectAllPlaylistsMeta, selectPlaylistsLoadingFlag } from '@iptvnator/m3u-state';
import { EmptyStateComponent } from '@iptvnator/playlist/shared/ui';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';
import { UnifiedGridTabComponent } from './unified-grid-tab.component';
import {
    UnifiedCollectionDetailContext,
    UnifiedCollectionDetailDirective,
} from './unified-collection-detail.directive';

@Component({
    selector: 'app-unified-collection-page',
    templateUrl: './unified-collection-page.component.html',
    styleUrl: './unified-collection-page.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListSkeletonComponent,
        EmptyStateComponent,
        NgTemplateOutlet,
        MatButtonToggleModule,
        MatIconButton,
        MatIconModule,
        MatMenuModule,
        MatTooltip,
        TranslatePipe,
        UnifiedGridTabComponent,
        UnifiedLiveTabComponent,
    ],
})
export class UnifiedCollectionPageComponent implements AfterContentInit {
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly portalType = input<string>();
    readonly playlistIdInput = input<string | undefined>(undefined, {
        alias: 'playlistId',
    });
    readonly defaultScope = input<CollectionScope>();

    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly destroyRef = inject(DestroyRef);
    private readonly scopeService = inject(ScopeToggleService);
    private readonly favoritesData = inject(UnifiedFavoritesDataService);
    private readonly recentData = inject(UnifiedRecentDataService);
    private readonly dialogService = inject(DialogService);
    private readonly translate = inject(TranslateService);
    private readonly workspaceViewCommands = inject(WorkspaceViewCommandService);
    private readonly liveSidebarStateService = inject(
        LiveLayoutSidebarStateService
    );
    readonly detailTemplate = contentChild(UnifiedCollectionDetailDirective);
    private readonly playlists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );
    private readonly playlistsLoaded = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    private readonly queryScope = queryParamSignal<CollectionScope | null>(
        this.route,
        'scope',
        (value) => (value === 'all' || value === 'playlist' ? value : null)
    );
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
    private readonly historyCollectionViewState =
        signal<CollectionViewState | null>(
            getCollectionViewState(window.history.state)
        );

    readonly isLoading = signal(true);
    readonly allItems = signal<UnifiedCollectionItem[]>([]);
    readonly favoriteUidSet = signal<ReadonlySet<string>>(new Set<string>());
    readonly selectedContentType = signal<CollectionContentType>(
        this.historyCollectionViewState()?.selectedContentType ?? 'live'
    );
    readonly selectedDetailItem = signal<UnifiedCollectionItem | null>(null);
    readonly pendingAutoOpenLiveItem = signal(
        getOpenLiveCollectionItemState(window.history.state)
    );
    readonly detailContext = computed<UnifiedCollectionDetailContext | null>(
        () => {
            const item = this.selectedDetailItem();
            if (!item) {
                return null;
            }

            return {
                $implicit: item,
                item,
                close: this.requestCloseDetail,
            };
        }
    );

    readonly skeletonRows = Array.from({ length: 12 }, (_, i) => i);
    readonly skeletonCards = Array.from({ length: 8 }, (_, i) => i);

    readonly scopeKey = computed(() => this.mode());
    private readonly persistedScope = computed(() =>
        this.scopeService.getScope(this.scopeKey())()
    );
    readonly scope = linkedSignal<CollectionScope>(() => {
        if (!this.showScopeToggle()) {
            return 'all';
        }

        const queryScope = this.queryScope();
        if (queryScope) {
            return queryScope;
        }

        const historyScope = this.historyCollectionViewState()?.scope;
        if (historyScope) {
            return historyScope;
        }

        const defaultScope = this.defaultScope();
        if (defaultScope) {
            return defaultScope;
        }

        return this.persistedScope();
    });
    readonly showScopeToggle = computed(() => Boolean(this.playlistId()));
    readonly effectiveScope = computed<CollectionScope>(() =>
        this.showScopeToggle() ? this.scope() : 'all'
    );

    readonly liveItems = computed(() =>
        this.allItems().filter((i) => i.contentType === 'live')
    );
    readonly movieItems = computed(() =>
        this.allItems().filter((i) => i.contentType === 'movie')
    );
    readonly seriesItems = computed(() =>
        this.allItems().filter((i) => i.contentType === 'series')
    );

    readonly hasLive = computed(() => this.liveItems().length > 0);
    readonly hasMovies = computed(() => this.movieItems().length > 0);
    readonly hasSeries = computed(() => this.seriesItems().length > 0);

    readonly availableTypes = computed(() => {
        const types: CollectionContentType[] = [];
        if (this.hasLive()) types.push('live');
        if (this.hasMovies()) types.push('movie');
        if (this.hasSeries()) types.push('series');
        return types;
    });

    readonly showContentToggle = computed(
        () => this.availableTypes().length > 1
    );

    readonly currentTypeItems = computed(() => {
        switch (this.selectedContentType()) {
            case 'live':
                return this.liveItems();
            case 'movie':
                return this.movieItems();
            case 'series':
                return this.seriesItems();
        }
    });

    readonly currentTypeLabelKey = computed(() => {
        switch (this.selectedContentType()) {
            case 'live':
                return 'PORTALS.LIVE_TV';
            case 'movie':
                return 'PORTALS.MOVIES';
            case 'series':
                return 'PORTALS.SERIES';
        }
    });

    readonly clearButtonTooltipKey = computed(() =>
        this.mode() === 'favorites'
            ? 'WORKSPACE.SHELL.CLEAR_FAVORITES_TYPE'
            : 'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_TYPE'
    );

    readonly title = computed(() => {
        return this.mode() === 'favorites'
            ? 'PORTALS.FAVORITES'
            : 'PORTALS.RECENTLY_VIEWED';
    });

    readonly favSortMode = signal<FavoritesChannelSortMode>(
        restoreFavoritesChannelSortMode()
    );
    readonly favSortLabelKey = computed(() =>
        getFavoritesChannelSortModeTranslationKey(this.favSortMode())
    );
    readonly showFavSortButton = computed(
        () =>
            this.mode() === 'favorites' &&
            this.selectedContentType() === 'live' &&
            this.hasLive()
    );
    readonly isSidebarCollapsed = this.liveSidebarStateService.isCollapsed;
    readonly showSidebarToggle = computed(
        () => this.selectedContentType() === 'live' && this.hasLive()
    );
    readonly favSortOptions: ReadonlyArray<{
        mode: FavoritesChannelSortMode;
        translationKey: string;
        icon: string;
    }> = [
        {
            mode: 'custom',
            translationKey: 'WORKSPACE.SORT_CUSTOM',
            icon: 'drag_indicator',
        },
        {
            mode: 'name-asc',
            translationKey: 'WORKSPACE.SORT_NAME_ASC',
            icon: 'sort_by_alpha',
        },
        {
            mode: 'name-desc',
            translationKey: 'WORKSPACE.SORT_NAME_DESC',
            icon: 'sort_by_alpha',
        },
        {
            mode: 'date-desc',
            translationKey: 'WORKSPACE.SORT_DATE_DESC',
            icon: 'schedule',
        },
    ];

    private readonly favoritesReloadKey = computed(() => {
        if (this.mode() !== 'favorites') {
            return 'recent';
        }

        if (!this.playlistsLoaded()) {
            return null;
        }

        return this.playlists()
            .map((playlist) =>
                [
                    playlist._id,
                    playlist.serverUrl
                        ? 'xtream'
                        : playlist.macAddress
                          ? 'stalker'
                          : 'm3u',
                    JSON.stringify(playlist.favorites ?? []),
                ].join('::')
            )
            .join('|');
    });
    private readonly loadRequest = computed(() => ({
        mode: this.mode(),
        portalType: this.portalType(),
        playlistId: this.playlistId(),
        scope: this.effectiveScope(),
        reloadKey: this.favoritesReloadKey(),
    }));

    private loadRequestId = 0;

    private readonly loadEffect = effect(() => {
        const { mode, portalType, playlistId, scope } = this.loadRequest();
        untracked(() => {
            void this.loadData({
                mode,
                portalType,
                playlistId,
                scope,
            });
        });
    });
    private readonly persistCollectionViewState = effect(() => {
        const selectedContentType = this.selectedContentType();
        const scope = this.showScopeToggle() ? this.scope() : undefined;

        untracked(() => {
            this.syncCollectionViewStateToHistory({
                selectedContentType,
                scope,
            });
        });
    });
    private readonly crossProviderDetailRedirect = effect(() => {
        const item = this.selectedDetailItem();
        if (!item || this.canRenderInlineDetailOnCurrentRoute(item)) {
            return;
        }

        const navigation = this.getGlobalCollectionDetailNavigation(item);
        if (!navigation) {
            return;
        }

        untracked(() => {
            this.selectedDetailItem.set(null);
            void this.router.navigate(navigation.link, {
                state: navigation.state,
            });
        });
    });
    private readonly workspaceCommandEffect = effect((onCleanup) => {
        if (!this.isWorkspaceLayout) {
            return;
        }

        const items = this.currentTypeItems();
        if (items.length === 0) {
            return;
        }

        const unregister = this.workspaceViewCommands.registerCommand({
            id: `unified-collection-clear-current-${this.mode()}`,
            group: 'view',
            icon: 'delete_sweep',
            labelKey: this.clearButtonTooltipKey(),
            labelParams: () => ({
                type: this.translate.instant(this.currentTypeLabelKey()),
            }),
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.CLEAR_CURRENT_VIEW_DESCRIPTION',
            descriptionParams: () => ({
                type: this.translate.instant(this.currentTypeLabelKey()),
            }),
            keywords: () =>
                this.mode() === 'favorites'
                    ? ['clear', 'favorites', 'remove', this.selectedContentType()]
                    : ['clear', 'recent', 'history', this.selectedContentType()],
            priority: 10,
            run: () => this.clearAllCurrent(),
        });

        onCleanup(unregister);
    });

    constructor() {
        if (typeof window !== 'undefined') {
            const onPopState = () => {
                this.syncCollectionViewStateFromHistory();
                this.syncDetailFromHistoryState();
            };
            window.addEventListener('popstate', onPopState);
            this.destroyRef.onDestroy(() => {
                window.removeEventListener('popstate', onPopState);
            });
        }
    }

    ngAfterContentInit(): void {
        this.syncCollectionViewStateFromHistory();
        this.syncDetailFromHistoryState();
    }

    onScopeChange(value: CollectionScope): void {
        if (!this.showScopeToggle()) {
            return;
        }

        this.scope.set(value);
        this.scopeService.setScope(this.scopeKey(), value);
    }

    onContentTypeChange(value: CollectionContentType): void {
        this.selectedContentType.set(value);
    }

    readonly emptyStateIcon = computed(() =>
        this.mode() === 'favorites' ? 'favorite_border' : 'history_toggle_off'
    );

    readonly emptyStateTitleKey = computed(() =>
        this.mode() === 'favorites'
            ? 'WORKSPACE.GLOBAL_FAVORITES.NO_ITEMS_TITLE'
            : 'WORKSPACE.GLOBAL_RECENT.NO_ITEMS_TITLE'
    );

    readonly emptyStateBodyKey = computed(() =>
        this.mode() === 'favorites'
            ? 'WORKSPACE.GLOBAL_FAVORITES.NO_ITEMS_BODY'
            : 'WORKSPACE.GLOBAL_RECENT.NO_ITEMS_BODY'
    );

    goToDashboard(): void {
        void this.router.navigate(['/workspace', 'dashboard']);
    }

    toggleSidebar(): void {
        this.liveSidebarStateService.toggle();
    }

    setFavSortMode(mode: FavoritesChannelSortMode): void {
        this.favSortMode.set(mode);
        persistFavoritesChannelSortMode(mode);
    }

    onGridItemSelected(item: UnifiedCollectionItem): void {
        this.syncCurrentCollectionViewState();

        if (this.canOpenInlineDetail(item)) {
            this.pushInlineDetailState(item);
            this.openInlineDetail(item);
            return;
        }

        const globalDetailNavigation =
            this.getGlobalCollectionDetailNavigation(item);
        if (globalDetailNavigation) {
            void this.router.navigate(globalDetailNavigation.link, {
                state: globalDetailNavigation.state,
            });
            return;
        }

        const navigation = getUnifiedCollectionNavigation(item);
        if (!navigation) {
            return;
        }

        const state =
            item.sourceType === 'stalker' && item.contentType !== 'live'
                ? {
                      ...(navigation.state ?? {}),
                      [STALKER_RETURN_TO_STATE_KEY]: this.router.url,
                  }
                : navigation.state;

        void this.router.navigate(navigation.link, { state });
    }

    async onRemoveItem(item: UnifiedCollectionItem): Promise<void> {
        if (this.mode() === 'favorites') {
            await this.favoritesData.removeFavorite(item);
            this.favoriteUidSet.update((favoriteUids) => {
                const nextFavoriteUids = new Set(favoriteUids);
                nextFavoriteUids.delete(item.uid);
                return nextFavoriteUids;
            });
        } else {
            await this.recentData.removeRecentItem(item);
        }
        this.allItems.update((items) =>
            items.filter((i) => i.uid !== item.uid)
        );
    }

    async onFavoriteToggled(item: UnifiedCollectionItem): Promise<void> {
        if (this.mode() !== 'recent') {
            return;
        }

        const nextFavoriteUids = new Set(this.favoriteUidSet());

        if (nextFavoriteUids.has(item.uid)) {
            await this.favoritesData.removeFavorite(item);
            nextFavoriteUids.delete(item.uid);
        } else {
            await this.favoritesData.addFavorite(item);
            nextFavoriteUids.add(item.uid);
        }

        this.favoriteUidSet.set(nextFavoriteUids);
    }

    clearAllCurrent(): void {
        const itemsToRemove = this.currentTypeItems();
        if (itemsToRemove.length === 0) {
            return;
        }

        const isFavorites = this.mode() === 'favorites';
        const type = this.translate.instant(this.currentTypeLabelKey());
        const isPlaylistScope = this.effectiveScope() === 'playlist';
        const titleKey = isFavorites
            ? 'WORKSPACE.SHELL.CLEAR_FAVORITES_DIALOG_TITLE'
            : 'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_DIALOG_TITLE';
        const messageKey = isFavorites
            ? isPlaylistScope
                ? 'WORKSPACE.SHELL.CLEAR_FAVORITES_DIALOG_MESSAGE_PLAYLIST'
                : 'WORKSPACE.SHELL.CLEAR_FAVORITES_DIALOG_MESSAGE_ALL'
            : isPlaylistScope
              ? 'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_DIALOG_MESSAGE_PLAYLIST'
              : 'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_DIALOG_MESSAGE_ALL';

        this.dialogService.openConfirmDialog({
            title: this.translate.instant(titleKey, { type }),
            message: this.translate.instant(messageKey, { type }),
            onConfirm: async () => {
                if (isFavorites) {
                    await this.clearCurrentFavorites(itemsToRemove);
                    return;
                }

                const removedType = this.selectedContentType();
                this.allItems.update((items) =>
                    items.filter((item) => item.contentType !== removedType)
                );
                const remaining = this.availableTypes();
                if (remaining.length > 0) {
                    this.selectedContentType.set(remaining[0]);
                }
                void this.recentData.removeRecentItemsBatch(itemsToRemove);
            },
        });
    }

    async onReorder(items: UnifiedCollectionItem[]): Promise<void> {
        const nonLive = this.allItems().filter((i) => i.contentType !== 'live');
        this.allItems.set([...items, ...nonLive]);
        await this.favoritesData.reorder(items, {
            scope: this.effectiveScope(),
            playlistId: this.playlistId(),
            portalType: this.portalType(),
        });
    }

    onItemPlayed(item: UnifiedCollectionItem): void {
        if (this.mode() !== 'recent') {
            return;
        }

        this.allItems.update((items) => {
            const nextItems = [
                item,
                ...items.filter((candidate) => candidate.uid !== item.uid),
            ];
            return nextItems.sort(
                (a, b) =>
                    new Date(b.viewedAt ?? 0).getTime() -
                    new Date(a.viewedAt ?? 0).getTime()
            );
        });
    }

    private async clearCurrentFavorites(
        itemsToRemove: UnifiedCollectionItem[]
    ): Promise<void> {
        const removedType = this.selectedContentType();
        this.allItems.update((items) =>
            items.filter((item) => item.contentType !== removedType)
        );
        const remaining = this.availableTypes();
        if (remaining.length > 0) {
            this.selectedContentType.set(remaining[0]);
        }

        try {
            await this.favoritesData.clearFavorites(itemsToRemove);
        } catch {
            await this.reloadCurrentCollection();
        }
    }

    private async loadData(params: {
        mode: 'favorites' | 'recent';
        portalType?: string;
        playlistId?: string;
        scope: CollectionScope;
    }): Promise<void> {
        const requestId = ++this.loadRequestId;
        if (this.allItems().length === 0) {
            this.isLoading.set(true);
        }

        try {
            const items =
                params.mode === 'favorites'
                    ? await this.favoritesData.getFavorites(
                          params.scope,
                          params.playlistId,
                          params.portalType
                      )
                    : await this.recentData.getRecentItems(
                          params.scope,
                          params.playlistId,
                          params.portalType
                      );
            const favoriteUids =
                params.mode === 'favorites'
                    ? new Set(items.map((item) => item.uid))
                    : await this.loadFavoriteUidSet(params);
            if (requestId !== this.loadRequestId) {
                return;
            }
            this.allItems.set(items);
            this.favoriteUidSet.set(favoriteUids);
            this.autoSelectContentType();
            if (
                this.pendingAutoOpenLiveItem() &&
                items.some((item) => item.contentType === 'live')
            ) {
                this.selectedContentType.set('live');
            }
        } catch {
            if (requestId !== this.loadRequestId) {
                return;
            }
            this.allItems.set([]);
        } finally {
            if (requestId === this.loadRequestId) {
                this.isLoading.set(false);
            }
        }
    }

    private async reloadCurrentCollection(): Promise<void> {
        await this.loadData({
            mode: this.mode(),
            portalType: this.portalType(),
            playlistId: this.playlistId(),
            scope: this.effectiveScope(),
        });
    }

    private async loadFavoriteUidSet(params: {
        portalType?: string;
        playlistId?: string;
        scope: CollectionScope;
    }): Promise<ReadonlySet<string>> {
        try {
            const favorites = await this.favoritesData.getFavorites(
                params.scope,
                params.playlistId,
                params.portalType
            );
            return new Set(favorites.map((item) => item.uid));
        } catch {
            return new Set<string>();
        }
    }

    private autoSelectContentType(): void {
        if (this.selectedDetailItem()) {
            return;
        }

        const types = this.availableTypes();
        if (types.length > 0 && !types.includes(this.selectedContentType())) {
            this.selectedContentType.set(types[0]);
        }
    }

    onLiveAutoOpenHandled(): void {
        this.pendingAutoOpenLiveItem.set(null);
        clearNavigationStateKeys([OPEN_LIVE_COLLECTION_ITEM_STATE_KEY]);
    }

    private readonly requestCloseDetail = (): void => {
        if (getOpenCollectionDetailItemState(window.history.state)) {
            window.history.back();
            return;
        }

        this.clearInlineDetail();
    };

    private canOpenInlineDetail(item: UnifiedCollectionItem): boolean {
        return (
            Boolean(this.detailTemplate()) &&
            item.contentType !== 'live' &&
            (item.sourceType === 'xtream' || item.sourceType === 'stalker') &&
            this.canRenderInlineDetailOnCurrentRoute(item)
        );
    }

    private canRenderInlineDetailOnCurrentRoute(
        item: UnifiedCollectionItem
    ): boolean {
        const url = this.router.url;

        if (url.includes('/workspace/xtreams/')) {
            return item.sourceType === 'xtream';
        }

        if (url.includes('/workspace/stalker/')) {
            return item.sourceType === 'stalker';
        }

        if (
            url.includes('/workspace/global-favorites') ||
            url.includes('/workspace/global-recent')
        ) {
            return (
                item.sourceType === 'xtream' || item.sourceType === 'stalker'
            );
        }

        const portalType = this.portalType();
        return !portalType || portalType === item.sourceType;
    }

    private getGlobalCollectionDetailNavigation(item: UnifiedCollectionItem) {
        if (
            item.contentType === 'live' ||
            (item.sourceType !== 'xtream' && item.sourceType !== 'stalker')
        ) {
            return null;
        }

        return buildGlobalCollectionDetailNavigationTarget(this.mode(), item);
    }

    private openInlineDetail(item: UnifiedCollectionItem): void {
        this.selectedContentType.set(item.contentType);
        this.selectedDetailItem.set(item);
    }

    private clearInlineDetail(): void {
        this.selectedDetailItem.set(null);
        this.autoSelectContentType();
        clearNavigationStateKeys([OPEN_COLLECTION_DETAIL_STATE_KEY]);
    }

    private pushInlineDetailState(item: UnifiedCollectionItem): void {
        const currentState = window.history.state ?? {};
        window.history.pushState(
            {
                ...currentState,
                [OPEN_COLLECTION_DETAIL_STATE_KEY]:
                    buildOpenCollectionDetailItemState(item),
            },
            document.title
        );
    }

    private syncCollectionViewStateFromHistory(): void {
        const collectionViewState = getCollectionViewState(
            window.history.state
        );
        this.historyCollectionViewState.set(collectionViewState);

        if (collectionViewState?.selectedContentType) {
            this.selectedContentType.set(
                collectionViewState.selectedContentType
            );
        }
    }

    private syncCurrentCollectionViewState(): void {
        this.syncCollectionViewStateToHistory({
            selectedContentType: this.selectedContentType(),
            scope: this.showScopeToggle() ? this.scope() : undefined,
        });
    }

    private syncCollectionViewStateToHistory(state: CollectionViewState): void {
        const nextCollectionViewState = buildCollectionViewState(state);
        const currentCollectionViewState = this.historyCollectionViewState();

        if (
            this.isSameCollectionViewState(
                currentCollectionViewState,
                nextCollectionViewState
            )
        ) {
            return;
        }

        const currentState = this.toHistoryStateRecord(window.history.state);
        const nextState = { ...currentState };

        if (nextCollectionViewState) {
            nextState[COLLECTION_VIEW_STATE_KEY] = nextCollectionViewState;
        } else {
            delete nextState[COLLECTION_VIEW_STATE_KEY];
        }

        window.history.replaceState(nextState, document.title);
        this.historyCollectionViewState.set(nextCollectionViewState);
    }

    private syncDetailFromHistoryState(): void {
        const detailItem = getOpenCollectionDetailItemState(
            window.history.state
        )?.item;

        if (detailItem && this.canOpenInlineDetail(detailItem)) {
            this.openInlineDetail(detailItem);
            return;
        }

        if (this.selectedDetailItem()) {
            this.clearInlineDetail();
        }
    }

    private isSameCollectionViewState(
        left: CollectionViewState | null,
        right: CollectionViewState | null
    ): boolean {
        return (
            left?.selectedContentType === right?.selectedContentType &&
            left?.scope === right?.scope
        );
    }

    private toHistoryStateRecord(state: unknown): Record<string, unknown> {
        return state && typeof state === 'object'
            ? { ...(state as Record<string, unknown>) }
            : {};
    }
}
