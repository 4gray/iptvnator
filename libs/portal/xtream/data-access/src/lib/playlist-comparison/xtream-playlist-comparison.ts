import { XtreamContent } from '@iptvnator/services';

export type PlaylistComparisonContentType = 'movie' | 'series' | 'live';
export type PlaylistComparisonBucket =
    'common' | 'only-a' | 'only-b' | 'ambiguous';

export interface PlaylistComparisonItem {
    id: number;
    title: string;
    year: number | null;
    tmdbId: number | null;
    epgChannelId: string | null;
}

export interface PlaylistComparisonRow {
    bucket: PlaylistComparisonBucket;
    a: PlaylistComparisonItem[];
    b: PlaylistComparisonItem[];
    reason?: 'tmdb' | 'title-year' | 'title' | 'epg';
}

export interface PlaylistComparisonTypeResult {
    totalA: number;
    totalB: number;
    common: PlaylistComparisonRow[];
    onlyA: PlaylistComparisonRow[];
    onlyB: PlaylistComparisonRow[];
    ambiguous: PlaylistComparisonRow[];
}

const ignoredPunctuation = /[^\p{L}\p{N}]+/gu;

export function normalizeComparisonText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(ignoredPunctuation, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function itemOf(content: XtreamContent): PlaylistComparisonItem {
    return {
        id: content.id,
        title: content.title,
        year: content.release_year ?? null,
        tmdbId: content.tmdb_id ?? null,
        epgChannelId: content.epg_channel_id?.trim() || null,
    };
}

function keyFor(
    item: PlaylistComparisonItem,
    type: PlaylistComparisonContentType,
    tier: 'strong' | 'year' | 'title'
): string | null {
    if (type === 'live') {
        if (tier === 'strong')
            return item.epgChannelId ? `epg:${item.epgChannelId}` : null;
        return item.title
            ? `title:${normalizeComparisonText(item.title)}`
            : null;
    }
    if (tier === 'strong') return item.tmdbId ? `tmdb:${item.tmdbId}` : null;
    const title = normalizeComparisonText(item.title);
    if (!title) return null;
    if (tier === 'year')
        return item.year === null ? null : `title-year:${title}:${item.year}`;
    return `title:${title}`;
}

function index(
    items: PlaylistComparisonItem[],
    type: PlaylistComparisonContentType,
    tier: 'strong' | 'year' | 'title'
) {
    const result = new Map<string, PlaylistComparisonItem[]>();
    for (const item of items) {
        const key = keyFor(item, type, tier);
        if (!key) continue;
        const candidates = result.get(key);
        if (candidates) candidates.push(item);
        else result.set(key, [item]);
    }
    return result;
}

function isSingle(
    index: Map<string, PlaylistComparisonItem[]>,
    key: string | null
): PlaylistComparisonItem | null {
    const candidates = key ? index.get(key) : undefined;
    return candidates?.length === 1 ? candidates[0] : null;
}

export function compareXtreamCatalogues(
    aContent: readonly XtreamContent[],
    bContent: readonly XtreamContent[],
    type: PlaylistComparisonContentType
): PlaylistComparisonTypeResult {
    const a = aContent.map(itemOf);
    const b = bContent.map(itemOf);
    const indexes = {
        a: {
            strong: index(a, type, 'strong'),
            year: index(a, type, 'year'),
            title: index(a, type, 'title'),
        },
        b: {
            strong: index(b, type, 'strong'),
            year: index(b, type, 'year'),
            title: index(b, type, 'title'),
        },
    };
    const matchedA = new Set<number>();
    const matchedB = new Set<number>();
    const common: PlaylistComparisonRow[] = [];
    const ambiguous: PlaylistComparisonRow[] = [];
    const tiers: Array<'strong' | 'year' | 'title'> =
        type === 'live' ? ['strong', 'title'] : ['strong', 'year', 'title'];

    for (const tier of tiers) {
        for (const item of a) {
            if (matchedA.has(item.id)) continue;
            const key = keyFor(item, type, tier);
            const counterpart = isSingle(indexes.b[tier], key);
            if (!key || !counterpart || matchedB.has(counterpart.id)) continue;
            if (
                type !== 'live' &&
                item.tmdbId !== null &&
                counterpart.tmdbId !== null &&
                item.tmdbId !== counterpart.tmdbId
            )
                continue;
            if (
                tier === 'title' &&
                type !== 'live' &&
                (item.tmdbId !== null || counterpart.tmdbId !== null)
            )
                continue;
            if (
                tier === 'title' &&
                item.year !== null &&
                counterpart.year !== null &&
                item.year !== counterpart.year
            )
                continue;
            const aCandidates = indexes.a[tier].get(key) ?? [];
            if (aCandidates.length !== 1) continue;
            matchedA.add(item.id);
            matchedB.add(counterpart.id);
            common.push({
                bucket: 'common',
                a: [item],
                b: [counterpart],
                reason:
                    type === 'live' && tier === 'strong'
                        ? 'epg'
                        : tier === 'strong'
                          ? 'tmdb'
                          : tier === 'year'
                            ? 'title-year'
                            : 'title',
            });
        }
    }
    for (const item of a) {
        if (matchedA.has(item.id)) continue;
        const key = keyFor(item, type, 'title');
        const opposite = key ? (indexes.b.title.get(key) ?? []) : [];
        const own = key ? (indexes.a.title.get(key) ?? []) : [];
        if (
            opposite.length > 0 &&
            (opposite.length !== 1 || own.length !== 1)
        ) {
            ambiguous.push({ bucket: 'ambiguous', a: own, b: opposite });
            for (const candidate of own) matchedA.add(candidate.id);
            for (const candidate of opposite) matchedB.add(candidate.id);
        }
    }
    const onlyA = a
        .filter((item) => !matchedA.has(item.id))
        .map((item) => ({ bucket: 'only-a' as const, a: [item], b: [] }));
    const onlyB = b
        .filter((item) => !matchedB.has(item.id))
        .map((item) => ({ bucket: 'only-b' as const, a: [], b: [item] }));
    return {
        totalA: a.length,
        totalB: b.length,
        common,
        onlyA,
        onlyB,
        ambiguous,
    };
}
