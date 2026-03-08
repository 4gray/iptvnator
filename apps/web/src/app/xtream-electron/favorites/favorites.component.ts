import {
    Component,
    computed,
    effect,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { selectActivePlaylist } from 'm3u-state';
import { BehaviorSubject, switchMap } from 'rxjs';
import { PlayerService } from '../../services/player.service';
import { PortalCollectionLiveShellComponent } from '../../shared/components/portal-collection-live-shell/portal-collection-live-shell.component';
import {
    PortalCollectionMode,
    PortalCollectionShellComponent,
    PortalCollectionShellLayout,
} from '../../shared/components/portal-collection-shell/portal-collection-shell.component';
import { queryParamSignal } from '../../shared/navigation/portal-route.utils';
import { createPortalCollectionContext } from '../../shared/utils/portal-collection-context';
import {
    buildStandardCollectionCategories,
    filterCollectionBucket,
} from '../../shared/utils/portal-collection-items';
import { FavoritesContextService } from '../../workspace/favorites-context.service';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { FavoriteItem } from '../services/favorite-item.interface';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../stores/xtream.store';

const XTREAM_FAVORITES_LAYOUT: PortalCollectionShellLayout = {};
const XTREAM_COLLECTION_LABELS = {
    all: 'All',
    movie: 'Movies',
    live: 'Live TV',
    series: 'Series',
};
type LiveChannelSortMode = 'server' | 'name-asc' | 'name-desc';
const XTREAM_FAVORITES_LIVE_SORT_STORAGE_KEY =
    'xtream-favorites-live-channel-sort-mode';

@Component({
    selector: 'app-favorites',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatTooltipModule,
        PortalChannelsListComponent,
        PortalCollectionLiveShellComponent,
        PortalCollectionShellComponent,
        TranslatePipe,
    ],
    templateUrl: './favorites.component.html',
    styleUrls: [
        './favorites.component.scss',
        '../../shared/styles/portal-sidebar.scss',
    ],
})
export class FavoritesComponent implements OnInit {
    private favoritesService = inject(FavoritesService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private store = inject(Store);
    private xtreamStore = inject(XtreamStore);
    private playerService = inject(PlayerService);
    private readonly favoritesCtx = inject(FavoritesContextService);

    readonly currentPlaylist = this.xtreamStore.currentPlaylist;
    readonly layout = XTREAM_FAVORITES_LAYOUT;
    readonly playlistSubtitle = 'Xtream Code';
    readonly playlistTitle = computed(
        () =>
            this.currentPlaylist()?.name ||
            this.currentPlaylist()?.title ||
            'Playlist'
    );

    readonly allItems = signal<FavoriteItem[]>([]);
    readonly series = signal<FavoriteItem[]>([]);
    readonly movies = signal<FavoriteItem[]>([]);
    readonly live = signal<FavoriteItem[]>([]);
    readonly searchTerm = queryParamSignal(this.route, 'q', (value) =>
        (value ?? '').trim().toLowerCase()
    );
    readonly categories = computed(() =>
        buildStandardCollectionCategories({
            labels: XTREAM_COLLECTION_LABELS,
            counts: {
                all: this.allItems().length,
                movie: this.movies().length,
                live: this.live().length,
                series: this.series().length,
            },
            includeLive: true,
        })
    );
    readonly collectionContext = createPortalCollectionContext({
        ctx: this.favoritesCtx,
        categories: this.categories,
    });
    readonly selectedLiveItem = signal<FavoriteItem | null>(null);
    readonly liveStreamUrl = signal('');
    readonly mode = computed<PortalCollectionMode>(() =>
        this.isLiveCategory() ? 'live' : 'grid'
    );
    readonly liveItemsToShow = computed(() =>
        this.live().filter((item) => {
            const term = this.searchTerm();
            if (!term) {
                return true;
            }

            return `${item?.title ?? ''}`.toLowerCase().includes(term);
        })
    );
    readonly isLiveCategory = computed(
        () => this.selectedCategoryId() === 'live'
    );
    readonly isEmbeddedPlayer = computed(() =>
        this.playerService.isEmbeddedPlayer()
    );
    readonly liveChannelSortMode = signal<LiveChannelSortMode>('server');
    readonly liveChannelSortLabel = computed(() => {
        const mode = this.liveChannelSortMode();
        if (mode === 'name-asc') return 'Name A-Z';
        if (mode === 'name-desc') return 'Name Z-A';
        return 'Server Order';
    });
    readonly epgItems = this.xtreamStore.epgItems;
    readonly isLoadingEpg = this.xtreamStore.isLoadingEpg;

    /** Synced with the workspace context service so panel clicks are reactive */
    readonly selectedCategoryId = this.collectionContext.selectedCategoryId;

    /** Items filtered by the active category — fully reactive, no imperative calls */
    readonly filteredFavoritesToShow = computed(() => {
        return filterCollectionBucket({
            selectedCategoryId: this.selectedCategoryId(),
            allItems: this.allItems(),
            buckets: {
                movie: this.movies(),
                live: this.live(),
                series: this.series(),
            },
            searchTerm: this.searchTerm(),
            textOf: (item) => `${item?.title ?? ''}`,
        });
    });

    private favoritesRefresh$ = new BehaviorSubject<void>(undefined);

    constructor() {
        effect(() => {
            const selectedItem = this.selectedLiveItem();
            if (!selectedItem) {
                return;
            }

            const stillExists = this.liveItemsToShow().some(
                (item) =>
                    Number(item.xtream_id) === Number(selectedItem.xtream_id)
            );

            if (!stillExists) {
                this.clearLiveSelection();
            }
        });

        effect(() => {
            if (this.isLiveCategory()) {
                return;
            }

            this.clearLiveSelection();
        });
    }

    ngOnInit() {
        this.xtreamStore.setSelectedContentType(undefined);
        const savedSortMode = localStorage.getItem(
            XTREAM_FAVORITES_LIVE_SORT_STORAGE_KEY
        );
        if (
            savedSortMode === 'server' ||
            savedSortMode === 'name-asc' ||
            savedSortMode === 'name-desc'
        ) {
            this.liveChannelSortMode.set(savedSortMode);
        }
        const playlistId = this.store.selectSignal(selectActivePlaylist)()._id;
        this.favoritesRefresh$
            .pipe(
                switchMap(() => this.favoritesService.getFavorites(playlistId))
            )
            .subscribe((items) => {
                this.allItems.set(items);
                this.movies.set(
                    items.filter((item) => (item as any).type === 'movie')
                );
                this.live.set(items.filter((item) => item.type === 'live'));
                this.series.set(items.filter((item) => item.type === 'series'));
            });
    }

    setCategoryId(categoryId: string) {
        this.collectionContext.setCategoryId(categoryId);
    }

    async removeFromFavorites(item: any) {
        await this.favoritesService.removeFromFavorites(
            item.content_id,
            item.playlist_id
        );
        this.favoritesRefresh$.next();
    }

    openItem(item: any) {
        const type = item.type === 'movie' ? 'vod' : item.type;
        this.xtreamStore.setSelectedContentType(type);
        if (type === 'live') {
            this.setCategoryId('live');
            this.selectLiveItem(item);
        } else {
            const routePlaylistId = this.route.snapshot.params['id'];
            const hasGlobalContext = this.router.url.includes(
                '/workspace/global-favorites'
            );
            const shouldNavigateAbsolute =
                hasGlobalContext ||
                (item.playlist_id &&
                    routePlaylistId &&
                    item.playlist_id !== routePlaylistId);

            if (shouldNavigateAbsolute && item.playlist_id) {
                this.router.navigate([
                    '/workspace',
                    'xtreams',
                    item.playlist_id,
                    type,
                    item.category_id,
                    item.xtream_id,
                ]);
                return;
            }

            this.router.navigate(
                ['..', type, item.category_id, item.xtream_id],
                {
                    relativeTo: this.route,
                }
            );
        }
    }

    selectLiveItem(item: FavoriteItem) {
        this.xtreamStore.setSelectedContentType('live');
        this.selectedLiveItem.set(item);
        const streamUrl = this.xtreamStore.constructStreamUrl(item);
        this.liveStreamUrl.set(streamUrl);

        if (this.isEmbeddedPlayer()) {
            return;
        }

        this.xtreamStore.openPlayer(
            streamUrl,
            item.title,
            item.poster_url || item.stream_icon || null
        );
    }

    setLiveChannelSortMode(mode: LiveChannelSortMode): void {
        this.liveChannelSortMode.set(mode);
        localStorage.setItem(XTREAM_FAVORITES_LIVE_SORT_STORAGE_KEY, mode);
    }

    private clearLiveSelection() {
        this.selectedLiveItem.set(null);
        this.liveStreamUrl.set('');
        this.xtreamStore.clearEpg();
        this.xtreamStore.setSelectedItem(null);
    }
}
