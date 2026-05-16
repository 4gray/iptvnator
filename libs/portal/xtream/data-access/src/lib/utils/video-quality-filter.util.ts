import {
    getXtreamVodQualityInfo,
    type XtreamVodDuplicateCandidate,
} from './vod-duplicates.util';

export type XtreamVideoQualityFilterValue =
    | 'all'
    | '2160p'
    | '1440p'
    | '1080p'
    | '720p'
    | 'sd'
    | 'unknown';

export type XtreamVideoQualityBucket = Exclude<
    XtreamVideoQualityFilterValue,
    'all'
>;

export interface XtreamVideoQualityOption {
    value: XtreamVideoQualityBucket;
    label: string;
    count: number;
}

export type XtreamVideoQualityFilterCandidate = Record<string, unknown> & {
    readonly duplicateVariants?: readonly XtreamVideoQualityFilterCandidate[];
};

const VIDEO_QUALITY_OPTIONS: readonly Omit<
    XtreamVideoQualityOption,
    'count'
>[] = [
    {
        value: '2160p',
        label: '2160p+',
    },
    {
        value: '1440p',
        label: '1440p',
    },
    {
        value: '1080p',
        label: '1080p',
    },
    {
        value: '720p',
        label: '720p',
    },
    {
        value: 'sd',
        label: 'SD',
    },
    {
        value: 'unknown',
        label: 'Not detected',
    },
];

const UNKNOWN_QUALITY_LABELS: Record<string, string> = {
    ar: 'غير مكتشفة',
    ary: 'غير مكتشفة',
    by: 'Не вызначана',
    de: 'Nicht erkannt',
    el: 'Δεν εντοπίστηκε',
    en: 'Not detected',
    es: 'No detectada',
    fr: 'Non détectée',
    it: 'Non rilevata',
    ja: '未検出',
    ko: '감지되지 않음',
    nl: 'Niet gedetecteerd',
    pl: 'Niewykryta',
    pt: 'Não detectada',
    ru: 'Не обнаружено',
    tr: 'Algılanmadı',
    zh: '未检测到',
    zhtw: '未偵測到',
};

const QUALITY_TEXT_KEYS = [
    'duplicateQualityLabel',
    'qualityLabels',
    'quality',
    'qualityLabel',
    'resolution',
    'title',
    'name',
    'o_name',
    'original_name',
    'stream_display_name',
    'container_extension',
    'category_name',
];

export function getXtreamVideoQualityOptions(
    items: readonly XtreamVideoQualityFilterCandidate[],
    selectedFilter: XtreamVideoQualityFilterValue = 'all',
    locale?: string
): XtreamVideoQualityOption[] {
    const counts = new Map<XtreamVideoQualityBucket, number>();

    for (const item of items) {
        for (const bucket of getXtreamItemVideoQualityBuckets(item)) {
            counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
        }
    }

    return getXtreamVideoQualityOptionsFromCounts(
        counts,
        selectedFilter,
        locale
    );
}

export function getXtreamVideoQualityOptionsFromCounts(
    counts: ReadonlyMap<XtreamVideoQualityBucket, number>,
    selectedFilter: XtreamVideoQualityFilterValue = 'all',
    locale?: string
): XtreamVideoQualityOption[] {
    return VIDEO_QUALITY_OPTIONS.map((option) => ({
        ...option,
        label: getXtreamVideoQualityLabel(option.value, locale),
        count: counts.get(option.value) ?? 0,
    })).filter((option) => option.count > 0 || option.value === selectedFilter);
}

export function getXtreamVideoQualityLabel(
    value: XtreamVideoQualityBucket,
    locale?: string
): string {
    if (value === 'unknown') {
        const normalizedLocale = normalizeVideoQualityLocale(locale);
        return (
            UNKNOWN_QUALITY_LABELS[normalizedLocale] ??
            UNKNOWN_QUALITY_LABELS[normalizedLocale.split('-')[0]] ??
            UNKNOWN_QUALITY_LABELS.en
        );
    }

    return (
        VIDEO_QUALITY_OPTIONS.find((option) => option.value === value)?.label ??
        value
    );
}

export function matchesXtreamVideoQualityFilter(
    item: XtreamVideoQualityFilterCandidate,
    filter: XtreamVideoQualityFilterValue
): boolean {
    if (filter === 'all') {
        return true;
    }

    return getXtreamItemVideoQualityBuckets(item).includes(filter);
}

