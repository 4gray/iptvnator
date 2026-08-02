import {
    Injectable,
    type Signal,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
    EPISODE_DOWNLOAD_SUBMISSIONS,
    SeasonDownloadCoordinator,
    type EpisodeDownloadCandidate,
    type SeasonEpisodeDownloadAdapter,
} from '@iptvnator/portal/shared/data-access';
import { isEpisodeDownloadEligible } from '@iptvnator/portal/shared/util';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { DownloadsService, type DownloadItem } from '@iptvnator/services';

const EPISODE_DOWNLOAD_ACTIONS = {
    Blocked: 'blocked',
    Download: 'download',
    Pending: 'pending',
    Play: 'play',
    Resume: 'resume',
} as const;

type EpisodeDownloadAction =
    (typeof EPISODE_DOWNLOAD_ACTIONS)[keyof typeof EPISODE_DOWNLOAD_ACTIONS];

export interface EpisodeDownloadPresentation {
    readonly action: EpisodeDownloadAction;
    readonly ariaKey: string;
    readonly disabled: boolean;
    readonly icon: string;
}

export interface SeasonEpisodeDownloadRow {
    readonly candidate: EpisodeDownloadCandidate | null;
    readonly download: DownloadItem | undefined;
    readonly eligible: boolean;
    readonly episode: XtreamSerieEpisode;
    readonly presentation: EpisodeDownloadPresentation;
}

export interface SeasonDownloadPresenterSources {
    readonly adapter: Signal<SeasonEpisodeDownloadAdapter | null>;
    readonly downloadsEnabled: Signal<boolean>;
    readonly isLoading: Signal<boolean>;
    readonly selectedEpisodes: Signal<readonly XtreamSerieEpisode[]>;
    readonly selectedSeason: Signal<string | undefined>;
}

const EPISODE_DOWNLOAD_STATES: Record<
    EpisodeDownloadAction,
    EpisodeDownloadPresentation
> = {
    blocked: {
        action: EPISODE_DOWNLOAD_ACTIONS.Blocked,
        ariaKey: 'DOWNLOADS.EPISODE_DOWNLOAD_ARIA',
        disabled: true,
        icon: 'block',
    },
    download: {
        action: EPISODE_DOWNLOAD_ACTIONS.Download,
        ariaKey: 'DOWNLOADS.EPISODE_DOWNLOAD_ARIA',
        disabled: false,
        icon: 'download',
    },
    pending: {
        action: EPISODE_DOWNLOAD_ACTIONS.Pending,
        ariaKey: 'DOWNLOADS.EPISODE_DOWNLOAD_PENDING_ARIA',
        disabled: true,
        icon: 'downloading',
    },
    play: {
        action: EPISODE_DOWNLOAD_ACTIONS.Play,
        ariaKey: 'DOWNLOADS.PLAY_LOCAL',
        disabled: false,
        icon: 'folder_open',
    },
    resume: {
        action: EPISODE_DOWNLOAD_ACTIONS.Resume,
        ariaKey: 'DOWNLOADS.ARIA.RESUME',
        disabled: false,
        icon: 'play_arrow',
    },
};

