import { Component, effect, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { selectPlaylistById } from 'm3u-state';
import { DataService, PlaylistsService } from 'services';
import {
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
    VodDetailsItem,
} from 'shared-interfaces';
import { ContentCardComponent } from '@iptvnator/portal/shared/ui';
import { SearchLayoutComponent } from '@iptvnator/portal/shared/ui';
import { StalkerInlineDetailComponent } from '../stalker-inline-detail/stalker-inline-detail.component';
import { StalkerContentTypes } from '@iptvnator/portal/stalker/data-access';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    isWorkspaceLayoutRoute,
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
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';

interface StalkerFilter {
    key: string;
    label: string;
    translationKey: string;
}

interface StalkerSearchResponse {
    js?: {
        data?: StalkerVodSource[];
    };
    message?: string;
    status?: number;
}

@Component({
    selector: 'app-stalker-search',
    imports: [
        ContentCardComponent,
        FormsModule,
        MatCheckboxModule,
        SearchLayoutComponent,
        StalkerInlineDetailComponent,
        TranslatePipe,
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

            const response =
                await this.dataService.sendIpcEvent<StalkerSearchResponse>(
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
    }

    /** Check if showing item details */
    get showingDetails(): boolean {
        return this.inlineDetail().categoryId !== null;
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

    inlineDetail() {
        return createStalkerInlineDetailState(
            this.itemDetails,
            this.vodDetailsItem,
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
}
