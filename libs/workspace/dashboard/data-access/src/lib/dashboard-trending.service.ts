import { computed, Injectable, inject, signal } from '@angular/core';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
    groupTitleMatchesByKey,
    pickTitleMatch,
} from '@iptvnator/services';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import type { TmdbTrendingEntry } from '@iptvnator/services';
import { DashboardDataService } from './dashboard-data.service';

/** One trending card: TMDB entry + optional library match for navigation */
export interface DashboardTrendingItem extends TmdbTrendingEntry {
    /** Confident match in an imported Xtream playlist, when found */
    match: CatalogTitleMatch | null;
}

/**
 * "Trending this week" dashboard rail data. Requires the TMDB opt-in and
 * (for availability matching / navigation) the Electron DB worker — the
 * rail is hidden in the PWA. Trending lists are cached for a day, and the
 * title match runs as ONE batched `matchTitles` call, fired only after the
 * dashboard's own data has loaded so it never competes for the worker.
 */
@Injectable({ providedIn: 'root' })
export class DashboardTrendingService {
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly titleMatch = inject(CatalogTitleMatchService);
    private readonly data = inject(DashboardDataService);

    private readonly loaded = signal<{
        entries: TmdbTrendingEntry[];
        matches: CatalogTitleMatch[];
    }>({ entries: [], matches: [] });
    /**
     * Trending entries with their library match, picked on READ from the
     * matches the parental lock does not withhold: a relock hides a match
     * found while unlocked, and a title that also exists in an unlocked
     * portal stays available through that copy.
     */
    readonly items = computed<DashboardTrendingItem[]>(() => {
        const { entries, matches } = this.loaded();
        const playlists = new Set(this.data.playlists().map(({ _id }) => _id));
        const grouped = groupTitleMatchesByKey(
            this.titleMatch.visibleMatches(
                matches.filter((match) => playlists.has(match.playlistId))
            )
        );
        return entries.map((entry) => ({
            ...entry,
            match: this.matchFor(entry, grouped),
        }));
    });
    readonly loading = signal(false);

    /** What the shown rail was loaded for; a load for the same inputs is skipped. */
    private loadedKey: string | null = null;

    get isAvailable(): boolean {
        return this.enrichment.isEnabled() && this.titleMatch.isAvailable;
    }

    /**
     * Runs once per TMDB language and imported-playlist set on success:
     * titles are localized, and the library matches link into playlists —
     * a deleted one would leave cards pointing nowhere, a new import would
     * stay unmatched. Empty or failed loads (TMDB temporarily unreachable)
     * do NOT latch, so the next dashboard visit retries instead of hiding
     * the rail until an app restart.
     */
    async load(): Promise<void> {
        if (this.loading() || !this.isAvailable) {
            return;
        }
        const key = this.loadKey();
        if (key === this.loadedKey) {
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
            this.loaded.set({ entries, matches });
            this.loadedKey = key;
        } catch (error) {
            console.warn('Dashboard trending load failed:', error);
        } finally {
            this.loading.set(false);
            // The call that noticed a change returned on the loading guard.
            if (this.loadKey() !== key) await this.load();
        }
    }

    private loadKey(): string {
        const playlists = this.data
            .playlists()
            .map((playlist) => playlist._id)
            .sort()
            .join(',');
        return `${this.enrichment.language()}//${playlists}`;
    }

    private matchFor(
        entry: TmdbTrendingEntry,
        grouped: ReadonlyMap<string, CatalogTitleMatch[]>
    ): CatalogTitleMatch | null {
        return pickTitleMatch(
            {
                type: entry.mediaType === 'movie' ? 'movie' : 'series',
                titles: [entry.title],
                year: entry.year,
            },
            grouped
        );
    }
}
