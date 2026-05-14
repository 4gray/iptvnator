import { Provider, Injectable, computed, inject } from '@angular/core';
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
import { MediaMetadataService } from 'services';
import { MediaStreamMetadata, XtreamVodDetails } from 'shared-interfaces';
import { XtreamUrlService } from '@iptvnator/portal/xtream/data-access';

const SORT_STORAGE_KEY = 'xtream-category-sort-mode';
const MAX_WARM_METADATA_ITEMS = 12;
const MAX_CONCURRENT_WARM_METADATA_PROBES = 2;

interface MediaMetadataWarmJob {
    key: string;
    url: string;
    contentType: 'live' | 'vod';
    xtreamId: number;
    staticMetadata: MediaStreamMetadata | null;
    headers: Record<string, string>;
}

@Injectable()
export class XtreamCatalogFacadeService implements PortalCatalogFacade<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
> {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly mediaMetadataService = inject(MediaMetadataService);
    private readonly urlService = inject(XtreamUrlService);
    private loadedPositionsPlaylistId: string | null = null;
    private readonly warmMetadataKeys = new Set<string>();
    private readonly warmMetadataQueue: MediaMetadataWarmJob[] = [];
    private activeWarmMetadataProbes = 0;

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

        for (const item of items.slice(0, MAX_WARM_METADATA_ITEMS)) {
            const job = this.createMediaMetadataWarmJob(item, contentType);
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
            this.xtreamStore.setContentMediaMetadata({
                contentType: job.contentType,
                xtreamId: job.xtreamId,
                metadata: mergeMediaStreamMetadata(
                    metadata,
                    job.staticMetadata
                ),
            });
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
        contentType: 'live' | 'vod'
    ): MediaMetadataWarmJob | null {
        const xtreamId = this.resolveItemNumericId(item);
        if (!xtreamId) {
            return null;
        }

        const staticMetadata = this.buildStaticMediaMetadata(item);
        const currentMetadata = mergeMediaStreamMetadata(
            this.readRecord(
                item['mediaMetadata']
            ) as unknown as MediaStreamMetadata | null,
            staticMetadata
        );
        if (!mediaMetadataNeedsProbe(currentMetadata)) {
            if (currentMetadata) {
                this.xtreamStore.setContentMediaMetadata({
                    contentType,
                    xtreamId,
                    metadata: currentMetadata,
                });
            }
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