export function isXtreamVideoQualityFilterActive(
    filter: XtreamVideoQualityFilterValue | null | undefined
): boolean {
    return Boolean(filter && filter !== 'all');
}

function normalizeVideoQualityLocale(locale?: string): string {
    const normalized = String(locale ?? 'en')
        .trim()
        .toLowerCase()
        .replace('_', '-');

    if (!normalized) {
        return 'en';
    }

    if (normalized === 'zh-hant' || normalized === 'zh-tw') {
        return 'zhtw';
    }

    return normalized;
}

export function getXtreamItemVideoQualityBuckets(
    item: XtreamVideoQualityFilterCandidate
): XtreamVideoQualityBucket[] {
    const buckets = new Set<XtreamVideoQualityBucket>();

    for (const candidate of collectItemAndVariants(item)) {
        const candidateBuckets = getSingleCandidateQualityBuckets(candidate);

        if (candidateBuckets.length) {
            candidateBuckets.forEach((bucket) => buckets.add(bucket));
        } else {
            buckets.add('unknown');
        }
    }

    return [...buckets];
}

function collectItemAndVariants(
    item: XtreamVideoQualityFilterCandidate
): XtreamVideoQualityFilterCandidate[] {
    return [
        item,
        ...((item.duplicateVariants ??
            []) as XtreamVideoQualityFilterCandidate[]),
    ];
}

function getSingleCandidateQualityBuckets(
    item: XtreamVideoQualityFilterCandidate
): XtreamVideoQualityBucket[] {
    const buckets = new Set<XtreamVideoQualityBucket>();
    const heights = new Set<number>();

    collectKnownHeights(item).forEach((height) => heights.add(height));
    collectEpisodeFallbackHeights(item).forEach((height) =>
        heights.add(height)
    );

    if (!heights.size) {
        collectQualityTexts(item).forEach((text) => {
            const parsedHeight = parseQualityHeight(text);
            if (parsedHeight) {
                heights.add(parsedHeight);
            }
        });

        const fallbackHeight = getXtreamVodQualityInfo(
            item as unknown as XtreamVodDuplicateCandidate
        ).height;
        if (fallbackHeight) {
            heights.add(fallbackHeight);
        }
    }

    heights.forEach((height) => buckets.add(heightToBucket(height)));
    return [...buckets];
}

function collectEpisodeFallbackHeights(
    item: XtreamVideoQualityFilterCandidate
): number[] {
    const heights: number[] = [];

    for (const episode of getEpisodeRecords(item['episodes'])) {
        if (collectKnownHeights(episode).length) {
            continue;
        }

        collectQualityTexts(episode).forEach((text) => {
            const parsedHeight = parseQualityHeight(text);
            if (parsedHeight) {
                heights.push(parsedHeight);
            }
        });

        const fallbackHeight = getXtreamVodQualityInfo(
            episode as unknown as XtreamVodDuplicateCandidate
        ).height;
        if (fallbackHeight) {
            heights.push(fallbackHeight);
        }
    }

    return heights;
}

function collectKnownHeights(
    item: XtreamVideoQualityFilterCandidate
): number[] {
    const heights: number[] = [];
    const mediaMetadata = getRecord(item['mediaMetadata']);

    pushHeight(heights, mediaMetadata?.['height']);
    pushHeights(heights, mediaMetadata?.['heights']);
    pushHeight(heights, item['height']);
    pushHeight(heights, item['videoHeight']);
    pushHeight(heights, item['resolutionHeight']);

    for (const record of [
        getRecord(item['info']),
        getRecord(item['movie_data']),
        ...getEpisodeRecords(item['episodes']),
    ]) {
        pushHeight(heights, record?.['height']);
        pushHeight(heights, record?.['videoHeight']);
        pushHeight(heights, record?.['resolutionHeight']);

        const videoRecord = getRecord(record?.['video']);
        pushHeight(heights, videoRecord?.['height']);
        pushHeight(heights, videoRecord?.['coded_height']);
        pushHeight(heights, videoRecord?.['display_aspect_ratio_height']);

        const infoVideoRecord = getRecord(
            getRecord(record?.['info'])?.['video']
        );
        pushHeight(heights, infoVideoRecord?.['height']);
        pushHeight(heights, infoVideoRecord?.['coded_height']);
        pushHeight(heights, infoVideoRecord?.['display_aspect_ratio_height']);
    }

    return heights;
}

