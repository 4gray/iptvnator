import { Injectable, inject, signal } from '@angular/core';
import {
    TmdbEnrichmentService,
    extractYear,
    tmdbBackdropUrl,
    type TmdbMatchService,
} from '@iptvnator/services';
import {
    DashboardTmdbMatchItem,
    buildDashboardTmdbAttempts,
    dashboardTmdbLookupKey,
    dashboardTmdbMatchToken,
    resolveDashboardTmdbDetails,
} from '@iptvnator/workspace/dashboard/data-access';

/** TMDB extras for the dashboard hero, patched in after first paint */
export interface DashboardHeroTmdbExtras {
    readonly backdropUrl: string | null;
    readonly rating: string | null;
    readonly genres: readonly string[];
    /** TMDB plot, in the enrichment language; null when TMDB has none */
    readonly overview: string | null;
    /** Release (movie) or first-air (series) year */
    readonly year: number | null;
}

/** Everything the hero lookup reads off an activity row */
export type DashboardHeroTmdbItem = DashboardTmdbMatchItem;

const MAX_HERO_GENRES = 2;

/**
 * Best-effort TMDB extras for the hero slides (backdrop, rating, genres,
 * overview, year).
 * Goes through the enrichment facade, so items already opened in a detail
 * view resolve from the SQLite cache without network. Found extras are
 * memoized per lookup identity for the session — dashboard revisits skip
 * the IPC round-trip; a lookup that found nothing is asked again.
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
    /**
     * The viewer's TMDB match choices, once their store has loaded. A signal:
     * keys computed before it loaded lack the choice, and must be computed
     * again (the presenter's effect reads `keyFor`). Loaded on first use
     * with TMDB on, so the store stays off startup.
     */
    private readonly matches = signal<TmdbMatchService | null>(null);
    private matchesRequested = false;

    private loadMatches(): void {
        if (this.matchesRequested || !this.enrichment.isEnabled()) return;
        this.matchesRequested = true;
        void this.enrichment
            .getMatches?.()
            .then((matches) => this.matches.set(matches));
    }

    /** Reactive when read inside a computed (settings signal underneath) */
    isEnabled(): boolean {
        return this.enrichment.isEnabled();
    }

    /**
     * Identity of the lookup for an item — the memo key, and the staleness
     * guard callers compare against while a request is in flight. The TMDB
     * language is part of it: the overview and genre names are localized,
     * so a language change must load them again. Reactive when read inside
     * a computed or effect (settings signal underneath).
     */
    keyFor(item: DashboardHeroTmdbItem): string {
        // The viewer's match choice too: a title re-matched in its detail
        // view must not keep the previous match's extras.
        this.loadMatches();
        return `${this.enrichment.language()}//${dashboardTmdbLookupKey(
            item
        )}//${dashboardTmdbMatchToken(this.matches(), item)}`;
    }

    getExtras(
        item: DashboardHeroTmdbItem
    ): Promise<DashboardHeroTmdbExtras | null> {
        if (
            !this.enrichment.isEnabled() ||
            buildDashboardTmdbAttempts(item).length === 0
        ) {
            return Promise.resolve(null);
        }

        const key = this.keyFor(item);
        const cached = this.memo.get(key);
        if (cached) {
            return cached;
        }

        const pending = this.loadExtras(item);
        this.memo.set(key, pending);
        // Only answers are kept for the session. A null may be a failed or
        // offline lookup, so the next visit asks again; a lasting miss is
        // remembered by the enrichment layer's own cache, not here.
        void pending.then((extras) => {
            if (extras === null && this.memo.get(key) === pending) {
                this.memo.delete(key);
            }
        });
        return pending;
    }

    /** Through the shared resolver, so the viewer's match choice holds. */
    private async loadExtras(
        item: DashboardHeroTmdbItem
    ): Promise<DashboardHeroTmdbExtras | null> {
        try {
            const resolved = await resolveDashboardTmdbDetails(
                this.enrichment,
                item
            );
            return resolved?.details ? toHeroExtras(resolved.details) : null;
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
    overview?: string;
    release_date?: string;
    first_air_date?: string;
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
        overview: details.overview?.trim() || null,
        year: extractYear(details.release_date ?? details.first_air_date),
    };
}
