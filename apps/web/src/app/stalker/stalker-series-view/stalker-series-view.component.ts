import {
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { FavoritesButtonComponent } from '../favorites-button/favorites-button.component';
import { ContentHeroComponent } from 'components';
import { StalkerStore } from '../stalker.store';
import { SeasonContainerComponent } from '../../xtream-tauri/season-container/season-container.component';
import { XtreamSerieEpisode } from 'shared-interfaces';

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
        TranslatePipe,
        SeasonContainerComponent,
    ],
})
export class StalkerSeriesViewComponent {
    readonly stalkerStore = inject(StalkerStore);
    readonly backClicked = output<void>();

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
     * Adapts both Regular and VOD series data into the format expected by SeasonContainerComponent.
     * Record<string, XtreamSerieEpisode[]> where string is season number/name.
     */
    readonly mappedSeasons = computed<Record<string, XtreamSerieEpisode[]>>(
        () => {
            const mapped: Record<string, XtreamSerieEpisode[]> = {};

            if (this.isVodSeries()) {
                // Map VOD Series (async loaded)
                this.vodSeriesSeasons().forEach((season) => {
                    const seasonKey =
                        season.season_number || season.name || season.id;
                    // Map existing episodes or empty array
                    mapped[seasonKey] = (season.episodes || []).map(
                        (ep) =>
                            ({
                                episode_num:
                                    ep.series_number || ep.episode_num || 0,
                                title:
                                    ep.name ||
                                    `Episode ${ep.series_number || ep.episode_num}`,
                                container_extension: 'mpg',
                                info: {
                                    movie_image:
                                        ep.cover ||
                                        this.displayItem().info.movie_image,
                                    plot: ep.description || '',
                                    duration: ep.duration
                                        ? `${ep.duration} min`
                                        : '',
                                },
                                id: ep.id,
                                custom_sid: 'vod-series', // marker
                            }) as unknown as XtreamSerieEpisode
                    );
                });
            } else {
                // Map Regular Series (just numbers)
                (this.regularSeasons() || []).forEach((season, index) => {
                    const seasonKey = (index + 1).toString();
                    mapped[seasonKey] = (season.series || []).map(
                        (epNum) =>
                            ({
                                episode_num: epNum,
                                title: `Episode ${epNum}`,
                                container_extension: '',
                                info: {
                                    movie_image:
                                        this.displayItem().info.movie_image,
                                },
                                custom_sid: 'regular-series', // marker
                                id: season.cmd, // Store cmd in id for playEpisodeClicked
                            }) as unknown as XtreamSerieEpisode
                    );
                });
            }

            return mapped;
        }
    );

    /**
     * Handles season selection from the container.
     * For VOD Series, triggers lazy loading of episodes.
     */
    onSeasonSelected(seasonKey: string) {
        if (!this.isVodSeries()) return;

        const seasons = this.vodSeriesSeasons();
        const season = seasons.find(
            (s) => (s.season_number || s.name || s.id) == seasonKey
        );

        if (season && (!season.episodes || season.episodes.length === 0)) {
            this.loadEpisodesForSeason(season);
        }
    }

    /**
     * Loads episodes for a specific VOD season
     */
    async loadEpisodesForSeason(season: VodSeriesSeason) {
        // Set loading state in local signal
        const seasons = this.vodSeriesSeasons();
        const index = seasons.findIndex((s) => s.id === season.id);
        if (index === -1) return;

        const updatedSeasons = [...seasons];
        updatedSeasons[index] = { ...updatedSeasons[index], isLoading: true };
        this.vodSeriesSeasons.set(updatedSeasons);

        try {
            const episodes = await this.stalkerStore.fetchVodSeriesEpisodes(
                season.video_id,
                season.id
            );

            // Update with loaded episodes
            const newSeasons = [...this.vodSeriesSeasons()];
            const newIndex = newSeasons.findIndex((s) => s.id === season.id);
            if (newIndex !== -1) {
                newSeasons[newIndex] = {
                    ...newSeasons[newIndex],
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
            const newIndex = newSeasons.findIndex((s) => s.id === season.id);
            if (newIndex !== -1) {
                newSeasons[newIndex] = {
                    ...newSeasons[newIndex],
                    isLoading: false,
                };
                this.vodSeriesSeasons.set(newSeasons);
            }
        }
    }

    /**
     * Determines if the current selected season is loading
     */
    isCurrentSeasonLoading(seasonKey: string): boolean {
        if (!this.isVodSeries()) return false;
        const season = this.vodSeriesSeasons().find(
            (s) => (s.season_number || s.name || s.id) == seasonKey
        );
        return season?.isLoading || false;
    }

    /**
     * Handles episode click from the container
     */
    onEpisodeClicked(episode: XtreamSerieEpisode) {
        if (episode.custom_sid === 'vod-series') {
            // It's a VOD series episode
            // We reconstructed the episode object, but playVodSeriesEpisode expects the raw object
            // or at least { id, name, series_number }
            this.playVodSeriesEpisode({
                id: episode.id,
                name: episode.title,
                series_number: episode.episode_num,
            });
        } else {
            // Regular series
            // episode.id contains the 'cmd' from mapping
            this.playEpisodeClicked(episode.episode_num, episode.id);
        }
    }

    /**
     * Play episode - handles both regular series and VOD series
     */
    playEpisodeClicked(episodeNum: any, cmd?: string) {
        const item = this.displayItem();
        this.stalkerStore.createLinkToPlayVod(
            cmd,
            item.info.name,
            item.info.movie_image,
            episodeNum
        );
    }

    /**
     * Play VOD series episode
     */
    playVodSeriesEpisode(episode: any) {
        const item = this.displayItem();
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
        this.backClicked.emit();
        this.stalkerStore.clearSelectedItem();
    }
}