import { Injectable, inject } from '@angular/core';
import {
    CatalogTitleMatch,
    TmdbRecommendation,
    normalizeTitleKeys,
    titleYearsCompatible,
} from '@iptvnator/shared/interfaces';
import {
    CatalogTitleMatchService,
    buildTitleMatchIndex,
} from './catalog-title-match.service';

/** One TMDB recommendation found in an imported Xtream playlist */
export interface CrossPortalSimilarItem {
    title: string;
    posterUrl: string | null;
    year: number | null;
    /** Where to navigate: playlist + category + item in that portal */
    match: CatalogTitleMatch;
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
        // Filter before indexing so a title also present in another
        // playlist survives the exclusion of the current one
        const index = buildTitleMatchIndex(
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
            const key = `${type}:${normalizeTitleKeys(recommendation.title).exact}`;
            const match = index.get(key);
            if (
                !match ||
                !titleYearsCompatible(recommendation.year, match.trailingYear)
            ) {
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
            });
        }
        return items;
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
