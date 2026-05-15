import {
    Component,
    OnDestroy,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FavoritesButtonComponent } from '../stalker-favorites-button/stalker-favorites-button.component';
import {
    ContentHeroComponent,
    SeasonContainerComponent,
    SeasonContainerPlaybackToggleRequest,
} from '@iptvnator/ui/components';
import {
    PlaybackPositionData,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    createLogger,
    getStalkerReturnToState,
} from '@iptvnator/portal/shared/util';
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
    normalizeStalkerVodDetailsItem,
    StalkerSelectedVodItem,
    StalkerStore,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import {
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
} from '@iptvnator/ui/playback';
import { DownloadsService } from '@iptvnator/services';
import {
    getStalkerSeriesQuickStartButton,
    type StalkerQuickStartButton,
} from './stalker-series-quick-start';

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
    styleUrls: ['../styles/detail-view.scss'],
    imports: [
        FavoritesButtonComponent,
        ContentHeroComponent,
        PortalInlinePlayerComponent,
        TranslatePipe,
        SeasonContainerComponent,
        MatIcon,
    ],
})
export class StalkerSeriesViewComponent implements OnDestroy {
    readonly stalkerStore = inject(StalkerStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly router = inject(Router);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly downloadsService = inject(DownloadsService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    readonly backClicked = output<void>();
    private readonly logger = createLogger('StalkerSeriesView');
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly episodePlaybackPositions = signal<
        Map<number, PlaybackPositionData>
    >(new Map());
    private lastSaveTime = 0;
    private unsubscribePositionUpdates: (() => void) | null = null;
    readonly openingEpisodeId = signal<number | null>(null);
    readonly activeEpisodeId = signal<number | null>(null);

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
                const normalizedSeriesId = this.toSeriesId(item.id);
                this.logger.debug('Loading positions for series', {
                    id: item.id,
                    seriesId: normalizedSeriesId,
                    isSeries: item.is_series,
                });
                if (!isNaN(normalizedSeriesId)) {
                    void this.loadSeriesPositions(
                        playlist._id,
                        normalizedSeriesId
                    );
                }
            } else {
                this.episodePlaybackPositions.set(new Map());
            }
        });

        effect(() => {
            const session = this.externalPlayback.activeSession();
            const item = this.displayItem();
            const playlistId = this.stalkerStore.currentPlaylist()?._id;
            const seriesId = item ? this.toSeriesId(item.id) : 0;

            if (
                !session?.contentInfo ||
                !playlistId ||
                !seriesId ||
                session.contentInfo.contentType !== 'episode' ||
                session.contentInfo.playlistId !== playlistId ||
                session.contentInfo.seriesXtreamId !== seriesId
            ) {
                this.openingEpisodeId.set(null);
                this.activeEpisodeId.set(null);
                return;
            }

            if (session.status === 'launching') {
                this.openingEpisodeId.set(session.contentInfo.contentXtreamId);
                this.activeEpisodeId.set(null);
                return;
            }

            if (session.status === 'opened' || session.status === 'playing') {
                this.openingEpisodeId.set(null);
                this.activeEpisodeId.set(session.contentInfo.contentXtreamId);
                return;
            }

            this.openingEpisodeId.set(null);
            this.activeEpisodeId.set(null);
        });

        if (window.electron?.onPlaybackPositionUpdate) {
            this.unsubscribePositionUpdates =
                window.electron.onPlaybackPositionUpdate(
                    (data: PlaybackPositionData) => {
                        const playlistId =
                            this.stalkerStore.currentPlaylist()?._id;
                        const item = this.displayItem();
                        const seriesId = item ? this.toSeriesId(item.id) : 0;

                        if (
                            data.contentType !== 'episode' ||
                            data.playlistId !== playlistId ||
                            data.seriesXtreamId !== seriesId
                        ) {
                            return;
                        }

                        this.updateEpisodePlaybackPosition(data);
                    }
                );
        }
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

    readonly quickStartAction = computed<StalkerQuickStartButton | null>(() => {
        return getStalkerSeriesQuickStartButton({
            isVodSeries: this.isVodSeries(),
            mappedSeasons: this.mappedSeasons(),
            playbackPositions: this.episodePlaybackPositions(),
            vodSeriesSeasons: this.vodSeriesSeasons(),
        });
    });

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

    async playQuickStartEpisode(): Promise<void> {
        const quickStart = this.quickStartAction();
        if (!quickStart || quickStart.disabled) {
            return;
        }

        if (quickStart.action) {
            this.onEpisodeClicked(quickStart.action.episode);
            return;
        }

        if (quickStart.lazySeason) {
            await this.loadAndPlayVodSeriesSeason(quickStart.lazySeason);
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

        const position = trackingId
            ? this.episodePlaybackPositions().get(trackingId)
            : undefined;
        const startTime = position?.positionSeconds;
        void this.startPlayback(
            cmd,
            item.info.name,
            item.info.movie_image,
            episodeNum,
            trackingId,
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

        const position = this.episodePlaybackPositions().get(trackingId);
        const startTime = position?.positionSeconds;
        void this.startPlayback(
            cmd,
            `${item.info.name} - ${episodeName}`,
            item.info.movie_image,
            episode.series_number,
            trackingId,
            startTime
        );
    }

    goBack() {
        const returnTo = getStalkerReturnToState(window.history.state);
        this.closeInlinePlayer();
        this.backClicked.emit();
        this.stalkerStore.clearSelectedItem();

        if (returnTo) {
            void this.router.navigateByUrl(returnTo);
        }
    }

    toSeriesId(id: string | number): number {
        const raw = String(id ?? '').trim();
        if (!raw) return 0;
        const primary = raw.includes(':') ? raw.split(':')[0] : raw;
        const parsed = Number(primary);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    closeInlinePlayer(): void {
        this.inlinePlayback.set(null);
        this.lastSaveTime = 0;
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.inlinePlayback();
        if (!playback?.contentInfo) return;

        const now = Date.now();
        if (now - this.lastSaveTime <= 15000) return;

        this.lastSaveTime = now;
        const position: PlaybackPositionData = {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        };
        void this.playbackPositions.savePlaybackPosition(
            playback.contentInfo.playlistId,
            position
        );
        this.updateEpisodePlaybackPosition(position);
    }

    showCopyNotification(): void {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            null,
            {
                duration: 2000,
            }
        );
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        void this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
    }

    private async startPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        episodeNum?: number,
        episodeId?: number,
        startTime?: number
    ): Promise<void> {
        try {
            const playback = await this.stalkerStore.resolveVodPlayback(
                cmd,
                title,
                thumbnail,
                episodeNum,
                episodeId,
                startTime
            );

            this.lastSaveTime = 0;
            if (this.portalPlayer.isEmbeddedPlayer()) {
                this.inlinePlayback.set(playback);
                return;
            }

            this.closeInlinePlayer();
            void this.portalPlayer.openResolvedPlayback(playback, true);
        } catch (error) {
            this.logger.error('Failed to start inline series playback', error);
            const errorMessage =
                error instanceof Error && error.message === 'nothing_to_play'
                    ? this.translateService.instant(
                          'PORTALS.CONTENT_NOT_AVAILABLE'
                      )
                    : this.translateService.instant('PORTALS.PLAYBACK_ERROR');
            this.snackBar.open(errorMessage, null, {
                duration: 3000,
            });
        }
    }

    ngOnDestroy(): void {
        this.unsubscribePositionUpdates?.();
    }

    async handlePlaybackToggleRequested(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (!playlistId) {
            return;
        }

        if (request.nextPosition) {
            await this.playbackPositions.savePlaybackPosition(
                playlistId,
                request.nextPosition
            );
            this.updateEpisodePlaybackPosition(request.nextPosition);
            return;
        }

        await this.playbackPositions.clearPlaybackPosition(
            playlistId,
            request.contentXtreamId,
            'episode'
        );
        this.removeEpisodePlaybackPosition(request.contentXtreamId);
    }

    async downloadEpisode(episode: XtreamSerieEpisode): Promise<void> {
        const playlist = this.stalkerStore.currentPlaylist();
        const item = this.displayItem();

        if (!playlist || !playlist.portalUrl || !playlist.macAddress || !item) {
            return;
        }

        const customSid = (episode as { custom_sid?: string }).custom_sid;
        const cmd =
            customSid === 'vod-series'
                ? `/media/file_${(episode as { originalId?: string }).originalId}.mpg`
                : ((episode as { originalCmd?: string }).originalCmd ?? '');

        let url: string;
        try {
            url = await this.stalkerStore.fetchLinkToPlay(
                playlist.portalUrl,
                playlist.macAddress,
                cmd,
                episode.episode_num
            );
            if (!url) {
                this.logger.error('Failed to resolve Stalker stream URL');
                return;
            }
        } catch (error) {
            this.logger.error('Error resolving Stalker stream URL', error);
            return;
        }

        const episodeInfo = this.getEpisodeInfo(episode);
        const posterUrl = episodeInfo?.movie_image;
        const seasonNum = Number(episode.season || 1);
        const episodeNum = episode.episode_num || 1;
        const seriesTitle =
            item.info?.name || this.displayItem()?.info?.name || 'Series';
        const episodeTitle = `${seriesTitle} - S${String(seasonNum).padStart(
            2,
            '0'
        )}E${String(episodeNum).padStart(2, '0')} - ${episode.title}`;

        await this.downloadsService.startDownload({
            playlistId: playlist._id,
            xtreamId: this.getEpisodeDownloadId(episode),
            contentType: 'episode',
            title: episodeTitle,
            url,
            posterUrl,
            seriesXtreamId: this.toSeriesId(item.id),
            seasonNumber: seasonNum,
            episodeNumber: episodeNum,
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
            playlistName: playlist.title || 'Stalker Portal',
            playlistType: 'stalker',
            portalUrl: playlist.portalUrl,
            macAddress: playlist.macAddress,
        });
    }

    private async loadSeriesPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<void> {
        const positions =
            await this.playbackPositions.getSeriesPlaybackPositions(
                playlistId,
                seriesXtreamId
            );
        const positionsMap = new Map<number, PlaybackPositionData>();
        positions.forEach((position) => {
            positionsMap.set(position.contentXtreamId, position);
        });
        this.episodePlaybackPositions.set(positionsMap);
    }

    private async loadAndPlayVodSeriesSeason(
        season: VodSeriesSeasonVm,
        visitedSeasonIds = new Set<string>()
    ): Promise<void> {
        if (visitedSeasonIds.has(season.id)) {
            return;
        }
        visitedSeasonIds.add(season.id);

        if (season.episodes.length === 0) {
            await this.loadEpisodesForSeason(season);
        }

        const quickStart = this.quickStartAction();
        if (!quickStart || quickStart.disabled) {
            return;
        }

        if (quickStart.action) {
            this.onEpisodeClicked(quickStart.action.episode);
            return;
        }

        if (quickStart.lazySeason) {
            await this.loadAndPlayVodSeriesSeason(
                quickStart.lazySeason,
                visitedSeasonIds
            );
        }
    }

    private updateEpisodePlaybackPosition(
        position: PlaybackPositionData
    ): void {
        const updated = new Map(this.episodePlaybackPositions());
        updated.set(position.contentXtreamId, position);
        this.episodePlaybackPositions.set(updated);
    }

    private removeEpisodePlaybackPosition(contentXtreamId: number): void {
        const updated = new Map(this.episodePlaybackPositions());
        updated.delete(contentXtreamId);
        this.episodePlaybackPositions.set(updated);
    }

    private getEpisodeInfo(
        episode: XtreamSerieEpisode
    ): { movie_image?: string } | undefined {
        if (!episode.info || Array.isArray(episode.info)) {
            return undefined;
        }
        return episode.info as { movie_image?: string };
    }

    private getEpisodeDownloadId(episode: XtreamSerieEpisode): number {
        const customSid = (episode as { custom_sid?: string }).custom_sid;

        if (customSid === 'regular-series') {
            const cmd = (episode as { originalCmd?: string }).originalCmd;
            if (cmd) {
                const match = cmd.match(/file_(\d+)/);
                if (match) {
                    return Number(match[1]);
                }
                return this.hashString(cmd);
            }
            return Number(episode.id);
        }

        if (customSid === 'vod-series') {
            const originalId = (episode as { originalId?: string | number })
                .originalId;
            const numericId = Number(originalId);
            return Number.isNaN(numericId)
                ? this.hashString(String(originalId))
                : numericId;
        }

        const numericId = Number(episode.id);
        return Number.isNaN(numericId)
            ? this.hashString(String(episode.id))
            : numericId;
    }

    private hashString(str: string): number {
        let hash = 0;
        for (let index = 0; index < str.length; index++) {
            const char = str.charCodeAt(index);
            hash = (hash << 5) - hash + char;
            hash &= hash;
        }
        return Math.abs(hash);
    }
}
