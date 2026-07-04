import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnInit,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
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
} from '@iptvnator/shared/interfaces';
import { DownloadsService } from '@iptvnator/services';
import { ProgressCapsuleComponent } from '../progress-capsule/progress-capsule.component';
import {
    buildXtreamEpisodeDownloadRequest,
    getEpisodeDownloadId,
    isStalkerEpisode,
} from './episode-download.util';
import {
    EPISODE_INFO_PLAY,
    EpisodeInfoDialogComponent,
    buildEpisodeInfoDialogData,
} from './episode-info-dialog.component';
import {
    formatEpisodePositionText,
    parseDuration,
} from './episode-progress.util';
import { SeasonTabsComponent } from './season-tabs.component';

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

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatButtonToggleModule,
        MatIcon,
        MatProgressSpinnerModule,
        MatTooltipModule,
        ProgressCapsuleComponent,
        SeasonTabsComponent,
        TranslateModule,
    ],
})
export class SeasonContainerComponent implements OnInit {
    private readonly downloadsService = inject(DownloadsService);
    private readonly dialog = inject(MatDialog);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly logger = createLogger('SeasonContainer');
    private lastEmittedSeason: string | undefined;

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
    /** Episode currently playing in an EXTERNAL player session. */
    readonly activeEpisodeId = input<number | null>(null);
    /** Episode currently playing in the inline player. */
    readonly playingEpisodeId = input<number | null>(null);
    /** Per-season descriptions (TMDB/provider), keyed by season key. */
    readonly seasonDescriptions = input<Record<string, string> | null>(null);

    readonly episodeClicked = output<XtreamSerieEpisode>();
    readonly episodeDownloadRequested = output<XtreamSerieEpisode>();
    readonly playbackToggleRequested =
        output<SeasonContainerPlaybackToggleRequest>();
    readonly seasonSelected = output<string>();
    readonly isElectron = this.downloadsService.isAvailable;
    readonly viewMode = signal<EpisodeViewMode>('grid');

    readonly sortedSeasonKeys = computed(() =>
        Object.keys(this.seasons()).sort((a, b) => Number(a) - Number(b))
    );

    readonly episodeCounts = computed(() => {
        const counts: Record<string, number> = {};
        for (const [key, episodes] of Object.entries(this.seasons())) {
            counts[key] = episodes?.length ?? 0;
        }
        return counts;
    });

    readonly watchedCounts = computed(() => {
        const counts: Record<string, number> = {};
        for (const [key, episodes] of Object.entries(this.seasons())) {
            counts[key] = (episodes ?? []).filter((episode) =>
                this.isEpisodeWatched(episode)
            ).length;
        }
        return counts;
    });

    /** Season key of the inline-playing episode, if it is in the loaded set. */
    readonly playingSeasonKey = computed(() =>
        this.findSeasonOfEpisode(this.playingEpisodeId())
    );

    /**
     * Selected season. Auto-resolves when the season key set changes or when
     * playback positions first arrive (priority: inline-playing episode's
     * season → most recently updated in-progress episode's season → first
     * season); user tab clicks write to it and stick until the auto-select
     * key changes. Ongoing position saves do not reset the selection — only
     * the empty→loaded transition of the positions map does.
     */
    readonly selectedSeason = signal<string | undefined>(undefined);

    private readonly autoSelectKey = computed(
        () =>
            `${this.sortedSeasonKeys().join('|')}::${
                this.playbackPositions().size > 0 ? '1' : '0'
            }`
    );
    private lastAutoSelectKey: string | null = null;

    /**
     * Show thumbnails in the list view only when episodes have genuinely
     * distinct stills (TMDB or per-episode provider art). When every episode
     * carries the same image (providers often repeat the series poster) a
     * column of identical pictures is worse than the plain number square.
     */
    readonly listThumbnailsEnabled = computed(() => {
        const episodes = this.selectedSeasonEpisodes();
        const images = episodes
            .map((episode) => this.getEpisodeInfo(episode)?.movie_image)
            .filter((image): image is string => !!image);
        if (images.length === 0) {
            return false;
        }
        return episodes.length === 1 || new Set(images).size > 1;
    });

    readonly selectedSeasonDescription = computed(() => {
        const selected = this.selectedSeason();
        if (!selected) {
            return null;
        }
        return this.seasonDescriptions()?.[selected] ?? null;
    });

    constructor() {
        effect(() => {
            const key = this.autoSelectKey();
            if (key === this.lastAutoSelectKey) {
                return;
            }
            this.lastAutoSelectKey = key;
            this.selectedSeason.set(
                untracked(() => this.resolveAutoSeason())
            );
        });

        // Fire the lazy-load/enrichment hooks for auto-selected seasons too —
        // with tabs there is no initial "pick a season" click anymore.
        effect(() => {
            const selected = this.selectedSeason();
            if (selected && selected !== this.lastEmittedSeason) {
                this.lastEmittedSeason = selected;
                this.seasonSelected.emit(selected);
            }
        });
    }

    ngOnInit() {
        const savedMode = localStorage.getItem(
            EPISODE_VIEW_MODE_KEY
        ) as EpisodeViewMode;
        if (savedMode === 'grid' || savedMode === 'list') {
            this.viewMode.set(savedMode);
        }
    }

