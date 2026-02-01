import { Component, inject, resource, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { selectPlaylistById } from 'm3u-state';
import { DataService, StalkerSessionService } from 'services';
import {
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
    VodDetailsItem,
    StalkerVodDetails,
    createStalkerVodItem,
} from 'shared-interfaces';
import { SearchFormComponent } from '../../shared/components/search-form/search-form.component';
import { SearchResultItemComponent } from '../../shared/components/search-result-item/search-result-item.component';
import { PlaylistErrorViewComponent } from '../../xtream-tauri/playlist-error-view/playlist-error-view.component';
import { VodDetailsComponent } from '../../xtream/vod-details/vod-details.component';
import { StalkerContentTypes } from '../stalker-content-types';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../stalker.store';

@Component({
    selector: 'app-stalker-search',
    imports: [
        MatCardModule,
        MatProgressSpinner,
        PlaylistErrorViewComponent,
        SearchFormComponent,
        TranslatePipe,
        SearchResultItemComponent,
        StalkerSeriesViewComponent,
        VodDetailsComponent,
    ],
    templateUrl: './stalker-search.component.html',
    styles: `
        :host {
            width: 100%;
        }

        .search-page {
            padding: 20px;
        }

        .results-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 1rem;
            padding-bottom: 1rem;
        }
    `,
})
export class StalkerSearchComponent {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly dataService = inject(DataService);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly store = inject(Store);

    readonly filters = {
        series: false,
        vod: true,
    };

    readonly filterConfig = [
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

    itemDetails: any = null;
    vodDetailsItem: VodDetailsItem | null = null;

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

            // Get token if it's a full stalker portal
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
                    console.error('Failed to get stalker token:', error);
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
                // Process items to convert relative URLs to absolute
                const items = response.js?.data || [];
                return items.map((item: any) =>
                    this.processItemUrls(item, portalUrl)
                );
            } else {
                throw new Error(
                    `Error: ${response.message} (Status: ${response.status})`
                );
            }
        },
    });

    createLinkToPlayVodItv(cmd?: string, title?: string, thumbnail?: string) {
        this.stalkerStore.createLinkToPlayVod(cmd, title, thumbnail);
    }

    selectItem(item: any) {
        // Check if item has embedded series data (vclub mode or Ministra with episodes)
        const hasEmbeddedSeries = item.series?.length > 0;

        // Detect if this VOD item is a series that needs API fetch (Ministra is_series flag WITHOUT embedded series)
        // Only set is_series when we need to fetch seasons from API
        const needsSeriesFetch =
            this.selectedFilterType() === 'vod' &&
            !hasEmbeddedSeries &&
            (item.is_series === '1' || item.is_series === 1);

        // Structure item exactly like category-content-view does
        this.itemDetails = {
            id: item.id,
            cmd: item.cmd,
            // For VOD items with embedded series array (Stalker vclub or Ministra with episode numbers)
            series: item.series,
            // Preserve has_files for cmd transformation during playback
            has_files: item.has_files,
            // Flag for VOD items that need to fetch seasons from API (Ministra plugin without embedded series)
            is_series: needsSeriesFetch ? true : undefined,
            // Store video_id for season fetching if available
            video_id: item.video_id,
            info: {
                movie_image: item.screenshot_uri,
                description: item.description,
                name: item.o_name || item.name,
                o_name: item.o_name,
                director: item.director,
                releasedate: item.year,
                genre: item.genres_str,
                actors: item.actors,
                rating_imdb: item.rating_imdb,
                rating_kinopoisk: item.rating_kinopoisk,
            },
        };

        // Debug logging
        console.log('[StalkerSearch] selectItem - hasEmbeddedSeries:', hasEmbeddedSeries);
        console.log('[StalkerSearch] selectItem - needsSeriesFetch:', needsSeriesFetch);
        console.log('[StalkerSearch] selectItem - itemDetails:', this.itemDetails);

        this.stalkerStore.setSelectedItem(this.itemDetails);

        switch (this.selectedFilterType()) {
            case 'vod':
                this.stalkerStore.setSelectedContentType('vod');
                // Only create VodDetailsItem for regular VODs (not series of any kind)
                if (!hasEmbeddedSeries && !needsSeriesFetch) {
                    const playlist = this.currentPlaylist();
                    this.vodDetailsItem = createStalkerVodItem(
                        this.itemDetails as StalkerVodDetails,
                        playlist?._id ?? ''
                    );
                } else {
                    this.vodDetailsItem = null;
                }
                break;
            case 'series':
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
    onVodFavoriteToggled(event: { item: VodDetailsItem; isFavorite: boolean }): void {
        if (event.item.type === 'stalker') {
            if (event.isFavorite) {
                this.addToFavorites({
                    ...event.item.data,
                    category_id: 'vod',
                    title: event.item.data.info?.name,
                    cover: event.item.data.info?.movie_image,
                    added_at: new Date().toISOString(),
                });
            } else {
                this.removeFromFavorites(event.item.data.id);
            }
        }
    }

    /** Handle back from vod-details component */
    onVodBack(): void {
        this.itemDetails = null;
        this.vodDetailsItem = null;
    }

    onFiltersChange(event: { vod: boolean; live: boolean; series: boolean }) {
        const selectedFilter = Object.keys(event).find((key) => event[key]);
        if (selectedFilter) {
            this.selectedFilterType.set(selectedFilter);
        }
    }

    addToFavorites(item: any) {
        console.debug('Add to favorites', item);
        this.stalkerStore.addToFavorites(item);
    }

    removeFromFavorites(favoriteId: string) {
        console.debug('Remove from favorites', favoriteId);
        this.stalkerStore.removeFromFavorites(favoriteId);
    }

    /**
     * Convert relative URLs to absolute URLs using the portal base URL.
     * Ministra portals often return relative paths for screenshot_uri.
     */
    private processItemUrls(item: any, portalUrl: string): any {
        const processed = { ...item };

        // Convert screenshot_uri to absolute URL
        if (processed.screenshot_uri) {
            processed.screenshot_uri = this.makeAbsoluteUrl(
                portalUrl,
                processed.screenshot_uri
            );
        }

        return processed;
    }

    /**
     * Convert relative URL to absolute using portal base URL
     */
    private makeAbsoluteUrl(baseUrl: string, relativePath: string): string {
        if (!relativePath) return '';
        // Already absolute URL
        if (
            relativePath.startsWith('http://') ||
            relativePath.startsWith('https://')
        ) {
            return relativePath;
        }
        // Parse the base URL to get origin
        try {
            const url = new URL(baseUrl);
            // Ensure the relative path starts with /
            const path = relativePath.startsWith('/')
                ? relativePath
                : `/${relativePath}`;
            return `${url.origin}${path}`;
        } catch {
            return relativePath;
        }
    }
}
