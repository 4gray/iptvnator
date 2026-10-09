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
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { type SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';
import {
    createLogger,
    isPortalPlaybackInProgress,
    isPortalPlaybackWatched,
} from '@iptvnator/portal/shared/util';
import {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { DetailSectionHeaderComponent } from '../detail-ui/detail-section-header.component';
import { ExpandableTextComponent } from '../expandable-text/expandable-text.component';
import {
    EPISODE_INFO_PLAY,
    EpisodeInfoDialogComponent,
    buildEpisodeInfoDialogData,
} from './episode-info-dialog.component';
import { EpisodeItemComponent } from './episode-item.component';
import {
    type EpisodeMetaState,
    resolveEpisodeMetaState,
    usableStillUrl,
} from './episode-meta-state.util';
import { EpisodeSkeletonComponent } from './episode-skeleton.component';
import {
    type SeasonAutoSelectState,
    createSeasonAutoSelectState,
    findSeasonOfEpisode,
} from './season-auto-select.state';
import { repeatsSeriesDescription } from './season-description.util';
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

/** The viewer's saved list/grid choice for episodes; list by default. */
export function readSavedEpisodeViewMode(): EpisodeViewMode {
    try {
        return localStorage.getItem(EPISODE_VIEW_MODE_KEY) === 'grid'
            ? 'grid'
            : 'list';
    } catch {
        return 'list';
    }
}

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [SeasonDownloadPresenter, SeasonWatchPresenter],
    imports: [
        DetailSectionHeaderComponent,
        EpisodeItemComponent,
        EpisodeSkeletonComponent,
        ExpandableTextComponent,
        MatButtonModule,
        MatButtonToggleModule,
        MatIcon,
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
    /** The hero's description: a season synopsis repeating it is not shown again. */
    readonly seriesDescription = input<string | null | undefined>(null);
    /** True while the provider's season or episode list is on its way. */
    readonly isLoading = input<boolean>(false);
    /**
     * True while the selected season's episode metadata is still being
     * fetched after the provider list (TMDB enrichment): its rows stay
     * skeletons so they do not change height when the data lands.
     */
    readonly metadataLoading = input<boolean>(false);
    /** The series poster: an episode "still" that repeats it counts as none. */
    readonly seriesPosterUrl = input<string | null | undefined>(null);
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
     * keyed by season key. Never rendered here: an episode "still" that is
     * only the season cover again counts as no still.
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
    /** "Play from beginning" in an episode's menu: start at 0, not the saved position. */
    readonly episodeRestartRequested = output<XtreamSerieEpisode>();
    readonly playbackToggleRequested =
        output<SeasonContainerPlaybackToggleRequest>();
    readonly seasonPlaybackToggleRequested =
        output<SeasonContainerSeasonPlaybackToggleRequest>();
    readonly seriesPlaybackToggleRequested =
        output<SeasonContainerSeriesPlaybackToggleRequest>();
    readonly seasonSelected = output<string>();
    readonly viewMode = signal<EpisodeViewMode>('list');

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
     * True when the season's episodes carry genuinely distinct stills (TMDB
     * or per-episode provider art). When every episode repeats one image
     * (providers often send the series poster) the thumbnails fall back to a
     * dimmed tile instead of a column of identical bright posters.
     */
    readonly distinctStills = computed(() => {
        const episodes = this.selectedSeasonEpisodes();
        const images = episodes
            .map((episode) => resolveEpisodeInfo(episode)?.movie_image)
            .filter((image): image is string => !!image);
        if (images.length === 0) {
            return false;
        }
        return episodes.length === 1 || new Set(images).size > 1;
    });

    private readonly stillContext = computed(() => ({
        distinctStills: this.distinctStills(),
        posterUrls: [
            this.seriesPosterUrl(),
            this.seasonPosters()?.[this.selectedSeason() ?? ''],
        ],
    }));

    /** Skeleton, full rows or bare rows; see `resolveEpisodeMetaState`. */
    readonly metaState = computed<EpisodeMetaState>(() =>
        resolveEpisodeMetaState(
            this.selectedSeasonEpisodes(),
            this.isLoading() || this.metadataLoading(),
            this.stillContext()
        )
    );

    /** Bare rows have no grid form: the view toggle hides and lists show. */
    readonly effectiveViewMode = computed<EpisodeViewMode>(() =>
        this.metaState() === 'bare' ? 'list' : this.viewMode()
    );

    /**
     * The highlighted "now playing / continue" episode of the season: the
     * one playing (inline or external), else the most recently watched
     * episode that is not finished.
     */
    readonly currentEpisodeId = computed<number | null>(() => {
        const playing = this.playingEpisodeId() ?? this.activeEpisodeId();
        if (playing !== null) {
            return playing;
        }
        let best: { id: number; updatedAt: string } | null = null;
        for (const episode of this.selectedSeasonEpisodes()) {
            const position = this.getEpisodePosition(episode);
            if (!isPortalPlaybackInProgress(position)) {
                continue;
            }
            const updatedAt = position?.updatedAt ?? '';
            if (!best || updatedAt > best.updatedAt) {
                best = { id: this.getEpisodeContentId(episode), updatedAt };
            }
        }
        return best?.id ?? null;
    });

    readonly selectedSeasonDescription = computed(() => {
        const selected = this.selectedSeason();
        if (!selected) {
            return null;
        }
        const description = this.seasonDescriptions()?.[selected] ?? null;
        return description &&
            !repeatsSeriesDescription(description, this.seriesDescription())
            ? description
            : null;
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
        this.viewMode.set(readSavedEpisodeViewMode());
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

    restartEpisode(episode: XtreamSerieEpisode) {
        this.episodeRestartRequested.emit(episode);
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

    hasUsableStill(episode: XtreamSerieEpisode): boolean {
        return usableStillUrl(episode, this.stillContext()) !== null;
    }

    isEpisodeWatched(episode: XtreamSerieEpisode): boolean {
        return isPortalPlaybackWatched(this.getEpisodePosition(episode));
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

    getEpisodeContentId(episode: XtreamSerieEpisode): number {
        return Number(episode.id);
    }

    getEpisodePosition(
        episode: XtreamSerieEpisode
    ): PlaybackPositionData | undefined {
        return this.playbackPositions().get(this.getEpisodeContentId(episode));
    }
}
