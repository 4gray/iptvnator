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
import { XtreamStore } from '../../xtream-tauri/stores/xtream.store';

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
    private readonly xtreamStore = inject(XtreamStore);
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
     * Note: is_series can be true, 1, or "1" depending on the source
     */
    readonly isVodSeries = computed(() => {
        const item = this.displayItem();
        return (
            item?.is_series === true ||
            item?.is_series === 1 ||
            item?.is_series === '1'
        );
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
            const isSeries =
                item?.is_series === true ||
                item?.is_series === 1 ||
                item?.is_series === '1';
            if (isSeries) {
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

        // Effect to load playback positions for Stalker series
        effect(() => {
            const item = this.displayItem();
            const playlist = this.stalkerStore.currentPlaylist();
            if (item && playlist?._id) {
                const seriesId = Number(item.id);
                console.log(
                    `[StalkerSeriesView] Loading positions for series: id=${item.id}, seriesId=${seriesId}, is_series=${item.is_series}`
                );
                if (!isNaN(seriesId)) {
                    // Load playback positions from the XtreamStore (works for any playlist type)
                    this.xtreamStore.loadSeriesPositions(playlist._id, seriesId);
                }
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
     * Simple hash function to generate consistent numeric IDs from strings
     */
    private hashString(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Generate a unique episode ID for Stalker episodes.
     * For VOD series: ALWAYS hash with season + episode number because
     * the API returns the same ID (series/movie ID) for all episodes.
     * For regular series: hash the cmd + episode number
     */
    private generateEpisodeId(
        episodeId: any,
        episodeNum: number,
        seasonKey: string,
        isVodSeries: boolean
    ): number {
        if (isVodSeries) {
            // For VOD series, ALWAYS create unique ID from season + episode number
            // The API-provided ep.id is the same for all episodes (it's the series ID)
            return this.hashString(`vod_${seasonKey}_${episodeNum}`);
        } else {
            // For regular series, create unique ID from cmd + episode number
            const cmd = String(episodeId || '');
            return this.hashString(`${cmd}_ep_${episodeNum}`);
        }
    }

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
                        (ep) => {
                            const episodeNum = ep.series_number || ep.episode_num || 0;
                            return {
                                episode_num: episodeNum,
                                title:
                                    ep.name ||
                                    `Episode ${episodeNum}`,
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
                                // Use unique ID for watched status tracking
                                id: this.generateEpisodeId(ep.id, episodeNum, seasonKey, true),
                                // Store original API id for playback
                                originalId: ep.id,
                                custom_sid: 'vod-series', // marker
                            } as unknown as XtreamSerieEpisode;
                        }
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
                                // Use unique ID for watched status tracking
                                id: this.generateEpisodeId(season.cmd, epNum, seasonKey, false),
                                // Store cmd for playback
                                originalCmd: season.cmd,
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
        if ((episode as any).custom_sid === 'vod-series') {
            // It's a VOD series episode (is_series=1 mode)
            // Use originalId for playback URL, but use generated id for tracking
            this.playVodSeriesEpisode({
                originalId: (episode as any).originalId, // For constructing playback URL
                trackingId: episode.id, // The generated unique ID for position tracking
                name: episode.title,
                series_number: episode.episode_num,
            });
        } else {
            // Regular series or vclub mode (VOD with embedded series array)
            // Use originalCmd for playback, episode.id for tracking
            const trackingId = Number(episode.id);
            this.playEpisodeClicked(
                episode.episode_num,
                (episode as any).originalCmd,
                trackingId
            );
        }
    }

    /**
     * Play episode - handles regular series and vclub mode
     */
    playEpisodeClicked(episodeNum: any, cmd?: string, trackingId?: number) {
        const item = this.displayItem();
        console.log(
            `[StalkerSeriesView] playEpisodeClicked: episodeNum=${episodeNum}, cmd=${cmd}, trackingId=${trackingId}, seriesId=${item.id}`
        );

        // Get playback position from XtreamStore if available
        const position = trackingId
            ? this.xtreamStore.playbackPositions().get(`episode_${trackingId}`)
            : undefined;
        const startTime = position?.positionSeconds;

        this.stalkerStore.createLinkToPlayVod(
            cmd,
            item.info.name,
            item.info.movie_image,
            episodeNum,
            trackingId, // unique episode ID for playback tracking
            startTime
        );
    }

    /**
     * Play VOD series episode
     */
    playVodSeriesEpisode(episode: any) {
        const item = this.displayItem();
        // Use originalId for playback URL (this is what the Stalker API expects)
        const cmd = `/media/file_${episode.originalId}.mpg`;
        const episodeName = episode.name || `Episode ${episode.series_number}`;
        // Use trackingId (generated unique ID) for playback position tracking
        const trackingId = Number(episode.trackingId);

        console.log(
            `[StalkerSeriesView] playVodSeriesEpisode: originalId=${episode.originalId}, trackingId=${trackingId}, seriesId=${item.id}, episodeName=${episodeName}`
        );

        // Get playback position from XtreamStore if available
        const position = this.xtreamStore
            .playbackPositions()
            .get(`episode_${trackingId}`);
        const startTime = position?.positionSeconds;

        this.stalkerStore.createLinkToPlayVod(
            cmd,
            `${item.info.name} - ${episodeName}`,
            item.info.movie_image,
            episode.series_number, // episode number for API
            trackingId, // unique episode ID for playback tracking
            startTime
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