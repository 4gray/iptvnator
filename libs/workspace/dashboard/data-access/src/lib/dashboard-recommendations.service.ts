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
    /**
     * TMDB original title when it differs from the localized one — a
     * matching/exclusion alias, never displayed. Catalogs frequently name
     * an item in its original language while the app language localizes
     * the TMDB title, so matching on the localized form alone would hide
     * available recommendations.
     */
    originalTitle: string | null;
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
 * What the user has already watched or favorited, in the two forms a
 * recommendation can collide with.
 */
interface ExclusionIndex {
    /** `type:exactNormalizedTitle` — the stored title as it normalizes */
    readonly exact: ReadonlySet<string>;
    /**
     * `type:baseNormalizedTitle` → the trailing years stripped from the
     * stored titles that produced it. Only titles that HAD a trailing
     * year appear here, so the base tier is always year-gated.
     */
    readonly baseYears: ReadonlyMap<string, readonly number[]>;
}

/** Normalized keys for one candidate alias, both matching tiers */
interface CandidateKeys {
    readonly exact: string;
    readonly base: string;
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
        const excluded = this.buildExclusionIndex();
        // The language is part of the identity: TMDB payloads (and thus
        // card titles) are localized, so a language change must reload —
        // the service outlives the dashboard and would otherwise keep
        // titles in the previous language all session.
        const loadKey = `${this.enrichment.language()}//${buildLoadKey(
            seeds,
            excluded,
            this.catalogKey()
        )}`;
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
                if (matched.length >= MIN_RECOMMENDATION_MATCHES) {
                    const contributed = new Set(
                        matched.map((item) => item.seedTitle)
                    );
                    this.items.set(matched);
                    this.seedTitles.set(
                        perSeed
                            .map((seed) => seed.seedTitle)
                            .filter((title) => contributed.has(title))
                    );
                    this.loadedKey = loadKey;
                } else {
                    // Below the threshold the rail is hidden — and NOT
                    // latched: an empty match result is indistinguishable
                    // from a transient worker failure at this layer
                    // (matchTitles maps failures to []), and re-running is
                    // cheap (cached enrichment + one batched worker call).
                    // Mirrors the trending rail's retry-on-empty semantics.
                    // The PREVIOUS key must reset too: it described the
                    // rail that was just cleared, and returning to those
                    // exact inputs (say, un-favoriting again) would
                    // otherwise hit the equality guard and stay empty.
                    this.items.set([]);
                    this.seedTitles.set([]);
                    this.loadedKey = null;
                }
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

