import { inject, Injectable, Injector, signal } from '@angular/core';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import {
    IncompleteStalkerSeriesCatalogError,
    StalkerSecondStreamService,
} from '@iptvnator/portal/stalker/data-access';
import { XtreamApiService } from '@iptvnator/portal/xtream/data-access';
import type {
    XtreamSerieDetails,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    dashboardSeriesEpisodesPassword,
    dashboardSeriesEpisodesRequestKey,
    dashboardSeriesEpisodesSource,
    type DashboardSeriesEpisodesRequest,
} from './dashboard-series-episodes-request';
import {
    createDashboardStalkerPlaylistLoader,
    DashboardIncompleteCatalogError,
} from './dashboard-stalker-playlist-loader';

export {
    createDashboardSeriesEpisodesRequest,
    dashboardSeriesEpisodesKey,
    dashboardSeriesEpisodesRequestKey,
    sameDashboardSeriesEpisodesRequests,
    type DashboardSeriesEpisodesRequest,
} from './dashboard-series-episodes-request';

export type DashboardSeriesEpisodes =
    | { readonly status: 'loading' }
    | { readonly status: 'failed' }
    | {
          readonly status: 'loaded';
          readonly seasons: Readonly<Record<string, XtreamSerieEpisode[]>>;
      };

type DashboardLoadedSeasons = Extract<
    DashboardSeriesEpisodes,
    { status: 'loaded' }
>['seasons'];

interface SeriesLookupState {
    readonly source: string;
    password: string | undefined;
    loadedAt?: number;
    failedAt?: number;
    attempt?: SeriesLookupAttempt;
}

interface SeriesLookupAttempt {
    readonly key: string;
    readonly request: DashboardSeriesEpisodesRequest;
    readonly state: SeriesLookupState;
    readonly controller: AbortController;
    readonly loadStalkerPlaylist?: ReturnType<
        typeof createDashboardStalkerPlaylistLoader
    >;
    followUp?: DashboardSeriesEpisodesRequest;
}

/** At most this many lookups run at once, so a visit cannot flood the portal. */
const MAX_CONCURRENT_LOOKUPS = 2;

/** An older list can be refreshed in the next lookup round. */
export const DASHBOARD_SERIES_EPISODES_MAX_AGE_MS = 60 * 60 * 1000;

/** Failed sources and stale lists are retried only after this delay. */
export const DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS = 5 * 60 * 1000;

const SOURCE_FAILURES_TO_TRIP = 2;

function hasIncompleteXtreamSeasons(
    advertised: XtreamSerieDetails['seasons'] | undefined,
    episodes: DashboardLoadedSeasons
): boolean {
    if (!Array.isArray(advertised) || advertised.length === 0) return false;
    const hasMainSeason = advertised.some(
        (season) => Number(season?.season_number) > 0
    );
    return advertised.some((season) => {
        const number = Number(season?.season_number);
        const expected = Number(season?.episode_count);
        if (
            !Number.isSafeInteger(number) ||
            number < 0 ||
            !Number.isSafeInteger(expected) ||
            expected <= 0 ||
            (hasMainSeason && number === 0)
        ) {
            return false;
        }
        const actual =
            episodes[number]?.length ??
            Object.values(episodes).reduce(
                (count, rows) =>
                    count +
                    (Array.isArray(rows)
                        ? rows.filter((row) => Number(row?.season) === number)
                              .length
                        : 0),
                0
            );
        return actual < expected;
    });
}

/**
 * The dashboard and watched history share episode lists, source backoff and
 * concurrency. Each consumer decides when a new lookup round starts.
 */
@Injectable({ providedIn: 'root' })
export class DashboardSeriesEpisodesService {
    private readonly api = inject(XtreamApiService);
    private readonly injector = inject(Injector);
    private readonly logger = createLogger('DashboardSeriesEpisodes');
    private readonly entries = signal<
        ReadonlyMap<string, DashboardSeriesEpisodes>
    >(new Map());
    private readonly queue: SeriesLookupAttempt[] = [];
    private readonly lookupStates = new Map<string, SeriesLookupState>();
    private readonly rounds = new WeakMap<object, Map<string, number>>();
    private readonly singleConsumer = {};
    private readonly sourceFailures = new Map<
        string,
        { count: number; at: number }
    >();
    private active = 0;

    readonly episodes = this.entries.asReadonly();

    get(
        request: DashboardSeriesEpisodesRequest
    ): DashboardSeriesEpisodes | undefined {
        const key = dashboardSeriesEpisodesRequestKey(request);
        const entry = this.entries().get(key);
        return this.lookupStates.get(key)?.source ===
            dashboardSeriesEpisodesSource(request)
            ? entry
            : undefined;
    }

