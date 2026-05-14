export interface XtreamVodDuplicateCandidate {
    readonly added?: string | number;
    readonly category_id?: string | number;
    readonly container_extension?: string;
    readonly cover?: string;
    readonly cover_big?: string;
    readonly id?: string | number;
    readonly imdbId?: string;
    readonly imdb_id?: string;
    readonly imdbMatchedTitle?: string;
    readonly imdbMatchedYear?: string | number;
    readonly imdbOverrideId?: string;
    readonly imdbOverrideTitle?: string;
    readonly imdbOverrideYear?: string | number;
    readonly info?:
        | {
              readonly cover?: string;
              readonly cover_big?: string;
              readonly movie_image?: string;
              readonly name?: string;
              readonly o_name?: string;
              readonly releaseDate?: string;
              readonly releasedate?: string;
              readonly tmdb_id?: string | number;
              readonly title?: string;
              readonly tvdb_id?: string | number;
          }
        | []
        | null;
    readonly movie_image?: string;
    readonly movie_data?: {
        readonly container_extension?: string;
        readonly name?: string;
        readonly stream_id?: string | number;
        readonly tmdb_id?: string | number;
        readonly title?: string;
        readonly tvdb_id?: string | number;
    };
    readonly name?: string;
    readonly original_name?: string;
    readonly o_name?: string;
    readonly poster_url?: string;
    readonly manualImdbId?: string;
    readonly manualImdbTitle?: string;
    readonly manualImdbYear?: string | number;
    readonly releaseDate?: string;
    readonly releasedate?: string;
    readonly series_id?: string | number;
    readonly stream_id?: string | number;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly tmdbId?: string | number;
    readonly tmdb_id?: string | number;
    readonly tvdbId?: string | number;
    readonly tvdb_id?: string | number;
    readonly xtream_id?: string | number;
    readonly year?: string | number;
}

export interface XtreamVodQualityInfo {
    readonly label: string;
    readonly score: number;
    readonly height?: number;
}

export type XtreamVodDuplicateDecorated<T> = T & {
    duplicateCount?: number;
    duplicateDefaultVariantId?: string;
    duplicateGroupKey?: string;
    duplicateQualityLabel?: string;
    duplicateQualityScore?: number;
    duplicateVariants?: Array<XtreamVodDuplicateDecorated<T>>;
};

type XtreamVodDuplicateWithVariants = XtreamVodDuplicateCandidate & {
    readonly duplicateVariants?: readonly XtreamVodDuplicateCandidate[];
};

const QUALITY_TAG_PATTERN =
    /\b(?:4320p|2160p|1080p|720p|576p|540p|480p|360p|uhd|hdr|hdr10|dv|dolby|vision|4k|x264|x265|h264|h265|hevc|avc|web[- ]?dl|webrip|bluray|bdrip|hdrip|dvdrip|remux|multi|ita|eng|sub|subs|aac|ac3|eac3|dts|atmos|truehd|10bit)\b/gi;

const SEARCH_STOP_WORDS = new Set([
    'a',
    'al',
    'alla',
    'an',
    'and',
    'dei',
    'del',
    'della',
    'di',
    'e',
    'gli',
    'i',
    'il',
    'la',
    'le',
    'lo',
    'of',
    'the',
    'un',
    'una',
    'uno',
]);

export function groupXtreamVodDuplicates<T extends XtreamVodDuplicateCandidate>(
    items: readonly T[]
): Array<XtreamVodDuplicateDecorated<T>> {
    return buildXtreamVodDuplicateGroups(items).map(({ key, items: group }) => {
        const variants = sortXtreamVodVariantsByQuality(group).map((variant) =>
            decorateVariant(variant, key)
        );
        const representative = variants[0];

        if (!key) {
            return representative;
        }

        return {
            ...representative,
            duplicateCount: variants.length,
            duplicateDefaultVariantId: getXtreamVodVariantKey(representative),
            duplicateGroupKey: key,
            duplicateVariants: variants,
        };
    });
}

export function findXtreamVodDuplicateVariants<
    T extends XtreamVodDuplicateCandidate,
