import { KeyValuePipe } from '@angular/common';
import { Component, EventEmitter, Output, input, inject, signal, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamSerieEpisode, XtreamSerieEpisodeInfo } from 'shared-interfaces';
import { XtreamStore } from '../stores/xtream.store';
import { StalkerStore } from '../../stalker/stalker.store';
import { ProgressCapsuleComponent } from '../shared/progress-capsule/progress-capsule.component';
import { WatchedBadgeComponent } from '../shared/watched-badge/watched-badge.component';
import { DownloadsService } from '../../services/downloads.service';

type EpisodeViewMode = 'grid' | 'list';
const EPISODE_VIEW_MODE_KEY = 'iptvnator_episode_view_mode';

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    imports: [
        KeyValuePipe,
        MatButtonModule,
        MatButtonToggleModule,
        MatIcon,
        MatProgressSpinnerModule,
        MatTooltipModule,
        ProgressCapsuleComponent,
        TranslateModule,
        WatchedBadgeComponent,
    ],
})
export class SeasonContainerComponent implements OnInit {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly downloadsService = inject(DownloadsService);

    readonly seasons = input.required<Record<string, XtreamSerieEpisode[]>>();
    readonly seriesId = input.required<number>();
    readonly seriesTitle = input<string>('');
    readonly isLoading = input<boolean>(false);

    readonly isElectron = this.downloadsService.isAvailable;

    /** Current view mode for episodes (grid or list) */
    readonly viewMode = signal<EpisodeViewMode>('grid');

    ngOnInit() {
        // Load saved view mode preference
        const savedMode = localStorage.getItem(EPISODE_VIEW_MODE_KEY) as EpisodeViewMode;
        if (savedMode === 'grid' || savedMode === 'list') {
            this.viewMode.set(savedMode);
        }
    }

    /** Toggle between grid and list view modes */
    setViewMode(mode: EpisodeViewMode) {
        this.viewMode.set(mode);
        localStorage.setItem(EPISODE_VIEW_MODE_KEY, mode);
    }

    /**
     * Detect if episode is from Stalker portal based on custom_sid marker
     */
    private isStalkerEpisode(episode: XtreamSerieEpisode): boolean {
        return (
            (episode as any).custom_sid === 'vod-series' ||
            (episode as any).custom_sid === 'regular-series'
        );
    }

    /**
     * Get the appropriate playlist ID based on mode
     * Note: XtreamStore uses 'id', StalkerStore uses '_id'
     */
    private getPlaylistId(episode: XtreamSerieEpisode): string | undefined {
        if (this.isStalkerEpisode(episode)) {
            return this.stalkerStore.currentPlaylist()?._id;
        }
        return this.xtreamStore.currentPlaylist()?.id;
    }

    /**
     * Get the content ID for playback position lookup.
     * For Stalker VOD series, use the generated unique ID (episode.id).
     * The API-provided originalId is the same for all episodes (it's the series ID),
     * so we use the hash-generated ID which is unique per episode.
     * For Xtream episodes, use episode.id directly.
     */
    private getEpisodeContentId(episode: XtreamSerieEpisode): number {
        const customSid = (episode as any).custom_sid;

        if (customSid === 'vod-series') {
            // For vod-series, use the generated unique ID (episode.id)
            // NOT originalId, which is the same for all episodes (series ID)
            return Number(episode.id);
        }

        if (customSid === 'regular-series') {
            // For regular-series, the hashed id is used for tracking
            // (regular series don't have individual episode IDs from API)
            return Number(episode.id);
        }

        // For xtream (non-Stalker), use episode.id directly
        return Number(episode.id);
    }

    /**
     * Get a stable numeric ID for an episode (used for downloads tracking)
     * For Stalker episodes, use originalCmd/originalId; for Xtream use episode.id
     */
    private getEpisodeDownloadId(episode: XtreamSerieEpisode): number {
        const customSid = (episode as any).custom_sid;

        if (customSid === 'regular-series') {
            // For regular-series, use originalCmd (like "/media/file_123.mpg")
            const cmd = (episode as any).originalCmd as string;
            if (cmd) {
                const match = cmd.match(/file_(\d+)/);
                if (match) {
                    return Number(match[1]);
                }
                // Fallback: hash the cmd string to get a consistent number
                return this.hashString(cmd);
            }
            // Final fallback: use the hashed id
            return Number(episode.id);
        }

        if (customSid === 'vod-series') {
            // For vod-series, use originalId from the API
            const originalId = (episode as any).originalId;
            const numId = Number(originalId);
            return isNaN(numId) ? this.hashString(String(originalId)) : numId;
        }

        // For xtream (non-Stalker), use the numeric id directly
        const numId = Number(episode.id);
        return isNaN(numId) ? this.hashString(String(episode.id)) : numId;
    }