    setViewMode(mode: EpisodeViewMode) {
        this.viewMode.set(mode);
        localStorage.setItem(EPISODE_VIEW_MODE_KEY, mode);
    }

    hasSeasons(): boolean {
        return this.sortedSeasonKeys().length > 0;
    }

    showSeriesEmptyState(): boolean {
        return !this.hasSeasons();
    }

    showSeasonEmptyState(): boolean {
        const selected = this.selectedSeason();
        return (
            Boolean(selected) &&
            (this.seasons()[selected as string]?.length ?? 0) === 0
        );
    }

    selectedSeasonEpisodes(): XtreamSerieEpisode[] {
        const selected = this.selectedSeason();
        return selected ? (this.seasons()[selected] ?? []) : [];
    }

    selectSeason(seasonKey: string) {
        this.selectedSeason.set(seasonKey);
    }

    scrollToPlayingEpisode(): void {
        const playingSeason = this.playingSeasonKey();
        if (!playingSeason) {
            return;
        }
        this.selectedSeason.set(playingSeason);
        // Wait a tick so the episode list re-renders for the new season.
        setTimeout(() => {
            const target = this.host.nativeElement.querySelector(
                `[data-episode-id="${this.playingEpisodeId()}"]`
            );
            target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
    }

    selectEpisode(episode: XtreamSerieEpisode) {
        this.episodeClicked.emit(episode);
    }

    openEpisodeInfo(event: Event, episode: XtreamSerieEpisode) {
        event.stopPropagation();
        this.dialog
            .open(EpisodeInfoDialogComponent, {
                data: buildEpisodeInfoDialogData(
                    episode,
                    this.selectedSeason()
                ),
                autoFocus: false,
            })
            .afterClosed()
            .subscribe((result) => {
                if (result === EPISODE_INFO_PLAY) {
                    this.selectEpisode(episode);
                }
            });
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
                    episode.season || this.selectedSeason() || 1
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

    isEpisodePlayingInline(episode: XtreamSerieEpisode): boolean {
        return this.playingEpisodeId() === this.getEpisodeContentId(episode);
    }

    getEpisodeProgress(episode: XtreamSerieEpisode): number {
        return getPortalPlaybackProgressPercent(
            this.getEpisodePosition(episode)
        );
    }

    getEpisodePositionText(episode: XtreamSerieEpisode): string | null {
        return formatEpisodePositionText(this.getEpisodePosition(episode));
    }

    getEpisodeContentId(episode: XtreamSerieEpisode): number {
        return Number(episode.id);
    }

    async downloadEpisode(event: Event, episode: XtreamSerieEpisode) {
        event.stopPropagation();

        if (isStalkerEpisode(episode)) {
            this.episodeDownloadRequested.emit(episode);
            return;
        }

        const xtreamDownload = this.xtreamDownloadContext();
        if (!this.playlistId() || !xtreamDownload) {
            return;
        }

        await this.downloadsService.startDownload(
            buildXtreamEpisodeDownloadRequest({
                episode,
                context: xtreamDownload,
                playlistId: this.playlistId(),
                seriesId: this.seriesId(),
                seriesTitle: this.seriesTitle(),
                fallbackSeasonKey: this.selectedSeason(),
                posterUrl: this.getEpisodeInfo(episode)?.movie_image,
            })
        );
    }

    isEpisodeDownloaded(episode: XtreamSerieEpisode): boolean {
        if (!this.playlistId()) {
            return false;
        }

        this.downloadsService.downloads();
        return this.downloadsService.isDownloaded(
            getEpisodeDownloadId(episode),
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
            getEpisodeDownloadId(episode),
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
            getEpisodeDownloadId(episode),
            this.playlistId(),
            'episode'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }

    private getEpisodePosition(
        episode: XtreamSerieEpisode
    ): PlaybackPositionData | undefined {
        return this.playbackPositions().get(this.getEpisodeContentId(episode));
    }

    private findSeasonOfEpisode(episodeId: number | null): string | null {
        if (episodeId === null) {
            return null;
        }
        for (const [key, episodes] of Object.entries(this.seasons())) {
            if (
                episodes?.some(
                    (episode) => this.getEpisodeContentId(episode) === episodeId
                )
            ) {
                return key;
            }
        }
        return null;
    }

    private resolveAutoSeason(): string | undefined {
        const keys = this.sortedSeasonKeys();
        if (keys.length === 0) {
            return undefined;
        }

        const playingSeason = this.playingSeasonKey();
        if (playingSeason) {
            return playingSeason;
        }

        const resumeSeason = this.findMostRecentInProgressSeason();
        return resumeSeason ?? keys[0];
    }

    private findMostRecentInProgressSeason(): string | null {
        let bestSeason: string | null = null;
        let bestUpdatedAt = '';
        for (const [key, episodes] of Object.entries(this.seasons())) {
            for (const episode of episodes ?? []) {
                const position = this.getEpisodePosition(episode);
                if (!isPortalPlaybackInProgress(position)) {
                    continue;
                }
                const updatedAt = position?.updatedAt ?? '';
                if (updatedAt >= bestUpdatedAt) {
                    bestUpdatedAt = updatedAt;
                    bestSeason = key;
                }
            }
        }
        return bestSeason;
    }
}
