import {
    ChangeDetectionStrategy,
    Component,
    computed,
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
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    clearNavigationStateKeys,
    CollectionContentType,
    CollectionScope,
    getOpenLiveCollectionItemState,
    isWorkspaceLayoutRoute,
    OPEN_LIVE_COLLECTION_ITEM_STATE_KEY,
    queryParamSignal,
    routeParamSignal,
    ScopeToggleService,
    UnifiedCollectionItem,
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/util';
import {
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from 'm3u-state';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';
import { UnifiedGridTabComponent } from './unified-grid-tab.component';

@Component({
    selector: 'app-unified-collection-page',
    templateUrl: './unified-collection-page.component.html',
    styleUrl: './unified-collection-page.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonToggleModule,
        MatIconButton,
        MatIconModule,
        MatTooltip,
        TranslatePipe,
        UnifiedGridTabComponent,
        UnifiedLiveTabComponent,
    ],
})
export class UnifiedCollectionPageComponent {
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly portalType = input<string>();
    readonly playlistIdInput = input<string | undefined>(undefined, {
        alias: 'playlistId',
    });
    readonly defaultScope = input<CollectionScope>();

    private readonly route = inject(ActivatedRoute);
    private readonly store = inject(Store);
    private readonly scopeService = inject(ScopeToggleService);
    private readonly favoritesData = inject(UnifiedFavoritesDataService);
    private readonly recentData = inject(UnifiedRecentDataService);
    private readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);
    private readonly playlistsLoaded = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    private readonly queryScope = queryParamSignal<CollectionScope | null>(
        this.route,
        'scope',
        (value) =>
            value === 'all' || value === 'playlist' ? value : null
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

    readonly isLoading = signal(true);
    readonly allItems = signal<UnifiedCollectionItem[]>([]);
    readonly selectedContentType = signal<CollectionContentType>('live');
    readonly pendingAutoOpenLiveItem = signal(
        getOpenLiveCollectionItemState(window.history.state)
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

    readonly title = computed(() => {
        return this.mode() === 'favorites'
            ? 'PORTALS.FAVORITES'
            : 'PORTALS.RECENTLY_VIEWED';
    });

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
                    playlist.serverUrl ? 'xtream' : playlist.macAddress ? 'stalker' : 'm3u',
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

    async onRemoveItem(item: UnifiedCollectionItem): Promise<void> {
        if (this.mode() === 'favorites') {
            await this.favoritesData.removeFavorite(item);
        } else {
            await this.recentData.removeRecentItem(item);
        }
        this.allItems.update((items) =>
            items.filter((i) => i.uid !== item.uid)
        );
    }

    async clearAllRecent(): Promise<void> {
        await this.recentData.clearRecentItems(
            this.effectiveScope(),
            this.playlistId()
        );
        this.allItems.set([]);
    }

    async onReorder(items: UnifiedCollectionItem[]): Promise<void> {
        const nonLive = this.allItems().filter(
            (i) => i.contentType !== 'live'
        );
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
            const nextItems = [item, ...items.filter((candidate) => candidate.uid !== item.uid)];
            return nextItems.sort(
                (a, b) =>
                    new Date(b.viewedAt ?? 0).getTime() -
                    new Date(a.viewedAt ?? 0).getTime()
            );
        });
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
            if (requestId !== this.loadRequestId) {
                return;
            }
            this.allItems.set(items);
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

    private autoSelectContentType(): void {
        const types = this.availableTypes();
        if (types.length > 0 && !types.includes(this.selectedContentType())) {
            this.selectedContentType.set(types[0]);
        }
    }

    onLiveAutoOpenHandled(): void {
        this.pendingAutoOpenLiveItem.set(null);
        clearNavigationStateKeys([OPEN_LIVE_COLLECTION_ITEM_STATE_KEY]);
    }
}
