import { Injectable, inject, signal } from '@angular/core';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { normalizeTitleKeys } from '@iptvnator/shared/interfaces';
import { DashboardDataService } from './dashboard-data.service';
import {
    DashboardTmdbLookupItem,
    buildDashboardTmdbAttempts,
    dashboardTmdbLookupKey,
} from './dashboard-tmdb-lookup.util';
import {
    DashboardRecommendationItem,
    ExclusionIndex,
    RecommendationCandidate,
    buildLoadKey,
    groupMatchesByKey,
    isExcludedCandidate,
    pickCatalogMatch,
    toCandidates,
    trustedReleaseYear,
} from './dashboard-recommendations.util';

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
            // missed. Do NOT latch — the next dashboard visit retries —
            // and do NOT blank the rail either: a failed refresh is not a
            // verdict that there is nothing to recommend, and removing
            // still-valid cards is the worse answer for an offline user.
            // Only the cards the user has meanwhile watched or favorited
            // are dropped, since those the failure cannot excuse.
            if (!perSeed.some((seed) => seed.resolved)) {
                this.dropExcludedCards(excluded);
            } else {
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
                    // Latch only once EVERY seed answered. A seed that did
                    // not resolve may have failed transiently, and latching
                    // on its behalf would drop its recommendations for the
                    // rest of the session. A seed that simply has no TMDB
                    // match never resolves either, so this rail re-runs on
                    // each visit for that user — bounded work, since the
                    // enrichment misses are cached and the catalog match is
                    // one batched worker call.
                    this.loadedKey = perSeed.every((seed) => seed.resolved)
                        ? loadKey
                        : null;
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
     * Re-filter the cards already on screen against a freshly built
     * exclusion index, used when a refresh could not reach TMDB. Keeps
     * the rail useful offline while making sure a title the user watched
     * or favorited since the last successful load cannot linger. Falling
     * under the match threshold hides the rail, as everywhere else.
     */
    private dropExcludedCards(excluded: ExclusionIndex): void {
        const current = this.items();
        // A card whose playlist is gone would navigate to a dead route,
        // and the failed refresh is no excuse for keeping it — this is
        // the only path that can reach a deleted playlist without the
        // catalog key rebuilding the rail from scratch.
        const livePlaylists = new Set(
            this.data.playlists().map((playlist) => playlist._id)
        );
        const kept = current.filter(
            (item) =>
                livePlaylists.has(item.match.playlistId) &&
                !isExcludedCandidate(item, excluded)
        );
        if (kept.length === current.length) {
            return;
        }

        // What is on screen is no longer the result of any completed
        // load, so the saved key must stop describing it — otherwise
        // restoring those exact inputs (un-favoriting the title again)
        // would hit the equality guard and leave the rail as it is now.
        this.loadedKey = null;

        if (kept.length < MIN_RECOMMENDATION_MATCHES) {
            this.items.set([]);
            this.seedTitles.set([]);
            return;
        }

        const contributed = new Set(kept.map((item) => item.seedTitle));
        this.items.set(kept);
        this.seedTitles.set(
            this.seedTitles().filter((title) => contributed.has(title))
        );
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
                // Deduplicated by TMDB identity only. Same-titled
                // remakes ("Dune" 1984 and 2021) are DIFFERENT films and
                // must both reach the catalog matching — collapsing them
                // here would let whichever arrived first fail the year
                // gate on behalf of the one the library actually holds.
                // Two candidates that end up on the same catalog row are
                // collapsed after matching instead.
                const idKey = `${entry.mediaType}:${entry.tmdbId}`;
                if (seen.has(idKey) || isExcludedCandidate(entry, excluded)) {
                    continue;
                }
                seen.add(idKey);
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
        const exact = new Map<string, (number | null)[]>();
        const baseYears = new Map<string, number[]>();

        const addTitle = (
            type: 'movie' | 'series',
            title: string | undefined,
            year: number | null
        ): void => {
            const keys = normalizeTitleKeys(title);
            if (!keys.exact) {
                return;
            }
            const exactKey = `${type}:${keys.exact}`;
            exact.set(exactKey, [...(exact.get(exactKey) ?? []), year]);
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
            // Only a year the row STATES in a metadata field gates the
            // exact tier, so a watched 1954 "Godzilla" cannot exclude the
            // 2014 one — while "Blade Runner 2049", whose year is part of
            // the name, still excludes itself. `null` keeps the
            // conservative behaviour for rows that state no year.
            const year = trustedReleaseYear(item);
            const [primary] = buildDashboardTmdbAttempts(item);

            addTitle(item.type, item.title, year);
            if (primary) {
                const type = primary.mediaType === 'tv' ? 'series' : 'movie';
                addTitle(type, primary.title, year);
                addTitle(type, primary.originalTitle, year);
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
        const grouped = groupMatchesByKey(matches);

        // Title collisions are resolved HERE rather than before matching:
        // two candidates that resolve to the same catalog row would render
        // as duplicate cards opening the same item, while same-titled
        // remakes resolve to different rows and both belong on the rail.
        const items: DashboardRecommendationItem[] = [];
        const claimedRows = new Set<string>();
        for (const candidate of candidates) {
            const match = pickCatalogMatch(candidate, grouped);
            if (!match) {
                continue;
            }
            const rowKey = `${match.playlistId}:${match.type}:${match.xtreamId}`;
            if (claimedRows.has(rowKey)) {
                continue;
            }
            claimedRows.add(rowKey);
            items.push({ ...candidate, match });
            if (items.length === MAX_ITEMS) {
                break;
            }
        }
        return items;
    }
}
