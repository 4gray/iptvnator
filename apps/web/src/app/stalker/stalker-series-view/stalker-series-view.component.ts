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
import { createLogger } from '../../shared/utils/logger';
import {
    getVodSeriesSeasonKey,
    isVodSeriesItem,
    mapRegularSeriesEpisodes,
    mapRegularSeriesSeasons,
    mapVodSeriesEpisodes,
    mapVodSeriesSeasonsToVm,
    StalkerMappedEpisode,
    StalkerSeriesSeasonVm,
    VodSeriesSeasonVm,
} from '../stalker-series.adapters';
import { StalkerSelectedVodItem, StalkerVodSource } from '../models';
import { normalizeStalkerVodDetailsItem } from '../stalker-vod.utils';

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
    private readonly logger = createLogger('StalkerSeriesView');

    /**
     * Optional input for VOD items with embedded series array (vclub mode)
     * When provided, uses this instead of fetching seasons from API
     */
    readonly vodWithSeries = input<StalkerVodSource | null>(null);

    readonly selectedItem = this.stalkerStore.selectedItem;

    /**
     * Track VOD series seasons with their loaded episodes
     */
    readonly vodSeriesSeasons = signal<VodSeriesSeasonVm[]>([]);

    /**
     * Indicates if this is a VOD series item (Ministra is_series=1)
     * Note: is_series can be true, 1, or "1" depending on the source
     */
    readonly isVodSeries = computed(() => {
        return (
            this.stalkerStore.selectedContentType() === 'vod' &&
            isVodSeriesItem(this.displayItem())
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
            if (this.isVodSeries()) {
                // Get seasons from the resource
                const seasons = this.stalkerStore.getVodSeriesSeasonsResource();
                this.vodSeriesSeasons.set(mapVodSeriesSeasonsToVm(seasons));
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
                const normalizedSeriesId = this.toSeriesId(item.id);
                this.logger.debug(
                    'Loading positions for series',
                    {
                        id: item.id,
                        seriesId: normalizedSeriesId,
                        isSeries: item.is_series,
                    }
                );
                if (!isNaN(normalizedSeriesId)) {
                    // Load playback positions from the XtreamStore (works for any playlist type)
                    this.xtreamStore.loadSeriesPositions(
                        playlist._id,
                        normalizedSeriesId
                    );
                }
            }
        });
    }

    /**
     * For VOD with embedded series, we create a single "season" with the episodes
     * For regular series, we use the API-fetched seasons
     */
    readonly regularSeasons = computed<StalkerSeriesSeasonVm[]>(() =>
        mapRegularSeriesSeasons(
            this.vodWithSeries(),
            this.stalkerStore.getSerialSeasonsResource()
        )
    );

    /**
     * Get the item to display details for (either vodWithSeries or selectedItem from store)
     */
    readonly displayItem = computed<StalkerSelectedVodItem | null>(() => {
        const item = this.vodWithSeries() || this.selectedItem();
        return item ? normalizeStalkerVodDetailsItem(item) : null;
    });

    /**
     * Adapts both Regular and VOD series data into the format expected by SeasonContainerComponent.
     * Record<string, XtreamSerieEpisode[]> where string is season number/name.
     */
    readonly mappedSeasons = computed<Record<string, XtreamSerieEpisode[]>>(
        () => {
            if (this.isVodSeries()) {
                return mapVodSeriesEpisodes(
                    this.vodSeriesSeasons(),
                    this.displayItem()?.info?.movie_image
                );
            }

            return mapRegularSeriesEpisodes(
                this.regularSeasons(),
                this.displayItem()?.info?.movie_image
            );
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
            (s) => getVodSeriesSeasonKey(s) === seasonKey
        );

        if (season && season.episodes.length === 0) {
            this.loadEpisodesForSeason(season);
        }
    }

    /**
     * Loads episodes for a specific VOD season
     */
    async loadEpisodesForSeason(season: VodSeriesSeasonVm) {
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
            this.logger.error('Failed to load episodes', error);
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
            (s) => getVodSeriesSeasonKey(s) === seasonKey
        );
        return season?.isLoading ?? false;
    }

    /**
     * Handles episode click from the container
     */
    onEpisodeClicked(episode: XtreamSerieEpisode) {
        const mappedEpisode = episode as StalkerMappedEpisode;

        if (mappedEpisode.custom_sid === 'vod-series') {
            // It's a VOD series episode (is_series=1 mode)
            // Use originalId for playback URL, but use generated id for tracking
            this.playVodSeriesEpisode({
                originalId: mappedEpisode.originalId, // For constructing playback URL
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
                mappedEpisode.originalCmd,
                trackingId
            );
        }
    }

    /**
     * Play episode - handles regular series and vclub mode
     */
    playEpisodeClicked(episodeNum: number, cmd?: string, trackingId?: number) {
        const item = this.displayItem();
        if (!item) return;
        this.logger.debug('playEpisodeClicked', {
            episodeNum,
            cmd,
            trackingId,
            seriesId: item.id,
        });

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
    playVodSeriesEpisode(episode: {
        originalId?: string;
        trackingId: string;
        name: string;
        series_number: number;
    }) {
        const item = this.displayItem();
        if (!item) return;
        // Use originalId for playback URL (this is what the Stalker API expects)
        const cmd = `/media/file_${episode.originalId ?? ''}.mpg`;
        const episodeName = episode.name || `Episode ${episode.series_number}`;
        // Use trackingId (generated unique ID) for playback position tracking
        const trackingId = Number(episode.trackingId);

        this.logger.debug('playVodSeriesEpisode', {
            originalId: episode.originalId,
            trackingId,
            seriesId: item.id,
            episodeName,
        });

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

    goBack() {
        this.backClicked.emit();
        this.stalkerStore.clearSelectedItem();
    }

    toSeriesId(id: string | number): number {
        const raw = String(id ?? '').trim();
        if (!raw) return 0;
        const primary = raw.includes(':') ? raw.split(':')[0] : raw;
        const parsed = Number(primary);
        return Number.isFinite(parsed) ? parsed : 0;
    }
}
