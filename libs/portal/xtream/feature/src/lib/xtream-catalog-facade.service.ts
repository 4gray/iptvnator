import {
    Provider,
    Injectable,
    OnDestroy,
    computed,
    effect,
    inject,
} from '@angular/core';
import {
    PortalCatalogFacade,
    PortalCatalogItemProgress,
    PortalCatalogLanguageFilterSection,
    PortalCatalogPlaylistMeta,
    PortalCatalogSortMode,
    PortalCatalogVideoQualityFilterValue,
    PORTAL_CATALOG_FACADE,
    buildMediaStreamMetadata,
    mediaMetadataNeedsProbe,
    mergeMediaStreamMetadata,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { DatabaseService, MediaMetadataService, SettingsStore } from 'services';
import {
    BackgroundMetadataWarmupSchedule,
    MediaStreamMetadata,
    SourceVpnRequestContext,
    XtreamVodDetails,
    isMediaMetadataDueForSchedule,
} from 'shared-interfaces';
import { XtreamUrlService } from '@iptvnator/portal/xtream/data-access';

const SORT_STORAGE_KEY = 'xtream-category-sort-mode';
const BACKGROUND_METADATA_LAST_RUN_KEY_PREFIX =
    'xtream-background-metadata-warmup:last-run';
const MAX_WARM_METADATA_ITEMS = 12;
const MAX_CONCURRENT_WARM_METADATA_PROBES = 2;
const BACKGROUND_METADATA_WARMUP_DEBOUNCE_MS = 5000;
const BACKGROUND_METADATA_JOB_BUILD_CHUNK_SIZE = 100;
const BACKGROUND_METADATA_JOB_BUILD_IDLE_DELAY_MS = 25;
const DEFAULT_BACKGROUND_METADATA_PROBE_CONCURRENCY = 2;
const BACKGROUND_METADATA_UI_UPDATE_BATCH_SIZE = 1;
const BACKGROUND_METADATA_UI_UPDATE_BUDGET_MS = 8;
const BACKGROUND_METADATA_UI_UPDATE_DELAY_MS = 3000;

interface MediaMetadataWarmJob {
    key: string;
    playlistId: string;
    url: string;
    contentType: 'live' | 'vod';
    xtreamId: number;
    staticMetadata: MediaStreamMetadata | null;
    headers: Record<string, string>;
}

interface MediaMetadataBackgroundWarmJob {
    playlistId: string;
    contentType: 'live' | 'movie' | 'episode';
    xtreamId: number;
    seriesXtreamId?: number | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    url: string;
    headers: Record<string, string>;
    staticMetadata: MediaStreamMetadata | null;
    sourceVpn?: SourceVpnRequestContext;
}

interface MediaMetadataBackgroundSeriesDiscoveryJob {
    playlistId: string;
    serverUrl: string;
    username: string;
    password: string;
    seriesXtreamId: number;
    headers: Record<string, string>;
    sourceVpn?: SourceVpnRequestContext;
}

interface MediaMetadataBackgroundItemEvent {
    type: 'item';
    playlistId: string;
    contentType: 'live' | 'movie' | 'series' | 'episode';
    xtreamId: number;
    metadata: MediaStreamMetadata;
}

@Injectable()
export class XtreamCatalogFacadeService
    implements
        OnDestroy,
        PortalCatalogFacade<
            Record<string, unknown>,
            Record<string, unknown>,
            unknown
        >
{
    private readonly xtreamStore = inject(XtreamStore);
    private readonly dbService = inject(DatabaseService);
    private readonly mediaMetadataService = inject(MediaMetadataService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly urlService = inject(XtreamUrlService);
    private loadedPositionsPlaylistId: string | null = null;
    private readonly warmMetadataKeys = new Set<string>();
    private readonly warmMetadataQueue: MediaMetadataWarmJob[] = [];
    private activeWarmMetadataProbes = 0;
    private backgroundWarmupTimer: ReturnType<typeof setTimeout> | null = null;
    private backgroundWarmupBuildId = 0;
    private lastBackgroundWarmupSignature = '';
    private backgroundMetadataUpdateTimer: ReturnType<
        typeof setTimeout
    > | null = null;
    private readonly pendingBackgroundMetadataUpdates = new Map<
        string,
        MediaMetadataBackgroundItemEvent
    >();
    private readonly unsubscribeBackgroundWarmup?: () => void;

    readonly provider = 'xtream' as const;
    readonly pageSizeOptions = [10, 25, 50, 100] as const;
    readonly contentType = this.xtreamStore.selectedContentType;
    readonly limit = this.xtreamStore.limit;
    readonly pageIndex = this.xtreamStore.page;
    readonly selectedCategory = this.xtreamStore.getSelectedCategory;
    readonly paginatedContent = this.xtreamStore.getPaginatedContent;
    readonly allContent = this.xtreamStore.selectItemsFromSelectedCategory;
    readonly filterExcludedContent =
        this.xtreamStore.selectFilterExcludedItemsFromSelectedCategory;
    readonly selectedItem = this.xtreamStore.selectedItem;
    readonly totalPages = this.xtreamStore.getTotalPages;
    readonly isPaginatedContentLoading =
        this.xtreamStore.isPaginatedContentLoading;
    readonly selectedCategoryTitle = computed(() => {
        const category = this.selectedCategory();
        return String(category?.['name'] ?? category?.['title'] ?? '');
    });
    readonly categoryItemCount = computed(
        () => this.xtreamStore.selectItemsFromSelectedCategory().length
    );
    readonly contentSortMode = this.xtreamStore.contentSortMode;
    readonly languageFilter = this.xtreamStore.languageFilter;
    readonly languageFilterOptions = this.xtreamStore.languageFilterOptions;
    readonly languageFilterActive = this.xtreamStore.languageFilterActive;
    readonly videoQualityFilter = this.xtreamStore.videoQualityFilter;
    readonly videoQualityFilterOptions =
        this.xtreamStore.videoQualityFilterOptions;
    readonly videoQualityFilterActive =
        this.xtreamStore.videoQualityFilterActive;
    readonly metadataFiltersReady = this.xtreamStore.metadataFiltersReady;
    readonly filterIndexProgress = this.xtreamStore.filterIndexProgress;
    readonly playlist = computed<PortalCatalogPlaylistMeta | null>(() => {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return null;
        }

        return {
            id: String(playlist.id),
            title: playlist.name ?? playlist.title ?? 'Xtream',
        };
    });

    constructor() {
        this.unsubscribeBackgroundWarmup =
            typeof window !== 'undefined'
                ? window.electron?.onMediaMetadataBackgroundEvent?.((event) =>
                      this.handleBackgroundMetadataEvent(event)
                  )
                : undefined;

        effect(() => {
            const enabled =
                this.settingsStore.backgroundMetadataWarmup?.() ?? false;
            const schedule =
                this.settingsStore.backgroundMetadataWarmupSchedule?.() ??
                'weekly';
            const concurrency =
                this.settingsStore.backgroundMetadataWarmupConcurrency?.() ??
                DEFAULT_BACKGROUND_METADATA_PROBE_CONCURRENCY;
            const playlist = this.xtreamStore.currentPlaylist();
            const liveCount = this.xtreamStore.liveStreams?.().length ?? 0;
            const vodCount = this.xtreamStore.vodStreams?.().length ?? 0;
            const seriesCount = this.xtreamStore.serialStreams?.().length ?? 0;

            if (!enabled) {
                this.cancelScheduledBackgroundWarmup();
                this.lastBackgroundWarmupSignature = '';
                return;
            }

            if (
                !playlist?.id ||
                !playlist.serverUrl ||
                !playlist.username ||
                !playlist.password
            ) {
                return;
            }

            const signature = `${playlist.id}:${liveCount}:${vodCount}:${seriesCount}:${schedule}:${concurrency}`;
            if (signature === this.lastBackgroundWarmupSignature) {
                return;
            }

            this.lastBackgroundWarmupSignature = signature;
            this.scheduleBackgroundMetadataWarmup();
        });
    }

    ngOnDestroy(): void {
        this.cancelScheduledBackgroundWarmup(false);
        if (this.backgroundMetadataUpdateTimer) {
            clearTimeout(this.backgroundMetadataUpdateTimer);
            this.backgroundMetadataUpdateTimer = null;
        }
        this.pendingBackgroundMetadataUpdates.clear();
        this.unsubscribeBackgroundWarmup?.();
    }

    initialize(categoryId?: string | null): void {
        const savedSortMode = localStorage.getItem(SORT_STORAGE_KEY);
        if (
            savedSortMode === 'date-desc' ||
            savedSortMode === 'date-asc' ||
            savedSortMode === 'name-asc' ||
            savedSortMode === 'name-desc' ||
            savedSortMode === 'rating-desc'
        ) {
            this.xtreamStore.setContentSortMode(savedSortMode);
        }

        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (playlistId && this.loadedPositionsPlaylistId !== playlistId) {
            this.loadedPositionsPlaylistId = playlistId;
            this.xtreamStore.loadAllPositions(playlistId);
        }

        this.clearSelectedItem();

        if (categoryId) {
            this.xtreamStore.setSelectedCategory(Number(categoryId));
        } else {
            this.xtreamStore.setSelectedCategory(null);
        }
    }

    clearSelectedItem(): void {
        this.xtreamStore.setSelectedItem(null);
    }

    setSearchQuery(query: string): void {
        this.xtreamStore.setCategorySearchTerm(query);
    }

    toggleLanguageFilterOption(
        section: PortalCatalogLanguageFilterSection,
        code: string,
        enabled: boolean
    ): void {
        this.xtreamStore.toggleLanguageFilterOption(section, code, enabled);
    }

    selectAllLanguageFilterOptions(
        section: PortalCatalogLanguageFilterSection
    ): void {
        this.xtreamStore.selectAllLanguageFilterOptions(section);
    }

    clearLanguageFilterOptions(
        section: PortalCatalogLanguageFilterSection
    ): void {
        this.xtreamStore.clearLanguageFilterOptions(section);
    }

    invertLanguageFilterOptions(
        section: PortalCatalogLanguageFilterSection
    ): void {
        this.xtreamStore.invertLanguageFilterOptions(section);
    }

    resetLanguageFilter(): void {
        this.xtreamStore.resetLanguageFilter();
    }

    setVideoQualityFilter(filter: PortalCatalogVideoQualityFilterValue): void {
        this.xtreamStore.setVideoQualityFilter(filter);
    }

    resetVideoQualityFilter(): void {
        this.xtreamStore.resetVideoQualityFilter();
    }

    warmVisibleMediaMetadata(items: readonly Record<string, unknown>[]): void {
        const contentType = this.contentType();
        if (contentType !== 'live' && contentType !== 'vod') {
            return;
        }

        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist?.serverUrl || !playlist.username || !playlist.password) {
            return;
        }

        const schedule = this.getBackgroundMetadataWarmupSchedule();
        const freshnessNow = Date.now();
        for (const item of items.slice(0, MAX_WARM_METADATA_ITEMS)) {
            const job = this.createMediaMetadataWarmJob(
                item,
                contentType,
                schedule,
                freshnessNow
            );
            if (!job || this.warmMetadataKeys.has(job.key)) {
                continue;
            }

            this.warmMetadataKeys.add(job.key);
            this.warmMetadataQueue.push(job);
        }

        this.drainWarmMetadataQueue();
    }

    setPage(page: number): void {
        this.xtreamStore.setPage(page);
    }

    setLimit(limit: number): void {
        this.xtreamStore.setLimit(limit);
    }

    setContentSortMode(mode: PortalCatalogSortMode): void {
        this.xtreamStore.setContentSortMode(mode);
        localStorage.setItem(SORT_STORAGE_KEY, mode);
    }

    selectItem(item: Record<string, unknown>): string[] | null {
        const isSeries = this.contentType() === 'series';
        const xtreamId = isSeries
            ? (item['series_id'] ?? item['xtream_id'] ?? item['id'])
            : (item['xtream_id'] ?? item['stream_id'] ?? item['id']);
        if (xtreamId === undefined || xtreamId === null) {
            return null;
        }

        const selectedCategoryId = this.xtreamStore.selectedCategoryId();
        if (selectedCategoryId !== null && selectedCategoryId !== undefined) {
            return [String(xtreamId)];
        }

        const categoryId = item['category_id'];
        if (categoryId === undefined || categoryId === null) {
            return null;
        }

        return [String(categoryId), String(xtreamId)];
    }

    getItemProgress(item: Record<string, unknown>): PortalCatalogItemProgress {
        const isSeries = this.contentType() === 'series';
        const itemId = Number(
            item['xtream_id'] ?? item['series_id'] ?? item['stream_id']
        );
        if (Number.isNaN(itemId)) {
            return {};
        }

        if (isSeries) {
            return {
                hasSeriesProgress: this.xtreamStore.hasSeriesProgress(itemId),
            };
        }

        return {
            progress: this.xtreamStore.getProgressPercent(itemId, 'vod'),
            isWatched: this.xtreamStore.isWatched(itemId, 'vod'),
        };
    }

    private drainWarmMetadataQueue(): void {
        while (
            this.activeWarmMetadataProbes <
                MAX_CONCURRENT_WARM_METADATA_PROBES &&
            this.warmMetadataQueue.length > 0
        ) {
            const job = this.warmMetadataQueue.shift();
            if (!job) {
                return;
            }

            this.activeWarmMetadataProbes++;
            void this.runWarmMetadataProbe(job);
        }
    }

    private async runWarmMetadataProbe(
        job: MediaMetadataWarmJob
    ): Promise<void> {
        try {
            const metadata = await this.mediaMetadataService.probe({
                url: job.url,
                headers: job.headers,
            });
            const mergedMetadata = mergeMediaStreamMetadata(
                metadata,
                job.staticMetadata
            );
            const metadataUpdatedAt = Date.now();
            this.xtreamStore.setContentMediaMetadata({
                contentType: job.contentType,
                xtreamId: job.xtreamId,
                metadata: mergedMetadata,
                metadataUpdatedAt,
            });
            void this.dbService.setXtreamContentMediaMetadata(
                job.playlistId,
                job.contentType === 'vod' ? 'movie' : 'live',
                job.xtreamId,
                mergedMetadata
            );
        } finally {
            this.activeWarmMetadataProbes = Math.max(
                0,
                this.activeWarmMetadataProbes - 1
            );
            this.drainWarmMetadataQueue();
        }
    }

    private createMediaMetadataWarmJob(
        item: Record<string, unknown>,
        contentType: 'live' | 'vod',
        schedule: BackgroundMetadataWarmupSchedule,
        freshnessNow: number
    ): MediaMetadataWarmJob | null {
        const xtreamId = this.resolveItemNumericId(item);
        if (!xtreamId) {
            return null;
        }

        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist?.id) {
            return null;
        }

        const existingMetadata = this.readRecord(
            item['mediaMetadata']
        ) as unknown as MediaStreamMetadata | null;
        const metadataDue = isMediaMetadataDueForSchedule(
            Boolean(existingMetadata),
            item['mediaMetadataUpdatedAt'],
            schedule,
            freshnessNow
        );
        const staticMetadata = this.buildStaticMediaMetadata(item);
        const currentMetadata = mergeMediaStreamMetadata(
            existingMetadata,
            staticMetadata
        );
        const needsProbe = mediaMetadataNeedsProbe(currentMetadata);
        if (!needsProbe) {
            if (!existingMetadata && currentMetadata) {
                const metadataUpdatedAt = Date.now();
                this.xtreamStore.setContentMediaMetadata({
                    contentType,
                    xtreamId,
                    metadata: currentMetadata,
                    metadataUpdatedAt,
                });
                void this.dbService.setXtreamContentMediaMetadata(
                    String(playlist.id),
                    contentType === 'vod' ? 'movie' : 'live',
                    xtreamId,
                    currentMetadata
                );
            }
            return null;
        }

        if (!metadataDue && existingMetadata) {
            return null;
        }

        const url =
            contentType === 'live'
                ? this.constructLiveProbeUrl(item, xtreamId)
                : this.constructVodProbeUrl(item, xtreamId);
        if (!url) {
            return null;
        }

        const headers = this.buildProbeHeaders();
        return {
            key: JSON.stringify({ contentType, xtreamId, url, headers }),
            playlistId: String(playlist.id),
            url,
            contentType,
            xtreamId,
            staticMetadata,
            headers,
        };
    }

    private buildStaticMediaMetadata(
        item: Record<string, unknown>
    ): MediaStreamMetadata | null {
        const info = this.readRecord(item['info']);
        const movieData = this.readRecord(item['movie_data']);
        return buildMediaStreamMetadata({
            video: item['video'] ?? info?.['video'],
            audio:
                item['audio'] ??
                item['audioLanguages'] ??
                info?.['audio'] ??
                movieData?.['audio'],
            subtitles:
                item['subtitles'] ??
                item['subtitle'] ??
                item['subtitleLanguages'] ??
                info?.['subtitles'] ??
                info?.['subtitle'] ??
                movieData?.['subtitles'],
            title: [
                item['title'],
                item['name'],
                item['o_name'],
                item['original_name'],
                movieData?.['name'],
                info?.['name'],
            ]
                .filter((value): value is string => typeof value === 'string')
                .join(' '),
            containerExtension:
                this.readString(item['container_extension']) ??
                this.readString(movieData?.['container_extension']) ??
                this.readString(info?.['container_extension']),
        });
    }

    private constructLiveProbeUrl(
        item: Record<string, unknown>,
        xtreamId: number
    ): string {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return '';
        }

        return this.urlService.constructLiveUrl(
            playlist,
            xtreamId,
            undefined,
            item as { xtream_id: number; direct_source?: string | null }
        );
    }

    private constructVodProbeUrl(
        item: Record<string, unknown>,
        xtreamId: number
    ): string {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return '';
        }

        const movieData = this.readRecord(item['movie_data']);
        const extension =
            this.readString(item['container_extension']) ??
            this.readString(movieData?.['container_extension']) ??
            'mp4';
        const vodItem = {
            stream_id: xtreamId,
            direct_source: this.readString(item['direct_source']),
            movie_data: {
                stream_id: xtreamId,
                container_extension: extension,
                direct_source:
                    this.readString(movieData?.['direct_source']) ??
                    this.readString(item['direct_source']),
            },
        } as unknown as XtreamVodDetails;

        return this.urlService.constructVodUrl(playlist, vodItem);
    }

    private buildProbeHeaders(): Record<string, string> {
        const playlist = this.xtreamStore.currentPlaylist();
        const headers: Record<string, string> = {};

        if (playlist?.userAgent) {
            headers['User-Agent'] = playlist.userAgent;
        }
        if (playlist?.referrer) {
            headers.Referer = playlist.referrer;
        }
        if (playlist?.origin) {
            headers.Origin = playlist.origin;
        }

        return headers;
    }

    private resolveItemNumericId(item: Record<string, unknown>): number | null {
        const candidate =
            item['xtream_id'] ??
            item['stream_id'] ??
            item['series_id'] ??
            item['id'];
        const numeric = Number(candidate);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    }

    private scheduleBackgroundMetadataWarmup(): void {
        this.cancelScheduledBackgroundWarmup(false);
        this.backgroundWarmupTimer = setTimeout(() => {
            this.backgroundWarmupTimer = null;
            void this.startBackgroundMetadataWarmup();
        }, BACKGROUND_METADATA_WARMUP_DEBOUNCE_MS);
    }

    private cancelScheduledBackgroundWarmup(cancelBackend = true): void {
        this.backgroundWarmupBuildId++;
        if (this.backgroundWarmupTimer) {
            clearTimeout(this.backgroundWarmupTimer);
            this.backgroundWarmupTimer = null;
        }

        if (cancelBackend) {
            void window.electron?.cancelMediaMetadataBackgroundWarmup?.();
        }
    }

    private async startBackgroundMetadataWarmup(): Promise<void> {
        if (!(this.settingsStore.backgroundMetadataWarmup?.() ?? false)) {
            return;
        }

        const playlist = this.xtreamStore.currentPlaylist();
        if (
            !playlist?.id ||
            !playlist.serverUrl ||
            !playlist.username ||
            !playlist.password ||
            !window.electron?.startMediaMetadataBackgroundWarmup
        ) {
            return;
        }

        const schedule = this.getBackgroundMetadataWarmupSchedule();
        if (await this.hasActiveBackgroundMetadataWarmup()) {
            return;
        }

        const buildId = ++this.backgroundWarmupBuildId;
        const freshnessNow = Date.now();
        const jobs: MediaMetadataBackgroundWarmJob[] = [];
        const seriesItems = this.xtreamStore.serialStreams?.() ?? [];

        await this.collectBackgroundMetadataJobs(
            buildId,
            jobs,
            this.xtreamStore.liveStreams?.() ?? [],
            'live',
            schedule,
            freshnessNow
        );
        await this.collectBackgroundMetadataJobs(
            buildId,
            jobs,
            this.xtreamStore.vodStreams?.() ?? [],
            'vod',
            schedule,
            freshnessNow
        );

        if (buildId !== this.backgroundWarmupBuildId) {
            return;
        }

        await this.flushBackgroundMetadataJobs(buildId, jobs);
        if (buildId !== this.backgroundWarmupBuildId) {
            return;
        }

        await this.flushBackgroundSeriesDiscoveryJobs(
            buildId,
            seriesItems,
            schedule,
            freshnessNow
        );
        if (buildId === this.backgroundWarmupBuildId) {
            await this.markBackgroundMetadataWarmupStarted(String(playlist.id));
        }
    }

    private getCurrentSourceVpnContext(): SourceVpnRequestContext | undefined {
        const playlist = this.readRecord(this.xtreamStore.currentPlaylist());
        if (
            !playlist ||
            this.readString(playlist['vpnProvider'])?.toLowerCase() !==
                'proton'
        ) {
            return undefined;
        }

        const location = this.readString(playlist['vpnLocation']);
        const sourceId =
            this.readString(playlist['id']) ?? this.readString(playlist['_id']);
        const sourceTitle =
            this.readString(playlist['title']) ??
            this.readString(playlist['name']);
        return {
            provider: 'proton',
            ...(location ? { location } : {}),
            ...(sourceId ? { sourceId } : {}),
            ...(sourceTitle ? { sourceTitle } : {}),
        };
    }

    private async collectBackgroundMetadataJobs(
        buildId: number,
        output: MediaMetadataBackgroundWarmJob[],
        items: readonly unknown[],
        contentType: 'live' | 'vod',
        schedule: BackgroundMetadataWarmupSchedule,
        freshnessNow: number
    ): Promise<void> {
        const sourceVpn = this.getCurrentSourceVpnContext();
        for (let index = 0; index < items.length; index++) {
            if (buildId !== this.backgroundWarmupBuildId) {
                return;
            }

            const item = this.readRecord(items[index]);
            const job = item
                ? this.createMediaMetadataWarmJob(
                      item,
                      contentType,
                      schedule,
                      freshnessNow
                  )
                : null;
            if (job) {
                output.push({
                    playlistId: job.playlistId,
                    contentType: contentType === 'vod' ? 'movie' : 'live',
                    xtreamId: job.xtreamId,
                    url: job.url,
                    headers: job.headers,
                    staticMetadata: job.staticMetadata,
                    sourceVpn,
                });
            }

            if (output.length >= BACKGROUND_METADATA_JOB_BUILD_CHUNK_SIZE) {
                await this.flushBackgroundMetadataJobs(buildId, output);
            }

            if (
                index > 0 &&
                index % BACKGROUND_METADATA_JOB_BUILD_CHUNK_SIZE === 0
            ) {
                await this.waitForBackgroundBuildYield();
            }
        }
    }

    private async flushBackgroundSeriesDiscoveryJobs(
        buildId: number,
        items: readonly unknown[],
        schedule: BackgroundMetadataWarmupSchedule,
        freshnessNow: number
    ): Promise<void> {
        const playlist = this.xtreamStore.currentPlaylist();
        if (
            !playlist?.id ||
            !playlist.serverUrl ||
            !playlist.username ||
            !playlist.password
        ) {
            return;
        }

        const headers = this.buildProbeHeaders();
        const sourceVpn = this.getCurrentSourceVpnContext();
        const seriesDiscoveryJobs: MediaMetadataBackgroundSeriesDiscoveryJob[] =
            [];

        for (let index = 0; index < items.length; index++) {
            if (buildId !== this.backgroundWarmupBuildId) {
                return;
            }

            const item = this.readRecord(items[index]);
            const seriesXtreamId = item
                ? this.resolveItemNumericId(item)
                : null;
            const existingMetadata = item
                ? (this.readRecord(
                      item['mediaMetadata']
                  ) as unknown as MediaStreamMetadata | null)
                : null;
            const metadataDue = item
                ? isMediaMetadataDueForSchedule(
                      Boolean(existingMetadata),
                      item['mediaMetadataUpdatedAt'],
                      schedule,
                      freshnessNow
                  )
                : false;
            const needsProbe = mediaMetadataNeedsProbe(existingMetadata);
            if (
                typeof seriesXtreamId === 'number' &&
                metadataDue &&
                needsProbe
            ) {
                seriesDiscoveryJobs.push({
                    playlistId: String(playlist.id),
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                    seriesXtreamId,
                    headers,
                    sourceVpn,
                });
            }

            if (
                seriesDiscoveryJobs.length >=
                BACKGROUND_METADATA_JOB_BUILD_CHUNK_SIZE
            ) {
                await this.flushBackgroundSeriesDiscoveryJobBatch(
                    buildId,
                    seriesDiscoveryJobs
                );
            }

            if (
                index > 0 &&
                index % BACKGROUND_METADATA_JOB_BUILD_CHUNK_SIZE === 0
            ) {
                await this.waitForBackgroundBuildYield();
            }
        }

        await this.flushBackgroundSeriesDiscoveryJobBatch(
            buildId,
            seriesDiscoveryJobs
        );
    }

    private async flushBackgroundSeriesDiscoveryJobBatch(
        buildId: number,
        seriesDiscoveryJobs: MediaMetadataBackgroundSeriesDiscoveryJob[]
    ): Promise<void> {
        if (
            buildId !== this.backgroundWarmupBuildId ||
            seriesDiscoveryJobs.length === 0 ||
            !window.electron?.startMediaMetadataBackgroundWarmup
        ) {
            return;
        }

        const batch = seriesDiscoveryJobs.splice(0, seriesDiscoveryJobs.length);
        await window.electron
            .startMediaMetadataBackgroundWarmup({
                jobs: [],
                seriesDiscoveryJobs: batch,
                runAfterWindowClose: true,
                concurrency: this.getBackgroundMetadataWarmupConcurrency(),
            })
            .then((status) => {
                if (
                    buildId === this.backgroundWarmupBuildId &&
                    this.isBackgroundMetadataWarmupRunning(status)
                ) {
                    this.backgroundWarmupBuildId++;
                }
            })
            .catch((error) => {
                console.warn(
                    'Failed to start background series metadata discovery.',
                    error
                );
            });
    }

    private async flushBackgroundMetadataJobs(
        buildId: number,
        jobs: MediaMetadataBackgroundWarmJob[]
    ): Promise<void> {
        if (
            buildId !== this.backgroundWarmupBuildId ||
            jobs.length === 0 ||
            !window.electron?.startMediaMetadataBackgroundWarmup
        ) {
            return;
        }

        const batch = jobs.splice(0, jobs.length);
        await window.electron
            .startMediaMetadataBackgroundWarmup({
                jobs: batch,
                runAfterWindowClose: true,
                concurrency: this.getBackgroundMetadataWarmupConcurrency(),
            })
            .then((status) => {
                if (
                    buildId === this.backgroundWarmupBuildId &&
                    this.isBackgroundMetadataWarmupRunning(status)
                ) {
                    this.backgroundWarmupBuildId++;
                }
            })
            .catch((error) => {
                console.warn(
                    'Failed to start background media metadata warmup.',
                    error
                );
            });
    }

    private waitForBackgroundBuildYield(): Promise<void> {
        return new Promise((resolve) =>
            setTimeout(resolve, BACKGROUND_METADATA_JOB_BUILD_IDLE_DELAY_MS)
        );
    }

    private getBackgroundMetadataWarmupSchedule(): BackgroundMetadataWarmupSchedule {
        return (
            this.settingsStore.backgroundMetadataWarmupSchedule?.() ??
            'weekly'
        );
    }

    private getBackgroundMetadataWarmupConcurrency(): number {
        const value =
            this.settingsStore.backgroundMetadataWarmupConcurrency?.() ??
            DEFAULT_BACKGROUND_METADATA_PROBE_CONCURRENCY;
        const numeric = Number(value);
        return Number.isFinite(numeric)
            ? Math.max(1, Math.min(8, Math.floor(numeric)))
            : DEFAULT_BACKGROUND_METADATA_PROBE_CONCURRENCY;
    }

    private async hasActiveBackgroundMetadataWarmup(): Promise<boolean> {
        const status = await window.electron
            ?.getMediaMetadataBackgroundStatus?.()
            .catch(() => null);
        return this.isBackgroundMetadataWarmupRunning(status);
    }

    private isBackgroundMetadataWarmupRunning(status: unknown): boolean {
        const candidate = status as
            | { pendingItems?: unknown; running?: unknown }
            | null
            | undefined;
        return Boolean(
            candidate?.running && Number(candidate.pendingItems ?? 0) > 0
        );
    }

    private async markBackgroundMetadataWarmupStarted(
        playlistId: string
    ): Promise<void> {
        const schedule = this.getBackgroundMetadataWarmupSchedule();
        if (schedule === 'every-opening') {
            return;
        }

        const dbWithState = this.dbService as DatabaseService & {
            setAppState?: (key: string, value: string) => Promise<boolean>;
        };
        if (typeof dbWithState.setAppState !== 'function') {
            return;
        }

        await dbWithState.setAppState(
            this.buildBackgroundWarmupLastRunKey(playlistId),
            String(Date.now())
        );
    }

    private buildBackgroundWarmupLastRunKey(playlistId: string): string {
        return `${BACKGROUND_METADATA_LAST_RUN_KEY_PREFIX}:${playlistId}`;
    }

    private handleBackgroundMetadataEvent(event: unknown): void {
        if (!this.isBackgroundItemEvent(event)) {
            return;
        }

        const playlistId = String(this.xtreamStore.currentPlaylist()?.id ?? '');
        if (event.playlistId !== playlistId) {
            return;
        }

        if (event.contentType === 'episode') {
            return;
        }

        this.pendingBackgroundMetadataUpdates.set(
            `${event.contentType}:${event.xtreamId}`,
            event
        );
        this.scheduleBackgroundMetadataUpdateFlush();
    }

    private scheduleBackgroundMetadataUpdateFlush(): void {
        if (this.backgroundMetadataUpdateTimer) {
            return;
        }

        this.backgroundMetadataUpdateTimer = setTimeout(() => {
            this.backgroundMetadataUpdateTimer = null;
            this.flushBackgroundMetadataUpdates();
        }, BACKGROUND_METADATA_UI_UPDATE_DELAY_MS);
    }

    private flushBackgroundMetadataUpdates(): void {
        const startedAt =
            typeof performance !== 'undefined' ? performance.now() : Date.now();
        let processed = 0;

        for (const [key, event] of this.pendingBackgroundMetadataUpdates) {
            this.pendingBackgroundMetadataUpdates.delete(key);
            this.xtreamStore.setContentMediaMetadata({
                contentType:
                    event.contentType === 'movie'
                        ? 'vod'
                        : event.contentType === 'series'
                          ? 'series'
                          : 'live',
                xtreamId: event.xtreamId,
                metadata: event.metadata,
                metadataUpdatedAt: Date.now(),
            });
            processed++;

            const elapsed =
                (typeof performance !== 'undefined'
                    ? performance.now()
                    : Date.now()) - startedAt;
            if (
                processed >= BACKGROUND_METADATA_UI_UPDATE_BATCH_SIZE ||
                elapsed >= BACKGROUND_METADATA_UI_UPDATE_BUDGET_MS
            ) {
                break;
            }
        }

        if (this.pendingBackgroundMetadataUpdates.size > 0) {
            this.scheduleBackgroundMetadataUpdateFlush();
        }
    }

    private isBackgroundItemEvent(
        event: unknown
    ): event is MediaMetadataBackgroundItemEvent {
        const candidate = event as MediaMetadataBackgroundItemEvent;
        return Boolean(
            candidate &&
            typeof candidate === 'object' &&
            candidate.type === 'item' &&
            typeof candidate.playlistId === 'string' &&
            (candidate.contentType === 'live' ||
                candidate.contentType === 'movie' ||
                candidate.contentType === 'series' ||
                candidate.contentType === 'episode') &&
            Number.isFinite(Number(candidate.xtreamId)) &&
            Boolean(candidate.metadata)
        );
    }

    private readRecord(value: unknown): Record<string, unknown> | null {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    }

    private readString(value: unknown): string | null {
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }
}

export function provideXtreamCatalogFacade(): Provider[] {
    return [
        XtreamCatalogFacadeService,
        {
            provide: PORTAL_CATALOG_FACADE,
            useExisting: XtreamCatalogFacadeService,
        },
    ];
}
