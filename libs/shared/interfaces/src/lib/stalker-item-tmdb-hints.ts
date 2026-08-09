import { isStalkerSeriesItem } from './stalker-item.normalizer';
import { StalkerPortalItem } from './stalker-portal-item.interface';
import { extractYear } from './title-normalization.util';
import { TmdbMediaType } from './tmdb.interface';

/**
 * What a stored Stalker favorite / recently-viewed entry already knows about
 * its TMDB match.
 *
 * These items are written as a spread of the item the detail view had on
 * screen, so an entry saved after enrichment carries the merged result:
 * the backdrop, the resolved id, the release date and the original title.
 * Anything reading such an entry (the dashboard hero above all) should use
 * those facts instead of starting a fresh title search — the search runs on
 * strictly less identity than the detail view had, and the confidence gate
 * turns that difference into a miss.
 */
export interface StalkerItemTmdbHints {
    /** Wide backdrop merged in by the detail view, when it got that far */
    readonly backdropUrl?: string;
    /**
     * The media type the detail view enriched under — NOT the activity type.
     * Embedded-VOD series stay `'movie'` as activity rows (they route into
     * the VOD section) while TMDB knows them as shows.
     */
    readonly mediaType: TmdbMediaType;
    readonly originalTitle?: string;
    /**
     * TMDB id from a previous merge. Unlike an Xtream `tmdb_id`, this is not
     * a provider claim — Stalker portals never send one, so its only source
     * is a match this app already made and gated.
     */
    readonly tmdbId?: number;
    /**
     * The title the detail view searched with (`info.name`). Absent when the
     * entry carries no `info`, in which case the caller keeps its own display
     * title — never a placeholder that would search for nothing.
     */
    readonly title?: string;
    readonly year: number | null;
}

function readString(value: unknown): string | undefined {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || undefined;
}

function readTmdbId(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Read the TMDB facts a stored Stalker item carries. The query fields mirror
 * `enrichStalkerSelectionWithTmdb` exactly — same title, same original
 * title, same year, same media type — so a lookup built from these hints
 * lands on the cache row the detail view already filled instead of minting a
 * second, weaker one.
 */
export function extractStalkerItemTmdbHints(
    item: StalkerPortalItem | Record<string, unknown> | null | undefined
): StalkerItemTmdbHints {
    const raw = (item ?? {}) as Record<string, unknown>;
    const info = (raw['info'] ?? {}) as Record<string, unknown>;

    const title = readString(info['name']);
    const categoryId = String(raw['category_id'] ?? '').toLowerCase();

    return {
        backdropUrl: readString(info['tmdb_backdrop']),
        mediaType:
            categoryId === 'series' || isStalkerSeriesItem(raw)
                ? 'tv'
                : 'movie',
        originalTitle: readString(info['o_name']),
        tmdbId: readTmdbId(info['tmdb_id']),
        title,
        year: extractYear(readString(info['releasedate']), title),
    };
}
