import { Injectable, inject } from '@angular/core';
import { TmdbEnrichmentService, tmdbBackdropUrl } from '@iptvnator/services';
import {
    DashboardTmdbAttempt,
    DashboardTmdbLookupItem,
    buildDashboardTmdbAttempts,
    dashboardTmdbLookupKey,
} from '@iptvnator/workspace/dashboard/data-access';

/** TMDB extras for the dashboard hero, patched in after first paint */
export interface DashboardHeroTmdbExtras {
    readonly backdropUrl: string | null;
    readonly rating: string | null;
    readonly genres: readonly string[];
}

/** Everything the hero lookup reads off an activity row */
export type DashboardHeroTmdbItem = DashboardTmdbLookupItem;

const MAX_HERO_GENRES = 2;

/**
 * Best-effort TMDB extras for the hero card (backdrop, rating, genres).
 * Goes through the enrichment facade, so items already opened in a detail
 * view resolve from the SQLite cache without network. Results are memoized
 * per lookup identity for the session — dashboard revisits skip the IPC
 * round-trip.
 *
 * The lookup attempts and their identity key are shared with the
 * recommendations rail (`dashboard-tmdb-lookup.util.ts`), so the two can
 * never disagree about how an activity row resolves to TMDB.
 */
@Injectable({ providedIn: 'root' })
export class DashboardHeroTmdbService {
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly memo = new Map<
        string,
        Promise<DashboardHeroTmdbExtras | null>
    >();

    /** Reactive when read inside a computed (settings signal underneath) */
    isEnabled(): boolean {
        return this.enrichment.isEnabled();
    }

    /**
     * Identity of the lookup for an item — the memo key, and the staleness
     * guard callers compare against while a request is in flight.
     */
    keyFor(item: DashboardHeroTmdbItem): string {
        return dashboardTmdbLookupKey(item);
    }

    getExtras(
        item: DashboardHeroTmdbItem
    ): Promise<DashboardHeroTmdbExtras | null> {
        const attempts = buildDashboardTmdbAttempts(item);
        if (!this.enrichment.isEnabled() || attempts.length === 0) {
            return Promise.resolve(null);
        }

        const key = this.keyFor(item);
        const cached = this.memo.get(key);
        if (cached) {
            return cached;
        }

        const pending = this.loadExtras(attempts);
        this.memo.set(key, pending);
        return pending;
    }

    private async loadExtras(
        attempts: readonly DashboardTmdbAttempt[]
    ): Promise<DashboardHeroTmdbExtras | null> {
        try {
            for (const attempt of attempts) {
                const query = {
                    title: attempt.title,
                    originalTitle: attempt.originalTitle,
                    tmdbId: attempt.tmdbId,
                    year: attempt.year,
                };
                const details =
                    attempt.mediaType === 'tv'
                        ? await this.enrichment.enrichTv(query)
                        : await this.enrichment.enrichMovie(query);
                if (details) {
                    return toHeroExtras(details);
                }
            }

            return null;
        } catch (error) {
            console.warn('Dashboard hero TMDB extras failed:', error);
            return null;
        }
    }
}

function toHeroExtras(details: {
    backdrop_path?: string | null;
    vote_average?: number;
    vote_count?: number;
    genres?: { name?: string }[];
}): DashboardHeroTmdbExtras {
    const rating =
        (details.vote_count ?? 0) > 0 && details.vote_average
            ? details.vote_average.toFixed(1)
            : null;

    return {
        backdropUrl: tmdbBackdropUrl(details.backdrop_path),
        rating,
        genres: (details.genres ?? [])
            .map((genre) => genre.name)
            .filter((name): name is string => Boolean(name))
            .slice(0, MAX_HERO_GENRES),
    };
}
