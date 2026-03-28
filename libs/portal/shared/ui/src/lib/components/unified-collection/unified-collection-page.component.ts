import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    input,
    OnInit,
    signal,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconButton } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    CollectionContentType,
    CollectionScope,
    isWorkspaceLayoutRoute,
    queryParamSignal,
    ScopeToggleService,
    UnifiedCollectionItem,
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/util';
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
export class UnifiedCollectionPageComponent implements OnInit {
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly portalType = input<string>();
    readonly defaultScope = input<CollectionScope>();

    private readonly route = inject(ActivatedRoute);
    private readonly scopeService = inject(ScopeToggleService);
    private readonly favoritesData = inject(UnifiedFavoritesDataService);
    private readonly recentData = inject(UnifiedRecentDataService);
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    private readonly routeSearchTerm = queryParamSignal(
        this.route,
        'q',
        (value) => (value ?? '').trim()
    );
    readonly workspaceSearchTerm = computed(() =>
        this.isWorkspaceLayout ? this.routeSearchTerm() : ''
    );

    readonly isLoading = signal(true);
    readonly allItems = signal<UnifiedCollectionItem[]>([]);
    readonly selectedContentType = signal<CollectionContentType>('live');

    readonly skeletonRows = Array.from({ length: 12 }, (_, i) => i);
    readonly skeletonCards = Array.from({ length: 8 }, (_, i) => i);

    readonly playlistId = computed(() => {
        let current = this.route.snapshot;
        while (current) {
            if (current.params['id']) {
                return current.params['id'] as string;
            }
            current = current.parent!;
        }
        return undefined;
    });

    readonly scopeKey = computed(() => this.mode());
    readonly scope = signal<CollectionScope>('playlist');
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

    constructor() {
        effect(() => {
            this.mode();
            this.portalType();
            this.playlistId();
            this.effectiveScope();
            void this.loadData();
        });
    }

    ngOnInit(): void {
        const queryScope = this.route.snapshot.queryParams['scope'] as
            | CollectionScope
            | undefined;
        if (
            this.showScopeToggle() &&
            (queryScope === 'all' || queryScope === 'playlist')
        ) {
            this.scope.set(queryScope);
        } else if (this.defaultScope()) {
            this.scope.set(this.defaultScope()!);
        } else {
            const persisted = this.scopeService.getScope(this.scopeKey());
            this.scope.set(persisted());
        }
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

    private async loadData(): Promise<void> {
        this.isLoading.set(true);
        try {
            const s = this.effectiveScope();
            const pid = this.playlistId();
            const pt = this.portalType();
            const items =
                this.mode() === 'favorites'
                    ? await this.favoritesData.getFavorites(s, pid, pt)
                    : await this.recentData.getRecentItems(s, pid, pt);
            this.allItems.set(items);
            this.autoSelectContentType();
        } catch {
            this.allItems.set([]);
        } finally {
            this.isLoading.set(false);
        }
    }

    private autoSelectContentType(): void {
        const types = this.availableTypes();
        if (types.length > 0 && !types.includes(this.selectedContentType())) {
            this.selectedContentType.set(types[0]);
        }
    }
}