function collectQualityTexts(
    item: XtreamVideoQualityFilterCandidate
): string[] {
    const values: unknown[] = [];
    const mediaMetadata = getRecord(item['mediaMetadata']);
    const info = getRecord(item['info']);
    const movieData = getRecord(item['movie_data']);
    const episodes = getEpisodeRecords(item['episodes']);

    values.push(...readKnownValues(item, QUALITY_TEXT_KEYS));
    values.push(...readKnownValues(mediaMetadata, QUALITY_TEXT_KEYS));
    values.push(...readKnownValues(info, QUALITY_TEXT_KEYS));
    values.push(...readKnownValues(movieData, QUALITY_TEXT_KEYS));

    for (const episode of episodes) {
        values.push(...readKnownValues(episode, QUALITY_TEXT_KEYS));
        values.push(
            ...readKnownValues(getRecord(episode['info']), QUALITY_TEXT_KEYS)
        );
        values.push(...collectLeafStrings(getRecord(episode['video'])));
        values.push(
            ...collectLeafStrings(
                getRecord(getRecord(episode['info'])?.['video'])
            )
        );
    }

    values.push(...collectLeafStrings(getRecord(item['video'])));
    values.push(...collectLeafStrings(getRecord(info?.['video'])));

    return collectLeafStrings(values);
}

function readKnownValues(
    record: Record<string, unknown> | null,
    keys: readonly string[]
): unknown[] {
    if (!record) {
        return [];
    }

    return keys
        .map((key) => record[key])
        .filter((value) => value !== undefined);
}

function getRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function getEpisodeRecords(value: unknown): Record<string, unknown>[] {
    if (!value || typeof value !== 'object') {
        return [];
    }

    if (Array.isArray(value)) {
        return value
            .map(getRecord)
            .filter(
                (record): record is Record<string, unknown> => record !== null
            );
    }

    const records: Record<string, unknown>[] = [];
    for (const entry of Object.values(value as Record<string, unknown>)) {
        if (Array.isArray(entry)) {
            records.push(
                ...entry
                    .map(getRecord)
                    .filter(
                        (record): record is Record<string, unknown> =>
                            record !== null
                    )
            );
        } else {
            const record = getRecord(entry);
            if (record) {
                records.push(record);
            }
        }
    }

    return records;
}

function collectLeafStrings(value: unknown): string[] {
    const strings: string[] = [];
    const visit = (entry: unknown): void => {
        if (typeof entry === 'string' || typeof entry === 'number') {
            strings.push(String(entry));
            return;
        }

        if (Array.isArray(entry)) {
            entry.forEach(visit);
            return;
        }

        const record = getRecord(entry);
        if (record) {
            Object.values(record).forEach(visit);
        }
    };

    visit(value);
    return strings;
}

function pushHeight(target: number[], value: unknown): void {
    const parsed =
        typeof value === 'number'
            ? value
            : typeof value === 'string'
              ? Number.parseInt(value, 10)
              : Number.NaN;

    if (Number.isFinite(parsed) && parsed >= 240) {
        target.push(parsed);
    }
}

function pushHeights(target: number[], values: unknown): void {
    if (!Array.isArray(values)) {
        return;
    }

    values.forEach((value) => pushHeight(target, value));
}

function parseQualityHeight(value: string): number | null {
    const normalized = value.toLocaleLowerCase();
    const explicit = normalized.match(
        /\b(4320|2160|1440|1080|720|576|540|480|360)p\b/
    );
    if (explicit) {
        return Number.parseInt(explicit[1], 10);
    }

    const dimensions = normalized.match(
        /\b\d{3,5}\s*[x×]\s*(4320|2160|1440|1080|720|576|540|480|360)\b/
    );
    if (dimensions) {
        return Number.parseInt(dimensions[1], 10);
    }

    if (/\b(?:8k)\b/.test(normalized)) {
        return 4320;
    }

    if (/\b(?:4k|uhd|ultra\s*hd)\b/.test(normalized)) {
        return 2160;
    }

    if (/\b(?:2k|qhd)\b/.test(normalized)) {
        return 1440;
    }

    if (/\b(?:fhd|full\s*hd)\b/.test(normalized)) {
        return 1080;
    }

    return null;
}

function heightToBucket(height: number): XtreamVideoQualityBucket {
    if (height >= 2160) {
        return '2160p';
    }

    if (height >= 1440) {
        return '1440p';
    }

    if (height >= 1080) {
        return '1080p';
    }

    if (height >= 720) {
        return '720p';
    }

    return 'sd';
}
