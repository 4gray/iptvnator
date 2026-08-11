import { Injectable, inject, signal } from '@angular/core';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
    buildTitleMatchIndex,
    extractYear,
    tmdbPosterUrl,
} from '@iptvnator/services';
import type { TmdbSearchResult } from '@iptvnator/services';
import {
    CatalogTitleMatch,
    normalizeTitleKeys,
    titleYearsCompatible,
} from '@iptvnator/shared/interfaces';
import { DashboardDataService } from './dashboard-data.service';
import {
    DashboardTmdbLookupItem,
    buildDashboardTmdbAttempts,
    dashboardTmdbLookupKey,
} from './dashboard-tmdb-lookup.util';

/** One recommendation card: TMDB entry + the library match that makes it playable */
export interface DashboardRecommendationItem {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    year: number | null;
    posterUrl: string | null;
    /** vote_average rounded to one decimal, null without votes */
    rating: string | null;
    /** Confident match in an imported Xtream playlist — unmatched entries are dropped */
    match: CatalogTitleMatch;
    /** Display title of the watched item this recommendation came from */
    seedTitle: string;
}

type RecommendationCandidate = Omit<DashboardRecommendationItem, 'match'>;

interface SeedRecommendations {
    resolved: boolean;
    seedTitle: string;
    entries: RecommendationCandidate[];
}

/**
 * Fewer confident matches than this hides the rail entirely — a rail of
 * two cards reads worse than no rail.
 */
export const MIN_RECOMMENDATION_MATCHES = 5;
const MAX_SEEDS = 3;
const MAX_ITEMS = 18;

/**
 * "Because you watched" dashboard rail data. TMDB has no account-free
 * "recommendations for you" endpoint, so the rail is seeded from the
 * user's most recently watched movies/series: each seed resolves through
 * the enrichment facade (items whose detail view was opened come straight
 * from the SQLite cache, where `recommendations` ride along with every
 * details payload), the per-seed lists are interleaved and deduplicated,
 * already watched/favorited titles are dropped, and ONE batched worker
 * request keeps only titles that exist in an imported library.
 *
 * Requires the TMDB opt-in and the Electron DB worker — hidden in the PWA.
 * A load is keyed by the seed set AND the watched/favorited exclusion set,
 * so watching something new re-seeds the rail and favoriting a recommended
 * title removes it on the next dashboard visit; failed loads (TMDB
 * unreachable) do not latch and retry instead. A load requested while one
 * is in flight is queued and re-run afterwards, so a mid-flight history
 * change cannot strand a stale rail.
 */
@Injectable({ providedIn: 'root' })
export class DashboardRecommendationsService {
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly titleMatch = inject(CatalogTitleMatchService);
    private readonly data = inject(DashboardDataService);

    readonly items = signal<DashboardRecommendationItem[]>([]);
    /** Seeds that contributed at least one visible card, most recent first */
    readonly seedTitles = signal<readonly string[]>([]);
    readonly loading = signal(false);

    private loadedKey: string | null = null;
    private rerunQueued = false;

    get isAvailable(): boolean {
        return this.enrichment.isEnabled() && this.titleMatch.isAvailable;
    }

    async load(): Promise<void> {
        if (!this.isAvailable) {
            return;
        }
        if (this.loading()) {
            // Re-run after the active load settles — its result may be for
            // a seed/exclusion set that just went stale.
            this.rerunQueued = true;
            return;
        }
        const seeds = this.selectSeeds();
        if (seeds.length === 0) {
            // The service outlives the dashboard (root-provided), so a
            // cleared watch history must clear the rail too.
            this.items.set([]);
            this.seedTitles.set([]);
            this.loadedKey = null;
            return;
        }
        const excluded = this.excludedTitleKeys();
        const loadKey = buildLoadKey(seeds, excluded);
        if (loadKey === this.loadedKey) {
            return;
        }

        this.loading.set(true);
        try {
            const perSeed = await Promise.all(
                seeds.map((seed) => this.recommendationsForSeed(seed))
            );
            // No seed resolved: TMDB is likely unreachable or every lookup
            // missed. Do NOT latch — the next dashboard visit retries.
            if (perSeed.some((seed) => seed.resolved)) {
                const candidates = this.mergeCandidates(
                    perSeed.map((seed) => seed.entries),
                    excluded
                );
                const matched = await this.attachMatches(candidates);
                const items =
                    matched.length >= MIN_RECOMMENDATION_MATCHES
                        ? matched
                        : [];

                const contributed = new Set(
                    items.map((item) => item.seedTitle)
                );
                this.items.set(items);
                this.seedTitles.set(
                    perSeed
                        .map((seed) => seed.seedTitle)
                        .filter((title) => contributed.has(title))
                );
                // Too few matches is a property of the library, not a
                // transient failure — latch so the same inputs are not
                // re-resolved on every dashboard visit.
                this.loadedKey = loadKey;
            }
        } catch (error) {
            console.warn('Dashboard recommendations load failed:', error);
        } finally {
            this.loading.set(false);
        }

        if (this.rerunQueued) {
            this.rerunQueued = false;
            await this.load();
        }
    }