    /**
     * Identity of the imported-playlist set. Included in the load key so
     * importing or deleting a playlist re-runs the catalog matching —
     * without it a deleted playlist would leave cards linking nowhere and
     * a new import would stay invisible until the seeds changed. A
     * refreshed playlist keeps its id and is NOT detected (parity with
     * the trending rail's once-per-session load).
     */
    private catalogKey(): string {
        return this.data
            .playlists()
            .map((playlist) => playlist._id)
            .sort()
            .join(',');
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
        excluded: ExclusionIndex
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
                // Title keys too (localized AND original alias): matching
                // is title-based, so two distinct TMDB entries normalizing
                // to one title would both claim the same catalog row and
                // render as duplicate cards — and a watched title stored
                // under its original language must still exclude its
                // localized recommendation.
                const idKey = `${entry.mediaType}:${entry.tmdbId}`;
                const titleKeys = candidateTitleKeys(entry);
                if (
                    seen.has(idKey) ||
                    titleKeys.some((key) => seen.has(key)) ||
                    isExcludedCandidate(entry, excluded)
                ) {
                    continue;
                }
                seen.add(idKey);
                titleKeys.forEach((key) => seen.add(key));
                merged.push(entry);
            }
        }
        return merged;
    }

    /**
     * What the user has already watched or favorited, keyed the way a
     * recommendation will be looked up.
     *
     * An activity row is indexed under more than its display title,
     * because two things about it can disagree with TMDB:
     *
     * - its TYPE is a routing verdict, not a media type. A Stalker
     *   embedded-VOD series routes into the VOD section and is stored as
     *   `'movie'`, while TMDB knows it as a show — so the show's
     *   recommendation would look up `series:` and sail past a
     *   `movie:`-only entry. The lookup builder already resolves the
     *   media type the detail view enriched under; that verdict is
     *   indexed alongside the routing one.
     * - its TITLE may be the original-language one (`info.o_name`) while
     *   the app requests TMDB in another language, so the candidate
     *   carries a translated title and no shared key.
     *
     * Only the PRIMARY attempt is indexed. The builder's second attempt
     * is a fallback guess for rows that state nothing, and indexing it
     * would let a watched film exclude the same-named show.
     */
    private buildExclusionIndex(): ExclusionIndex {
        const exact = new Set<string>();
        const baseYears = new Map<string, number[]>();

        const addTitle = (
            type: 'movie' | 'series',
            title: string | undefined
        ): void => {
            const keys = normalizeTitleKeys(title);
            if (!keys.exact) {
                return;
            }
            exact.add(`${type}:${keys.exact}`);
            // Providers routinely store titles with a trailing release
            // year ("Inception 2010") whose exact key can never equal the
            // canonical TMDB title. Record the base + year so the merge
            // can exclude the canonical form when the years agree.
            if (keys.trailingYear !== null) {
                const baseKey = `${type}:${keys.base}`;
                baseYears.set(baseKey, [
                    ...(baseYears.get(baseKey) ?? []),
                    keys.trailingYear,
                ]);
            }
        };

        const add = (item: DashboardTmdbLookupItem): void => {
            if (item.type !== 'movie' && item.type !== 'series') {
                return;
            }
            addTitle(item.type, item.title);

            const [primary] = buildDashboardTmdbAttempts(item);
            if (primary) {
                const type = primary.mediaType === 'tv' ? 'series' : 'movie';
                addTitle(type, primary.title);
                addTitle(type, primary.originalTitle);
            }
        };

        this.data.globalRecentItems().forEach(add);
        this.data.globalFavoriteItems().forEach(add);
        return { exact, baseYears };
    }

    private async attachMatches(
        candidates: readonly RecommendationCandidate[]
    ): Promise<DashboardRecommendationItem[]> {
        if (candidates.length === 0) {
            return [];
        }
        // Both aliases go into the ONE batched request; the index lookup
        // below prefers the localized form. Built with a loop rather than
        // flatMap — the web app compiles this lib against `lib: es2018`,
        // which predates Array.prototype.flatMap.
        const queryTitles: string[] = [];
        for (const candidate of candidates) {
            queryTitles.push(candidate.title);
            if (candidate.originalTitle) {
                queryTitles.push(candidate.originalTitle);
            }
        }
        const matches = await this.titleMatch.matchTitles(queryTitles);
        const index = buildTitleMatchIndex(matches);

        const items: DashboardRecommendationItem[] = [];
        for (const candidate of candidates) {
            // First alias whose match is ALSO year-compatible: a localized
            // title can hit a same-named different-year row while the
            // original-title alias holds the correct match — a bad first
            // hit must not veto the good second one.
            const match =
                candidateTitleKeys(candidate)
                    .map((key) => index.get(key))
                    .find(
                        (found) =>
                            found &&
                            titleYearsCompatible(
                                candidate.year,
                                found.trailingYear
                            )
                    ) ?? null;
            if (!match) {
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

/**
 * Both matching tiers for each of the candidate's aliases — localized
 * title first, original-title alias second.
 */
function candidateKeySets(
    candidate: RecommendationCandidate
): CandidateKeys[] {
    const type = candidate.mediaType === 'movie' ? 'movie' : 'series';
    const toKeys = (title: string): CandidateKeys => {
        const keys = normalizeTitleKeys(title);
        return { exact: `${type}:${keys.exact}`, base: `${type}:${keys.base}` };
    };

    const sets = [toKeys(candidate.title)];
    if (candidate.originalTitle) {
        const alias = toKeys(candidate.originalTitle);
        if (alias.exact !== sets[0].exact) {
            sets.push(alias);
        }
    }
    return sets;
}

/** Exact-tier keys only — used for dedupe and catalog-match lookup */
function candidateTitleKeys(candidate: RecommendationCandidate): string[] {
    return candidateKeySets(candidate).map((keys) => keys.exact);
}

/**
 * Whether the user has already watched or favorited this recommendation.
 *
 * Two tiers, because a provider stores whatever the panel named the file.
 * The exact tier catches a stored title that normalizes to the canonical
 * one. The base tier catches the common `"Inception 2010"` shape, whose
 * exact key can never equal TMDB's `"Inception"` — but only when the
 * years agree, so a stored `"Blade Runner 2049"` does not swallow the
 * 1982 film. An unknown year on either side counts as agreeing
 * (`titleYearsCompatible`): recommending something already watched is the
 * worse failure of the two.
 */
function isExcludedCandidate(
    candidate: RecommendationCandidate,
    excluded: ExclusionIndex
): boolean {
    return candidateKeySets(candidate).some(
        ({ exact, base }) =>
            excluded.exact.has(exact) ||
            (excluded.baseYears.get(base) ?? []).some((year) =>
                titleYearsCompatible(candidate.year, year)
            )
    );
}

/**
 * Identity of one load: the seed set, the watched/favorited exclusion
 * index, and the imported-playlist set. Including the exclusions means
 * favoriting a recommended title (or new watch history that does not
 * change the top seeds) still invalidates the latch and re-filters the
 * rail; including the catalog means imports and deletions re-run the
 * matching.
 */
function buildLoadKey(
    seeds: readonly DashboardTmdbLookupItem[],
    excluded: ExclusionIndex,
    catalogKey: string
): string {
    const exclusionKey = [
        ...[...excluded.exact].sort(),
        ...[...excluded.baseYears]
            .map(([base, years]) => `${base}=${[...years].sort().join('/')}`)
            .sort(),
    ].join('|');
    return `${catalogKey}@@${seeds
        .map(dashboardTmdbLookupKey)
        .join('||')}##${exclusionKey}`;
}

function toCandidates(
    results: readonly TmdbSearchResult[],
    mediaType: 'movie' | 'tv',
    seedTitle: string
): RecommendationCandidate[] {
    return results
        .map((result) => {
            const title = result.title ?? result.name ?? '';
            const original =
                result.original_title ?? result.original_name ?? '';
            const rating =
                (result.vote_count ?? 0) > 0 && result.vote_average
                    ? result.vote_average.toFixed(1)
                    : null;
            return {
                tmdbId: result.id,
                mediaType,
                title,
                originalTitle:
                    original !== '' && original !== title ? original : null,
                year: extractYear(result.release_date ?? result.first_air_date),
                posterUrl: tmdbPosterUrl(result.poster_path),
                rating,
                seedTitle,
            };
        })
        .filter((entry) => entry.tmdbId > 0 && entry.title !== '');
}
