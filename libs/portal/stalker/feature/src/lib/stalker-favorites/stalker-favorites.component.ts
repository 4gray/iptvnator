import {
    Component,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistsService } from 'services';
import { EpgItem, VodDetailsItem } from 'shared-interfaces';
import { PortalCollectionLiveShellComponent } from '@iptvnator/portal/shared/ui';
import {
    FavoriteLayoutItem,
    PortalCollectionMode,
    PortalCollectionShellComponent,
    PortalCollectionShellLayout,
} from '@iptvnator/portal/shared/ui';
import { StalkerInlineDetailComponent } from '../stalker-inline-detail/stalker-inline-detail.component';
import { queryParamSignal } from '@iptvnator/portal/shared/util';
import { createPortalCollectionContext } from '@iptvnator/portal/shared/util';
import {
    buildStandardCollectionCategories,
    filterCollectionBucket,
} from '@iptvnator/portal/shared/util';
import {
    createLogger,
    FavoritesContextService,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { StalkerFavoriteItem } from '@iptvnator/portal/stalker/data-access';
import {
    clearStalkerDetailViewState,
    createStalkerInlineDetailState,
    createPortalFavoritesResource,
    createRefreshTrigger,
    createStalkerDetailViewState,
    isSelectedStalkerVodFavorite,
    NormalizedStalkerFavoriteItem,
    normalizeStalkerEntityId,
    normalizeStalkerFavoriteItem,
    StalkerVodSource,
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';
import { StalkerCollectionChannelsListComponent } from '../stalker-collection-channels-list/stalker-collection-channels-list.component';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';

const STALKER_FAVORITES_LAYOUT: PortalCollectionShellLayout = {};

@Component({
    selector: 'app-stalker-favorites',
    templateUrl: './stalker-favorites.component.html',
    imports: [
        PortalCollectionLiveShellComponent,
        PortalCollectionShellComponent,
        StalkerCollectionChannelsListComponent,
        StalkerInlineDetailComponent,
        TranslatePipe,
    ],
    styles: [
        `
            :host {
                display: block;
                height: 100%;
                width: 100%;
                position: relative;
            }

            .back-button {
                margin: 10px 0 0 16px;
            }
        `,
    ],
})
export class StalkerFavoritesComponent {
    private static isCategoryType(
        value: unknown
    ): value is 'vod' | 'series' | 'itv' {
        const normalized = String(value ?? '').toLowerCase();
        return (
            normalized === 'vod' ||
            normalized === 'series' ||
            normalized === 'itv'
        );
    }

    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly playlistService = inject(PlaylistsService);
    private readonly favoritesRefresh = createRefreshTrigger();
    private readonly stalkerStore = inject(StalkerStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('StalkerFavorites');
    private readonly favoritesCtx = inject(FavoritesContextService);
    private previousSelectedCategoryId: string | null = null;

    itemDetails: NormalizedStalkerFavoriteItem | null = null;
    vodDetailsItem: VodDetailsItem | null = null;
    readonly isSelectedVodFavorite = signal<boolean>(false);
    readonly selectedLiveItem = signal<StalkerVodSource | null>(null);
    readonly liveStreamUrl = signal('');
    readonly epgItems = signal<EpgItem[]>([]);
    readonly isLoadingEpg = signal(false);
    readonly hasMoreEpg = signal(false);
    readonly isResolvingPlayback = signal(false);

    readonly currentPlaylist = this.stalkerStore.currentPlaylist;
    readonly layout = STALKER_FAVORITES_LAYOUT;
    readonly playlistSubtitle = 'Stalker Portal';
    readonly playlistTitle = computed(
        () => this.currentPlaylist()?.title || 'Portal'
    );

    readonly allFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => this.stalkerStore.currentPlaylist()?._id,
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly categories = computed(() =>
        buildStandardCollectionCategories({
            labels: {
                all: this.translate.instant('PORTALS.ALL_CATEGORIES'),
                movie: this.translate.instant('PORTALS.SIDEBAR.MOVIES'),
                live: this.translate.instant('PORTALS.SIDEBAR.LIVE_TV'),
                series: this.translate.instant('PORTALS.SIDEBAR.SERIES'),
            },
            counts: {
                all: this.allFavorites.value()?.length ?? 0,
                movie: this.movies()?.length ?? 0,
                live: this.live()?.length ?? 0,
                series: this.series()?.length ?? 0,
            },
            includeLive: true,
            liveCategoryId: 'itv',
        })
    );
    readonly collectionContext = createPortalCollectionContext({
        ctx: this.favoritesCtx,
        categories: this.categories,
    });
    readonly liveItemsToShow = computed<StalkerFavoriteItem[]>(() =>
        ((this.allFavorites.value() ?? []) as StalkerFavoriteItem[]).filter((item) => {
            if (item.category_id !== 'itv') {
                return false;
            }

            const term = this.searchTerm();
            if (!term) {
                return true;
            }

            return `${item?.name ?? ''} ${item?.o_name ?? ''}`
                .toLowerCase()
                .includes(term);
        })
    );
    readonly isLiveCategory = computed(() => this.selectedCategoryId() === 'itv');
    readonly isEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );
    private epgPageSize = 10;
    private epgChannelId: number | string | null = null;

    readonly favoritesToShow = computed(() => {
        return filterCollectionBucket({
            selectedCategoryId: this.selectedCategoryId(),
            allItems: this.allFavorites.value(),
            buckets: {
                movie: this.movies(),
                live: this.live(),
                series: this.series(),
            },
            searchTerm: this.searchTerm(),
            liveCategoryId: 'itv',
            textOf: (item: StalkerFavoriteItem) =>
                `${item.name ?? ''} ${item.o_name ?? ''}`,
        });
    });

    /** Synced with workspace context service so panel clicks are reactive */
    readonly selectedCategoryId = this.collectionContext.selectedCategoryId;
    readonly searchTerm = queryParamSignal(this.route, 'q', (value) =>
        (value ?? '').trim().toLowerCase()
    );

    readonly series = computed(() =>
        this.allFavorites
            .value()
            ?.filter((item) => item.category_id === 'series')
    );
    readonly movies = computed(() =>
        this.allFavorites.value()?.filter((item) => item.category_id === 'vod')
    );
    readonly live = computed(() =>
        this.allFavorites.value()?.filter((item) => item.category_id === 'itv')
    );

    get mode(): PortalCollectionMode {
        if (this.isLiveCategory()) {
            return 'live';
        }

        return this.showDetails() ? 'detail' : 'grid';
    }

    constructor() {
        effect(() => {
            this.allFavorites.value();
            this.syncSelectedVodFavorite();
        });

        effect(() => {
            const selectedCategoryId = this.selectedCategoryId();
            const hasInlineDetail = this.inlineDetail().categoryId !== null;
            const previousCategoryId = this.previousSelectedCategoryId;

            this.previousSelectedCategoryId = selectedCategoryId;

            if (
                hasInlineDetail &&
                previousCategoryId !== null &&
                previousCategoryId !== selectedCategoryId
            ) {
                this.resetDetailsView(false);
            }
        });

        effect(() => {
            const selectedItem = this.selectedLiveItem();
            if (!selectedItem) {
                return;
            }

            const stillExists = this.liveItemsToShow().some(
                (item) => normalizeStalkerEntityId(item.id) === normalizeStalkerEntityId(selectedItem.id)
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

        effect(() => {
            const playlist = this.currentPlaylist();
            if (!playlist?._id) {
                return;
            }

            const state =
                this.router.currentNavigation()?.extras?.state ??
                window.history.state;
            const item = state?.openFavoriteItem;
            if (
                !item ||
                !StalkerFavoritesComponent.isCategoryType(item.category_id)
            ) {
                return;
            }

            this.openItem(item);

            try {
                window.history.replaceState({}, document.title);
            } catch {
                // no-op
            }
        });
    }

    removeFromFavorites(
        item: Pick<StalkerFavoriteItem, 'id'>,
        onDone?: () => void
    ) {
        this.stalkerStore.removeFromFavorites(
            normalizeStalkerEntityId(item.id),
            () => {
                this.favoritesRefresh.refresh();
                this.syncSelectedVodFavorite();
                onDone?.();
            }
        );
    }

    addToFavorites(item: Record<string, unknown>, onDone?: () => void) {
        this.stalkerStore.addToFavorites(item, () => {
            this.favoritesRefresh.refresh();
            this.syncSelectedVodFavorite();
            onDone?.();
        });
    }

    setCategoryId(categoryId: string) {
        this.collectionContext.setCategoryId(categoryId);
    }

    openItem(item: FavoriteLayoutItem) {
        this.logger.debug('Open item', item);
        const normalizedCategory =
            item.category_id === 'movie' ? 'vod' : item.category_id;
        const itemToOpen = {
            ...item,
            category_id: normalizedCategory,
        } as StalkerFavoriteItem;
        const normalizedItem = normalizeStalkerFavoriteItem(itemToOpen);

        switch (itemToOpen.category_id) {
            case 'itv':
                this.setCategoryId('itv');
                this.resetDetailsView(false);
                void this.selectLiveItem(itemToOpen);
                break;
            case 'vod': {
                this.itemDetails = normalizedItem;
                this.stalkerStore.setSelectedItem(normalizedItem.details);
                this.stalkerStore.setSelectedContentType('vod');

                const detailViewState = createStalkerDetailViewState(
                    normalizedItem.details,
                    this.currentPlaylist()?._id ?? ''
                );
                this.itemDetails = {
                    ...normalizedItem,
                    details: detailViewState.itemDetails,
                };
                this.vodDetailsItem = detailViewState.vodDetailsItem;
                this.syncSelectedVodFavorite();
                break;
            }
            case 'series':
                this.itemDetails = normalizedItem;
                this.stalkerStore.setSelectedItem(normalizedItem.details);
                this.stalkerStore.setSelectedContentType('series');
                break;
            default:
                break;
        }
    }

    /** Handle play from vod-details component */
    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            this.createLinkToPlayVodItv(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image
            );
        }
    }

    /** Handle favorite toggle from vod-details component */
    onVodFavoriteToggled(event: {
        item: VodDetailsItem;
        isFavorite: boolean;
    }): void {
        toggleStalkerVodFavorite(event, {
            addToFavorites: (item, onDone) => this.addToFavorites(item, onDone),
            removeFromFavorites: (favoriteId, onDone) =>
                this.removeFromFavorites({ id: favoriteId }, onDone),
            onComplete: () => {
                this.favoritesRefresh.refresh();
                this.syncSelectedVodFavorite();
            },
        });
    }

    /** Handle back from vod-details component */
    onVodBack(): void {
        this.resetDetailsView(true);
    }

    onSeriesBack(): void {
        this.resetDetailsView(true);
    }

    private resetDetailsView(refreshList: boolean): void {
        const cleared = clearStalkerDetailViewState();
        this.itemDetails = null;
        this.vodDetailsItem = cleared.vodDetailsItem;
        this.isSelectedVodFavorite.set(false);
        if (refreshList) {
            this.favoritesRefresh.refresh();
        }
    }

    private syncSelectedVodFavorite(): void {
        this.isSelectedVodFavorite.set(
            isSelectedStalkerVodFavorite(
                this.vodDetailsItem,
                this.allFavorites.value() ?? []
            )
        );
    }

    inlineDetail() {
        return createStalkerInlineDetailState(
            this.itemDetails,
            this.vodDetailsItem
        );
    }

    showDetails() {
        return this.inlineDetail().categoryId !== null;
    }

    async selectLiveItem(item: StalkerVodSource) {
        this.selectedLiveItem.set(item);
        this.liveStreamUrl.set('');
        this.stalkerStore.setSelectedContentType('itv');
        this.stalkerStore.setSelectedItem(item);
        this.isResolvingPlayback.set(true);

        try {
            const playback = await this.stalkerStore.resolveItvPlayback(item);
            await this.loadEpgForChannel(item.id);
            this.liveStreamUrl.set(playback.streamUrl);

            if (!this.isEmbeddedPlayer()) {
                void this.portalPlayer.openResolvedPlayback(playback, true);
            }
        } catch (error) {
            this.logger.error('Failed to resolve ITV playback', error);
            this.showPlaybackError(error);
        } finally {
            this.isResolvingPlayback.set(false);
        }
    }

    async loadMoreEpg() {
        if (!this.epgChannelId || this.isLoadingEpg()) {
            return;
        }

        this.epgPageSize += 10;
        this.isLoadingEpg.set(true);
        try {
            const items = await this.stalkerStore.fetchChannelEpg(
                this.epgChannelId,
                this.epgPageSize
            );
            this.epgItems.set(items);
            this.hasMoreEpg.set(items.length >= this.epgPageSize);
        } catch {
            this.hasMoreEpg.set(false);
        } finally {
            this.isLoadingEpg.set(false);
        }
    }

    async createLinkToPlayVodItv(
        cmd?: string,
        title?: string,
        thumbnail?: string
    ) {
        this.logger.debug('Create link to play VOD/ITV', {
            cmd,
            title,
            thumbnail,
        });
        await this.stalkerStore.createLinkToPlayVod(cmd, title, thumbnail);
    }

    toggleLiveFavorite(item: StalkerVodSource): void {
        const itemId = normalizeStalkerEntityId(item.id);
        if (this.liveFavoriteIds().has(itemId)) {
            this.removeFromFavorites({ id: item.id });
            return;
        }

        this.addToFavorites({
            ...item,
            category_id: 'itv',
            title: item.o_name || item.name,
            cover: item.logo,
            added_at: new Date().toISOString(),
        });
    }

    readonly liveFavoriteIds = computed(() => {
        const ids = new Map<string | number, boolean>();
        for (const item of this.liveItemsToShow()) {
            ids.set(normalizeStalkerEntityId(item.id), true);
        }
        return ids;
    });

    private clearLiveSelection() {
        this.selectedLiveItem.set(null);
        this.liveStreamUrl.set('');
        this.isResolvingPlayback.set(false);
        this.epgItems.set([]);
        this.isLoadingEpg.set(false);
        this.hasMoreEpg.set(false);
        this.epgChannelId = null;
        this.stalkerStore.setSelectedItem(null);
    }

    private async loadEpgForChannel(channelId: number | string | undefined) {
        if (channelId === undefined || channelId === null) {
            this.epgItems.set([]);
            this.hasMoreEpg.set(false);
            return;
        }

        this.epgChannelId = channelId;
        this.epgPageSize = 10;
        this.isLoadingEpg.set(true);
        this.epgItems.set([]);
        this.hasMoreEpg.set(false);

        try {
            const items = await this.stalkerStore.fetchChannelEpg(
                channelId,
                this.epgPageSize
            );
            this.epgItems.set(items);
            this.hasMoreEpg.set(items.length >= this.epgPageSize);
        } catch {
            this.epgItems.set([]);
        } finally {
            this.isLoadingEpg.set(false);
        }
    }

    private showPlaybackError(error: unknown): void {
        const errorMessage =
            error instanceof Error && error.message === 'nothing_to_play'
                ? this.translate.instant('PORTALS.CONTENT_NOT_AVAILABLE')
                : this.translate.instant('PORTALS.PLAYBACK_ERROR');
        this.snackBar.open(errorMessage, undefined, { duration: 3000 });
    }
}