    /** Most recent distinct watched VOD/series usable as TMDB lookups */
    private selectSeeds(): DashboardTmdbLookupItem[] {
        const seeds: DashboardTmdbLookupItem[] = [];
        const seen = new Set<string>();
        for (const item of this.data.globalRecentVodItems()) {
            if (buildDashboardTmdbAttempts(item).length === 0) {
                continue;
            }
            const key = dashboardTmdbLookupKey(item);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            seeds.push(item);
            if (seeds.length === MAX_SEEDS) {
                break;
            }
        }
        return seeds;
    }

    private async recommendationsForSeed(
        seed: DashboardTmdbLookupItem
    ): Promise<SeedRecommendations> {
        for (const attempt of buildDashboardTmdbAttempts(seed)) {
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
                return {
                    resolved: true,
                    seedTitle: attempt.title,
                    entries: toCandidates(
                        details.recommendations?.results ?? [],
                        attempt.mediaType,
                        attempt.title
                    ),
                };
            }
        }
        return { resolved: false, seedTitle: seed.title, entries: [] };
    }

    /**
     * Round-robin across the per-seed lists so one seed cannot crowd out
     * the others, dropping duplicates and anything the user has already
     * watched or favorited.
     */
    private mergeCandidates(
        lists: readonly RecommendationCandidate[][],
        excluded: ReadonlySet<string>
    ): RecommendationCandidate[] {
        const seen = new Set<string>();
        const merged: RecommendationCandidate[] = [];
        const longest = Math.max(0, ...lists.map((list) => list.length));
        for (let i = 0; i < longest; i++) {
            for (const list of lists) {
                const entry = list[i];
                if (!entry) {
                    continue;
                }
                // Title key too: matching is title-based, so two distinct
                // TMDB entries normalizing to one title would both claim
                // the same catalog row and render as duplicate cards.
                const idKey = `${entry.mediaType}:${entry.tmdbId}`;
                const titleKey = candidateTitleKey(entry);
                if (
                    seen.has(idKey) ||
                    seen.has(titleKey) ||
                    excluded.has(titleKey)
                ) {
                    continue;
                }
                seen.add(idKey);
                seen.add(titleKey);
                merged.push(entry);
            }
        }
        return merged;
    }

    private excludedTitleKeys(): Set<string> {
        const keys = new Set<string>();
        const add = (item: { type: string; title: string }): void => {
            if (item.type === 'movie' || item.type === 'series') {
                keys.add(
                    `${item.type}:${normalizeTitleKeys(item.title).exact}`
                );
            }
        };
        this.data.globalRecentItems().forEach(add);
        this.data.globalFavoriteItems().forEach(add);
        return keys;
    }

    private async attachMatches(
        candidates: readonly RecommendationCandidate[]
    ): Promise<DashboardRecommendationItem[]> {
        if (candidates.length === 0) {
            return [];
        }
        const matches = await this.titleMatch.matchTitles(
            candidates.map((candidate) => candidate.title)
        );
        const index = buildTitleMatchIndex(matches);

        const items: DashboardRecommendationItem[] = [];
        for (const candidate of candidates) {
            const match = index.get(candidateTitleKey(candidate)) ?? null;
            if (
                !match ||
                !titleYearsCompatible(candidate.year, match.trailingYear)
            ) {
                continue;
            }
            items.push({ ...candidate, match });
            if (items.length === MAX_ITEMS) {
                break;
            }
        }
        return items;
    }
}

function candidateTitleKey(candidate: RecommendationCandidate): string {
    const type = candidate.mediaType === 'movie' ? 'movie' : 'series';
    return `${type}:${normalizeTitleKeys(candidate.title).exact}`;
}

/**
 * Identity of one load: the seed set plus the watched/favorited exclusion
 * set. Including the exclusions means favoriting a recommended title (or
 * new watch history that does not change the top seeds) still invalidates
 * the latch and re-filters the rail.
 */
function buildLoadKey(
    seeds: readonly DashboardTmdbLookupItem[],
    excluded: ReadonlySet<string>
): string {
    return `${seeds.map(dashboardTmdbLookupKey).join('||')}##${[...excluded]
        .sort()
        .join('|')}`;
}

function toCandidates(
    results: readonly TmdbSearchResult[],
    mediaType: 'movie' | 'tv',
    seedTitle: string
): RecommendationCandidate[] {
    return results
        .map((result) => {
            const title = result.title ?? result.name ?? '';
            const rating =
                (result.vote_count ?? 0) > 0 && result.vote_average
                    ? result.vote_average.toFixed(1)
                    : null;
            return {
                tmdbId: result.id,
                mediaType,
                title,
                year: extractYear(result.release_date ?? result.first_air_date),
                posterUrl: tmdbPosterUrl(result.poster_path),
                rating,
                seedTitle,
            };
        })
        .filter((entry) => entry.tmdbId > 0 && entry.title !== '');
}
