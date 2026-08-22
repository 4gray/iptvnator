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
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { type SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';
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
import { ProgressCapsuleComponent } from '../progress-capsule/progress-capsule.component';
import {
    EPISODE_INFO_PLAY,
    EpisodeInfoDialogComponent,
    buildEpisodeInfoDialogData,
} from './episode-info-dialog.component';
import { formatEpisodePositionText } from './episode-progress.util';
import { SeasonDownloadPresenter } from './season-download-presenter';
import {
    type EpisodeViewMode,
    SeasonHeaderComponent,
} from './season-header.component';
import { SeasonTabsComponent } from './season-tabs.component';
import { SeasonWatchPresenter } from './season-watch-presenter';
import {
    type SeasonContainerPlaybackToggleRequest,
    type SeasonContainerSeasonPlaybackToggleRequest,
    type SeasonContainerSeriesPlaybackToggleRequest,
    buildWatchedEpisodePosition,
    resolveEpisodeInfo,
} from './season-watch-toggle.util';

const EPISODE_VIEW_MODE_KEY = 'iptvnator_episode_view_mode';

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [SeasonDownloadPresenter, SeasonWatchPresenter],
    imports: [
        MatButtonModule,
        MatIcon,
        MatProgressSpinnerModule,
        MatTooltipModule,
        ProgressCapsuleComponent,
        SeasonHeaderComponent,
        SeasonTabsComponent,
        TranslateModule,
    ],
})
export class SeasonContainerComponent implements OnInit {
    private readonly dialog = inject(MatDialog);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly logger = createLogger('SeasonContainer');
    private lastEmittedSeason: string | undefined;
    readonly downloadPresenter = inject(SeasonDownloadPresenter);
    readonly watchPresenter = inject(SeasonWatchPresenter);

    readonly seasons = input.required<Record<string, XtreamSerieEpisode[]>>();
    readonly seriesId = input.required<number>();
    readonly playlistId = input.required<string>();
    readonly seriesTitle = input<string>('');
    readonly isLoading = input<boolean>(false);
    readonly playbackPositions = input<Map<number, PlaybackPositionData>>(
        new Map()
    );
    readonly downloadAdapter = input<SeasonEpisodeDownloadAdapter | null>(null);
    readonly downloadsEnabled = input(true);
    readonly openingEpisodeId = input<number | null>(null);
    /** Episode currently playing in an EXTERNAL player session. */
    readonly activeEpisodeId = input<number | null>(null);
    /** Episode currently playing in the inline player. */
    readonly playingEpisodeId = input<number | null>(null);
    /** Per-season descriptions (TMDB/provider), keyed by season key. */
    readonly seasonDescriptions = input<Record<string, string> | null>(null);
    /** True while a host is persisting a season-level watched toggle. */
    readonly seasonWatchBatchRunning = input(false);
    /**
     * True while some seasons' episode lists are not loaded yet (Stalker
     * lazy-VOD): blocks the series-wide "fully watched" verdict and hides the
     * count from the series action label.
     */
    readonly hasUnloadedSeasons = input(false);

