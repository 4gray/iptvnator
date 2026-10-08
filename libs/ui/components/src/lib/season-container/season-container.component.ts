import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnInit,
    computed,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
import { ExpandableTextComponent } from '../expandable-text/expandable-text.component';
import {
    EPISODE_INFO_PLAY,
    EpisodeInfoDialogComponent,
    buildEpisodeInfoDialogData,
} from './episode-info-dialog.component';
import { formatEpisodePositionText } from './episode-progress.util';
import { buildEpisodeSubline } from './episode-subline.util';
import {
    type SeasonAutoSelectState,
    createSeasonAutoSelectState,
    findSeasonOfEpisode,
} from './season-auto-select.state';
import { SeasonDownloadPresenter } from './season-download-presenter';
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

export type EpisodeViewMode = 'grid' | 'list';

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [SeasonDownloadPresenter, SeasonWatchPresenter],
    imports: [
        ExpandableTextComponent,
        MatButtonModule,
        MatButtonToggleModule,
        MatIcon,
        MatProgressSpinnerModule,
        MatTooltipModule,
        SeasonTabsComponent,
        TranslateModule,
    ],
})
export class SeasonContainerComponent implements OnInit {
    private readonly dialog = inject(MatDialog);
    private readonly translate = inject(TranslateService);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly logger = createLogger('SeasonContainer');
    /** Auto-select + `seasonSelected` emission; wired in the constructor. */
    private readonly autoSelect: SeasonAutoSelectState;
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
    /**
     * Per-season poster URLs (TMDB season poster, provider season cover),
     * keyed by season key. Rendered as the season cover beside the tabs.
     */
    readonly seasonPosters = input<Record<string, string> | null>(null);
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
    readonly playingSeasonKey = computed(() => {
        const episodeId = this.playingEpisodeId();
        return episodeId === null
            ? null
            : findSeasonOfEpisode(this.seasons(), episodeId);
    });

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

    /** Poster URLs whose image request failed; the cover column then folds. */
    private readonly failedSeasonPosters = signal<ReadonlySet<string>>(
        new Set()
    );

    /**
     * The selected season's cover. Withheld for one-season items — that
     * poster is the show poster again, a few hundred pixels below the hero —
     * and for a URL whose image failed, so a dead provider link never leaves
     * a broken-image frame beside the tabs.
     */
    readonly selectedSeasonPosterUrl = computed(() => {
        const selected = this.selectedSeason();
        if (!selected || this.sortedSeasonKeys().length < 2) {
            return null;
        }
        const url = this.seasonPosters()?.[selected] ?? null;
        return url && !this.failedSeasonPosters().has(url) ? url : null;
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
                this.autoSelect.markLocalWatchedMutation();
                this.seasonPlaybackToggleRequested.emit(request);
            },
            emitSeriesToggle: (request) => {
                this.autoSelect.markLocalWatchedMutation();
                this.seriesPlaybackToggleRequested.emit(request);
            },
        });

        // Auto-select rules and the effects driving them live in
        // season-auto-select.state.ts / season-auto-select.util.ts.
        this.autoSelect = createSeasonAutoSelectState({
            selectedSeason: this.selectedSeason,
            seasons: this.seasons,
            sortedSeasonKeys: this.sortedSeasonKeys,
            playingSeasonKey: this.playingSeasonKey,
            playbackPositions: this.playbackPositions,
            positionOf: (episode) => this.getEpisodePosition(episode),
            hasUnloadedSeasons: this.hasUnloadedSeasons,
            episodeCounts: this.episodeCounts,
            watchedCounts: this.watchedCounts,
            emitSeasonSelected: (seasonKey) =>
                this.seasonSelected.emit(seasonKey),
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

    onSeasonPosterError(url: string): void {
        this.failedSeasonPosters.update((failed) => new Set(failed).add(url));
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
        this.autoSelect.markLocalWatchedMutation();

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

    /** "42 min · 18m left", "42 min · watched", "42 min" — or null. */
    getEpisodeSubline(episode: XtreamSerieEpisode): string | null {
        return buildEpisodeSubline(
            this.getEpisodeInfo(episode),
            this.getEpisodePosition(episode),
            this.translate
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
}
