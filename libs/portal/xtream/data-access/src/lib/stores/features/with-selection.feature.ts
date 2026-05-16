import { computed, effect, inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withHooks,
    withMethods,
    withState,
} from '@ngrx/signals';
import { ContentType, XtreamContentLoadState } from '../../xtream-state';
import {
    groupXtreamSeriesDuplicates,
    groupXtreamVodDuplicates,
    matchesXtreamSeriesSearchTerm,
    matchesXtreamVodSearchTerm,
} from '../../utils/vod-duplicates.util';
import {
    EMPTY_XTREAM_LANGUAGE_FILTER,
    getXtreamLanguageOptionsFromCodes,
    getXtreamItemLanguageMetadata,
    isXtreamLanguageFilterActive,
    matchesXtreamLanguageFilter,
    XtreamLanguageFilterCandidate,
    XtreamLanguageFilterSection,
    XtreamLanguageFilterState,
} from '../../utils/language-filter.util';
import {
    getXtreamItemVideoQualityBuckets,
    getXtreamVideoQualityLabel,
    getXtreamVideoQualityOptions,
    getXtreamVideoQualityOptionsFromCounts,
    isXtreamVideoQualityFilterActive,
    matchesXtreamVideoQualityFilter,
    XtreamVideoQualityBucket,
    XtreamVideoQualityFilterCandidate,
    XtreamVideoQualityOption,
    XtreamVideoQualityFilterValue,
} from '../../utils/video-quality-filter.util';
import { SettingsStore } from 'services';

/**
 * Module-level collator — allocating Intl.Collator is expensive;
 * one shared instance avoids repeated allocation on every sort call.
 */
const COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

const FILTER_INDEX_CHUNK_ITEM_LIMIT = 20;
const FILTER_INDEX_CHUNK_BUDGET_MS = 3;
const FILTER_INDEX_IDLE_DELAY_MS = 120;
const FILTER_INDEX_PUBLISH_INTERVAL_MS = 750;
const FILTER_INDEX_REFRESH_DEBOUNCE_MS = 250;
const FILTER_INDEX_SYNC_FALLBACK_ITEM_LIMIT = 500;
const FILTER_INDEX_CACHE_STORAGE_KEY = 'xtream-filter-index-cache-v1';
const FILTER_INDEX_CACHE_MAX_ENTRIES = 8;

export type XtreamCategorySortMode =
    | 'date-desc'
    | 'date-asc'
    | 'name-asc'
    | 'name-desc'
    | 'rating-desc';

/**
 * Selection state for managing UI selection and pagination
 */
export interface SelectionState {
    selectedContentType: ContentType;
    selectedCategoryId: number | null;
    selectedItem: XtreamSelectionItem | null;
    page: number;
    limit: number;
    contentSortMode: XtreamCategorySortMode;
    categorySearchTerm: string;
    languageFilter: XtreamLanguageFilterState;
    videoQualityFilter: XtreamVideoQualityFilterValue;
    filterIndex: XtreamFilterIndexState;
    isLoadingDetails: boolean;
    detailsError: string | null;
}

export interface XtreamFilterIndexProgress {
    status: 'idle' | 'running' | 'ready';
    processedItems: number;
    totalItems: number;
    percent: number;
    updatedAt: number;
}

interface XtreamFilterIndexState {
    contentSignature: string;
    status: XtreamFilterIndexProgress['status'];
    processedItems: number;
    totalItems: number;
    updatedAt: number;
    languageCodes: string[];
    videoQualityOptions: Record<'vod' | 'series', XtreamVideoQualityOption[]>;
    videoQualityOptionsByCategory: Record<
        'vod' | 'series',
        Record<string, XtreamVideoQualityOption[]>
    >;
}

interface FilterIndexAccumulator {
    languageCodes: Set<string>;
    videoQualityCounts: Record<
        'vod' | 'series',
        Map<XtreamVideoQualityBucket, number>
    >;
    videoQualityCountsByCategory: Record<
        'vod' | 'series',
        Map<string, Map<XtreamVideoQualityBucket, number>>
    >;
}

/**
 * Initial selection state
 */
const initialSelectionState: SelectionState = {
    selectedContentType: 'vod',
    selectedCategoryId: null,
    selectedItem: null,
    page: 0,
    limit: Number(localStorage.getItem('xtream-page-size') ?? 25),
    contentSortMode: 'date-desc',
    categorySearchTerm: '',
    languageFilter: EMPTY_XTREAM_LANGUAGE_FILTER,
    videoQualityFilter: 'all',
    filterIndex: createEmptyFilterIndexState(),
    isLoadingDetails: false,
    detailsError: null,
};

interface XtreamSelectionCategory {
    readonly [key: string]: unknown;
    readonly category_name?: string;
    readonly category_id?: string | number;
    readonly id?: string | number;
    readonly name?: string;
    readonly type?: ContentType;
}

interface XtreamSelectionItem {
    readonly [key: string]: unknown;
    readonly added?: string;
    readonly category_id?: string | number;
    readonly duplicateGroupKey?: string;
    readonly episodes?: unknown;
    readonly id?: string | number;
    readonly imdbRating?: number | string;
    readonly imdb_id?: string;
    readonly imdbMatchedTitle?: string;
    readonly imdbMatchedYear?: string | number;
    readonly info?:
        | {
              readonly actors?: string;
              readonly backdrop_path?: string[];
              readonly cast?: string;
              readonly country?: string;
              readonly cover?: string;
              readonly description?: string;
              readonly director?: string;
              readonly duration?: string;
              readonly episode_run_time?: number | string;
              readonly genre?: string;
              readonly movie_image?: string;
              readonly name?: string;
              readonly plot?: string;
              readonly rating?: number | string;
              readonly rating_imdb?: string;
              readonly rating_kinopoisk?: string;
              readonly releaseDate?: string;
              readonly releasedate?: string;
              readonly tmdb_id?: string | number;
              readonly tvdb_id?: string | number;
              readonly youtube_trailer?: string;
          }
        | []
        | null;
    readonly last_modified?: string;
    readonly movie_data?: {
        readonly container_extension?: string;
        readonly name?: string;
        readonly stream_id?: string | number;
        readonly title?: string;
        readonly tmdb_id?: string | number;
        readonly tvdb_id?: string | number;
    };
    readonly name?: string;
    readonly rating?: number | string;
    readonly rating_5based?: number | string;
    readonly rating_imdb?: string;
    readonly rating_kinopoisk?: string;
    readonly series_id?: string | number;
    readonly stream_id?: string | number;
    readonly title?: string;
    readonly tmdb_id?: string | number;
    readonly tvdb_id?: string | number;
    readonly xtream_id?: string | number;
    readonly year?: string | number;
}

