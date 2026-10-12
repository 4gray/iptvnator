import { inject, Injectable } from '@angular/core';
import {
    CatalogTitleMatch,
    normalizeTitleKeys,
    titleYearsCompatible,
} from '@iptvnator/shared/interfaces';
import { ParentalLockService } from './parental-lock/parental-lock.service';

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
 * Titles per `DB_MATCH_TITLES` request. The DB worker answers one request
 * at a time and runs a ranked FTS query per title, a second or more for a
 * common word on a large catalog; a whole rail's batch in one request held
 * every other read (the dashboard's playback positions among them) behind
 * it for up to a minute and a half. Small requests, sent one after
 * another, let those reads in between.
 */
export const TITLE_MATCH_REQUEST_SIZE = 5;

/** Distinct titles matched per call: the worker's MAX_TITLES_PER_REQUEST. */
export const TITLE_MATCH_TITLE_LIMIT = 200;

/**
 * Times a batch starts over when the parental lock changes while it runs;
 * a lock that keeps changing yields no matches rather than a mixed answer.
 */
export const TITLE_MATCH_LOCK_ATTEMPTS = 3;

const LOCK_CHANGED = Symbol('lock changed');

/**
 * Cross-playlist title matching via the Electron DB worker
 * (`DB_MATCH_TITLES`, trigram FTS over all imported Xtream playlists), in
 * requests of TITLE_MATCH_REQUEST_SIZE titles.
 * Unavailable in the PWA — `isAvailable` gates the actor page's
 * "All portals" scope.
 */
@Injectable({ providedIn: 'root' })
export class CatalogTitleMatchService {
    private readonly parentalLock = inject(ParentalLockService);

    get isAvailable(): boolean {
        return (
            typeof window !== 'undefined' &&
            typeof window.electron?.dbMatchTitles === 'function'
        );
    }

    async matchTitles(titles: string[]): Promise<CatalogTitleMatch[]> {
        // The worker filters locked rows by its own lock state and index;
        // while the lock withholds everything (store unreadable, or a
        // bridge without the worker filter) neither can be trusted.
        if (
            !this.isAvailable ||
            titles.length === 0 ||
            this.parentalLock.withholdsEverything()
        ) {
            return [];
        }

        // The worker dedupes and caps each request; doing both here first
        // keeps the overall cap and the result order of one big request.
        const unique = [
            ...new Set(
                titles.filter(
                    (title) => typeof title === 'string' && title.trim() !== ''
                )
            ),
        ].slice(0, TITLE_MATCH_TITLE_LIMIT);
        // One request ran under one lock state; a batch must too. If the
        // lock changes between requests (a relock, an unlock, a changed
        // lock list), the earlier answers were filtered under the old state
        // and the batch starts over.
        for (let attempt = 0; attempt < TITLE_MATCH_LOCK_ATTEMPTS; attempt++) {
            const matches = await this.matchUnderOneLockState(unique);
            if (matches !== LOCK_CHANGED) {
                return matches;
            }
        }
        return [];
    }

    private async matchUnderOneLockState(
        titles: readonly string[]
    ): Promise<CatalogTitleMatch[] | typeof LOCK_CHANGED> {
        const lockVersion = this.parentalLock.version();
        const matches: CatalogTitleMatch[] = [];
        for (
            let start = 0;
            start < titles.length;
            start += TITLE_MATCH_REQUEST_SIZE
        ) {
            try {
                matches.push(
                    ...(await window.electron.dbMatchTitles(
                        titles.slice(start, start + TITLE_MATCH_REQUEST_SIZE)
                    ))
                );
            } catch (error) {
                // All or nothing, as with one request: callers treat an
                // empty answer as a failed lookup they may run again.
                console.warn('Cross-playlist title matching failed:', error);
                return [];
            }
            // The lock can close while a request runs, the last one too.
            if (this.parentalLock.withholdsEverything()) {
                return [];
            }
            if (this.parentalLock.version() !== lockVersion) {
                return LOCK_CHANGED;
            }
        }
        return matches;
    }

    /**
     * Whether the parental lock withholds this match's category now. It
     * reads the lock state, so a `computed` that filters with it re-runs on
     * every relock and unlock: matches cached while unlocked (or returned
     * by a lookup issued before a relock) must not keep advertising a
     * locked title or its playlist name.
     */
    isWithheld(match: CatalogTitleMatch): boolean {
        return this.parentalLock.isXtreamCategoryLocked(
            match.playlistId,
            match.type === 'movie' ? 'movies' : 'series',
            match.categoryId
        );
    }

    /** `matches` without the ones the lock withholds; reactive, see above. */
    visibleMatches(matches: readonly CatalogTitleMatch[]): CatalogTitleMatch[] {
        return matches.filter((match) => !this.isWithheld(match));
    }
}