>(
    items: readonly T[],
    target: T | null | undefined
): Array<XtreamVodDuplicateDecorated<T>> {
    if (!target) {
        return [];
    }

    const targetVariantKey = getXtreamVodVariantKey(target);
    const targetKeys = getXtreamVodDuplicateKeys(target);
    const group = buildXtreamVodDuplicateGroups(items).find(({ items }) =>
        items.some((item) => {
            if (item === target) {
                return true;
            }

            if (
                targetVariantKey &&
                getXtreamVodVariantKey(item) === targetVariantKey
            ) {
                return true;
            }

            if (!targetKeys.length) {
                return false;
            }

            return getXtreamVodDuplicateKeys(item).some((key) =>
                targetKeys.includes(key)
            );
        })
    );
    const key = group?.key ?? getXtreamVodDuplicateKey(target);
    const variants = group?.items ?? [target];

    return sortXtreamVodVariantsByQuality(variants).map((variant) =>
        decorateVariant(variant, key)
    );
}

export function getXtreamVodDuplicateKey(
    item: XtreamVodDuplicateCandidate
): string | null {
    return getXtreamVodDuplicateKeys(item)[0] ?? null;
}

export function matchesXtreamVodSearchTerm(
    item: XtreamVodDuplicateCandidate,
    searchTerm: string
): boolean {
    const tokens = getSearchTokens(searchTerm);
    if (!tokens.length) {
        return true;
    }

    const haystacks = getXtreamVodSearchValues(item)
        .map(normalizeXtreamVodSearchText)
        .filter(Boolean);

    return tokens.every((token) =>
        haystacks.some((haystack) => {
            if (haystack.includes(token)) {
                return true;
            }

            return haystack.replace(/\s+/g, '').includes(token);
        })
    );
}

function getXtreamVodDuplicateKeys(
    item: XtreamVodDuplicateCandidate
): string[] {
    const keys = new Set(getXtreamExternalContentKeys(item));

    const title = normalizeXtreamVodTitle(
        item.manualImdbTitle ??
            item.imdbOverrideTitle ??
            item.imdbMatchedTitle ??
            item.title ??
            item.name ??
            item.o_name ??
            item.original_name ??
            item.movie_data?.name
    );
    if (!title) {
        return [...keys];
    }

    const year =
        parseYear(item.manualImdbYear) ??
        parseYear(item.imdbOverrideYear) ??
        parseYear(item.imdbMatchedYear) ??
        parseYear(item.year) ??
        parseYear(item.releaseDate) ??
        parseYear(item.releasedate) ??
        parseYear(
            item.info && !Array.isArray(item.info)
                ? (item.info.releaseDate ?? item.info.releasedate)
                : undefined
        ) ??
        parseYear(item.title) ??
        parseYear(item.name);

    const poster = normalizePosterUrl(resolvePosterUrl(item));

    if (poster) {
        keys.add(`poster:${poster}`);
        keys.add(`poster-title:${poster}|${title}`);
        if (year) {
            keys.add(`poster-year:${poster}|${year}`);
        }
    }

    keys.add(`title:${title}|${year ?? ''}`);

    return [...keys];
}