type ParentSelectionStoreLike = {
    contentLoadStateByType?: () => Record<ContentType, XtreamContentLoadState>;
    isLoadingContent?: () => boolean;
    liveCategories?: () => XtreamSelectionCategory[];
    liveStreams?: () => XtreamSelectionItem[];
    serialCategories?: () => XtreamSelectionCategory[];
    serialStreams?: () => XtreamSelectionItem[];
    vodCategories?: () => XtreamSelectionCategory[];
    vodStreams?: () => XtreamSelectionItem[];
};

function createEmptyFilterIndexState(): XtreamFilterIndexState {
    return {
        contentSignature: '',
        status: 'idle',
        processedItems: 0,
        totalItems: 0,
        updatedAt: 0,
        languageCodes: [],
        videoQualityOptions: {
            vod: [],
            series: [],
        },
        videoQualityOptionsByCategory: {
            vod: {},
            series: {},
        },
    };
}

function getFilterIndexCacheStorage(): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

function isCacheableFilterIndexState(
    value: unknown
): value is XtreamFilterIndexState {
    const candidate = value as XtreamFilterIndexState | null | undefined;
    const processedItems = Number(candidate?.processedItems);
    const totalItems = Number(candidate?.totalItems);

    return Boolean(
        candidate &&
        typeof candidate.contentSignature === 'string' &&
        candidate.contentSignature.length > 0 &&
        (candidate.status === 'ready' || candidate.status === 'running') &&
        Number.isFinite(processedItems) &&
        Number.isFinite(totalItems) &&
        processedItems >= 0 &&
        totalItems >= 0 &&
        processedItems <= totalItems &&
        (candidate.status !== 'ready' || processedItems >= totalItems) &&
        Array.isArray(candidate.languageCodes) &&
        candidate.videoQualityOptions &&
        candidate.videoQualityOptionsByCategory
    );
}

function readFilterIndexCache(): Record<string, XtreamFilterIndexState> {
    const storage = getFilterIndexCacheStorage();
    if (!storage) {
        return {};
    }

    try {
        const parsed = JSON.parse(
            storage.getItem(FILTER_INDEX_CACHE_STORAGE_KEY) ?? '{}'
        ) as Record<string, unknown>;
        const cache: Record<string, XtreamFilterIndexState> = {};
        for (const [signature, value] of Object.entries(parsed)) {
            if (
                isCacheableFilterIndexState(value) &&
                value.contentSignature === signature
            ) {
                cache[signature] = value;
            }
        }
        return cache;
    } catch {
        return {};
    }
}

function getCachedFilterIndexState(
    contentSignature: string
): XtreamFilterIndexState | null {
    const cached = readFilterIndexCache()[contentSignature];
    return cached &&
        isCacheableFilterIndexState(cached) &&
        cached.contentSignature === contentSignature
        ? cached
        : null;
}

function writeFilterIndexCache(index: XtreamFilterIndexState): void {
    if (!isCacheableFilterIndexState(index)) {
        return;
    }

    const storage = getFilterIndexCacheStorage();
    if (!storage) {
        return;
    }

    try {
        const cache = readFilterIndexCache();
        cache[index.contentSignature] = index;
        const prunedEntries = Object.entries(cache)
            .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
            .slice(0, FILTER_INDEX_CACHE_MAX_ENTRIES);
        const prunedCache = prunedEntries.reduce<
            Record<string, XtreamFilterIndexState>
        >((result, [signature, value]) => {
            result[signature] = value;
            return result;
        }, {});
        storage.setItem(
            FILTER_INDEX_CACHE_STORAGE_KEY,
            JSON.stringify(prunedCache)
        );
    } catch {
        // Cache misses are cheap; ignore quota/private-mode failures.
    }
}

function createFilterIndexAccumulator(): FilterIndexAccumulator {
    return {
        languageCodes: new Set<string>(),
        videoQualityCounts: {
            vod: new Map<XtreamVideoQualityBucket, number>(),
            series: new Map<XtreamVideoQualityBucket, number>(),
        },
        videoQualityCountsByCategory: {
            vod: new Map<string, Map<XtreamVideoQualityBucket, number>>(),
            series: new Map<string, Map<XtreamVideoQualityBucket, number>>(),
        },
    };
}

function hydrateQualityCounts(
    options: readonly XtreamVideoQualityOption[] | undefined
): Map<XtreamVideoQualityBucket, number> {
    const counts = new Map<XtreamVideoQualityBucket, number>();
    for (const option of options ?? []) {
        const count = Number(option.count);
        if (Number.isFinite(count) && count > 0) {
            counts.set(option.value, count);
        }
    }
    return counts;
}

function hydrateCategoryQualityCounts(
    optionsByCategory:
        | Record<string, readonly XtreamVideoQualityOption[]>
        | undefined
): Map<string, Map<XtreamVideoQualityBucket, number>> {
    const countsByCategory = new Map<
        string,
        Map<XtreamVideoQualityBucket, number>
    >();
    for (const [categoryId, options] of Object.entries(
        optionsByCategory ?? {}
    )) {
        countsByCategory.set(categoryId, hydrateQualityCounts(options));
    }
    return countsByCategory;
}

function createFilterIndexAccumulatorFromState(
    index: XtreamFilterIndexState
): FilterIndexAccumulator {
    return {
        languageCodes: new Set(index.languageCodes),
        videoQualityCounts: {
            vod: hydrateQualityCounts(index.videoQualityOptions.vod),
            series: hydrateQualityCounts(index.videoQualityOptions.series),
        },
        videoQualityCountsByCategory: {
            vod: hydrateCategoryQualityCounts(
                index.videoQualityOptionsByCategory.vod
            ),
            series: hydrateCategoryQualityCounts(
                index.videoQualityOptionsByCategory.series
            ),
        },
    };
}

function createOptionsByCategory(
    countsByCategory: Map<string, Map<XtreamVideoQualityBucket, number>>
): Record<string, XtreamVideoQualityOption[]> {
    const result: Record<string, XtreamVideoQualityOption[]> = {};
    for (const [categoryId, counts] of countsByCategory.entries()) {
        result[categoryId] = getXtreamVideoQualityOptionsFromCounts(counts);
    }

    return result;
}

function incrementQualityCounts(
    target: Map<XtreamVideoQualityBucket, number>,
    buckets: readonly XtreamVideoQualityBucket[]
): void {
    for (const bucket of buckets) {
        target.set(bucket, (target.get(bucket) ?? 0) + 1);
    }
}

