import { Injectable, inject, signal } from '@angular/core';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
    buildTitleMatchIndex,
} from '@iptvnator/services';
import {
    CatalogTitleMatch,
    normalizeTitleKeys,
    titleYearsCompatible,
} from '@iptvnator/shared/interfaces';
import type { TmdbTrendingEntry } from '@iptvnator/services';

/** One trending card: TMDB entry + optional library match for navigation */
export interface DashboardTrendingItem extends TmdbTrendingEntry {
    /** Confident match in an imported Xtream playlist, when found */
    match: CatalogTitleMatch | null;
}

/**
 * "Trending this week" dashboard rail data. Requires the TMDB opt-in and
 * (for availability matching / navigation) the Electron DB worker — the
 * rail is hidden in the PWA. Trending lists are cached for a day, and the
 * title match runs as ONE batched worker request, fired only after the
 * dashboard's own data has loaded so it never competes for the worker.
 */
@Injectable({ providedIn: 'root' })
export class DashboardTrendingService {
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly titleMatch = inject(CatalogTitleMatchService);

    readonly items = signal<DashboardTrendingItem[]>([]);
    readonly loading = signal(false);

    private loadedOnce = false;

    get isAvailable(): boolean {
        return this.enrichment.isEnabled() && this.titleMatch.isAvailable;
    }

    /**
     * Runs once per app session on success. Empty or failed loads (TMDB
     * temporarily unreachable) do NOT latch, so the next dashboard visit
     * retries instead of hiding the rail until an app restart.
     */
    async load(): Promise<void> {
        if (this.loadedOnce || this.loading() || !this.isAvailable) {
            return;
        }
        this.loading.set(true);

        try {
            const entries = await this.enrichment.getTrendingWeek();
            if (entries.length === 0) {
                return;
            }

            const matches = await this.titleMatch.matchTitles(
                entries.map((entry) => entry.title)
            );
            const index = buildTitleMatchIndex(matches);

            this.items.set(
                entries.map((entry) => ({
                    ...entry,
                    match: this.matchFor(entry, index),
                }))
            );
            this.loadedOnce = true;
        } catch (error) {
            console.warn('Dashboard trending load failed:', error);
        } finally {
            this.loading.set(false);
        }
    }

    private matchFor(
        entry: TmdbTrendingEntry,
        index: ReadonlyMap<string, CatalogTitleMatch>
    ): CatalogTitleMatch | null {
        const type = entry.mediaType === 'movie' ? 'movie' : 'series';
        const key = `${type}:${normalizeTitleKeys(entry.title).exact}`;
        const match = index.get(key) ?? null;
        return match && titleYearsCompatible(entry.year, match.trailingYear)
            ? match
            : null;
    }
}
