import { normalizeTitle } from '@iptvnator/services';
import { TmdbRecommendation } from '@iptvnator/shared/interfaces';

/**
 * Matches TMDB recommendations against the provider catalog so the
 * "Similar" rail only shows titles the user can actually play. Matching is
 * by normalized title (same normalization as the enrichment matcher);
 * recommendations without a catalog hit are dropped.
 */

export interface SimilarCatalogItem {
    id: number;
    categoryId: string;
    title: string;
    posterUrl: string | null;
}

/** Catalog rows vary by source (API vs DB) — fields are read structurally */
type CatalogStream = object;

function field(stream: CatalogStream, key: string): unknown {
    return (stream as Record<string, unknown>)[key];
}

function streamId(stream: CatalogStream): number | null {
    const candidate =
        field(stream, 'xtream_id') ??
        field(stream, 'stream_id') ??
        field(stream, 'series_id') ??
        field(stream, 'id');
    const parsed = Number(candidate);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function streamTitle(stream: CatalogStream): string {
    const title = field(stream, 'name') ?? field(stream, 'title');
    return typeof title === 'string' ? title : '';
}

function streamPoster(stream: CatalogStream): string | null {
    const poster =
        field(stream, 'stream_icon') ??
        field(stream, 'cover') ??
        field(stream, 'poster_url');
    return typeof poster === 'string' && poster !== '' ? poster : null;
}

export interface CatalogMatch {
    id: number;
    categoryId: string;
}

/**
 * Normalized-title → catalog entry index for per-title availability checks
 * (actor page filmography). First occurrence of a title wins.
 */
export function buildCatalogTitleIndex(
    streams: readonly CatalogStream[]
): Map<string, CatalogMatch> {
    const index = new Map<string, CatalogMatch>();
    for (const stream of streams) {
        const key = normalizeTitle(streamTitle(stream));
        if (!key || index.has(key)) {
            continue;
        }
        const id = streamId(stream);
        const categoryId =
            field(stream, 'category_id') ?? field(stream, 'categoryId');
        if (id === null || categoryId === undefined || categoryId === null) {
            continue;
        }
        index.set(key, { id, categoryId: String(categoryId) });
    }
    return index;
}

export function matchRecommendationsToCatalog(
    recommendations: readonly TmdbRecommendation[] | undefined,
    streams: readonly CatalogStream[],
    options: { excludeId?: number; limit?: number } = {}
): SimilarCatalogItem[] {
    if (!recommendations?.length || !streams.length) {
        return [];
    }

    const wanted = new Map<string, TmdbRecommendation>();
    for (const recommendation of recommendations) {
        const key = normalizeTitle(recommendation.title);
        if (key && !wanted.has(key)) {
            wanted.set(key, recommendation);
        }
    }

    // Single pass over the catalog; stop as soon as every wanted title has
    // a candidate — catalogs can hold tens of thousands of rows.
    const catalogHits = new Map<string, CatalogStream>();
    for (const stream of streams) {
        if (catalogHits.size >= wanted.size) {
            break;
        }
        const key = normalizeTitle(streamTitle(stream));
        if (!key || !wanted.has(key) || catalogHits.has(key)) {
            continue;
        }
        catalogHits.set(key, stream);
    }

    const limit = options.limit ?? 12;
    const seenIds = new Set<number>();
    const matched: SimilarCatalogItem[] = [];

    for (const [key, recommendation] of wanted) {
        if (matched.length >= limit) {
            break;
        }
        const stream = catalogHits.get(key);
        if (!stream) {
            continue;
        }
        const id = streamId(stream);
        const categoryId =
            field(stream, 'category_id') ?? field(stream, 'categoryId');
        if (
            id === null ||
            id === options.excludeId ||
            seenIds.has(id) ||
            categoryId === undefined ||
            categoryId === null
        ) {
            continue;
        }
        seenIds.add(id);
        matched.push({
            id,
            categoryId: String(categoryId),
            title: streamTitle(stream),
            posterUrl: recommendation.posterUrl ?? streamPoster(stream),
        });
    }

    return matched;
}