function getXtreamExternalContentKeys(
    item: XtreamVodDuplicateCandidate
): string[] {
    const info = item.info && !Array.isArray(item.info) ? item.info : null;
    const keys = [
        normalizeImdbId(
            item.manualImdbId ??
                item.imdbOverrideId ??
                item.imdb_id ??
                item.imdbId
        ),
        normalizeNumericExternalId('tmdb', item.tmdb_id ?? item.tmdbId),
        normalizeNumericExternalId('tmdb', info?.tmdb_id),
        normalizeNumericExternalId('tmdb', item.movie_data?.tmdb_id),
        normalizeNumericExternalId('tvdb', item.tvdb_id ?? item.tvdbId),
        normalizeNumericExternalId('tvdb', info?.tvdb_id),
        normalizeNumericExternalId('tvdb', item.movie_data?.tvdb_id),
    ];

    return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

export function getXtreamVodQualityInfo(
    item: XtreamVodDuplicateCandidate
): XtreamVodQualityInfo {
    const title = [
        item.title,
        item.name,
        item.o_name,
        item.original_name,
        item.movie_data?.name,
        item.container_extension,
        item.movie_data?.container_extension,
    ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    const lower = title.toLowerCase();
    const height = resolveHeight(lower);
    const codec = resolveCodec(lower);
    const source = resolveSource(lower);
    const extension = (
        item.container_extension ??
        item.movie_data?.container_extension ??
        ''
    ).toUpperCase();

    const score =
        (height ?? 0) * 100 +
        (codec === 'HEVC' ? 30 : codec === 'H.264' ? 12 : 0) +
        (source === 'REMUX'
            ? 22
            : source === 'BluRay'
              ? 18
              : source === 'WEB-DL'
                ? 10
                : 0) +
        (extension === 'MKV' ? 4 : extension === 'MP4' ? 2 : 0);
    const labelParts = [
        height ? `${height}p` : undefined,
        source,
        codec,
        extension && !source?.toLowerCase().includes(extension.toLowerCase())
            ? extension
            : undefined,
    ].filter((value): value is string => Boolean(value));

    return {
        height,
        label: labelParts.length
            ? labelParts.join(' ')
            : 'Qualita non rilevata',
        score,
    };
}

export function getXtreamVodVariantKey(
    item: XtreamVodDuplicateCandidate
): string {
    return String(
        item.stream_id ??
            item.series_id ??
            item.xtream_id ??
            item.id ??
            item.movie_data?.stream_id ??
            ''
    );
}

export const groupXtreamSeriesDuplicates = groupXtreamVodDuplicates;
export const findXtreamSeriesDuplicateVariants = findXtreamVodDuplicateVariants;
export const getXtreamSeriesDuplicateKey = getXtreamVodDuplicateKey;
export const getXtreamSeriesVariantKey = getXtreamVodVariantKey;
export const matchesXtreamSeriesSearchTerm = matchesXtreamVodSearchTerm;

function decorateVariant<T extends XtreamVodDuplicateCandidate>(
    item: T,
    duplicateGroupKey?: string | null
): XtreamVodDuplicateDecorated<T> {
    const quality = getXtreamVodQualityInfo(item);
    return {
        ...item,
        duplicateGroupKey: duplicateGroupKey ?? undefined,
        duplicateQualityLabel: quality.label,
        duplicateQualityScore: quality.score,
    };
}

function buildXtreamVodDuplicateGroups<T extends XtreamVodDuplicateCandidate>(
    items: readonly T[]
): Array<{ key: string | null; items: T[] }> {
    const groups: Array<{ key: string | null; items: T[] }> = [];
    const keyToGroup = new Map<string, { key: string | null; items: T[] }>();

    for (const item of items) {
        const keys = getXtreamVodDuplicateKeys(item);
        if (!keys.length) {
            groups.push({ key: null, items: [item] });
            continue;
        }

        const matchingGroups = [
            ...new Set(
                keys
                    .map((key) => keyToGroup.get(key))
                    .filter(
                        (group): group is { key: string | null; items: T[] } =>
                            Boolean(group)
                    )
            ),
        ];

        const group =
            matchingGroups[0] ??
            ({
                key: keys[0],
                items: [],
            } satisfies { key: string; items: T[] });

        if (!matchingGroups.length) {
            groups.push(group);
        }

        for (const mergedGroup of matchingGroups.slice(1)) {
            group.items.push(...mergedGroup.items);
            groups.splice(groups.indexOf(mergedGroup), 1);
            for (const [key, mappedGroup] of keyToGroup.entries()) {
                if (mappedGroup === mergedGroup) {
                    keyToGroup.set(key, group);
                }
            }
        }

        group.items.push(item);
        for (const key of keys) {
            keyToGroup.set(key, group);
        }
    }

    return groups;
}

function sortXtreamVodVariantsByQuality<T extends XtreamVodDuplicateCandidate>(
    items: readonly T[]
): T[] {
    return [...items].sort((a, b) => {
        const byQuality =
            getXtreamVodQualityInfo(b).score - getXtreamVodQualityInfo(a).score;
        if (byQuality !== 0) {
            return byQuality;
        }

        return parseAdded(b) - parseAdded(a);
    });
}

function normalizeXtreamVodTitle(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/^\s*(?:[a-z]{2,3}|multi)\s*[-_.|:]\s*/i, ' ')
        .replace(/\.[a-z0-9]{2,5}$/i, ' ')
        .replace(/[\[({][^\])}]*[\])}]/g, ' ')
        .replace(/\b(?:19|20)\d{2}\b/g, ' ')
        .replace(QUALITY_TAG_PATTERN, ' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/['’`]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .replace(/^(?:the|a|an|il|lo|la|i|gli|le|un|uno|una|l)\s+/, '')
        .trim()
        .toLocaleLowerCase();
}

function normalizeXtreamVodSearchText(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return '';
    }

    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/['’`]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .toLocaleLowerCase();
}