function getCategoryBucketCounts(
    target: Map<string, Map<XtreamVideoQualityBucket, number>>,
    categoryId: unknown
): Map<XtreamVideoQualityBucket, number> | null {
    const key = String(categoryId ?? '').trim();
    if (!key) {
        return null;
    }

    const existing = target.get(key);
    if (existing) {
        return existing;
    }

    const counts = new Map<XtreamVideoQualityBucket, number>();
    target.set(key, counts);
    return counts;
}

function snapshotFilterIndexState(
    accumulator: FilterIndexAccumulator,
    contentSignature: string,
    status: XtreamFilterIndexProgress['status'],
    processedItems: number,
    totalItems: number
): XtreamFilterIndexState {
    return {
        contentSignature,
        status,
        processedItems,
        totalItems,
        updatedAt: Date.now(),
        languageCodes: [...accumulator.languageCodes].sort(),
        videoQualityOptions: {
            vod: getXtreamVideoQualityOptionsFromCounts(
                accumulator.videoQualityCounts.vod
            ),
            series: getXtreamVideoQualityOptionsFromCounts(
                accumulator.videoQualityCounts.series
            ),
        },
        videoQualityOptionsByCategory: {
            vod: createOptionsByCategory(
                accumulator.videoQualityCountsByCategory.vod
            ),
            series: createOptionsByCategory(
                accumulator.videoQualityCountsByCategory.series
            ),
        },
    };
}

function createFilterIndexContentSignature(
    liveStreams: readonly XtreamSelectionItem[],
    vodStreams: readonly XtreamSelectionItem[],
    serialStreams: readonly XtreamSelectionItem[]
): string {
    return [
        createStreamListSignature(liveStreams),
        createStreamListSignature(vodStreams),
        createStreamListSignature(serialStreams),
    ].join('|');
}

