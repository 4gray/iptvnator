import { KeyValuePipe } from '@angular/common';
import { Component, EventEmitter, Output, input, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
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

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    imports: [
        KeyValuePipe,
        MatButtonModule,
        MatIcon,
        MatProgressSpinnerModule,
        MatTooltipModule,
        ProgressCapsuleComponent,
        TranslateModule,
        WatchedBadgeComponent,
    ],
})
export class SeasonContainerComponent {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly downloadsService = inject(DownloadsService);

    readonly seasons = input.required<Record<string, XtreamSerieEpisode[]>>();
    readonly seriesId = input.required<number>();
    readonly seriesTitle = input<string>('');
    readonly isLoading = input<boolean>(false);

    readonly isElectron = this.downloadsService.isAvailable;

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
        const playlistId = this.xtreamStore.currentPlaylist().id;
        this.xtreamStore.toggleEpisodeWatched(
            playlistId,
            episode,
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
        return this.xtreamStore.isWatched(Number(episode.id), 'episode');
    }

    isEpisodeInProgress(episode: XtreamSerieEpisode) {
        return this.xtreamStore.isInProgress(Number(episode.id), 'episode');
    }

    getEpisodeProgress(episode: XtreamSerieEpisode) {
        return this.xtreamStore.getProgressPercent(
            Number(episode.id),
            'episode'
        );
    }

    getEpisodePositionText(episode: XtreamSerieEpisode): string | null {
        if (this.isEpisodeWatched(episode)) return null;

        const position = this.xtreamStore
            .playbackPositions()
            .get(`episode_${episode.id}`);
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
            // VOD series episode - construct the cmd using episode id
            cmd = `/media/file_${episode.id}.mpg`;
        } else {
            // Regular series - episode.id contains the cmd
            cmd = episode.id as unknown as string;
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
            xtreamId: Number(episode.id) || Date.now(), // Use timestamp if id is not numeric
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
            Number(episode.id),
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
            Number(episode.id),
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
            Number(episode.id),
            playlistId,
            'episode'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }
}