    /**
     * Queues missing lists and lists from a previous source. Later rounds
     * retry failures and refresh old or stale lists after their cooldowns.
     * A corrected password can retry a failed lookup right away. Each caller
     * uses its own stable consumer token when supplying independent rounds.
     */
    request(
        requests: readonly DashboardSeriesEpisodesRequest[],
        round = 0,
        consumer = this.singleConsumer
    ): void {
        let rounds = this.rounds.get(consumer);
        if (!rounds) {
            rounds = new Map();
            this.rounds.set(consumer, rounds);
        }
        const next = new Map(this.entries());
        const now = Date.now();
        let queued = false;
        let loadStalkerPlaylist: SeriesLookupAttempt['loadStalkerPlaylist'];
        for (const request of requests) {
            const key = dashboardSeriesEpisodesRequestKey(request);
            const source = dashboardSeriesEpisodesSource(request);
            const password = dashboardSeriesEpisodesPassword(request);
            const previous = this.lookupStates.get(key);
            const sameSource = previous?.source === source;
            const state: SeriesLookupState = sameSource
                ? previous
                : { source, password };
            const entry = next.get(key);
            const lastRound = rounds.get(key) ?? -1;
            const laterRound = round > lastRound;
            rounds.set(key, Math.max(round, lastRound));
            if (state.attempt) {
                if (state.password !== password) {
                    state.attempt.followUp = request;
                }
                continue;
            }
            const correctedPassword =
                state.failedAt !== undefined && state.password !== password;
            const retryDue =
                now - (state.failedAt ?? -Infinity) >=
                DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS;
            const listAge = now - (state.loadedAt ?? 0);
            const due =
                !entry ||
                !sameSource ||
                correctedPassword ||
                (laterRound &&
                    retryDue &&
                    (entry.status === 'failed' ||
                        (entry.status === 'loaded' &&
                            listAge >=
                                (request.refresh
                                    ? DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS
                                    : DASHBOARD_SERIES_EPISODES_MAX_AGE_MS))));
            if (!due) {
                continue;
            }
            if (!sameSource) {
                previous?.attempt?.controller.abort();
            }
            if (correctedPassword) {
                this.sourceFailures.delete(source);
            }
            if (!sameSource || entry?.status !== 'loaded') {
                next.set(key, { status: 'loading' });
            }
            state.password = password;
            if (request.provider === 'stalker') {
                loadStalkerPlaylist ??= createDashboardStalkerPlaylistLoader(
                    this.injector
                );
            }
            state.attempt = {
                key,
                request,
                state,
                controller: new AbortController(),
                loadStalkerPlaylist,
            };
            this.lookupStates.set(key, state);
            this.queue.push(state.attempt);
            queued = true;
        }
        if (queued) {
            this.entries.set(next);
            this.pump();
        }
    }

    private pump(): void {
        while (this.active < MAX_CONCURRENT_LOOKUPS) {
            const attempt = this.queue.shift();
            if (!attempt) {
                return;
            }
            if (attempt.controller.signal.aborted) {
                continue;
            }
            this.active++;
            void this.load(attempt).finally(() => {
                this.active--;
                this.pump();
            });
        }
    }

    private async load(attempt: SeriesLookupAttempt): Promise<void> {
        const { key, state, controller } = attempt;
        const { source } = state;
        let seasons: DashboardLoadedSeasons | null = null;
        let incompleteCatalog = false;
        const skipped = this.isTripped(source);
        if (skipped) {
            this.logger.debug('Skipped a series lookup on a failing source');
        } else {
            try {
                seasons = await this.loadSeasons(attempt);
            } catch (error) {
                incompleteCatalog =
                    error instanceof DashboardIncompleteCatalogError ||
                    error instanceof IncompleteStalkerSeriesCatalogError;
                if (!controller.signal.aborted) {
                    this.logger.warn(
                        'Could not load the episodes of a series',
                        error
                    );
                }
            }
        }
        // The same playlist can point at a different catalog before a request returns.
        if (controller.signal.aborted) {
            return;
        }

        const now = Date.now();
        state.attempt = undefined;
        if (seasons) {
            state.loadedAt = now;
            state.failedAt = undefined;
            this.sourceFailures.delete(source);
            if (attempt.followUp) {
                state.password = dashboardSeriesEpisodesPassword(
                    attempt.followUp
                );
            }
            this.entries.update((entries) =>
                new Map(entries).set(key, { status: 'loaded', seasons })
            );
            return;
        }

        // A skip follows the existing source cooldown, without extending it.
        state.failedAt = skipped
            ? (this.sourceFailures.get(source)?.at ?? now)
            : now;
        if (incompleteCatalog) {
            this.sourceFailures.delete(source);
        } else if (!skipped) {
            const failures = this.sourceFailures.get(source);
            this.sourceFailures.set(source, {
                count: (failures?.count ?? 0) + 1,
                at: now,
            });
        }
        // A transport failure can keep the known list. An incomplete answer
        // establishes that the stored list cannot prove completion anymore.
        if (incompleteCatalog || this.entries().get(key)?.status !== 'loaded') {
            state.loadedAt = undefined;
            this.entries.update((entries) =>
                new Map(entries).set(key, { status: 'failed' })
            );
        }
        if (attempt.followUp) {
            this.request([attempt.followUp]);
        }
    }

    private async loadSeasons(
        attempt: SeriesLookupAttempt
    ): Promise<DashboardLoadedSeasons> {
        const {
            request,
            loadStalkerPlaylist,
            controller: { signal },
        } = attempt;
        if (request.provider === 'stalker') {
            if (!loadStalkerPlaylist)
                throw new Error('Stalker playlist loader unavailable');
            const playlist = await loadStalkerPlaylist(request.playlist);
            signal.throwIfAborted();
            return this.injector
                .get(StalkerSecondStreamService)
                .episodes(playlist, request.item, signal, {
                    refreshEmbedded: true,
                    requireComplete: true,
                });
        }
        const details = await this.api.getSeriesInfo(
            request.credentials,
            request.seriesId,
            { suppressErrorLog: true }
        );
        const episodes = details?.episodes ?? {};
        if (hasIncompleteXtreamSeasons(details?.seasons, episodes)) {
            throw new DashboardIncompleteCatalogError(
                'Incomplete Xtream series list'
            );
        }
        return episodes;
    }

    private isTripped(source: string): boolean {
        const failures = this.sourceFailures.get(source);
        return (
            !!failures &&
            failures.count >= SOURCE_FAILURES_TO_TRIP &&
            Date.now() - failures.at < DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS
        );
    }
}