function appendSignatureHash(hash: number, value: unknown): number {
    const text = String(value ?? '');
    let nextHash = hash;
    for (let index = 0; index < text.length; index++) {
        nextHash = (nextHash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return nextHash;
}

function appendSignatureValues(
    hash: number,
    values: readonly unknown[]
): number {
    let nextHash = hash;
    for (const value of values) {
        nextHash = appendSignatureHash(nextHash, value);
    }
    return nextHash;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function appendMediaMetadataSignature(
    hash: number,
    item: XtreamSelectionItem
): number {
    const metadata = readRecord(item['mediaMetadata']);
    if (!metadata) {
        return appendSignatureHash(hash, '');
    }

    return appendSignatureValues(hash, [
        metadata['available'],
        metadata['qualityLabel'],
        metadata['qualityLabels'],
        metadata['height'],
        metadata['heights'],
        metadata['width'],
        metadata['widths'],
        metadata['videoCodec'],
        metadata['videoCodecs'],
        metadata['audioLanguages'],
        metadata['audioCodecs'],
        metadata['subtitleLanguages'],
        metadata['subtitleCodecs'],
        metadata['source'],
        metadata['reason'],
    ]);
}

function createStreamListSignature(
    items: readonly XtreamSelectionItem[]
): string {
    const sample = [
        ...items.slice(0, 3),
        ...items.slice(Math.max(0, items.length - 3)),
    ]
        .map((item) =>
            String(
                item.xtream_id ??
                    item.stream_id ??
                    item.series_id ??
                    item.id ??
                    item.title ??
                    ''
            )
        )
        .join(',');
    const metadataCount = items.reduce(
        (count, item) => count + (item['mediaMetadata'] ? 1 : 0),
        0
    );
    const metadataHash = items.reduce(
        (hash, item) => appendMediaMetadataSignature(hash, item),
        0
    );
    const itemHash = items.reduce(
        (hash, item) =>
            appendSignatureHash(
                hash,
                item.xtream_id ??
                    item.stream_id ??
                    item.series_id ??
                    item.id ??
                    item.title ??
                    ''
            ),
        0
    );

    return `${items.length}:${metadataCount}:${metadataHash}:${itemHash}:${sample}`;
}

function getFilterIndexContentSignatureFromStore(
    store: ParentSelectionStoreLike
): string {
    return createFilterIndexContentSignature(
        store.liveStreams?.() ?? [],
        store.vodStreams?.() ?? [],
        store.serialStreams?.() ?? []
    );
}

function isFilterIndexReadyForSignature(
    index: XtreamFilterIndexState,
    contentSignature: string
): boolean {
    return (
        index.status === 'ready' &&
        index.contentSignature === contentSignature &&
        index.processedItems >= index.totalItems
    );
}

function getTotalFilterIndexItemCount(store: ParentSelectionStoreLike): number {
    return (
        (store.liveStreams?.().length ?? 0) +
        (store.vodStreams?.().length ?? 0) +
        (store.serialStreams?.().length ?? 0)
    );
}

function getFilterIndexEntriesFromStore(store: ParentSelectionStoreLike): {
    contentSignature: string;
    items: Array<{ type: ContentType; item: XtreamSelectionItem }>;
} {
    const liveStreams = store.liveStreams?.() ?? [];
    const vodStreams = store.vodStreams?.() ?? [];
    const serialStreams = store.serialStreams?.() ?? [];

    return {
        contentSignature: createFilterIndexContentSignature(
            liveStreams,
            vodStreams,
            serialStreams
        ),
        items: [
            ...liveStreams.map((item) => ({
                type: 'live' as ContentType,
                item,
            })),
            ...vodStreams.map((item) => ({
                type: 'vod' as ContentType,
                item,
            })),
            ...serialStreams.map((item) => ({
                type: 'series' as ContentType,
                item,
            })),
        ],
    };
}

/**
 * Selection feature store for managing UI selection and pagination.
 * Handles:
 * - Content type selection (live, vod, series)
 * - Category selection
 * - Item selection
 * - Pagination (page, limit)
 */
export function withSelection() {
    return signalStoreFeature(
        withState<SelectionState>(initialSelectionState),

        withComputed((store) => {
            const settingsStore = inject(SettingsStore, { optional: true });
            const getAppLanguage = (): string =>
                String(settingsStore?.language?.() ?? 'en');
            const getItemDate = (
                item: XtreamSelectionItem,
                categoryType: ContentType
            ): number => {
                const value =
                    categoryType === 'series'
                        ? (item.last_modified ?? item.added)
                        : item.added;
                return parseInt(value ?? '', 10) || 0;
            };

            const parseRating = (value: unknown): number | null => {
                if (typeof value === 'number') {
                    return Number.isFinite(value) ? value : null;
                }

                if (typeof value !== 'string') {
                    return null;
                }

                const normalized = value.trim().replace(',', '.');
                if (!normalized) {
                    return null;
                }

                const match = normalized.match(/\d+(?:\.\d+)?/);
                if (!match) {
                    return null;
                }

                const rating = Number.parseFloat(match[0]);
                return Number.isFinite(rating) ? rating : null;
            };

            const getItemRating = (
                item: XtreamSelectionItem
            ): number | null => {
                const info =
                    item.info && !Array.isArray(item.info) ? item.info : null;

                return (
                    parseRating(item.imdbRating) ??
                    parseRating(item.rating_imdb) ??
                    parseRating(info?.rating_imdb)
                );
            };

            const sortByMode = (
                items: XtreamSelectionItem[],
                sortMode: XtreamCategorySortMode,
                categoryType: ContentType
            ): XtreamSelectionItem[] => {
                return [...items].sort((a, b) => {
                    const titleA = a.title ?? a.name ?? '';
                    const titleB = b.title ?? b.name ?? '';

                    if (sortMode === 'date-desc') {
                        return (
                            getItemDate(b, categoryType) -
                            getItemDate(a, categoryType)
                        );
                    }
                    if (sortMode === 'date-asc') {
                        return (
                            getItemDate(a, categoryType) -
                            getItemDate(b, categoryType)
                        );
                    }
                    if (sortMode === 'rating-desc') {
                        const ratingA = getItemRating(a);
                        const ratingB = getItemRating(b);

                        if (ratingA === null && ratingB === null) {
                            return COLLATOR.compare(titleA, titleB);
                        }
                        if (ratingA === null) {
                            return 1;
                        }
                        if (ratingB === null) {
                            return -1;
                        }

                        const byRating = ratingB - ratingA;
                        return byRating === 0
                            ? COLLATOR.compare(titleA, titleB)
                            : byRating;
                    }

                    const byName = COLLATOR.compare(titleA, titleB);
                    return sortMode === 'name-asc' ? byName : -byName;
                });
            };

            const filterBySearchTerm = (
                items: XtreamSelectionItem[],
                searchTerm: string
            ): XtreamSelectionItem[] => {
                const normalized = searchTerm.trim().toLocaleLowerCase();
                if (!normalized) {
                    return items;
                }

                return items.filter((item) => {
                    const title = (item.title ?? item.name ?? '').toString();
                    return title.toLocaleLowerCase().includes(normalized);
                });
            };

            const filterVodGroupsBySearchTerm = (
                items: XtreamSelectionItem[],
                searchTerm: string
            ): XtreamSelectionItem[] => {
                if (!searchTerm.trim()) {
                    return items;
                }

                return items.filter((item) =>
                    matchesXtreamVodSearchTerm(item, searchTerm)
                );
            };

            const filterSeriesGroupsBySearchTerm = (
                items: XtreamSelectionItem[],
                searchTerm: string
            ): XtreamSelectionItem[] => {
                if (!searchTerm.trim()) {
                    return items;
                }

                return items.filter((item) =>
                    matchesXtreamSeriesSearchTerm(item, searchTerm)
                );
            };

            const filterIndexContentSignature = computed(() =>
                getFilterIndexContentSignatureFromStore(
                    store as ParentSelectionStoreLike
                )
            );

            const metadataFiltersReady = computed(() =>
                isFilterIndexReadyForSignature(
                    store.filterIndex(),
                    filterIndexContentSignature()
                )
            );

            const isLanguageFilterReadyAndActive = (): boolean =>
                metadataFiltersReady() &&
                isXtreamLanguageFilterActive(store.languageFilter());

            const isVideoQualityFilterReadyAndActive = (): boolean =>
                metadataFiltersReady() &&
                isXtreamVideoQualityFilterActive(store.videoQualityFilter());

            const filterByLanguage = (
                items: XtreamSelectionItem[]
            ): XtreamSelectionItem[] => {
                const filter = store.languageFilter();
                if (!isLanguageFilterReadyAndActive()) {
                    return items;
                }

                return items.filter((item) =>
                    matchesXtreamLanguageFilter(
                        item as XtreamLanguageFilterCandidate,
                        filter
                    )
                );
            };

            const supportsVideoQualityFilter = (
                categoryType: ContentType
            ): boolean => categoryType === 'vod' || categoryType === 'series';

            const filterByVideoQuality = (
                items: XtreamSelectionItem[],
                categoryType: ContentType
            ): XtreamSelectionItem[] => {
                const filter = store.videoQualityFilter();
                if (
                    !supportsVideoQualityFilter(categoryType) ||
                    !isVideoQualityFilterReadyAndActive()
                ) {
                    return items;
                }

                return items.filter((item) =>
                    matchesXtreamVideoQualityFilter(
                        item as XtreamVideoQualityFilterCandidate,
                        filter
                    )
                );
            };

            const applyCatalogFilters = (
                items: XtreamSelectionItem[],
                categoryType: ContentType
            ): XtreamSelectionItem[] =>
                filterByVideoQuality(filterByLanguage(items), categoryType);

            const hasActiveCatalogFilters = (
                categoryType: ContentType
            ): boolean =>
                isLanguageFilterReadyAndActive() ||
                (supportsVideoQualityFilter(categoryType) &&
                    isVideoQualityFilterReadyAndActive());

            const getStreamsByType = (
                categoryType: ContentType
            ): XtreamSelectionItem[] => {
                const storeAny = store as ParentSelectionStoreLike;
                return categoryType === 'live'
                    ? storeAny.liveStreams?.() || []
                    : categoryType === 'vod'
                      ? storeAny.vodStreams?.() || []
                      : storeAny.serialStreams?.() || [];
            };

            // ---------------------------------------------------------------------------
            // Per-type category item-count maps.
            // Each computed only recomputes when ITS streams array changes —
            // switching content tabs no longer triggers an O(n) full scan.
            // ---------------------------------------------------------------------------
            const buildCountMap = (
                streams: XtreamSelectionItem[]
            ): Map<number, number> => {
                const countMap = new Map<number, number>();
                for (const item of filterByLanguage(streams)) {
                    const catId = Number(item.category_id);
                    if (!isNaN(catId)) {
                        countMap.set(catId, (countMap.get(catId) || 0) + 1);
                    }
                }
                return countMap;
            };

            const buildVodCountMap = (
                streams: XtreamSelectionItem[]
            ): Map<number, number> => {
                return buildDuplicateCountMap(
                    streams,
                    groupXtreamVodDuplicates,
                    'vod'
                );
            };

            const buildSeriesCountMap = (
                streams: XtreamSelectionItem[]
            ): Map<number, number> => {
                return buildDuplicateCountMap(
                    streams,
                    groupXtreamSeriesDuplicates,
                    'series'
                );
            };

            const buildDuplicateCountMap = (
                streams: XtreamSelectionItem[],
                groupItems: (
                    items: readonly XtreamSelectionItem[]
                ) => XtreamSelectionItem[],
                categoryType: ContentType
            ): Map<number, number> => {
                const streamsByCategory = new Map<
                    number,
                    XtreamSelectionItem[]
                >();

                for (const item of streams) {
                    const catId = Number(item.category_id);
                    if (isNaN(catId)) {
                        continue;
                    }

                    const categoryStreams = streamsByCategory.get(catId) ?? [];
                    categoryStreams.push(item);
                    streamsByCategory.set(catId, categoryStreams);
                }

                const countMap = new Map<number, number>();
                for (const [catId, categoryStreams] of streamsByCategory) {
                    countMap.set(
                        catId,
                        applyCatalogFilters(
                            groupItems(categoryStreams),
                            categoryType
                        ).length
                    );
                }

                return countMap;
            };

            const liveItemCounts = computed(() =>
                buildCountMap(
                    (store as ParentSelectionStoreLike).liveStreams?.() || []
                )
            );
            const vodItemCounts = computed(() =>
                buildVodCountMap(
                    (store as ParentSelectionStoreLike).vodStreams?.() || []
                )
            );
            const seriesItemCounts = computed(() =>
                buildSeriesCountMap(
                    (store as ParentSelectionStoreLike).serialStreams?.() || []
                )
            );
            const selectedTypeContentState = computed(() => {
                const storeAny = store as ParentSelectionStoreLike;
                const selectedType = store.selectedContentType();
                return (
                    storeAny.contentLoadStateByType?.()?.[selectedType] ??
                    'idle'
                );
            });
            const selectedTypeContentLoading = computed(
                () => selectedTypeContentState() === 'loading'
            );
            const selectedTypeContentReady = computed(
                () => selectedTypeContentState() === 'ready'
            );
            const selectedTypeCountsReady = computed(() =>
                selectedTypeContentReady()
            );

            // ---------------------------------------------------------------------------
            // Stable filter + sort intermediate.
            // Depends on category / search / sort — but NOT on page or limit.
            // This prevents re-sorting the full array on every page-navigation.
            // ---------------------------------------------------------------------------
            const searchMatchedContent = computed(() => {
                const categoryId = store.selectedCategoryId();
                const categoryType = store.selectedContentType();
                const searchTerm = store.categorySearchTerm();
                const content = getStreamsByType(categoryType);
                const scopedContent = categoryId
                    ? content.filter(
                          (item) => Number(item.category_id) === categoryId
                      )
                    : content;

                if (categoryType === 'vod') {
                    return filterVodGroupsBySearchTerm(
                        groupXtreamVodDuplicates(scopedContent),
                        searchTerm
                    );
                }

                if (categoryType === 'series') {
                    return filterSeriesGroupsBySearchTerm(
                        groupXtreamSeriesDuplicates(scopedContent),
                        searchTerm
                    );
                }

                return filterBySearchTerm(scopedContent, searchTerm);
            });

            const filteredAndSortedContent = computed(() => {
                const categoryType = store.selectedContentType();
                const sortMode = store.contentSortMode();

                return sortByMode(
                    applyCatalogFilters(searchMatchedContent(), categoryType),
                    sortMode,
                    categoryType
                );
            });

            const getSelectionItemKey = (
                item: XtreamSelectionItem,
                categoryType: ContentType
            ): string => {
                const id =
                    item.duplicateGroupKey ??
                    (categoryType === 'series'
                        ? (item.series_id ?? item.xtream_id ?? item.id)
                        : (item.xtream_id ??
                          item.stream_id ??
                          item.series_id ??
                          item.id));

                return `${categoryType}:${String(
                    id ?? item.title ?? item.name ?? ''
                )}`;
            };

            const filterExcludedContent = computed(() => {
                const categoryType = store.selectedContentType();
                if (!hasActiveCatalogFilters(categoryType)) {
                    return [];
                }

                const includedKeys = new Set(
                    filteredAndSortedContent().map((item) =>
                        getSelectionItemKey(item, categoryType)
                    )
                );
                const excluded = searchMatchedContent().filter(
                    (item) =>
                        !includedKeys.has(
                            getSelectionItemKey(item, categoryType)
                        )
                );

                return sortByMode(
                    excluded,
                    store.contentSortMode(),
                    categoryType
                );
            });

            const getVideoQualityOptionItems = (): XtreamSelectionItem[] => {
                const categoryId = store.selectedCategoryId();
                const categoryType = store.selectedContentType();
                const searchTerm = store.categorySearchTerm();

                if (!supportsVideoQualityFilter(categoryType)) {
                    return [];
                }

                const content = getStreamsByType(categoryType);
                let filtered = categoryId
                    ? content.filter(
                          (item) => Number(item.category_id) === categoryId
                      )
                    : content;

                filtered =
                    categoryType === 'vod'
                        ? groupXtreamVodDuplicates(filtered)
                        : groupXtreamSeriesDuplicates(filtered);
                filtered =
                    categoryType === 'vod'
                        ? filterVodGroupsBySearchTerm(filtered, searchTerm)
                        : filterSeriesGroupsBySearchTerm(filtered, searchTerm);

                return filterByLanguage(filtered);
            };
            const localizeVideoQualityOptions = (
                options: readonly XtreamVideoQualityOption[]
            ): XtreamVideoQualityOption[] =>
                options.map((option) => ({
                    ...option,
                    label: getXtreamVideoQualityLabel(
                        option.value,
                        getAppLanguage()
                    ),
                }));

            return {
                metadataFiltersReady,

                languageFilterOptions: computed(() => {
                    const index = store.filterIndex();
                    const signature = filterIndexContentSignature();
                    if (index.contentSignature === signature) {
                        return getXtreamLanguageOptionsFromCodes(
                            index.languageCodes,
                            store.languageFilter(),
                            getAppLanguage()
                        );
                    }

                    const storeAny = store as ParentSelectionStoreLike;
                    if (
                        getTotalFilterIndexItemCount(storeAny) >
                        FILTER_INDEX_SYNC_FALLBACK_ITEM_LIMIT
                    ) {
                        return getXtreamLanguageOptionsFromCodes(
                            index.languageCodes,
                            store.languageFilter(),
                            getAppLanguage()
                        );
                    }

                    const languageCodes = [
                        ...(storeAny.liveStreams?.() ?? []),
                        ...(storeAny.vodStreams?.() ?? []),
                        ...(storeAny.serialStreams?.() ?? []),
                    ].reduce<string[]>((codes, item) => {
                        const metadata = getXtreamItemLanguageMetadata(
                            item as XtreamLanguageFilterCandidate
                        );
                        codes.push(
                            ...metadata.audioLanguages,
                            ...metadata.subtitleLanguages
                        );
                        return codes;
                    }, []);

                    return getXtreamLanguageOptionsFromCodes(
                        languageCodes,
                        store.languageFilter(),
                        getAppLanguage()
                    );
                }),

                languageFilterActive: computed(() =>
                    isLanguageFilterReadyAndActive()
                ),

                videoQualityFilterOptions: computed(() => {
                    const categoryType = store.selectedContentType();
                    const filter = store.videoQualityFilter();
                    if (!supportsVideoQualityFilter(categoryType)) {
                        return [];
                    }

                    const categoryId = store.selectedCategoryId();
                    const typeKey =
                        categoryType === 'series' ? 'series' : 'vod';
                    const index = store.filterIndex();
                    const isIndexFresh =
                        index.contentSignature ===
                        filterIndexContentSignature();
                    const indexedOptions = categoryId
                        ? (index.videoQualityOptionsByCategory[typeKey][
                              String(categoryId)
                          ] ?? [])
                        : index.videoQualityOptions[typeKey];

                    if (
                        isIndexFresh &&
                        (indexedOptions.length || index.status !== 'idle')
                    ) {
                        if (
                            filter !== 'all' &&
                            !indexedOptions.some(
                                (option) => option.value === filter
                            )
                        ) {
                            return [
                                ...localizeVideoQualityOptions(indexedOptions),
                                ...getXtreamVideoQualityOptions(
                                    [],
                                    filter,
                                    getAppLanguage()
                                ),
                            ];
                        }

                        return localizeVideoQualityOptions(indexedOptions);
                    }

                    if (
                        getStreamsByType(categoryType).length >
                        FILTER_INDEX_SYNC_FALLBACK_ITEM_LIMIT
                    ) {
                        if (
                            filter !== 'all' &&
                            !indexedOptions.some(
                                (option) => option.value === filter
                            )
                        ) {
                            return [
                                ...localizeVideoQualityOptions(indexedOptions),
                                ...getXtreamVideoQualityOptions(
                                    [],
                                    filter,
                                    getAppLanguage()
                                ),
                            ];
                        }

                        return localizeVideoQualityOptions(indexedOptions);
                    }

                    return getXtreamVideoQualityOptions(
                        getVideoQualityOptionItems() as XtreamVideoQualityFilterCandidate[],
                        filter,
                        getAppLanguage()
                    );
                }),

                videoQualityFilterActive: computed(() =>
                    isVideoQualityFilterReadyAndActive()
                ),

                filterIndexProgress: computed<XtreamFilterIndexProgress>(() => {
                    const index = store.filterIndex();
                    return {
                        status: index.status,
                        processedItems: index.processedItems,
                        totalItems: index.totalItems,
                        percent:
                            index.totalItems > 0
                                ? Math.min(
                                      100,
                                      Math.round(
                                          (index.processedItems /
                                              index.totalItems) *
                                              100
                                      )
                                  )
                                : index.status === 'ready'
                                  ? 100
                                  : 0,
                        updatedAt: index.updatedAt,
                    };
                }),

                /**
                 * Get the selected category from the parent store's categories
                 */
                getSelectedCategory: computed(() => {
                    const categoryId = store.selectedCategoryId();
                    if (!categoryId) {
                        return {
                            id: 0,
                            name: 'All Items',
                            type: store.selectedContentType(),
                        };
                    }

                    // Access parent store categories (from withContent)
                    const storeAny = store as ParentSelectionStoreLike;
                    const allCategories: XtreamSelectionCategory[] = [
                        ...(storeAny.vodCategories?.() || []),
                        ...(storeAny.liveCategories?.() || []),
                        ...(storeAny.serialCategories?.() || []),
                    ];

                    return allCategories.find(
                        (c) =>
                            c.id === categoryId ||
                            c.category_id === String(categoryId)
                    );
                }),

                /**
                 * Get the selected item by ID from content
                 */
                getSelectedItemById: computed(() => {
                    const categoryType = store.selectedContentType();
                    const selectedItem = store.selectedItem();

                    if (!selectedItem) return null;

                    // Access parent store content (from withContent)
                    const storeAny = store as ParentSelectionStoreLike;
                    const content =
                        categoryType === 'live'
                            ? storeAny.liveStreams?.() || []
                            : categoryType === 'vod'
                              ? storeAny.vodStreams?.() || []
                              : storeAny.serialStreams?.() || [];

                    return content.find(
                        (item) =>
                            item.stream_id === selectedItem.stream_id ||
                            item.id === selectedItem.id ||
                            item.series_id === selectedItem.series_id
                    );
                }),

                /**
                 * Get paginated content for the selected category.
                 * Slices from the stable `filteredAndSortedContent` intermediate so
                 * page navigation never triggers a full re-sort of the array.
                 */
                getPaginatedContent: computed(() => {
                    const start = store.page() * store.limit();
                    return filteredAndSortedContent().slice(
                        start,
                        start + store.limit()
                    );
                }),

                /**
                 * Get all items from the selected category (without pagination).
                 * Reuses the `filteredAndSortedContent` intermediate to avoid
                 * duplicating the filter+sort work already done for pagination.
                 */
                selectItemsFromSelectedCategory: computed(() =>
                    filteredAndSortedContent()
                ),

                selectFilterExcludedItemsFromSelectedCategory: computed(() =>
                    filterExcludedContent()
                ),

                /**
                 * Get total pages for the selected category.
                 * Derives length from the shared `filteredAndSortedContent` intermediate.
                 */
                getTotalPages: computed(() =>
                    Math.ceil(filteredAndSortedContent().length / store.limit())
                ),

                /**
                 * Check if paginated content is loading
                 */
                isPaginatedContentLoading: computed(() =>
                    selectedTypeContentLoading()
                ),

                selectedTypeContentState,

                selectedTypeContentLoading,

                selectedTypeContentReady,

                selectedTypeCountsReady,

                /**
                 * Memoized category item counts map.
                 * Selects from per-type pre-computed maps so switching content tabs
                 * is O(1) — no full array scan on every tab switch.
                 */
                getCategoryItemCounts: computed(() => {
                    const type = store.selectedContentType();
                    return type === 'live'
                        ? liveItemCounts()
                        : type === 'vod'
                          ? vodItemCounts()
                          : seriesItemCounts();
                }),

                /**
                 * Get categories for the currently selected content type
                 */
                getCategoriesBySelectedType: computed(() => {
                    const type = store.selectedContentType();

                    // Access parent store categories (from withContent)
                    const storeAny = store as ParentSelectionStoreLike;
                    return type === 'live'
                        ? storeAny.liveCategories?.() || []
                        : type === 'vod'
                          ? storeAny.vodCategories?.() || []
                          : storeAny.serialCategories?.() || [];
                }),
            };
        }),

        withMethods((store) => {
            let filterIndexRunId = 0;
            let filterIndexTimer: ReturnType<typeof setTimeout> | null = null;
            let filterIndexRunning = false;
            let filterIndexRefreshPending = false;

            const clearFilterIndexTimer = (): void => {
                if (filterIndexTimer) {
                    clearTimeout(filterIndexTimer);
                    filterIndexTimer = null;
                }
            };

            const processFilterIndexItem = (
                accumulator: FilterIndexAccumulator,
                entry: { type: ContentType; item: XtreamSelectionItem }
            ): void => {
                const metadata = getXtreamItemLanguageMetadata(
                    entry.item as XtreamLanguageFilterCandidate
                );
                metadata.audioLanguages.forEach((code) =>
                    accumulator.languageCodes.add(code)
                );
                metadata.subtitleLanguages.forEach((code) =>
                    accumulator.languageCodes.add(code)
                );

                if (entry.type !== 'vod' && entry.type !== 'series') {
                    return;
                }

                const typeKey = entry.type === 'series' ? 'series' : 'vod';
                const buckets = getXtreamItemVideoQualityBuckets(
                    entry.item as XtreamVideoQualityFilterCandidate
                );
                incrementQualityCounts(
                    accumulator.videoQualityCounts[typeKey],
                    buckets
                );

                const categoryCounts = getCategoryBucketCounts(
                    accumulator.videoQualityCountsByCategory[typeKey],
                    entry.item.category_id
                );
                if (categoryCounts) {
                    incrementQualityCounts(categoryCounts, buckets);
                }
            };

            const publishFilterIndexSnapshot = (
                accumulator: FilterIndexAccumulator,
                contentSignature: string,
                status: XtreamFilterIndexProgress['status'],
                processedItems: number,
                totalItems: number
            ): void => {
                const filterIndex = snapshotFilterIndexState(
                    accumulator,
                    contentSignature,
                    status,
                    processedItems,
                    totalItems
                );
                patchState(store, {
                    filterIndex,
                });
                writeFilterIndexCache(filterIndex);
            };

            const startFilterIndexRefresh = (): void => {
                const storeAny = store as ParentSelectionStoreLike;
                const currentSignature =
                    getFilterIndexContentSignatureFromStore(storeAny);
                const currentIndex = store.filterIndex();

                if (
                    currentIndex.contentSignature === currentSignature &&
                    (currentIndex.status === 'ready' ||
                        currentIndex.status === 'running')
                ) {
                    return;
                }

                const cachedIndex = getCachedFilterIndexState(currentSignature);
                if (cachedIndex?.status === 'ready') {
                    if (filterIndexRunning) {
                        filterIndexRunId++;
                        filterIndexRunning = false;
                        filterIndexRefreshPending = false;
                        clearFilterIndexTimer();
                    }
                    patchState(store, { filterIndex: cachedIndex });
                    return;
                }

                if (filterIndexRunning) {
                    if (cachedIndex?.status === 'running') {
                        filterIndexRunId++;
                        filterIndexRunning = false;
                        filterIndexRefreshPending = false;
                        clearFilterIndexTimer();
                    } else {
                        filterIndexRefreshPending = true;
                        return;
                    }
                }

                clearFilterIndexTimer();
                const runId = ++filterIndexRunId;
                const { contentSignature, items } =
                    getFilterIndexEntriesFromStore(storeAny);
                const totalItems = items.length;
                const resumableIndex =
                    cachedIndex?.contentSignature === contentSignature &&
                    cachedIndex.status === 'running' &&
                    cachedIndex.totalItems === totalItems
                        ? cachedIndex
                        : null;
                const accumulator = resumableIndex
                    ? createFilterIndexAccumulatorFromState(resumableIndex)
                    : createFilterIndexAccumulator();
                let processedItems = resumableIndex
                    ? Math.min(resumableIndex.processedItems, totalItems)
                    : 0;
                let lastPublishedAt = 0;
                filterIndexRunning = true;
                filterIndexRefreshPending = false;

                if (resumableIndex) {
                    patchState(store, { filterIndex: resumableIndex });
                } else {
                    publishFilterIndexSnapshot(
                        accumulator,
                        contentSignature,
                        totalItems > 0 ? 'running' : 'ready',
                        0,
                        totalItems
                    );
                }

                const processChunk = (): void => {
                    if (runId !== filterIndexRunId) {
                        return;
                    }

                    const chunkStartedAt = Date.now();
                    let processedInChunk = 0;
                    while (
                        processedItems < totalItems &&
                        processedInChunk < FILTER_INDEX_CHUNK_ITEM_LIMIT
                    ) {
                        processFilterIndexItem(
                            accumulator,
                            items[processedItems]
                        );
                        processedItems++;
                        processedInChunk++;

                        if (
                            processedInChunk > 0 &&
                            Date.now() - chunkStartedAt >=
                                FILTER_INDEX_CHUNK_BUDGET_MS
                        ) {
                            break;
                        }
                    }

                    const isComplete = processedItems >= totalItems;
                    const shouldPublish =
                        isComplete ||
                        Date.now() - lastPublishedAt >=
                            FILTER_INDEX_PUBLISH_INTERVAL_MS;

                    if (shouldPublish) {
                        lastPublishedAt = Date.now();
                        publishFilterIndexSnapshot(
                            accumulator,
                            contentSignature,
                            isComplete ? 'ready' : 'running',
                            processedItems,
                            totalItems
                        );
                    }

                    if (isComplete) {
                        filterIndexRunning = false;
                        if (filterIndexRefreshPending) {
                            startFilterIndexRefresh();
                        }
                        return;
                    }

                    filterIndexTimer = setTimeout(
                        processChunk,
                        FILTER_INDEX_IDLE_DELAY_MS
                    );
                };

                if (totalItems > 0) {
                    filterIndexTimer = setTimeout(
                        processChunk,
                        FILTER_INDEX_IDLE_DELAY_MS
                    );
                } else {
                    filterIndexRunning = false;
                }
            };

            return {
                /**
                 * Set the content type (live, vod, series)
                 */
                setSelectedContentType(type: ContentType): void {
                    if (store.selectedContentType() === type) {
                        return;
                    }

                    patchState(store, {
                        selectedContentType: type,
                        selectedCategoryId: null,
                        page: 0,
                        categorySearchTerm: '',
                    });
                },

                /**
                 * Set the selected category
                 * Only resets page to 0 when category actually changes
                 */
                setSelectedCategory(categoryId: number | null): void {
                    const newCategoryId =
                        categoryId !== null ? Number(categoryId) : null;
                    const currentCategoryId = store.selectedCategoryId();

                    // Only reset page if category actually changed
                    if (currentCategoryId !== newCategoryId) {
                        patchState(store, {
                            selectedCategoryId: newCategoryId,
                            page: 0,
                            categorySearchTerm: '',
                        });
                    }
                },

                /**
                 * Set the selected item
                 */
                setSelectedItem(item: XtreamSelectionItem | null): void {
                    patchState(store, { selectedItem: item });
                },

                /**
                 * Set the loading details state
                 */
                setIsLoadingDetails(isLoading: boolean): void {
                    patchState(store, { isLoadingDetails: isLoading });
                },

                /**
                 * Set the details error state
                 */
                setDetailsError(error: string | null): void {
                    patchState(store, { detailsError: error });
                },

                /**
                 * Set the current page
                 */
                setPage(page: number): void {
                    patchState(store, { page });
                },

                /**
                 * Set the page limit (items per page)
                 */
                setLimit(limit: number): void {
                    patchState(store, { limit });
                    localStorage.setItem('xtream-page-size', String(limit));
                },

                /**
                 * Set category content sort mode
                 */
                setContentSortMode(mode: XtreamCategorySortMode): void {
                    if (store.contentSortMode() === mode) {
                        return;
                    }
                    patchState(store, {
                        contentSortMode: mode,
                        page: 0,
                    });
                },

                /**
                 * Set selected category search term
                 */
                setCategorySearchTerm(term: string): void {
                    if (store.categorySearchTerm() === term) {
                        return;
                    }

                    patchState(store, {
                        categorySearchTerm: term,
                        page: 0,
                    });
                },

                toggleLanguageFilterOption(
                    section: XtreamLanguageFilterSection,
                    code: string,
                    enabled: boolean
                ): void {
                    const normalizedCode = code.trim().toLowerCase();
                    if (!normalizedCode) {
                        return;
                    }

                    const current = store.languageFilter();
                    const selected = new Set(current[section]);
                    if (enabled) {
                        selected.add(normalizedCode);
                    } else {
                        selected.delete(normalizedCode);
                    }

                    patchState(store, {
                        languageFilter: {
                            ...current,
                            [section]: [...selected].sort(),
                        },
                        page: 0,
                    });
                },

                selectAllLanguageFilterOptions(
                    section: XtreamLanguageFilterSection
                ): void {
                    patchState(store, {
                        languageFilter: {
                            ...store.languageFilter(),
                            [section]: store
                                .languageFilterOptions()
                                .map((option) => option.code)
                                .sort(),
                        },
                        page: 0,
                    });
                },

                clearLanguageFilterOptions(
                    section: XtreamLanguageFilterSection
                ): void {
                    patchState(store, {
                        languageFilter: {
                            ...store.languageFilter(),
                            [section]: [],
                        },
                        page: 0,
                    });
                },

                invertLanguageFilterOptions(
                    section: XtreamLanguageFilterSection
                ): void {
                    const current = store.languageFilter();
                    const selected = new Set(current[section]);
                    const inverted = store
                        .languageFilterOptions()
                        .map((option) => option.code)
                        .filter((code) => !selected.has(code))
                        .sort();

                    patchState(store, {
                        languageFilter: {
                            ...current,
                            [section]: inverted,
                        },
                        page: 0,
                    });
                },

                resetLanguageFilter(): void {
                    patchState(store, {
                        languageFilter: EMPTY_XTREAM_LANGUAGE_FILTER,
                        page: 0,
                    });
                },

                setVideoQualityFilter(
                    filter: XtreamVideoQualityFilterValue
                ): void {
                    if (store.videoQualityFilter() === filter) {
                        return;
                    }

                    patchState(store, {
                        videoQualityFilter: filter,
                        page: 0,
                    });
                },

                resetVideoQualityFilter(): void {
                    patchState(store, {
                        videoQualityFilter: 'all',
                        page: 0,
                    });
                },

                refreshFilterIndexInBackground(): void {
                    startFilterIndexRefresh();
                },

                cancelFilterIndexRefresh(): void {
                    filterIndexRunId++;
                    filterIndexRunning = false;
                    filterIndexRefreshPending = false;
                    clearFilterIndexTimer();
                },

                /**
                 * Reset selection state
                 */
                resetSelection(): void {
                    filterIndexRunId++;
                    filterIndexRunning = false;
                    filterIndexRefreshPending = false;
                    clearFilterIndexTimer();
                    patchState(store, {
                        ...initialSelectionState,
                        filterIndex: createEmptyFilterIndexState(),
                        limit: Number(
                            localStorage.getItem('xtream-page-size') ?? 25
                        ),
                    });
                },
            };
        }),

        withHooks((store) => {
            let scheduledRefresh: ReturnType<typeof setTimeout> | undefined;
            let lastScheduledSignature = '';

            const contentWatcher = effect(() => {
                const signature = getFilterIndexContentSignatureFromStore(
                    store as ParentSelectionStoreLike
                );
                const indexedSignature = store.filterIndex().contentSignature;

                if (
                    signature === indexedSignature ||
                    signature === lastScheduledSignature
                ) {
                    return;
                }

                lastScheduledSignature = signature;
                if (scheduledRefresh) {
                    clearTimeout(scheduledRefresh);
                }
                scheduledRefresh = setTimeout(() => {
                    scheduledRefresh = undefined;
                    store.refreshFilterIndexInBackground();
                }, FILTER_INDEX_REFRESH_DEBOUNCE_MS);
            });

            return {
                onInit() {
                    store.refreshFilterIndexInBackground();
                },
                onDestroy() {
                    if (scheduledRefresh) {
                        clearTimeout(scheduledRefresh);
                    }
                    contentWatcher.destroy();
                    store.cancelFilterIndexRefresh();
                },
            };
        })
    );
}
