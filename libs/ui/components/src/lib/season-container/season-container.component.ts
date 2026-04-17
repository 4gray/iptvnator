import { KeyValuePipe } from '@angular/common';
import {
    Component,
    DoCheck,
    OnInit,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    createLogger,
    getPortalPlaybackProgressPercent,
    isPortalPlaybackInProgress,
    isPortalPlaybackWatched,
} from '@iptvnator/portal/shared/util';
import {
    PlaybackPositionData,
    XtreamSerieEpisode,
    XtreamSerieEpisodeInfo,
} from 'shared-interfaces';
import { DownloadsService } from 'services';
import { ProgressCapsuleComponent } from '../progress-capsule/progress-capsule.component';
import { WatchedBadgeComponent } from '../watched-badge/watched-badge.component';

type EpisodeViewMode = 'grid' | 'list';
const EPISODE_VIEW_MODE_KEY = 'iptvnator_episode_view_mode';

export interface SeasonContainerXtreamDownloadContext {
    serverUrl?: string;
    username?: string;
    password?: string;
}

export interface SeasonContainerPlaybackToggleRequest {
    contentXtreamId: number;
    nextPosition: PlaybackPositionData | null;
}

function parseDuration(duration: string | number | undefined): number {
    if (!duration) {
        return 0;
    }

    if (typeof duration === 'number') {
        return duration;
    }

    const parts = duration.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }

    return Number(duration) || 0;
}

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
export class SeasonContainerComponent implements OnInit, DoCheck {
    private readonly downloadsService = inject(DownloadsService);
    private readonly logger = createLogger('SeasonContainer');
    private previousSeasonKeysSignature = '';

    readonly seasons = input.required<Record<string, XtreamSerieEpisode[]>>();
    readonly seriesId = input.required<number>();
    readonly playlistId = input.required<string>();
    readonly seriesTitle = input<string>('');
    readonly isLoading = input<boolean>(false);
    readonly playbackPositions = input<Map<number, PlaybackPositionData>>(
        new Map()
    );
    readonly xtreamDownloadContext =
        input<SeasonContainerXtreamDownloadContext | null>(null);
    readonly openingEpisodeId = input<number | null>(null);
    readonly activeEpisodeId = input<number | null>(null);

    readonly episodeClicked = output<XtreamSerieEpisode>();
    readonly episodeDownloadRequested = output<XtreamSerieEpisode>();
    readonly playbackToggleRequested =
        output<SeasonContainerPlaybackToggleRequest>();
    readonly seasonSelected = output<string>();
    readonly isElectron = this.downloadsService.isAvailable;
    readonly viewMode = signal<EpisodeViewMode>('grid');

    selectedSeason: string | undefined;

    ngOnInit() {
        const savedMode = localStorage.getItem(
            EPISODE_VIEW_MODE_KEY
        ) as EpisodeViewMode;
        if (savedMode === 'grid' || savedMode === 'list') {
            this.viewMode.set(savedMode);
        }
        this.previousSeasonKeysSignature = this.getSeasonKeys().join('|');
    }

    ngDoCheck(): void {
        this.syncSelectedSeason();
    }

    setViewMode(mode: EpisodeViewMode) {
        this.viewMode.set(mode);
        localStorage.setItem(EPISODE_VIEW_MODE_KEY, mode);
    }

    compareSeasons(a: { key: string }, b: { key: string }): number {
        return Number(a.key) - Number(b.key);
    }

    hasSeasons(): boolean {
        return this.getSeasonKeys().length > 0;
    }

    showSeriesEmptyState(): boolean {
        return !this.selectedSeason && !this.hasSeasons();
    }

    showSeasonEmptyState(): boolean {
        return Boolean(this.selectedSeason) && !this.selectedSeasonHasEpisodes();
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
        if (!this.playlistId()) {
            this.logger.warn('Cannot toggle watched: no playlist ID');
            return;
        }

        const contentXtreamId = this.getEpisodeContentId(episode);
        const currentPosition = this.getEpisodePosition(episode);

        if (isPortalPlaybackWatched(currentPosition)) {
            this.playbackToggleRequested.emit({
                contentXtreamId,
                nextPosition: null,
            });
            return;
        }

        const info = this.getEpisodeInfo(episode);
        const duration =
            info?.duration_secs || parseDuration(info?.duration) || 1;

        this.playbackToggleRequested.emit({
            contentXtreamId,
            nextPosition: {
                contentXtreamId,
                contentType: 'episode',
                seriesXtreamId: this.seriesId(),
                seasonNumber: Number(episode.season || this.selectedSeason || 1),
                episodeNumber: Number(episode.episode_num || 1),
                positionSeconds: duration,
                durationSeconds: duration,
                playlistId: this.playlistId(),
                updatedAt: new Date().toISOString(),
            },
        });
    }

    getEpisodeInfo(
        episode: XtreamSerieEpisode
    ): XtreamSerieEpisodeInfo | undefined {
        if (Array.isArray(episode.info) || !episode.info) {
            return undefined;
        }
        return episode.info;
    }

    isEpisodeWatched(episode: XtreamSerieEpisode): boolean {
        return isPortalPlaybackWatched(this.getEpisodePosition(episode));
    }

    isEpisodeInProgress(episode: XtreamSerieEpisode): boolean {
        return isPortalPlaybackInProgress(this.getEpisodePosition(episode));
    }

