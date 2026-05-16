import { KeyValuePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    DoCheck,
    OnDestroy,
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
    buildMediaStreamMetadata,
    getMediaMetadataUnavailableTag,
    getMediaMetadataTags,
    getPortalPlaybackProgressPercent,
    isPortalPlaybackInProgress,
    isPortalPlaybackWatched,
    mediaMetadataNeedsProbe,
    mergeMediaStreamMetadata,
} from '@iptvnator/portal/shared/util';
import {
    MediaStreamMetadata,
    PlaybackPositionData,
    XtreamSerieEpisode,
    XtreamSerieEpisodeInfo,
} from 'shared-interfaces';
import {
    DatabaseService,
    DownloadsService,
    MediaMetadataService,
    SettingsStore,
} from 'services';
import { ProgressCapsuleComponent } from '../progress-capsule/progress-capsule.component';
import { WatchedBadgeComponent } from '../watched-badge/watched-badge.component';

type EpisodeViewMode = 'grid' | 'list';
const EPISODE_VIEW_MODE_KEY = 'iptvnator_episode_view_mode';
const MAX_CONCURRENT_EPISODE_PROBES = 2;

export interface SeasonContainerXtreamDownloadContext {
    serverUrl?: string;
    username?: string;
    password?: string;
    userAgent?: string;
    origin?: string;
    referrer?: string;
}

export interface SeasonContainerPlaybackToggleRequest {
    contentXtreamId: number;
    nextPosition: PlaybackPositionData | null;
}

