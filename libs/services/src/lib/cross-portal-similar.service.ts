import { Injectable, inject } from '@angular/core';
import {
    CatalogTitleMatch,
    normalizeTitleKeys,
    TmdbRecommendation,
} from '@iptvnator/shared/interfaces';
import {
    CatalogTitleLookup,
    CatalogTitleMatchService,
    groupTitleMatchesByKey,
    pickTitleMatch,
} from './catalog-title-match.service';

/** One TMDB recommendation found in an imported Xtream playlist */
export interface CrossPortalSimilarItem {
    title: string;
    posterUrl: string | null;
    year: number | null;
    /** Where to navigate: playlist + category + item in that portal */
    match: CatalogTitleMatch;
    /**
     * Every eligible catalog row found for this title (the chosen `match`
     * included), so `visible()` can fall back to a copy in an unlocked
     * portal when the parental lock withholds the chosen one.
     */
    candidates?: readonly CatalogTitleMatch[];
}

const DEFAULT_LIMIT = 12;

/**
 * Matches TMDB recommendations against ALL imported Xtream playlists via
 * one batched DB-worker request — powers the "Similar" rail for portals
 * without a matchable local catalog (Stalker) and supplements the Xtream
 * rail with titles available in the user's other portals. Electron-only:
 * `isAvailable` is false in the PWA and every call resolves to [].
 */
@Injectable({ providedIn: 'root' })
export class CrossPortalSimilarService {
    private readonly titleMatch = inject(CatalogTitleMatchService);

    get isAvailable(): boolean {
        return this.titleMatch.isAvailable;
    }

    async matchRecommendations(
        recommendations: readonly TmdbRecommendation[] | undefined,
        type: 'movie' | 'series',
        options: { excludePlaylistId?: string; limit?: number } = {}
    ): Promise<CrossPortalSimilarItem[]> {
        if (!recommendations?.length || !this.isAvailable) {
            return [];
        }

        const matches = await this.titleMatch.matchTitles(
            recommendations.map((recommendation) => recommendation.title)
        );
        // Filter before grouping so a title also present in another
        // playlist survives the exclusion of the current one
        const grouped = groupTitleMatchesByKey(
            matches.filter(
                (match) =>
                    match.type === type &&
                    match.playlistId !== options.excludePlaylistId
            )
        );

        const limit = options.limit ?? DEFAULT_LIMIT;
        const seen = new Set<string>();
        const items: CrossPortalSimilarItem[] = [];
        for (const recommendation of recommendations) {
            if (items.length >= limit) {
                break;
            }
            const lookup = {
                type,
                titles: [recommendation.title],
                year: recommendation.year,
            };
            const match = pickTitleMatch(lookup, grouped);
            if (!match) {
                continue;
            }
            const dedupeKey = `${match.playlistId}:${match.type}:${match.xtreamId}`;
            if (seen.has(dedupeKey)) {
                continue;
            }
            seen.add(dedupeKey);
            items.push({
                title: recommendation.title,
                posterUrl: recommendation.posterUrl,
                year: recommendation.year,
                match,
                candidates: titleMatchCandidates(lookup, grouped),
            });
        }
        return items;
    }

    /**
     * `items` as the parental lock allows them now. An item whose chosen
     * match is withheld falls back to its best unlocked candidate, and is
     * dropped only when none is left (or another item already shows that
     * row). Reactive (see `CatalogTitleMatchService.isWithheld`): call it
     * inside a `computed` so cached rails follow relock and unlock.
     */
    visible<T extends CrossPortalSimilarItem>(items: readonly T[]): T[] {
        const seen = new Set<string>();
        const visible: T[] = [];
        for (const item of items) {
            const match = this.titleMatch.isWithheld(item.match)
                ? pickTitleMatch(
                      {
                          type: item.match.type,
                          titles: [item.title],
                          year: item.year,
                      },
                      groupTitleMatchesByKey(
                          this.titleMatch.visibleMatches(item.candidates ?? [])
                      )
                  )
                : item.match;
            const key = match
                ? `${match.playlistId}:${match.type}:${match.xtreamId}`
                : null;
            if (!match || !key || seen.has(key)) {
                continue;
            }
            seen.add(key);
            visible.push(match === item.match ? item : { ...item, match });
        }
        return visible;
    }

    /** Route array for one match: the item's detail view in its portal */
    buildLink(item: CrossPortalSimilarItem): string[] {
        return [
            '/workspace/xtreams',
            item.match.playlistId,
            item.match.type === 'movie' ? 'vod' : 'series',
            String(item.match.categoryId),
            String(item.match.xtreamId),
        ];
    }
}

/** The grouped rows a lookup's titles resolve to, in grouping order. */
function titleMatchCandidates(
    lookup: CatalogTitleLookup,
    grouped: ReadonlyMap<string, CatalogTitleMatch[]>
): CatalogTitleMatch[] {
    const candidates: CatalogTitleMatch[] = [];
    for (const title of lookup.titles) {
        const key = `${lookup.type}:${normalizeTitleKeys(title).exact}`;
        candidates.push(...(grouped.get(key) ?? []));
    }
    return candidates;
}