@Injectable()
export class SeasonDownloadPresenter {
    private readonly coordinator = inject(SeasonDownloadCoordinator);
    private readonly downloadsService = inject(DownloadsService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly sources = signal<SeasonDownloadPresenterSources | null>(
        null
    );
    private readonly batchInFlight = signal(false);

    readonly batchRunning = this.batchInFlight.asReadonly();
    readonly presentationVisible = computed(() => {
        const sources = this.sources();
        return Boolean(
            sources &&
            this.downloadsService.isAvailable() &&
            sources.downloadsEnabled() &&
            sources.adapter()
        );
    });

    readonly rows = computed<readonly SeasonEpisodeDownloadRow[]>(() => {
        const sources = this.sources();
        if (!sources) {
            return [];
        }

        const adapter = sources.adapter();
        const seasonKey = sources.selectedSeason();
        const downloadsAvailable = this.downloadsService.isAvailable();
        const downloadsReady =
            this.downloadsService.hasLoadedDownloads() &&
            this.downloadsService.hasAuthoritativeDownloadList();
        this.downloadsService.downloads();

        return sources.selectedEpisodes().map((episode) => {
            const candidate =
                adapter && seasonKey
                    ? adapter.createCandidate(episode, seasonKey)
                    : null;
            const pending = candidate
                ? this.coordinator.isPending(candidate.identity)
                : false;
            const resolution = candidate
                ? this.coordinator.resolveDownload(candidate.identity)
                : { kind: 'missing' as const };
            const download =
                resolution.kind === 'match' ? resolution.download : undefined;
            const identityConflict = resolution.kind === 'conflict';
            return {
                candidate,
                download,
                eligible: Boolean(
                    candidate &&
                    downloadsAvailable &&
                    downloadsReady &&
                    !pending &&
                    isEpisodeDownloadEligible(resolution)
                ),
                episode,
                presentation: this.createPresentation(
                    candidate,
                    download,
                    pending,
                    downloadsReady,
                    identityConflict
                ),
            };
        });
    });

    private readonly rowByEpisode = computed(
        () => new Map(this.rows().map((row) => [row.episode, row] as const))
    );

    readonly eligibleEpisodeCount = computed(
        () => this.rows().filter((row) => row.eligible).length
    );

    readonly seasonDisabled = computed(() => {
        const sources = this.sources();
        return (
            !sources ||
            sources.isLoading() ||
            this.batchRunning() ||
            !this.downloadsService.hasLoadedDownloads() ||
            !this.downloadsService.hasAuthoritativeDownloadList() ||
            !sources.selectedSeason() ||
            this.rows().length === 0 ||
            this.eligibleEpisodeCount() === 0
        );
    });

    connect(sources: SeasonDownloadPresenterSources): void {
        if (this.sources()) {
            throw new Error('SeasonDownloadPresenter is already connected');
        }
        this.sources.set(sources);
    }

    rowFor(episode: XtreamSerieEpisode): SeasonEpisodeDownloadRow {
        const row = this.rowByEpisode().get(episode);
        if (!row) {
            throw new Error('Episode is outside the selected-season row model');
        }
        return row;
    }

    runEpisodeAction(event: Event, episode: XtreamSerieEpisode): void {
        event.stopPropagation();
        const row = this.rowByEpisode().get(episode);
        if (!row || row.presentation.disabled) {
            return;
        }

        if (row.presentation.action === EPISODE_DOWNLOAD_ACTIONS.Resume) {
            void this.resume(row);
        } else if (row.presentation.action === EPISODE_DOWNLOAD_ACTIONS.Play) {
            void this.play(row);
        } else if (
            row.presentation.action === EPISODE_DOWNLOAD_ACTIONS.Download
        ) {
            void this.enqueueOne(episode);
        }
    }

    async enqueueOne(episode: XtreamSerieEpisode): Promise<void> {
        if (!this.presentationVisible()) {
            return;
        }
        const row = this.rowByEpisode().get(episode);
        if (!row?.candidate || !row.eligible) {
            return;
        }

        const result = await this.coordinator.enqueueOne(row.candidate);
        if (result === EPISODE_DOWNLOAD_SUBMISSIONS.Failed) {
            this.notify('DOWNLOADS.EPISODE_DOWNLOAD_FAILED');
        }
    }

    async enqueueSeason(): Promise<void> {
        if (
            this.batchRunning() ||
            this.seasonDisabled() ||
            !this.presentationVisible()
        ) {
            return;
        }

        const candidates = this.rows().map((row) => row.candidate);
        this.batchInFlight.set(true);
        try {
            const result = await this.coordinator.enqueueSeason(candidates);
            this.notify(
                result.failed > 0
                    ? 'DOWNLOADS.SEASON_QUEUE_RESULT_WITH_FAILURES'
                    : 'DOWNLOADS.SEASON_QUEUE_RESULT',
                result
            );
        } finally {
            this.batchInFlight.set(false);
        }
    }

    private async resume(row: SeasonEpisodeDownloadRow): Promise<void> {
        const download = row.download;
        if (
            download?.status === 'paused' &&
            Number.isSafeInteger(download.id) &&
            download.id > 0
        ) {
            await this.downloadsService.resumeDownload(download.id);
        }
    }

    private async play(row: SeasonEpisodeDownloadRow): Promise<void> {
        const download = row.download;
        if (
            download?.status === 'completed' &&
            download.fileAvailability === 'available' &&
            download.filePath
        ) {
            await this.downloadsService.playDownload(download.filePath);
        }
    }

    private notify(key: string, params?: object): void {
        this.snackBar.open(this.translate.instant(key, params), undefined, {
            duration: 5000,
        });
    }

    private createPresentation(
        candidate: EpisodeDownloadCandidate | null,
        download: DownloadItem | undefined,
        pending: boolean,
        downloadsReady: boolean,
        identityConflict: boolean
    ): EpisodeDownloadPresentation {
        if (!candidate || !downloadsReady || identityConflict) {
            return EPISODE_DOWNLOAD_STATES.blocked;
        }
        if (
            pending ||
            download?.status === 'queued' ||
            download?.status === 'downloading'
        ) {
            return EPISODE_DOWNLOAD_STATES.pending;
        }
        if (download?.status === 'paused') {
            return EPISODE_DOWNLOAD_STATES.resume;
        }
        if (download?.status === 'completed') {
            if (
                download.fileAvailability === 'available' &&
                download.filePath
            ) {
                return EPISODE_DOWNLOAD_STATES.play;
            }
            return download.fileAvailability === 'missing'
                ? EPISODE_DOWNLOAD_STATES.download
                : EPISODE_DOWNLOAD_STATES.blocked;
        }
        return EPISODE_DOWNLOAD_STATES.download;
    }
}
