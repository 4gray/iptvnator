import { Component, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { selectPlaylistById } from 'm3u-state';
import { DataService, StalkerSessionService } from 'services';
import {
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
    StalkerVodDetails,
    VodDetailsItem,
    createStalkerVodItem,
} from 'shared-interfaces';
import { ContentCardComponent } from '../../shared/components/content-card/content-card.component';
import { SearchLayoutComponent } from '../../shared/components/search-layout/search-layout.component';
import { VodDetailsComponent } from '../../xtream/vod-details/vod-details.component';
import { StalkerContentTypes } from '../stalker-content-types';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../stalker.store';

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
    private readonly stalkerStore = inject(StalkerStore);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly store = inject(Store);

    readonly filters = signal({
        series: false,
        vod: true,
    });

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

    selectItem(item: any) {
        const hasEmbeddedSeries = item.series?.length > 0;
        const needsSeriesFetch =
            this.selectedFilterType() === 'vod' &&
            !hasEmbeddedSeries &&
            (item.is_series === '1' || item.is_series === 1);

        this.itemDetails = {
            id: item.id,
            cmd: item.cmd,
            series: item.series,
            has_files: item.has_files,
            is_series: needsSeriesFetch ? true : undefined,
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

        this.stalkerStore.setSelectedItem(this.itemDetails);

        switch (this.selectedFilterType()) {
            case 'vod':
                this.stalkerStore.setSelectedContentType('vod');
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

    onVodBack(): void {
        this.itemDetails = null;
        this.vodDetailsItem = null;
    }

    addToFavorites(item: any) {
        this.stalkerStore.addToFavorites(item);
    }

    removeFromFavorites(favoriteId: string) {
        this.stalkerStore.removeFromFavorites(favoriteId);
    }

    private processItemUrls(item: any, portalUrl: string): any {
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
