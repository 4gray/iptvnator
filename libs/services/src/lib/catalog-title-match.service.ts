import { Injectable } from '@angular/core';
import {
    CatalogTitleMatch,
    normalizeTitleKeys,
    titleYearsCompatible,
} from '@iptvnator/shared/interfaces';

/** What one caller is looking for, in catalog-match terms */
export interface CatalogTitleLookup {
    readonly type: 'movie' | 'series';
    /**
     * Title aliases to try, most-trusted first. Usually a single title; a
     * caller that also knows an original-language title passes it second,
     * since a catalog often names an item in its original language while
     * the app language localizes the TMDB title.
     */
    readonly titles: readonly string[];
    /** Release year, or null when unknown — unknown never rejects a row */
    readonly year: number | null;
}

/**
 * EVERY match per `type:exactNormalizedTitle`, in the order the worker
 * returned them.
 *
 * Deliberately not collapsed to one row per key: the year that decides
 * between same-titled rows belongs to the LOOKUP, which this function
 * cannot see. A catalog holding both "Dune 1984" and "Dune 2021" would
 * otherwise keep whichever arrived first, and a 2021 lookup would then
 * fail its year check with the right row already discarded — rendering
 * as "not in your library" for a movie the library does hold.
 */
export function groupTitleMatchesByKey(
    matches: readonly CatalogTitleMatch[]
): Map<string, CatalogTitleMatch[]> {
    const grouped = new Map<string, CatalogTitleMatch[]>();
    for (const match of matches) {
        const key = `${match.type}:${normalizeTitleKeys(match.queryTitle).exact}`;
        const rows = grouped.get(key);
        if (rows) {
            rows.push(match);
        } else {
            grouped.set(key, [match]);
        }
    }
    return grouped;
}

/**
 * The catalog row this lookup should resolve to, or null.
 *
 * Aliases are tried in order, but ranking is by EVIDENCE across all of
 * them at once — a bad hit under the first alias must not veto a good one
 * under the second. A row whose stripped year IS the lookup's wins: that
 * is positive evidence for this exact film, while an untagged row merely
 * fails to contradict one ("Dune" could be either cut, so resolving a
 * 2021 lookup to it when "Dune 2021" also exists throws better evidence
 * away). Untagged rows come next — the only tier reachable when the
 * lookup's own year is unknown — then anything else year-compatible.
 * Alias order survives as the tiebreaker within a tier.
 */
export function pickTitleMatch(
    lookup: CatalogTitleLookup,
    grouped: ReadonlyMap<string, CatalogTitleMatch[]>
): CatalogTitleMatch | null {
    const compatible: CatalogTitleMatch[] = [];
    const seenKeys = new Set<string>();
    for (const title of lookup.titles) {
        const key = `${lookup.type}:${normalizeTitleKeys(title).exact}`;
        // Aliases routinely normalize to one key (TMDB repeats the title
        // as original_title for English-language items). Re-scanning it
        // cannot change the pick, so this only skips the wasted pass.
        if (seenKeys.has(key)) {
            continue;
        }
        seenKeys.add(key);
        for (const row of grouped.get(key) ?? []) {
            if (titleYearsCompatible(lookup.year, row.trailingYear)) {
                compatible.push(row);
            }
        }
    }

    return (
        (lookup.year !== null
            ? compatible.find((row) => row.trailingYear === lookup.year)
            : undefined) ??
        compatible.find((row) => row.trailingYear === null) ??
        compatible[0] ??
        null
    );
}

/**
 * Cross-playlist title matching via the Electron DB worker
 * (`DB_MATCH_TITLES`, trigram FTS over all imported Xtream playlists).
 * Unavailable in the PWA — `isAvailable` gates the actor page's
 * "All portals" scope.
 */
@Injectable({ providedIn: 'root' })
export class CatalogTitleMatchService {
    get isAvailable(): boolean {
        return (
            typeof window !== 'undefined' &&
            typeof window.electron?.dbMatchTitles === 'function'
        );
    }

    async matchTitles(titles: string[]): Promise<CatalogTitleMatch[]> {
        if (!this.isAvailable || titles.length === 0) {
            return [];
        }

        try {
            return await window.electron.dbMatchTitles(titles);
        } catch (error) {
            console.warn('Cross-playlist title matching failed:', error);
            return [];
        }
    }
}
