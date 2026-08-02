import { Injectable, inject } from '@angular/core';
import {
    TmdbEnrichmentService,
    extractYear,
    tmdbBackdropUrl,
} from '@iptvnator/services';
import {
    TmdbMediaType,
    extractStalkerItemTmdbHints,
} from '@iptvnator/shared/interfaces';
import type { GlobalRecentItem } from '@iptvnator/workspace/dashboard/data-access';

/** TMDB extras for the dashboard hero, patched in after first paint */
export interface DashboardHeroTmdbExtras {
    readonly backdropUrl: string | null;
    readonly rating: string | null;
    readonly genres: readonly string[];
}

/** Everything the hero lookup reads off an activity row */
export type DashboardHeroTmdbItem = Pick<
    GlobalRecentItem,
    'title' | 'type' | 'stalker_item'
>;

/**
 * One lookup attempt: a media type plus the query to run under it. The
 * TMDB id belongs to exactly one media type, so a second attempt under the
 * other one must drop it — `/movie/<tv id>` resolves to an unrelated film
 * whose details would then be rendered as this item's.
 */
interface HeroTmdbAttempt {
    readonly mediaType: TmdbMediaType;
    readonly title: string;
    readonly originalTitle?: string;
    readonly tmdbId?: number;
    readonly year: number | null;
}

const MAX_HERO_GENRES = 2;

/**
 * Best-effort TMDB extras for the hero card (backdrop, rating, genres).
 * Goes through the enrichment facade, so items already opened in a detail
 * view resolve from the SQLite cache without network. Results are memoized
 * per lookup identity for the session — dashboard revisits skip the IPC
 * round-trip.
 *
 * The query is built to match what the detail view searched with, not just
 * what the card displays. A title alone is weaker identity than the detail
 * page had: without a year `pickConfidentMatch` falls back to requiring a
 * single exact title match, which common titles never satisfy, and the miss
 * is cached under a lookup key the detail view's hit can never be found at.
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
     * guard callers compare against while a request is in flight. Derived
     * here so the two can never disagree about what "the same hero" means.
     */
    keyFor(item: DashboardHeroTmdbItem): string {
        const [primary] = this.buildAttempts(item);
        return primary
            ? [
                  primary.mediaType,
                  primary.title,
                  primary.originalTitle ?? '',
                  primary.year ?? '',
                  primary.tmdbId ?? '',
              ].join('|')
            : `${item.type}:${item.title}`;
    }

    getExtras(
        item: DashboardHeroTmdbItem
    ): Promise<DashboardHeroTmdbExtras | null> {
        const attempts = this.buildAttempts(item);
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

    /**
     * Ordered lookup attempts for one activity row. Stalker rows carry the
     * facts of the detail view's own enrichment, so they lead with those;
     * everything else can only offer the display title.
     *
     * A `'movie'` verdict gets a second attempt under `'tv'`, because
     * `'movie'` is what every row falls back to when nothing says otherwise
     * — an embedded-VOD ("vclub") series is a `'movie'` activity row, and a
     * lazily-loaded Ministra item can be stored before its series marker is
     * known. The retry drops the id (`/movie/<tv id>` resolves to an
     * unrelated film), so a wrong default costs one negatively-cached search
     * rather than another title's metadata.
     *
     * `'tv'` gets no such retry. It is only ever reached on positive
     * evidence — a series category, an `is_series` flag, or a non-empty
     * episode array — and retrying it as a movie would trade that evidence
     * for a same-title film: the gate cannot tell an adaptation sharing its
     * show's name and year from the show itself.
     */
    private buildAttempts(item: DashboardHeroTmdbItem): HeroTmdbAttempt[] {
        if (item.type !== 'movie' && item.type !== 'series') {
            return [];
        }

        const hints = item.stalker_item
            ? extractStalkerItemTmdbHints(item.stalker_item)
            : null;
        const title = hints?.title ?? item.title;
        // A stalker entry with no usable name falls back to the placeholder
        // `extractStalkerItemTitle` produces. The detail view refuses to
        // enrich those, and so must this — "Unknown" is itself a real film
        // title (2011), so searching for it attaches another movie's data.
        if (!title || (hints !== null && !hints.title && title === 'Unknown')) {
            return [];
        }

        const mediaType: TmdbMediaType =
            hints?.mediaType ?? (item.type === 'series' ? 'tv' : 'movie');
        const year = hints?.year ?? extractYear(null, title);
        const primary: HeroTmdbAttempt = {
            mediaType,
            title,
            originalTitle: hints?.originalTitle,
            tmdbId: hints?.tmdbId,
            year,
        };

        return mediaType === 'movie'
            ? [primary, { ...primary, mediaType: 'tv', tmdbId: undefined }]
            : [primary];
    }

    private async loadExtras(
        attempts: readonly HeroTmdbAttempt[]
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
