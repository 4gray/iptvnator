import {
    normalizeTitleKeys,
    titleYearsCompatible,
    extractYear,
    extractSeasonFromTitle,
} from '@iptvnator/shared/interfaces';
import { ActorFilmographyCredit } from '@iptvnator/shared/tmdb';
import { Kind, Media, ProviderClient } from '@iptvnator/tv/util';

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
    const rawNames = [
        item.title,
        item.raw.name,
        item.raw.o_name,
        item.raw.title,
    ].filter((t): t is string => typeof t === 'string');
    // Later seasons can carry their own year; an unmarked show or season 1
    // must still corroborate the premiere, so same-title remakes do not open.
    const seasonSlice =
        credit.mediaType === 'tv' &&
        rawNames.some((title) => (extractSeasonFromTitle(title) ?? 0) > 1);
    const compatibleYear = (year: number | null) =>
        titleYearsCompatible(credit.year, year) ||
        (seasonSlice && !!year && !!credit.year && year >= credit.year);
    const names = rawNames.map(normalizeTitleKeys);
    const exact = names.some((keys) => wanted.includes(keys.exact));
    // A canonical numeric title (Blade Runner 2049) is not a release-year tag.
    const suffixes = names.filter(
        (keys) =>
            keys.base !== keys.exact &&
            wanted.includes(keys.base) &&
            !wanted.includes(keys.exact)
    );
    if (!exact && !suffixes.length) return null;
    const years = [
        extractYear(item.year),
        ...rawNames.map((title) =>
            extractYear(
                title.match(
                    /(?:\(|\[|\{)\s*((?:19|20)\d{2})\s*(?:\)|\]|\})/
                )?.[1]
            )
        ),
        ...suffixes.map((keys) => keys.trailingYear),
    ];
    if (years.some((year) => !compatibleYear(year))) return null;
    const year = years.find((value) => value !== null) ?? null;
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
    const catalogs: Kind[] =
        kind === 'series' && provider.capabilities.vodSeries
            ? ['series', 'movie']
            : [kind];
    const queries = [
        ...new Set(
            [credit.title, credit.originalTitle].filter(
                (t): t is string => !!t?.trim()
            )
        ),
    ];
    let incomplete = false;
    const matches = new Map<string, { item: Media; score: number }>();
    for (const query of queries) {
        for (const catalogKind of catalogs) {
            const hits = new Map<string, { item: Media; score: number }>();
            const seen = new Set<string>();
            let complete = false;
            try {
                for (let page = 0; page < 20; page++) {
                    if (signal.aborted)
                        throw new DOMException('Aborted', 'AbortError');
                    const catalog = await provider.catalog(
                        catalogKind,
                        '',
                        page,
                        query,
                        signal,
                        'provider'
                    );
                    if (signal.aborted)
                        throw new DOMException('Aborted', 'AbortError');
                    const before = seen.size;
                    catalog.items.forEach((item) => {
                        seen.add(item.id);
                        if (item.sourceId !== sourceId || item.kind !== kind)
                            return;
                        const score = matchScore(item, credit);
                        if (score !== null) hits.set(item.id, { item, score });
                    });
                    if (!catalog.items.length || seen.size >= catalog.total) {
                        complete = true;
                        break;
                    }
                    if (seen.size === before) break;
                }
            } catch (error) {
                if (signal.aborted) throw error;
                incomplete = true;
                continue;
            }
            if (!complete) {
                incomplete = true;
                continue;
            }
            hits.forEach((hit, id) => {
                if (!matches.has(id) || matches.get(id)!.score < hit.score)
                    matches.set(id, hit);
            });
        }
    }
    if (matches.size) return bestMatch(matches);
    if (incomplete) throw new Error('Portal search is incomplete.');
    return { status: 'missing' };
}
