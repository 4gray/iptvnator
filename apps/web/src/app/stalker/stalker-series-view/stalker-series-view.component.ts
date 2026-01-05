import {
    Component,
    computed,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { FavoritesButtonComponent } from '../favorites-button/favorites-button.component';
import { ContentHeroComponent } from 'components';
import { StalkerStore } from '../stalker.store';

/**
 * VOD series season with episodes loaded dynamically
 */
interface VodSeriesSeason {
    id: string;
    video_id: string;
    name: string;
    season_number: string;
    episodes?: any[];
    isLoading?: boolean;
    isExpanded?: boolean;
}

/**
 * Common interface for regular series seasons
 */
interface StalkerSeriesSeason {
    id: string;
    name: string;
    cmd?: string;
    series?: any[];
}

/**
 * Component for displaying series/episodes for Stalker portal content.
 * Supports three modes:
 * 1. Regular series (type=series): Fetches seasons from API via serialSeasonsResource
 * 2. VOD with embedded series (vclub): Uses the series array from the vodWithSeries input
 * 3. VOD series (Ministra is_series=1): Fetches seasons/episodes using movie_id and season_id
 */
@Component({
    selector: 'app-stalker-series-view',
    templateUrl: './stalker-series-view.component.html',
    styleUrls: ['../../xtream-tauri/detail-view.scss'],
    imports: [
        FavoritesButtonComponent,
        ContentHeroComponent,
        MatButton,
        MatDivider,
        MatProgressSpinner,
        TranslatePipe,
    ],
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
     * Track VOD series seasons with their loaded episodes
     */
    readonly vodSeriesSeasons = signal<VodSeriesSeason[]>([]);

    /**
     * Indicates if this is a VOD series item (Ministra is_series=1)
     */
    readonly isVodSeries = computed(() => {
        const item = this.displayItem();
        return item?.is_series === true;
    });

    /**
     * Loading state for VOD series seasons
     */
    readonly isVodSeriesSeasonsLoading =
        this.stalkerStore.isVodSeriesSeasonsLoading;

    /**
     * Loading state for regular series seasons
     */
    readonly isSerialSeasonsLoading = this.stalkerStore.isSerialSeasonsLoading;

    constructor() {
        // Effect to load VOD series seasons when a VOD series item is selected
        effect(() => {
            const item = this.displayItem();
            if (item?.is_series === true) {
                // Get seasons from the resource
                const seasons = this.stalkerStore.getVodSeriesSeasonsResource();
                if (seasons && seasons.length > 0) {
                    // Map seasons to our VodSeriesSeason structure
                    const mappedSeasons: VodSeriesSeason[] = seasons.map(
                        (season: any) => ({
                            id: season.id,
                            video_id: season.video_id,
                            name:
                                season.name || `Season ${season.season_number}`,
                            season_number: season.season_number,
                            episodes: [],
                            isLoading: false,
                            isExpanded: false,
                        })
                    );
                    this.vodSeriesSeasons.set(mappedSeasons);
                }
            } else {
                this.vodSeriesSeasons.set([]);
            }
        });
    }

    /**
     * For VOD with embedded series, we create a single "season" with the episodes
     * For regular series, we use the API-fetched seasons
     */
    readonly regularSeasons = computed<StalkerSeriesSeason[]>(() => {
        const vodItem = this.vodWithSeries();
        if (vodItem?.series?.length > 0) {
            // VOD with embedded series - create a pseudo-season structure
            return [
                {
                    id: vodItem.id,
                    name: vodItem.info?.name || 'Episodes',
                    cmd: vodItem.cmd,
                    series: vodItem.series,
                },
            ];
        }

        // Regular series - use API-fetched seasons
        return this.stalkerStore.getSerialSeasonsResource() as unknown as StalkerSeriesSeason[];
    });

    /**
     * Get the item to display details for (either vodWithSeries or selectedItem from store)
     */
    readonly displayItem = computed(() => {
        return this.vodWithSeries() || this.selectedItem();
    });

    /**
     * Toggle season expansion and load episodes if needed (for VOD series)
     */
    async toggleSeasonExpanded(season: VodSeriesSeason) {
        const seasons = this.vodSeriesSeasons();
        const index = seasons.findIndex((s) => s.id === season.id);
        if (index === -1) return;

        const updatedSeasons = [...seasons];
        const currentSeason = { ...updatedSeasons[index] };

        // Toggle expansion
        currentSeason.isExpanded = !currentSeason.isExpanded;

        // Load episodes if expanding and not already loaded
        if (
            currentSeason.isExpanded &&
            (!currentSeason.episodes || currentSeason.episodes.length === 0)
        ) {
            currentSeason.isLoading = true;
            updatedSeasons[index] = currentSeason;
            this.vodSeriesSeasons.set(updatedSeasons);

            try {
                const episodes = await this.stalkerStore.fetchVodSeriesEpisodes(
                    currentSeason.video_id,
                    currentSeason.id
                );
                // Update season with loaded episodes
                const newSeasons = [...this.vodSeriesSeasons()];
                const seasonIndex = newSeasons.findIndex(
                    (s) => s.id === season.id
                );
                if (seasonIndex !== -1) {
                    newSeasons[seasonIndex] = {
                        ...newSeasons[seasonIndex],
                        episodes: episodes,
                        isLoading: false,
                    };
                    this.vodSeriesSeasons.set(newSeasons);
                }
            } catch (error) {
                console.error(
                    '[StalkerSeriesViewComponent] Failed to load episodes:',
                    error
                );
                const newSeasons = [...this.vodSeriesSeasons()];
                const seasonIndex = newSeasons.findIndex(
                    (s) => s.id === season.id
                );
                if (seasonIndex !== -1) {
                    newSeasons[seasonIndex] = {
                        ...newSeasons[seasonIndex],
                        isLoading: false,
                    };
                    this.vodSeriesSeasons.set(newSeasons);
                }
            }
        } else {
            updatedSeasons[index] = currentSeason;
            this.vodSeriesSeasons.set(updatedSeasons);
        }
    }

    /**
     * Play episode - handles both regular series and VOD series
     */
    playEpisodeClicked(episode: any, cmd?: string) {
        const item = this.displayItem();
        this.stalkerStore.createLinkToPlayVod(
            cmd,
            item.info.name,
            item.info.movie_image,
            episode
        );
    }

    /**
     * Play VOD series episode
     * For VOD series, we need to use a different cmd format
     */
    playVodSeriesEpisode(episode: any) {
        const item = this.displayItem();
        // For VOD series episodes, the cmd is: /media/file_{episode.id}.mpg
        const cmd = `/media/file_${episode.id}.mpg`;
        const episodeName = episode.name || `Episode ${episode.series_number}`;

        this.stalkerStore.createLinkToPlayVod(
            cmd,
            `${item.info.name} - ${episodeName}`,
            item.info.movie_image
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

    goBack() {
        // Clear selectedItem to return to category view
        this.stalkerStore.clearSelectedItem();
    }
}
