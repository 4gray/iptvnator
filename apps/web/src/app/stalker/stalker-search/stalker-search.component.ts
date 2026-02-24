import { Component, effect, inject, resource, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { selectPlaylistById } from 'm3u-state';
import { DataService, PlaylistsService, StalkerSessionService } from 'services';
import {
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
    VodDetailsItem,
} from 'shared-interfaces';
import { ContentCardComponent } from '../../shared/components/content-card/content-card.component';
import { SearchLayoutComponent } from '../../shared/components/search-layout/search-layout.component';
import { VodDetailsComponent } from '../../xtream-electron/vod-details/vod-details.component';
import { StalkerContentTypes } from '../stalker-content-types';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../stalker.store';
import { createLogger } from '../../shared/utils/logger';
import {
    StalkerSelectedVodItem,
    StalkerVodSource,
} from '../models';
import {
    buildStalkerSelectedVodItem,
    clearStalkerDetailViewState,
    createPortalFavoritesResource,
    createRefreshTrigger,
    createStalkerDetailViewState,
    isSelectedStalkerVodFavorite,
    isStalkerSeriesFlag,
    toggleStalkerVodFavorite,
} from '../stalker-vod.utils';

interface StalkerFilter {
    key: string;
    label: string;
    translationKey: string;
}

@Component({
    selector: 'app-stalker-search',
    imports: [
        ContentCardComponent,
        FormsModule,
        MatCheckboxModule,
        SearchLayoutComponent,
        StalkerSeriesViewComponent,
        TranslatePipe,
        VodDetailsComponent,
    ],
    templateUrl: './stalker-search.component.html',
    styleUrl: './stalker-search.component.scss',
})
export class StalkerSearchComponent {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly dataService = inject(DataService);
    private readonly playlistService = inject(PlaylistsService);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly store = inject(Store);
    private readonly logger = createLogger('StalkerSearch');

    readonly filters = signal({
        series: false,
        vod: true,
    });
    readonly isWorkspaceLayout =
        this.activatedRoute.snapshot.data['layout'] === 'workspace';

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

    private readonly currentPlaylist = this.store.selectSignal(
        selectPlaylistById(this.activatedRoute?.parent?.snapshot.params.id)
    );

    readonly selectedFilterType = signal('vod');
    private readonly favoritesRefresh = createRefreshTrigger();

    itemDetails: StalkerSelectedVodItem | null = null;
    vodDetailsItem: VodDetailsItem | null = null;

    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => this.currentPlaylist()?._id,
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly searchResultsResource = resource({
        params: () => ({
            contentType: this.selectedFilterType(),
            search: this.searchTerm(),
            action: StalkerPortalActions.GetOrderedList,
        }),
        loader: async ({ params }) => {
            if (params.search.length < 3) {
                return [];
            }
            const playlist = this.currentPlaylist();
            if (!playlist) return [];
            const { portalUrl, macAddress } = playlist;

            let token: string | undefined;
            let serialNumber: string | undefined;
            if ((playlist as Playlist).isFullStalkerPortal) {
                try {
                    const result = await this.stalkerSession.ensureToken(
                        playlist as Playlist
                    );
                    token = result.token ?? undefined;
                    serialNumber = (playlist as Playlist).stalkerSerialNumber;
                } catch (error) {
                    this.logger.error('Failed to get stalker token', error);
                }
            }

            const response = await this.dataService.sendIpcEvent(
                STALKER_REQUEST,
                {
                    url: portalUrl,
                    macAddress,
                    params: {
                        action: StalkerContentTypes[params.contentType]
                            .getContentAction,
                        type: params.contentType,
                        search: params.search,
                        max_page_items: 100,
                    },
                    token,
                    serialNumber,
                }
            );
            if (response) {
                const items = response.js?.data || [];
                return items.map((item: StalkerVodSource) =>
                    this.processItemUrls(item, portalUrl)
                );
            } else {
                throw new Error(
                    `Error: ${response.message} (Status: ${response.status})`
                );
            }
        },
    });

    readonly isSelectedVodFavorite = signal<boolean>(false);

    constructor() {
        this.activatedRoute.queryParamMap
            .pipe(takeUntilDestroyed())
            .subscribe((queryParams) => {
                const routeTerm = queryParams.get('q')?.trim() ?? '';
                if (routeTerm !== this.searchTerm()) {
                    this.searchTerm.set(routeTerm);
                }
            });

        effect(() => {
            // Re-evaluate favorite state whenever favorites resource changes.
            this.portalFavorites.value();
            this.syncSelectedVodFavorite();
        });
    }

    /** Check if showing item details */
    get showingDetails(): boolean {
        return this.itemDetails !== null;
    }

    /** Get results count for layout */
    get resultsCount(): number {
        return this.searchResultsResource.value()?.length ?? 0;
    }

    createLinkToPlayVodItv(cmd?: string, title?: string, thumbnail?: string) {
        this.stalkerStore.createLinkToPlayVod(cmd, title, thumbnail);
    }

    updateSearchTerm(term: string) {
        this.searchTerm.set(term);
    }

    updateFilter(key: string, value: boolean) {
        if (value) {
            // Single selection mode - set clicked filter, disable others
            this.selectedFilterType.set(key);
            this.filters.update((f) => {
                const newFilters: Record<string, boolean> = {};
                Object.keys(f).forEach((k) => {
                    newFilters[k] = k === key;
                });
                return newFilters as typeof f;
            });
        }
    }

    selectItem(item: StalkerVodSource) {
        const hasEmbeddedSeries = item.series?.length > 0;
        const needsSeriesFetch =
            this.selectedFilterType() === 'vod' &&
            !hasEmbeddedSeries &&
            isStalkerSeriesFlag(item.is_series);

        this.itemDetails = buildStalkerSelectedVodItem(item, needsSeriesFetch);

        this.stalkerStore.setSelectedItem(this.itemDetails);

        switch (this.selectedFilterType()) {
            case 'vod':
                this.stalkerStore.setSelectedContentType('vod');
                if (!hasEmbeddedSeries && !needsSeriesFetch) {
                    const detailViewState = createStalkerDetailViewState(
                        this.itemDetails,
                        this.currentPlaylist()?._id ?? ''
                    );
                    this.itemDetails = detailViewState.itemDetails;
                    this.vodDetailsItem = detailViewState.vodDetailsItem;
                    this.syncSelectedVodFavorite();
                } else {
                    const cleared = clearStalkerDetailViewState();
                    this.vodDetailsItem = cleared.vodDetailsItem;
                    this.isSelectedVodFavorite.set(false);
                }
                break;
            case 'series':
                this.stalkerStore.setSelectedContentType('series');
                break;
            default:
                break;
        }
    }

    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            this.createLinkToPlayVodItv(
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
        const cleared = clearStalkerDetailViewState();
        this.itemDetails = cleared.itemDetails;
        this.vodDetailsItem = cleared.vodDetailsItem;
        this.isSelectedVodFavorite.set(false);
    }

    removeFromFavorites(favoriteId: string, onDone?: () => void) {
        this.stalkerStore.removeFromFavorites(favoriteId, onDone);
    }

    addToFavorites(item: Record<string, unknown>, onDone?: () => void) {
        this.stalkerStore.addToFavorites(item, onDone);
    }

    private syncSelectedVodFavorite(): void {
        const item = this.vodDetailsItem;
        this.isSelectedVodFavorite.set(
            isSelectedStalkerVodFavorite(
                item,
                this.portalFavorites.value() ?? []
            )
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
}
