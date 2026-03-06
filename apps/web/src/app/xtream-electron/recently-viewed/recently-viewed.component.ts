import { KeyValuePipe } from '@angular/common';
import {
    Component,
    computed,
    inject,
    Optional,
    signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import groupBy from 'lodash/groupBy';
import { firstValueFrom } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import { ContentCardComponent } from '../../shared/components/content-card/content-card.component';
import {
    PortalCollectionShellComponent,
    PortalCollectionShellLayout,
} from '../../shared/components/portal-collection-shell/portal-collection-shell.component';
import {
    isWorkspaceLayoutRoute,
    queryParamSignal,
} from '../../shared/navigation/portal-route.utils';
import { createPortalCollectionContext } from '../../shared/utils/portal-collection-context';
import {
    buildStandardCollectionCategories,
    filterCollectionBucket,
} from '../../shared/utils/portal-collection-items';
import { createLogger } from '../../shared/utils/logger';
import { FavoritesContextService } from '../../workspace/favorites-context.service';
import { XtreamStore } from '../stores/xtream.store';

const XTREAM_RECENT_LAYOUT: Omit<
    PortalCollectionShellLayout,
    'showHeaderAction'
> = {
    titleTranslationKey: 'PORTALS.SIDEBAR.RECENT',
    removeTooltip: 'Remove from history',
    emptyIcon: 'history',
    headerActionIcon: 'delete_sweep',
    headerActionTooltip: 'Clear history',
};
const XTREAM_COLLECTION_LABELS = {
    all: 'All',
    movie: 'Movies',
    live: 'Live TV',
    series: 'Series',
};

@Component({
    selector: 'app-recently-viewed',
    imports: [
        ContentCardComponent,
        FormsModule,
        KeyValuePipe,
        MatButton,
        MatCheckboxModule,
        MatIcon,
        MatIconButton,
        PortalCollectionShellComponent,
    ],
    providers: [],
    templateUrl: './recently-viewed.component.html',
    styleUrl: './recently-viewed.component.scss',
})
export class RecentlyViewedComponent {
    private static readonly GROUP_BY_STORAGE_KEY =
        'global-recent-group-by-playlist';
    private static readonly TYPE_FILTERS_STORAGE_KEY =
        'global-recent-type-filters';
    private static readonly MAX_FLAT_GLOBAL_ITEMS = 250;

    private xtreamStore = inject(XtreamStore);
    private activatedRoute = inject(ActivatedRoute);
    private router = inject(Router);
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private dialogData = inject(MAT_DIALOG_DATA, { optional: true });
    private readonly logger = createLogger('XtreamRecentlyViewed');
    private readonly favoritesCtx = inject(FavoritesContextService);

    readonly isGlobal = this.dialogData?.isGlobal ?? false;
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.activatedRoute);
    readonly nonGlobalLayout: PortalCollectionShellLayout = {
        ...XTREAM_RECENT_LAYOUT,
        showHeaderAction: !this.isWorkspaceLayout,
    };
    readonly playlistSubtitle = 'Xtream Code';
    private readonly _groupByPlaylist = (() => {
        const saved = localStorage.getItem(
            RecentlyViewedComponent.GROUP_BY_STORAGE_KEY
        );
        return signal(saved !== 'false');
    })();
    readonly groupByPlaylist = computed(() => this._groupByPlaylist());
    private readonly _typeFilters = (() => {
        const saved = localStorage.getItem(
            RecentlyViewedComponent.TYPE_FILTERS_STORAGE_KEY
        );
        if (!saved) {
            return signal({ live: true, movie: true, series: true });
        }
        try {
            const parsed = JSON.parse(saved) as {
                live?: boolean;
                movie?: boolean;
                series?: boolean;
            };
            return signal({
                live: parsed.live !== false,
                movie: parsed.movie !== false,
                series: parsed.series !== false,
            });
        } catch {
            return signal({ live: true, movie: true, series: true });
        }
    })();
    readonly typeFilters = computed(() => this._typeFilters());
    readonly recentItems = computed(() =>
        this.isGlobal
            ? this.xtreamStore.globalRecentItems()
            : this.xtreamStore.recentItems()
    );
    readonly categories = computed(() => {
        const items = this.recentItems();
        const movies = items.filter(
            (item: any) => item?.type === 'movie'
        ).length;
        const live = items.filter((item: any) => item?.type === 'live').length;
        const series = items.filter(
            (item: any) => item?.type === 'series'
        ).length;

        return buildStandardCollectionCategories({
            labels: XTREAM_COLLECTION_LABELS,
            counts: {
                all: items.length,
                movie: movies,
                live,
                series,
            },
            includeLive: true,
        });
    });
    readonly collectionContext = createPortalCollectionContext({
        ctx: this.favoritesCtx,
        categories: this.categories,
        enabled: () => !this.isGlobal,
    });
    readonly selectedCategoryId = this.collectionContext.selectedCategoryId;
    readonly recentSearchTerm = signal('');
    readonly workspaceSearchTerm = queryParamSignal(
        this.activatedRoute,
        'q',
        (value) => (value ?? '').trim().toLowerCase()
    );
    readonly filteredRecentItems = computed(() => {
        const term =
            this.isWorkspaceLayout && !this.isGlobal
                ? this.workspaceSearchTerm()
                : this.recentSearchTerm().trim().toLowerCase();
        const typeFilters = this.typeFilters();
        const items = this.recentItems().filter((item: any) => {
            if (item?.type === 'live') return typeFilters.live;
            if (item?.type === 'movie') return typeFilters.movie;
            if (item?.type === 'series') return typeFilters.series;
            return true;
        });
        if (!term) return items;

        return items.filter((item: any) =>
            `${item?.title ?? ''} ${item?.playlist_name ?? ''}`
                .toLowerCase()
                .includes(term)
        );
    });
    readonly visibleRecentItems = computed(() => {
        const items = this.filteredRecentItems();
        if (this.isGlobal && !this.groupByPlaylist()) {
            return items.slice(
                0,
                RecentlyViewedComponent.MAX_FLAT_GLOBAL_ITEMS
            );
        }
        return items;
    });
    readonly nonGlobalItemsToShow = computed(() => {
        const items = this.visibleRecentItems();
        return filterCollectionBucket({
            selectedCategoryId: this.selectedCategoryId(),
            allItems: items,
            buckets: {
                movie: items.filter((item: any) => item?.type === 'movie'),
                live: items.filter((item: any) => item?.type === 'live'),
                series: items.filter((item: any) => item?.type === 'series'),
            },
            textOf: (item: any) =>
                `${item?.title ?? ''} ${item?.playlist_name ?? ''}`,
        });
    });
    readonly currentPlaylist = this.xtreamStore.currentPlaylist;
    readonly playlistTitle = computed(
        () =>
            this.currentPlaylist()?.name ||
            this.currentPlaylist()?.title ||
            'Playlist'
    );

    constructor(
        @Optional() public dialogRef?: MatDialogRef<RecentlyViewedComponent>
    ) {
        this.xtreamStore.setSelectedContentType(undefined);

        if (this.isGlobal) {
            this.loadGlobalItems();
        } else if (this.currentPlaylist()) {
            this.xtreamStore.loadRecentItems(this.currentPlaylist);
        }
    }

    private async loadGlobalItems() {
        try {
            await this.xtreamStore.loadGlobalRecentItems();
        } catch (error) {
            this.logger.error('Error loading global items', error);
        }
    }

    clearHistory() {
        if (this.isGlobal) {
            this.xtreamStore.clearGlobalRecentlyViewed();
        } else {
            this.xtreamStore.clearRecentItems(this.xtreamStore.currentPlaylist);
        }
    }

    openItem(item: any) {
        const source = item.source ?? 'xtream';

        if (source === 'stalker' && this.isGlobal) {
            this.dialogRef?.close();
            this.router.navigate(
                ['/workspace', 'stalker', item.playlist_id, 'recent'],
                {
                    state: {
                        openRecentItem: item.stalker_item ?? {
                            id: item.id,
                            title: item.title,
                            name: item.title,
                            category_id:
                                item.type === 'movie'
                                    ? 'vod'
                                    : item.type === 'live'
                                      ? 'itv'
                                      : 'series',
                            cover: item.poster_url,
                        },
                    },
                }
            );
            return;
        }

        const type = item.type === 'movie' ? 'vod' : item.type;
        this.xtreamStore.setSelectedContentType(type);

        if (this.isGlobal) {
            this.dialogRef?.close();

            this.router.navigate([
                '/workspace',
                'xtreams',
                item.playlist_id,
                type,
                item.category_id,
                item.xtream_id,
            ]);
        } else {
            this.router.navigate(
                ['..', type, item.category_id, item.xtream_id],
                {
                    relativeTo: this.activatedRoute,
                }
            );
        }
    }

    async onRemoveItem(item: any) {
        try {
            if (this.isGlobal) {
                if (item.source === 'stalker') {
                    await firstValueFrom(
                        this.playlistsService.removeFromPortalRecentlyViewed(
                            item.playlist_id,
                            item.id
                        )
                    );
                } else {
                    await this.dbService.removeRecentItem(
                        Number(item.id),
                        item.playlist_id
                    );
                }
                await this.loadGlobalItems();
                return;
            }

            this.xtreamStore.removeRecentItem({
                itemId: Number(item.id),
                playlistId: this.currentPlaylist().id,
            });
        } catch (error) {
            this.logger.error('Error removing recent item', error);
        }
    }

    getGroupedItems() {
        const items = this.visibleRecentItems();
        if (!this.isGlobal) return { default: items };
        const grouped = groupBy(items, 'playlist_name');
        return grouped;
    }

    updateRecentSearchTerm(term: string) {
        this.recentSearchTerm.set(term);
    }

    toggleGroupByPlaylist(value: boolean) {
        this._groupByPlaylist.set(value);
        localStorage.setItem(
            RecentlyViewedComponent.GROUP_BY_STORAGE_KEY,
            String(value)
        );
    }

    toggleTypeFilter(type: 'live' | 'movie' | 'series', value: boolean) {
        const next = {
            ...this._typeFilters(),
            [type]: value,
        };
        this._typeFilters.set(next);
        localStorage.setItem(
            RecentlyViewedComponent.TYPE_FILTERS_STORAGE_KEY,
            JSON.stringify(next)
        );
    }

    setCategoryId(categoryId: string): void {
        this.collectionContext.setCategoryId(categoryId);
    }
}