function normalizeImdbId(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const match = value
        .trim()
        .toLocaleLowerCase()
        .match(/tt\d{5,}/);
    return match ? `imdb:${match[0]}` : null;
}

function normalizeNumericExternalId(
    source: 'tmdb' | 'tvdb',
    value: unknown
): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }

    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) {
        return null;
    }

    return `${source}:${normalized}`;
}

function getSearchTokens(searchTerm: string): string[] {
    const rawTokens = normalizeXtreamVodSearchText(searchTerm)
        .split(/\s+/)
        .filter(Boolean);
    const meaningfulTokens = rawTokens.filter(
        (token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token)
    );

    return meaningfulTokens.length ? meaningfulTokens : rawTokens;
}

function getXtreamVodSearchValues(
    item: XtreamVodDuplicateCandidate
): unknown[] {
    const values = getSingleXtreamVodSearchValues(item);

    for (const variant of (item as XtreamVodDuplicateWithVariants)
        .duplicateVariants ?? []) {
        values.push(...getSingleXtreamVodSearchValues(variant));
    }

    return values;
}

function getSingleXtreamVodSearchValues(
    item: XtreamVodDuplicateCandidate
): unknown[] {
    const info = item.info && !Array.isArray(item.info) ? item.info : null;

    return [
        item.imdb_id,
        item.imdbId,
        item.tmdb_id,
        item.tmdbId,
        item.tvdb_id,
        item.tvdbId,
        item.imdbMatchedTitle,
        item.imdbMatchedYear,
        item.title,
        item.name,
        item.o_name,
        item.original_name,
        item.movie_data?.name,
        item.movie_data?.title,
        item.movie_data?.tmdb_id,
        item.movie_data?.tvdb_id,
        info?.name,
        info?.o_name,
        info?.title,
        info?.tmdb_id,
        info?.tvdb_id,
        item.year,
        item.releaseDate,
        item.releasedate,
        info?.releaseDate,
        info?.releasedate,
    ];
}

function resolvePosterUrl(item: XtreamVodDuplicateCandidate): unknown {
    const info = item.info && !Array.isArray(item.info) ? item.info : null;

    return (
        item.poster_url ??
        item.stream_icon ??
        item.movie_image ??
        item.cover_big ??
        item.cover ??
        info?.movie_image ??
        info?.cover_big ??
        info?.cover
    );
}

function normalizePosterUrl(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed || /default-poster|placeholder/i.test(trimmed)) {
        return '';
    }

    try {
        const url = new URL(trimmed);
        url.hash = '';
        url.search = '';
        return url.toString().toLocaleLowerCase();
    } catch {
        return trimmed.split(/[?#]/)[0].toLocaleLowerCase();
    }
}

function parseYear(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return undefined;
    }

    const match = value.match(/\b(19\d{2}|20\d{2})\b/);
    return match ? Number.parseInt(match[1], 10) : undefined;
}

function parseAdded(item: XtreamVodDuplicateCandidate): number {
    const parsed = Number.parseInt(String(item.added ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function resolveHeight(value: string): number | undefined {
    const explicit = value.match(/\b(4320|2160|1080|720|576|540|480|360)p\b/);
    if (explicit) {
        return Number.parseInt(explicit[1], 10);
    }

    if (/\b(?:4k|uhd)\b/.test(value)) {
        return 2160;
    }

    return undefined;
}

function resolveCodec(value: string): string | undefined {
    if (/\b(?:x265|h265|h\.265|hevc)\b/.test(value)) {
        return 'HEVC';
    }
    if (/\b(?:x264|h264|h\.264|avc)\b/.test(value)) {
        return 'H.264';
    }

    return undefined;
}

function resolveSource(value: string): string | undefined {
    if (/\bremux\b/.test(value)) {
        return 'REMUX';
    }
    if (/\b(?:bluray|bdrip)\b/.test(value)) {
        return 'BluRay';
    }
    if (/\bweb[- ]?dl\b/.test(value)) {
        return 'WEB-DL';
    }
    if (/\bwebrip\b/.test(value)) {
        return 'WEBRip';
    }

    return undefined;
}
