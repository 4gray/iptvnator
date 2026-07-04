import { Injectable } from '@angular/core';
import {
    CatalogTitleMatch,
    normalizeTitleKeys,
} from '@iptvnator/shared/interfaces';

/**
 * Index of matches keyed by `type:exactNormalizedTitle` for O(1) lookups
 * when mapping a filmography onto the match list. Exact-title matches
 * (trailingYear === null) win over year-stripped ones for the same key.
 */
export function buildTitleMatchIndex(
    matches: readonly CatalogTitleMatch[]
): Map<string, CatalogTitleMatch> {
    const index = new Map<string, CatalogTitleMatch>();
    for (const match of matches) {
        const key = `${match.type}:${normalizeTitleKeys(match.queryTitle).exact}`;
        const existing = index.get(key);
        if (
            !existing ||
            (existing.trailingYear !== null && match.trailingYear === null)
        ) {
            index.set(key, match);
        }
    }
    return index;
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