    /**
     * Simple string hash function to generate consistent numeric IDs
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

    @Output() episodeClicked = new EventEmitter<any>();
    @Output() seasonSelected = new EventEmitter<string>();

    selectedSeason: string;

    compareSeasons(a: any, b: any): number {
        return Number(a.key) - Number(b.key);
    }

    selectSeason(seasonKey: string) {
        this.selectedSeason = seasonKey;
        this.seasonSelected.emit(seasonKey);
    }

    selectEpisode(episode: XtreamSerieEpisode) {
        this.episodeClicked.emit(episode);
    }

    toggleWatched(event: Event, episode: XtreamSerieEpisode) {
        event.stopPropagation();
        const playlistId = this.getPlaylistId(episode);
        if (!playlistId) {
            console.warn('[SeasonContainer] Cannot toggle watched: no playlist ID');
            return;
        }

        // For Stalker episodes, we need to use the content ID that matches
        // what the player uses (originalId for vod-series)
        const contentId = this.getEpisodeContentId(episode);
        const episodeWithCorrectId = {
            ...episode,
            id: String(contentId),
        } as XtreamSerieEpisode;

        this.xtreamStore.toggleEpisodeWatched(
            playlistId,
            episodeWithCorrectId,
            this.seriesId()
        );
    }

    /**
     * Safely get episode info - returns undefined if info is an empty array
     * (Xtream API returns [] when no metadata available instead of null/object)
     */
    getEpisodeInfo(
        episode: XtreamSerieEpisode
    ): XtreamSerieEpisodeInfo | undefined {
        if (Array.isArray(episode.info) || !episode.info) {
            return undefined;
        }
        return episode.info;
    }

    isEpisodeWatched(episode: XtreamSerieEpisode) {
        const contentId = this.getEpisodeContentId(episode);
        return this.xtreamStore.isWatched(contentId, 'episode');
    }

    isEpisodeInProgress(episode: XtreamSerieEpisode) {
        const contentId = this.getEpisodeContentId(episode);
        const inProgress = this.xtreamStore.isInProgress(contentId, 'episode');
        if (inProgress) {
            console.log(
                `[SeasonContainer] Episode ${episode.title} (contentId=${contentId}, originalId=${(episode as any).originalId}) is IN PROGRESS`
            );
        }
        return inProgress;
    }

    getEpisodeProgress(episode: XtreamSerieEpisode) {
        const contentId = this.getEpisodeContentId(episode);
        return this.xtreamStore.getProgressPercent(contentId, 'episode');
    }

    getEpisodePositionText(episode: XtreamSerieEpisode): string | null {
        if (this.isEpisodeWatched(episode)) return null;

        const contentId = this.getEpisodeContentId(episode);
        const position = this.xtreamStore
            .playbackPositions()
            .get(`episode_${contentId}`);
        if (!position || !position.positionSeconds) return null;

        let seconds = position.positionSeconds;
        let suffix = '';

        // Calculate remaining time if duration is available
        if (position.durationSeconds > 0) {
            const remaining = Math.max(
                0,
                position.durationSeconds - position.positionSeconds
            );

            if (remaining <= 0) return null;

            seconds = remaining;
            suffix = ' left';
        }

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const formatted = [hours, minutes, secs]
            .map((n) => String(n).padStart(2, '0'))
            .filter((v, i) => (i === 0 ? v !== '00' : true))
            .join(':');
        return `${formatted}${suffix}`;
    }

    getSeasonWatchedCount(seasonKey: string): number {
        const episodes = this.seasons()[seasonKey];
        if (!episodes) return 0;
        return episodes.filter((e) => this.isEpisodeWatched(e)).length;
    }

    getSeasonProgressDash(seasonKey: string): string {
        const episodes = this.seasons()[seasonKey];
        if (!episodes || episodes.length === 0) return '0, 100';

        const watched = this.getSeasonWatchedCount(seasonKey);
        const percent = (watched / episodes.length) * 100;
        return `${percent}, 100`;
    }

    async downloadEpisode(event: Event, episode: XtreamSerieEpisode) {
        event.stopPropagation();

        // Handle Stalker mode
        if (this.isStalkerEpisode(episode)) {
            await this.downloadStalkerEpisode(episode);
            return;
        }

        // Xtream mode
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) return;