    readonly episodeClicked = output<XtreamSerieEpisode>();
    readonly playbackToggleRequested =
        output<SeasonContainerPlaybackToggleRequest>();
    readonly seasonPlaybackToggleRequested =
        output<SeasonContainerSeasonPlaybackToggleRequest>();
    readonly seriesPlaybackToggleRequested =
        output<SeasonContainerSeriesPlaybackToggleRequest>();
    readonly seasonSelected = output<string>();
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
     * season → most recently updated in-progress episode's season → earliest
     * season with unwatched episodes → latest season, with unhydrated
     * lazy-VOD seasons pinning the fallback to the first season); user tab
     * clicks write to it and stick until the auto-select
     * key changes. Ongoing position saves do not reset the selection — only
     * the empty→loaded transition of the positions map does, and even that
     * is ignored once this session toggled watched state itself (the flip is
     * then an echo of the local action, not an initial load).
     */
    readonly selectedSeason = signal<string | undefined>(undefined);

    readonly selectedSeasonEpisodes = computed(() => {
        const selected = this.selectedSeason();
        return selected ? (this.seasons()[selected] ?? []) : [];
    });

    private readonly autoSelectKey = computed(
        () =>
            `${this.sortedSeasonKeys().join('|')}::${
                this.playbackPositions().size > 0 ? '1' : '0'
            }`
    );
    private lastAutoSelectKey: string | null = null;
    private lastAutoSelectSeasonSet: string | null = null;
    /**
     * True once this session toggled watched state itself. From then on an
     * empty↔loaded flip of the positions map is the echo of that action, not
     * an async initial load — re-resolving on it would yank the user off the
     * season they just marked (e.g. all-watched season 1 → jump to season 2).
     */
    private hasLocalWatchedMutation = false;

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
        this.downloadPresenter.connect({
            adapter: this.downloadAdapter,
            downloadsEnabled: this.downloadsEnabled,
            isLoading: this.isLoading,
            selectedEpisodes: this.selectedSeasonEpisodes,
            selectedSeason: this.selectedSeason,
        });

        this.watchPresenter.connect({
            seasons: this.seasons,
            selectedSeason: this.selectedSeason,
            selectedSeasonEpisodes: this.selectedSeasonEpisodes,
            seriesId: this.seriesId,
            playlistId: this.playlistId,
            hasUnloadedSeasons: this.hasUnloadedSeasons,
            batchRunning: this.seasonWatchBatchRunning,
            playingEpisodeId: this.playingEpisodeId,
            activeEpisodeId: this.activeEpisodeId,
            openingEpisodeId: this.openingEpisodeId,
            isEpisodeWatched: (episode) => this.isEpisodeWatched(episode),
            emitSeasonToggle: (request) => {
                this.hasLocalWatchedMutation = true;
                this.seasonPlaybackToggleRequested.emit(request);
            },
            emitSeriesToggle: (request) => {
                this.hasLocalWatchedMutation = true;
                this.seriesPlaybackToggleRequested.emit(request);
            },
        });

        effect(() => {
            const key = this.autoSelectKey();
            if (key === this.lastAutoSelectKey) {
                return;
            }
            const seasonSet = untracked(() =>
                this.sortedSeasonKeys().join('|')
            );
            const seasonSetUnchanged =
                seasonSet === this.lastAutoSelectSeasonSet;
            this.lastAutoSelectKey = key;
            this.lastAutoSelectSeasonSet = seasonSet;
            // A positions-emptiness flip after a local watched toggle keeps
            // the current selection; only the async initial positions load
            // (or a season-set change) re-resolves the season.
            if (seasonSetUnchanged && this.hasLocalWatchedMutation) {
                return;
            }
            this.selectedSeason.set(untracked(() => this.resolveAutoSeason()));
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
        this.hasLocalWatchedMutation = true;

        const contentXtreamId = this.getEpisodeContentId(episode);
        const currentPosition = this.getEpisodePosition(episode);

        if (isPortalPlaybackWatched(currentPosition)) {
            this.playbackToggleRequested.emit({
                contentXtreamId,
                nextPosition: null,
            });
            return;
        }

        this.playbackToggleRequested.emit({
            contentXtreamId,
            nextPosition: buildWatchedEpisodePosition({
                episode,
                seriesId: this.seriesId(),
                playlistId: this.playlistId(),
                fallbackSeasonKey: this.selectedSeason(),
            }),
        });
    }

    getEpisodeInfo(
        episode: XtreamSerieEpisode
    ): XtreamSerieEpisodeInfo | undefined {
        return resolveEpisodeInfo(episode);
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
        return resumeSeason ?? this.resolveDefaultSeason(keys);
    }

    /**
     * Fallback when nothing is playing or in progress: the earliest season
     * with unwatched episodes, or — once everything loaded is watched — the
     * latest non-empty season, where new episodes land (issue #1441).
     * Loaded-but-empty seasons (a valid Stalker answer) are never picked over
     * one that has episodes. Stalker lazy-VOD series with unhydrated seasons
     * keep the first season: their watched state is unknown, so skipping
     * past them would be a guess.
     */
    private resolveDefaultSeason(keys: readonly string[]): string {
        if (this.hasUnloadedSeasons()) {
            return keys[0];
        }

        const episodeCounts = this.episodeCounts();
        const watchedCounts = this.watchedCounts();
        const firstUnwatched = keys.find((key) => {
            const total = episodeCounts[key] ?? 0;
            return total > 0 && (watchedCounts[key] ?? 0) < total;
        });
        if (firstUnwatched) {
            return firstUnwatched;
        }
        const latestWithEpisodes = [...keys]
            .reverse()
            .find((key) => (episodeCounts[key] ?? 0) > 0);
        return latestWithEpisodes ?? keys[0];
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
