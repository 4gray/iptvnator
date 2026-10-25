import {
    normalizeTitleKeys,
    titleYearsCompatible,
    extractYear,
} from '@iptvnator/shared/interfaces';
import { ActorFilmographyCredit } from '@iptvnator/shared/tmdb';
import { Media, ProviderClient } from '@iptvnator/tv/util';

export type FilmographyMatch =
    | { status: 'found'; item: Media }
    | { status: 'choices'; items: Media[] }
    | { status: 'missing' };

function bestMatch(
    hits: Map<string, { item: Media; score: number }>
): FilmographyMatch {
    const best = Math.max(...[...hits.values()].map((hit) => hit.score));
    const items = [...hits.values()]
        .filter((hit) => hit.score === best)
        .map((hit) => hit.item);
    return items.length === 1
        ? { status: 'found', item: items[0] }
        : { status: 'choices', items };
}

function matchScore(
    item: Media,
    credit: ActorFilmographyCredit
): number | null {
    const wanted = [credit.title, credit.originalTitle]
        .filter((t): t is string => !!t)
        .map((t) => normalizeTitleKeys(t).exact);
    const compatibleYear = (year: number | null) =>
        titleYearsCompatible(credit.year, year) ||
        (credit.mediaType === 'tv' &&
            !!year &&
            !!credit.year &&
            year >= credit.year);
    const names = [item.title, item.raw.name, item.raw.o_name, item.raw.title]
        .filter((t): t is string => typeof t === 'string')
        .map(normalizeTitleKeys);
    const exact = names.some((keys) => wanted.includes(keys.exact));
    const base = names.find(
        (keys) =>
            keys.base !== keys.exact &&
            wanted.includes(keys.base) &&
            compatibleYear(keys.trailingYear)
    );
    if (!exact && !base) return null;
    // A canonical numeric title (Blade Runner 2049) is not a release-year tag.
    const year =
        extractYear(item.year) ??
        (!exact ? (base?.trailingYear ?? null) : null);
    if (!compatibleYear(year)) return null;
    return year && credit.year
        ? year === credit.year
            ? 3
            : Math.abs(year - credit.year) <= 1
              ? 2
              : 1
        : 0;
}

/** On-demand search only in this provider. Exhaust pages before claiming absence. */
export async function findFilmographyTitle(
    provider: ProviderClient,
    sourceId: string,
    credit: ActorFilmographyCredit,
    signal: AbortSignal
): Promise<FilmographyMatch> {
    const kind = credit.mediaType === 'movie' ? 'movie' : 'series';
    const queries = [
        ...new Set(
            [credit.title, credit.originalTitle].filter(
                (t): t is string => !!t?.trim()
            )
        ),
    ];
    for (const query of queries) {
        const hits = new Map<string, { item: Media; score: number }>();
        const seen = new Set<string>();
        let complete = false;
        for (let page = 0; page < 20; page++) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const catalog = await provider.catalog(
                kind,
                '',
                page,
                query,
                signal,
                'provider'
            );
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const before = seen.size;
            catalog.items.forEach((item) => {
                seen.add(item.id);
                if (item.sourceId !== sourceId || item.kind !== kind) return;
                const score = matchScore(item, credit);
                if (score !== null) hits.set(item.id, { item, score });
            });
            // A matching title and exact release year is enough to open this
            // provider version, even if its server ignores the search filter.
            if ([...hits.values()].some((hit) => hit.score === 3))
                return bestMatch(hits);
            if (!catalog.items.length || seen.size >= catalog.total) {
                complete = true;
                break;
            }
            if (seen.size === before) break;
        }
        if (!complete) throw new Error('Portal search is incomplete.');
        if (hits.size) return bestMatch(hits);
    }
    return { status: 'missing' };
}