        // Construct the episode stream URL
        const serverUrl = playlist.serverUrl?.replace(/\/$/, '') || '';
        const username = playlist.username || '';
        const password = playlist.password || '';
        const extension = episode.container_extension || 'mp4';

        const url = `${serverUrl}/series/${username}/${password}/${episode.id}.${extension}`;

        // Get episode info for poster
        const episodeInfo = this.getEpisodeInfo(episode);
        const posterUrl = episodeInfo?.movie_image;

        // Build episode title
        const seriesName = this.seriesTitle() || 'Series';
        const seasonNum = episode.season || Number(this.selectedSeason) || 1;
        const episodeNum = episode.episode_num || 1;
        const episodeTitle = `${seriesName} - S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')} - ${episode.title}`;

        await this.downloadsService.startDownload({
            playlistId: playlist.id,
            xtreamId: Number(episode.id),
            contentType: 'episode',
            title: episodeTitle,
            url,
            posterUrl,
            seriesXtreamId: this.seriesId(),
            seasonNumber: seasonNum,
            episodeNumber: episodeNum,
        });
    }

    /**
     * Download episode from Stalker portal
     */
    private async downloadStalkerEpisode(episode: XtreamSerieEpisode) {
        const playlist = this.stalkerStore.currentPlaylist();
        if (!playlist || !playlist.portalUrl || !playlist.macAddress) return;

        const customSid = (episode as any).custom_sid;
        let cmd: string;

        if (customSid === 'vod-series') {
            // VOD series episode - use originalId for the cmd
            const originalId = (episode as any).originalId;
            cmd = `/media/file_${originalId}.mpg`;
        } else {
            // Regular series - use originalCmd for the cmd
            cmd = (episode as any).originalCmd as string;
        }

        // Resolve the actual stream URL via Stalker API
        // The cmd is a reference that needs to be resolved to get the tokenized URL
        let url: string;
        try {
            url = await this.stalkerStore.fetchLinkToPlay(
                playlist.portalUrl,
                playlist.macAddress,
                cmd,
                episode.episode_num // series param for episode number
            );
            if (!url) {
                console.error('[SeasonContainer] Failed to resolve Stalker stream URL');
                return;
            }
        } catch (error) {
            console.error('[SeasonContainer] Error resolving Stalker stream URL:', error);
            return;
        }

        // Get episode info for poster
        const episodeInfo = this.getEpisodeInfo(episode);
        const posterUrl = episodeInfo?.movie_image;

        // Build episode title
        const selectedItem = this.stalkerStore.selectedItem();
        const seriesName = selectedItem?.info?.name || this.seriesTitle() || 'Series';
        const seasonNum = Number(this.selectedSeason) || 1;
        const episodeNum = episode.episode_num || 1;
        const episodeTitle = `${seriesName} - S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')} - ${episode.title}`;

        await this.downloadsService.startDownload({
            playlistId: playlist._id,
            xtreamId: this.getEpisodeDownloadId(episode),
            contentType: 'episode',
            title: episodeTitle,
            url,
            posterUrl,
            seriesXtreamId: this.seriesId(),
            seasonNumber: seasonNum,
            episodeNumber: episodeNum,
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
            // Playlist info for auto-creation (Stalker playlists)
            playlistName: playlist.title || 'Stalker Portal',
            playlistType: 'stalker',
            portalUrl: playlist.portalUrl,
            macAddress: playlist.macAddress,
        });
    }

    /** Check if episode is already downloaded */
    isEpisodeDownloaded(episode: XtreamSerieEpisode): boolean {
        const playlistId = this.getPlaylistId(episode);
        if (!playlistId) return false;
        // Access downloads signal to make this reactive
        this.downloadsService.downloads();
        return this.downloadsService.isDownloaded(
            this.getEpisodeDownloadId(episode),
            playlistId,
            'episode'
        );
    }

    /** Check if episode is currently downloading */
    isEpisodeDownloading(episode: XtreamSerieEpisode): boolean {
        const playlistId = this.getPlaylistId(episode);
        if (!playlistId) return false;
        // Access downloads signal to make this reactive
        this.downloadsService.downloads();
        return this.downloadsService.isDownloading(
            this.getEpisodeDownloadId(episode),
            playlistId,
            'episode'
        );
    }

    /** Play episode from local file */
    async playFromLocal(event: Event, episode: XtreamSerieEpisode) {
        event.stopPropagation();

        const playlistId = this.getPlaylistId(episode);
        if (!playlistId) return;

        const filePath = this.downloadsService.getDownloadedFilePath(
            this.getEpisodeDownloadId(episode),
            playlistId,
            'episode'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }
}
