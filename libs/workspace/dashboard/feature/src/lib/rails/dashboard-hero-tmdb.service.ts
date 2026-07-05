import { Injectable, inject } from '@angular/core';
import {
    TmdbEnrichmentService,
    extractYear,
    tmdbBackdropUrl,
} from '@iptvnator/services';
import type { GlobalRecentItem } from '@iptvnator/workspace/dashboard/data-access';

/** TMDB extras for the dashboard hero, patched in after first paint */
export interface DashboardHeroTmdbExtras {
    readonly backdropUrl: string | null;
    readonly rating: string | null;
    readonly genres: readonly string[];
}

const MAX_HERO_GENRES = 2;

/**
 * Best-effort TMDB extras for the hero card (backdrop, rating, genres).
 * Goes through the enrichment facade, so items already opened in a detail
 * view resolve from the SQLite cache without network. Results are memoized
 * per title for the session — dashboard revisits skip the IPC round-trip.
 */
@Injectable({ providedIn: 'root' })
export class DashboardHeroTmdbService {
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly memo = new Map<
        string,
        Promise<DashboardHeroTmdbExtras | null>
    >();

    getExtras(
        item: Pick<GlobalRecentItem, 'title' | 'type'>
    ): Promise<DashboardHeroTmdbExtras | null> {
        if (
            !this.enrichment.isEnabled() ||
            (item.type !== 'movie' && item.type !== 'series')
        ) {
            return Promise.resolve(null);
        }

        const key = `${item.type}:${item.title}`;
        const cached = this.memo.get(key);
        if (cached) {
            return cached;
        }

        const pending = this.loadExtras(item);
        this.memo.set(key, pending);
        return pending;
    }

    private async loadExtras(
        item: Pick<GlobalRecentItem, 'title' | 'type'>
    ): Promise<DashboardHeroTmdbExtras | null> {
        try {
            const query = {
                title: item.title,
                year: extractYear(null, item.title),
            };
            const details =
                item.type === 'movie'
                    ? await this.enrichment.enrichMovie(query)
                    : await this.enrichment.enrichTv(query);
            if (!details) {
                return null;
            }

            const rating =
                (details.vote_count ?? 0) > 0 && details.vote_average
                    ? details.vote_average.toFixed(1)
                    : null;
            const genres = (details.genres ?? [])
                .map((genre) => genre.name)
                .filter(Boolean)
                .slice(0, MAX_HERO_GENRES);

            return {
                backdropUrl: tmdbBackdropUrl(details.backdrop_path),
                rating,
                genres,
            };
        } catch (error) {
            console.warn('Dashboard hero TMDB extras failed:', error);
            return null;
        }
    }
}