    isEpisodeLaunching(episode: XtreamSerieEpisode): boolean {
        return this.openingEpisodeId() === this.getEpisodeContentId(episode);
    }

    isEpisodeActiveExternal(episode: XtreamSerieEpisode): boolean {
        return this.activeEpisodeId() === this.getEpisodeContentId(episode);
    }

    getEpisodeProgress(episode: XtreamSerieEpisode): number {
        return getPortalPlaybackProgressPercent(this.getEpisodePosition(episode));
    }

    getEpisodePositionText(episode: XtreamSerieEpisode): string | null {
        if (this.isEpisodeWatched(episode)) {
            return null;
        }

        const position = this.getEpisodePosition(episode);
        if (!position || !position.positionSeconds) {
            return null;
        }

        let seconds = position.positionSeconds;
        let suffix = '';

        if (position.durationSeconds && position.durationSeconds > 0) {
            const remaining = Math.max(
                0,
                position.durationSeconds - position.positionSeconds
            );

            if (remaining <= 0) {
                return null;
            }

            seconds = remaining;
            suffix = ' left';
        }

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const formatted = [hours, minutes, secs]
            .map((value) => String(value).padStart(2, '0'))
            .filter((value, index) => (index === 0 ? value !== '00' : true))
            .join(':');
        return `${formatted}${suffix}`;
    }

    getSeasonWatchedCount(seasonKey: string): number {
        const episodes = this.seasons()[seasonKey];
        if (!episodes) {
            return 0;
        }
        return episodes.filter((episode) => this.isEpisodeWatched(episode)).length;
    }

    getSeasonProgressDash(seasonKey: string): string {
        const episodes = this.seasons()[seasonKey];
        if (!episodes || episodes.length === 0) {
            return '0, 100';
        }

        const watched = this.getSeasonWatchedCount(seasonKey);
        const percent = (watched / episodes.length) * 100;
        return `${percent}, 100`;
    }

    async downloadEpisode(event: Event, episode: XtreamSerieEpisode) {
        event.stopPropagation();

        if (this.isStalkerEpisode(episode)) {
            this.episodeDownloadRequested.emit(episode);
            return;
        }

        const xtreamDownload = this.xtreamDownloadContext();
        if (!this.playlistId() || !xtreamDownload) {
            return;
        }

        const serverUrl = xtreamDownload.serverUrl?.replace(/\/$/, '') || '';
        const username = xtreamDownload.username || '';
        const password = xtreamDownload.password || '';
        const extension = episode.container_extension || 'mp4';
        const url = `${serverUrl}/series/${username}/${password}/${episode.id}.${extension}`;
        const episodeInfo = this.getEpisodeInfo(episode);
        const posterUrl = episodeInfo?.movie_image;
        const seasonNum = episode.season || Number(this.selectedSeason) || 1;
        const episodeNum = episode.episode_num || 1;
        const episodeTitle = `${this.seriesTitle() || 'Series'} - S${String(
            seasonNum
        ).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')} - ${episode.title}`;

        await this.downloadsService.startDownload({
            playlistId: this.playlistId(),
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

    isEpisodeDownloaded(episode: XtreamSerieEpisode): boolean {
        if (!this.playlistId()) {
            return false;
        }

        this.downloadsService.downloads();
        return this.downloadsService.isDownloaded(
            this.getEpisodeDownloadId(episode),
            this.playlistId(),
            'episode'
        );
    }

    isEpisodeDownloading(episode: XtreamSerieEpisode): boolean {
        if (!this.playlistId()) {
            return false;
        }

        this.downloadsService.downloads();
        return this.downloadsService.isDownloading(
            this.getEpisodeDownloadId(episode),
            this.playlistId(),
            'episode'
        );
    }

    async playFromLocal(event: Event, episode: XtreamSerieEpisode) {
        event.stopPropagation();
        if (!this.playlistId()) {
            return;
        }

        const filePath = this.downloadsService.getDownloadedFilePath(
            this.getEpisodeDownloadId(episode),
            this.playlistId(),
            'episode'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }

    private isStalkerEpisode(episode: XtreamSerieEpisode): boolean {
        return (
            (episode as { custom_sid?: string }).custom_sid === 'vod-series' ||
            (episode as { custom_sid?: string }).custom_sid === 'regular-series'
        );
    }

    private getEpisodeContentId(episode: XtreamSerieEpisode): number {
        return Number(episode.id);
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

    private getEpisodePosition(
        episode: XtreamSerieEpisode
    ): PlaybackPositionData | undefined {
        return this.playbackPositions().get(this.getEpisodeContentId(episode));
    }

    private selectedSeasonHasEpisodes(): boolean {
        if (!this.selectedSeason) {
            return false;
        }

        return (this.seasons()[this.selectedSeason]?.length ?? 0) > 0;
    }

    private getSeasonKeys(): string[] {
        return Object.keys(this.seasons());
    }

    private hasSeasonKey(seasonKey: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.seasons(), seasonKey);
    }

    private syncSelectedSeason(): void {
        const seasonKeysSignature = this.getSeasonKeys().join('|');
        if (seasonKeysSignature === this.previousSeasonKeysSignature) {
            return;
        }

        this.previousSeasonKeysSignature = seasonKeysSignature;

        if (this.selectedSeason && !this.hasSeasonKey(this.selectedSeason)) {
            this.selectedSeason = undefined;
        }
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
