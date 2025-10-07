import { Component, inject, resource, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { STALKER_REQUEST } from '../../../shared/ipc-commands';
import { StalkerPortalActions } from '../../../shared/stalker-portal-actions.enum';
import { DataService } from '../../services/data.service';
import { SearchFormComponent } from '../../shared/components/search-form/search-form.component';
import { SearchResultItemComponent } from '../../shared/components/search-result-item/search-result-item.component';
import { selectPlaylistById } from '../../state/selectors';
import { PlaylistErrorViewComponent } from '../../xtream-tauri/playlist-error-view/playlist-error-view.component';
import { VodDetailsComponent } from '../../xtream/vod-details/vod-details.component';
import { StalkerContentTypes } from '../stalker-content-types';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../stalker.store';

@Component({
    selector: 'app-stalker-search',
    imports: [
        MatCardModule,
        MatButton,
        MatIcon,
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
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            height: 100%;
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

    itemDetails = null;

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
                }
            );
            if (response) {
                return response.js?.data;
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
        this.itemDetails = {
            ...item,
            info: { ...item, movie_image: item.screenshot_uri },
        };
        this.stalkerStore.setSelectedItem(this.itemDetails);

        switch (this.selectedFilterType()) {
            case 'vod':
                this.stalkerStore.setSelectedContentType('vod');
                break;
            case 'series':
                this.stalkerStore.setSelectedContentType('series');
                break;
            default:
                break;
        }
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
}
