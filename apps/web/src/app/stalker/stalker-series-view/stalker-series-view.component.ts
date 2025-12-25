import { Component, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { TranslatePipe } from '@ngx-translate/core';
import { FavoritesButtonComponent } from '../favorites-button/favorites-button.component';
import { StalkerStore } from '../stalker.store';

/**
 * Component for displaying series/episodes for Stalker portal content.
 * Supports two modes:
 * 1. Regular series (type=series): Fetches seasons from API via serialSeasonsResource
 * 2. VOD with embedded series (vclub): Uses the series array from the vodWithSeries input
 */
@Component({
    selector: 'app-stalker-series-view',
    templateUrl: './stalker-series-view.component.html',
    styleUrls: ['../../xtream/detail-view.scss'],
    imports: [FavoritesButtonComponent, MatButton, MatDivider, TranslatePipe],
})
export class StalkerSeriesViewComponent {
    readonly stalkerStore = inject(StalkerStore);

    /**
     * Optional input for VOD items with embedded series array (vclub mode)
     * When provided, uses this instead of fetching seasons from API
     */
    readonly vodWithSeries = input<any>(null);

    readonly selectedItem = this.stalkerStore.selectedItem;

    /**
     * For VOD with embedded series, we create a single "season" with the episodes
     * For regular series, we use the API-fetched seasons
     */
    readonly seasonsData = computed(() => {
        const vodItem = this.vodWithSeries();
        if (vodItem?.series?.length > 0) {
            // VOD with embedded series - create a pseudo-season structure
            return [{
                id: vodItem.id,
                name: vodItem.info?.name || 'Episodes',
                cmd: vodItem.cmd,
                series: vodItem.series,
            }];
        }
        // Regular series - use API-fetched seasons
        return this.stalkerStore.getSerialSeasonsResource();
    });

    /**
     * Get the item to display details for (either vodWithSeries or selectedItem from store)
     */
    readonly displayItem = computed(() => {
        return this.vodWithSeries() || this.selectedItem();
    });

    playEpisodeClicked(episode: any, cmd: string) {
        const item = this.displayItem();
        this.stalkerStore.createLinkToPlayVod(
            cmd,
            item.info.name,
            item.info.movie_image,
            episode
        );
    }

    addToFavorites(item: any) {
        const displayItem = this.displayItem();
        this.stalkerStore.addToFavorites({
            ...item,
            title: displayItem.info.name,
            cover: displayItem.info.movie_image,
            series_id: displayItem.id,
            added_at: new Date().toISOString(),
            category_id: 'series',
        });
    }

    removeFromFavorites(serialId: string) {
        this.stalkerStore.removeFromFavorites(serialId);
    }
}