interface EpisodeProbeJob {
    key: string;
    episodeXtreamId: number;
    seriesXtreamId: number;
    seasonNumber: number | null;
    episodeNumber: number | null;
    url: string;
    headers: Record<string, string>;
    staticMetadata: MediaStreamMetadata | null;
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

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function uniqueNumbers(values: number[]): number[] {
    return Array.from(new Set(values));
}

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
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
export class SeasonContainerComponent implements OnInit, DoCheck, OnDestroy {
    private readonly databaseService = inject(DatabaseService);
    private readonly downloadsService = inject(DownloadsService);
    private readonly mediaMetadataService = inject(MediaMetadataService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly logger = createLogger('SeasonContainer');
    private previousSeasonKeysSignature = '';
    private readonly queuedEpisodeProbeKeys = new Set<string>();
    private episodeProbeQueue: EpisodeProbeJob[] = [];
    private activeEpisodeProbeCount = 0;
    private destroyed = false;
    private lastSeriesMetadataSignature = '';
    private episodeMetadataLoadSignature = '';
    private episodeMetadataLoadingSignature = '';

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
    readonly seriesMediaMetadataChanged = output<MediaStreamMetadata | null>();
    readonly isElectron = this.downloadsService.isAvailable;
    readonly viewMode = signal<EpisodeViewMode>('grid');
    readonly episodeProbeMetadata = signal<Record<string, MediaStreamMetadata>>(
        {}
    );
    readonly episodePersistedMetadata = signal<
        Record<string, MediaStreamMetadata>
    >({});
    readonly episodeProbePending = signal<Record<string, boolean>>({});

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
        this.syncPersistedEpisodeMetadata();
        this.scheduleEpisodeMetadataProbes();
        this.emitSeriesMediaMetadataIfChanged();
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.episodeProbeQueue = [];
        this.queuedEpisodeProbeKeys.clear();
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
        return (
            Boolean(this.selectedSeason) && !this.selectedSeasonHasEpisodes()
        );
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
                seasonNumber: Number(
                    episode.season || this.selectedSeason || 1
                ),
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

    getEpisodeMediaTags(episode: XtreamSerieEpisode): string[] {
        const metadata = this.getEpisodeMergedMetadata(episode);
        const tags = getMediaMetadataTags(metadata);
        if (tags.length > 0) {
            return tags;
        }

        if (this.isEpisodeProbePending(episode)) {
            return ['Analisi qualita...'];
        }

        const unavailableTag = getMediaMetadataUnavailableTag(metadata);
        return unavailableTag ? [unavailableTag] : [];
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
        return getPortalPlaybackProgressPercent(
            this.getEpisodePosition(episode)
        );
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
        return episodes.filter((episode) => this.isEpisodeWatched(episode))
            .length;
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

        const url = this.getEpisodeStreamUrl(episode, xtreamDownload);
        if (!url) {
            return;
        }

        const episodeInfo = this.getEpisodeInfo(episode);
        const posterUrl = episodeInfo?.movie_image;
        const seasonNum = episode.season || Number(this.selectedSeason) || 1;
        const episodeNum = episode.episode_num || 1;
        const episodeTitle = `${this.seriesTitle() || 'Series'} - S${String(
            seasonNum
        ).padStart(
            2,
            '0'
        )}E${String(episodeNum).padStart(2, '0')} - ${episode.title}`;

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
            headers: {
                userAgent: xtreamDownload.userAgent,
                referer: xtreamDownload.referrer,
                origin: xtreamDownload.origin,
            },
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

    private syncPersistedEpisodeMetadata(): void {
        const playlistId = this.playlistId();
        const seriesId = this.seriesId();
        const signature =
            playlistId && seriesId ? `${playlistId}:${seriesId}` : '';
        if (signature === this.episodeMetadataLoadSignature) {
            return;
        }

        this.episodeMetadataLoadSignature = signature;
        this.episodeMetadataLoadingSignature = signature;
        this.episodePersistedMetadata.set({});

        if (!playlistId || !seriesId) {
            this.episodeMetadataLoadingSignature = '';
            return;
        }

        void this.databaseService
            .getXtreamSeriesEpisodeMediaMetadata(playlistId, seriesId)
            .then((rows) => {
                if (
                    this.destroyed ||
                    this.episodeMetadataLoadSignature !== signature
                ) {
                    return;
                }

                const next: Record<string, MediaStreamMetadata> = {};
                for (const row of rows) {
                    next[String(row.episodeXtreamId)] = row.mediaMetadata;
                }
                this.episodePersistedMetadata.set(next);
                this.emitSeriesMediaMetadataIfChanged();
            })
            .catch(() => undefined)
            .finally(() => {
                if (this.episodeMetadataLoadingSignature === signature) {
                    this.episodeMetadataLoadingSignature = '';
                    this.scheduleEpisodeMetadataProbes();
                }
            });
    }

    private scheduleEpisodeMetadataProbes(): void {
        const context = this.xtreamDownloadContext();
        if (
            !context?.serverUrl ||
            !context.username ||
            !context.password ||
            this.destroyed
        ) {
            return;
        }
        if (this.episodeMetadataLoadingSignature) {
            return;
        }

        const existingMetadata = this.episodeProbeMetadata();
        const persistedMetadata = this.episodePersistedMetadata();
        const pendingMetadata = this.episodeProbePending();
        const nextPendingMetadata = { ...pendingMetadata };
        const headers = this.buildProbeHeaders(context);
        let hasQueuedProbe = false;

        for (const episode of this.getAllEpisodes()) {
            const url = this.getEpisodeStreamUrl(episode, context);
            if (!url) {
                continue;
            }

            const episodeXtreamId = this.getEpisodeContentId(episode);
            const staticMetadata = this.getEpisodeStaticMetadata(episode);
            const persistedEpisodeMetadata =
                persistedMetadata[String(episodeXtreamId)];
            const currentMetadata = mergeMediaStreamMetadata(
                persistedEpisodeMetadata,
                staticMetadata
            );
            if (currentMetadata && !mediaMetadataNeedsProbe(currentMetadata)) {
                if (!persistedEpisodeMetadata) {
                    this.persistEpisodeMetadata(
                        {
                            key: this.getEpisodeProbeKey(url, headers),
                            episodeXtreamId,
                            seriesXtreamId: this.seriesId(),
                            seasonNumber:
                                Number(episode.season || this.selectedSeason) ||
                                null,
                            episodeNumber:
                                Number(episode.episode_num) || null,
                            url,
                            headers,
                            staticMetadata,
                        },
                        currentMetadata
                    );
                }
                continue;
            }

            const key = this.getEpisodeProbeKey(url, headers);
            if (
                Object.prototype.hasOwnProperty.call(existingMetadata, key) ||
                pendingMetadata[key] ||
                this.queuedEpisodeProbeKeys.has(key)
            ) {
                continue;
            }

            this.queuedEpisodeProbeKeys.add(key);
            this.episodeProbeQueue.push({
                key,
                episodeXtreamId,
                seriesXtreamId: this.seriesId(),
                seasonNumber:
                    Number(episode.season || this.selectedSeason) || null,
                episodeNumber: Number(episode.episode_num) || null,
                url,
                headers,
                staticMetadata,
            });
            nextPendingMetadata[key] = true;
            hasQueuedProbe = true;
        }

        if (hasQueuedProbe) {
            this.episodeProbePending.set(nextPendingMetadata);
        }

        this.drainEpisodeProbeQueue();
    }

    private drainEpisodeProbeQueue(): void {
        while (
            !this.destroyed &&
            this.activeEpisodeProbeCount < MAX_CONCURRENT_EPISODE_PROBES &&
            this.episodeProbeQueue.length > 0
        ) {
            const job = this.episodeProbeQueue.shift();
            if (!job) {
                return;
            }

            this.queuedEpisodeProbeKeys.delete(job.key);
            this.activeEpisodeProbeCount++;
            void this.probeEpisodeMetadata(job);
        }
    }

    private async probeEpisodeMetadata(job: EpisodeProbeJob): Promise<void> {
        try {
            const metadata = await this.mediaMetadataService.probe({
                url: job.url,
                headers: job.headers,
            });
            const mergedMetadata =
                mergeMediaStreamMetadata(metadata, job.staticMetadata) ??
                metadata;

            if (!this.destroyed) {
                this.setEpisodeProbeMetadata(job.key, mergedMetadata);
                this.persistEpisodeMetadata(job, mergedMetadata);
            }
        } catch (error) {
            if (!this.destroyed) {
                const metadata = mergeMediaStreamMetadata(
                    {
                        available: false,
                        audioLanguages: [],
                        audioCodecs: [],
                        subtitleLanguages: [],
                        subtitleCodecs: [],
                        reason:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                    job.staticMetadata
                ) ?? {
                    available: false,
                    audioLanguages: [],
                    audioCodecs: [],
                    subtitleLanguages: [],
                    subtitleCodecs: [],
                    reason:
                        error instanceof Error ? error.message : String(error),
                };
                this.setEpisodeProbeMetadata(job.key, metadata);
                this.persistEpisodeMetadata(job, metadata);
            }
        } finally {
            this.activeEpisodeProbeCount = Math.max(
                0,
                this.activeEpisodeProbeCount - 1
            );

            if (!this.destroyed) {
                this.setEpisodeProbePending(job.key, false);
                this.emitSeriesMediaMetadataIfChanged();
                this.drainEpisodeProbeQueue();
            }
        }
    }

    private setEpisodeProbeMetadata(
        key: string,
        metadata: MediaStreamMetadata
    ): void {
        this.episodeProbeMetadata.update((current) => ({
            ...current,
            [key]: metadata,
        }));
    }

    private persistEpisodeMetadata(
        job: EpisodeProbeJob,
        metadata: MediaStreamMetadata
    ): void {
        const playlistId = this.playlistId();
        if (!playlistId || !job.seriesXtreamId || !job.episodeXtreamId) {
            return;
        }

        this.episodePersistedMetadata.update((current) => ({
            ...current,
            [String(job.episodeXtreamId)]: metadata,
        }));

        void this.databaseService.setXtreamEpisodeMediaMetadata(
            playlistId,
            job.seriesXtreamId,
            job.episodeXtreamId,
            metadata,
            job.seasonNumber,
            job.episodeNumber
        );
    }

    private setEpisodeProbePending(key: string, isPending: boolean): void {
        this.episodeProbePending.update((current) => {
            const isAlreadyPending = Boolean(current[key]);
            if (isAlreadyPending === isPending) {
                return current;
            }

            const next = { ...current };
            if (isPending) {
                next[key] = true;
            } else {
                delete next[key];
            }
            return next;
        });
    }

    private emitSeriesMediaMetadataIfChanged(): void {
        const metadata = this.getSharedSeriesMediaMetadata();
        const signature = JSON.stringify(metadata);
        if (signature === this.lastSeriesMetadataSignature) {
            return;
        }

        this.lastSeriesMetadataSignature = signature;
        this.seriesMediaMetadataChanged.emit(metadata);
    }

    private getSharedSeriesMediaMetadata(): MediaStreamMetadata | null {
        const episodeMetadata = this.getAllEpisodes().map((episode) =>
            this.getEpisodeMetadataForSeriesSummary(episode)
        );

        const metadataList = episodeMetadata.filter(
            (metadata): metadata is MediaStreamMetadata => Boolean(metadata)
        );
        if (
            episodeMetadata.length === 0 ||
            metadataList.length !== episodeMetadata.length
        ) {
            return null;
        }

        const qualityLabels = uniqueStrings(
            metadataList.reduce<string[]>(
                (values, metadata) => [
                    ...values,
                    ...(metadata.qualityLabels ?? []),
                    metadata.qualityLabel ?? '',
                ],
                []
            )
        );
        const audioLanguages = uniqueStrings(
            metadataList.reduce<string[]>(
                (values, metadata) => [
                    ...values,
                    ...(metadata.audioLanguages ?? []),
                ],
                []
            )
        );
        const audioCodecs = uniqueStrings(
            metadataList.reduce<string[]>(
                (values, metadata) => [
                    ...values,
                    ...(metadata.audioCodecs ?? []),
                ],
                []
            )
        );
        const subtitleLanguages = uniqueStrings(
            metadataList.reduce<string[]>(
                (values, metadata) => [
                    ...values,
                    ...(metadata.subtitleLanguages ?? []),
                ],
                []
            )
        );
        const subtitleCodecs = uniqueStrings(
            metadataList.reduce<string[]>(
                (values, metadata) => [
                    ...values,
                    ...(metadata.subtitleCodecs ?? []),
                ],
                []
            )
        );

        const heights = uniqueNumbers(
            metadataList
                .reduce<
                    (number | undefined)[]
                >((values, metadata) => [...values, ...(metadata.heights ?? []), metadata.height], [])
                .filter((height): height is number => Number.isFinite(height))
        );
        const widths = uniqueNumbers(
            metadataList
                .reduce<
                    (number | undefined)[]
                >((values, metadata) => [...values, ...(metadata.widths ?? []), metadata.width], [])
                .filter((width): width is number => Number.isFinite(width))
        );
        const videoCodecs = uniqueStrings(
            metadataList.reduce<string[]>(
                (values, metadata) => [
                    ...values,
                    ...(metadata.videoCodecs ?? []),
                    metadata.videoCodec ?? '',
                ],
                []
            )
        );

        return {
            available: metadataList.some((metadata) => metadata.available),
            qualityLabel:
                qualityLabels.length === 1 ? qualityLabels[0] : undefined,
            qualityLabels,
            height: heights.length === 1 ? heights[0] : undefined,
            heights,
            width: widths.length === 1 ? widths[0] : undefined,
            widths,
            videoCodec: videoCodecs.length === 1 ? videoCodecs[0] : undefined,
            videoCodecs,
            audioLanguages,
            audioCodecs,
            subtitleLanguages,
            subtitleCodecs,
            source: 'derived',
        };
    }

    private getEpisodeMetadataForSeriesSummary(
        episode: XtreamSerieEpisode
    ): MediaStreamMetadata | null {
        const persistedMetadata =
            this.episodePersistedMetadata()[
                String(this.getEpisodeContentId(episode))
            ];
        if (persistedMetadata) {
            return this.getEpisodeMergedMetadata(episode);
        }

        const context = this.xtreamDownloadContext();
        const url = context ? this.getEpisodeStreamUrl(episode, context) : '';
        const key = url
            ? this.getEpisodeProbeKey(url, this.buildProbeHeaders(context))
            : '';

        if (
            key &&
            !Object.prototype.hasOwnProperty.call(
                this.episodeProbeMetadata(),
                key
            )
        ) {
            return null;
        }

        return this.getEpisodeMergedMetadata(episode);
    }

    private getEpisodeMergedMetadata(
        episode: XtreamSerieEpisode
    ): MediaStreamMetadata | null {
        const staticMetadata = this.getEpisodeStaticMetadata(episode);
        const probeMetadata = this.getEpisodeProbedMetadata(episode);
        return probeMetadata
            ? mergeMediaStreamMetadata(probeMetadata, staticMetadata)
            : staticMetadata;
    }

    private getEpisodeStaticMetadata(
        episode: XtreamSerieEpisode
    ): MediaStreamMetadata | null {
        const info = this.getEpisodeInfo(episode);
        return buildMediaStreamMetadata({
            video: info?.video,
            audio: info?.audio,
            subtitles: info?.subtitles ?? info?.subtitle,
            title: episode.title,
            containerExtension: episode.container_extension,
        });
    }

    private getEpisodeProbedMetadata(
        episode: XtreamSerieEpisode
    ): MediaStreamMetadata | null {
        const persistedMetadata =
            this.episodePersistedMetadata()[
                String(this.getEpisodeContentId(episode))
            ];
        if (persistedMetadata) {
            return persistedMetadata;
        }

        const context = this.xtreamDownloadContext();
        const url = context ? this.getEpisodeStreamUrl(episode, context) : '';
        if (!url) {
            return null;
        }

        return (
            this.episodeProbeMetadata()[
                this.getEpisodeProbeKey(url, this.buildProbeHeaders(context))
            ] ?? null
        );
    }

    private isEpisodeProbePending(episode: XtreamSerieEpisode): boolean {
        const context = this.xtreamDownloadContext();
        const url = context ? this.getEpisodeStreamUrl(episode, context) : '';
        if (!url) {
            return false;
        }

        return Boolean(
            this.episodeProbePending()[
                this.getEpisodeProbeKey(url, this.buildProbeHeaders(context))
            ]
        );
    }

    private getAllEpisodes(): XtreamSerieEpisode[] {
        return Object.values(this.seasons()).reduce<XtreamSerieEpisode[]>(
            (episodes, seasonEpisodes) => {
                episodes.push(...seasonEpisodes);
                return episodes;
            },
            []
        );
    }

    private getEpisodeStreamUrl(
        episode: XtreamSerieEpisode,
        context: SeasonContainerXtreamDownloadContext | null
    ): string {
        if (
            !context?.serverUrl ||
            !context.username ||
            !context.password ||
            this.isStalkerEpisode(episode)
        ) {
            return '';
        }

        const directSource = this.getDirectSourceUrl(episode.direct_source);
        if (directSource) {
            return directSource;
        }

        const serverUrl = context.serverUrl.replace(/\/$/, '');
        const extension = episode.container_extension || 'mp4';
        return `${serverUrl}/series/${context.username}/${context.password}/${episode.id}.${extension}`;
    }

    private getDirectSourceUrl(value: unknown): string | null {
        if (
            this.settingsStore.redirectIndirectStreamsToDirectSource?.() !==
            true
        ) {
            return null;
        }

        if (typeof value !== 'string') {
            return null;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        try {
            const parsed = new URL(trimmed);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:'
                ? trimmed
                : null;
        } catch {
            return null;
        }
    }

    private getEpisodeProbeKey(
        url: string,
        headers: Record<string, string>
    ): string {
        return JSON.stringify({ url, headers });
    }

    private buildProbeHeaders(
        context: SeasonContainerXtreamDownloadContext | null
    ): Record<string, string> {
        const headers: Record<string, string> = {};

        if (context?.userAgent) {
            headers['User-Agent'] = context.userAgent;
        }
        if (context?.referrer) {
            headers.Referer = context.referrer;
        }
        if (context?.origin) {
            headers.Origin = context.origin;
        }

        return headers;
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
