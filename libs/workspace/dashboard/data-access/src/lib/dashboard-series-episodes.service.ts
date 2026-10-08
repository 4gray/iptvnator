import { inject, Injectable, signal } from '@angular/core';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import {
    XtreamApiService,
    type XtreamCredentials,
} from '@iptvnator/portal/xtream/data-access';
import type { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';

/** The episode list of one Xtream series, as far as the dashboard knows it. */
export type DashboardSeriesEpisodes =
    | { readonly status: 'loading' }
    | { readonly status: 'failed' }
    | {
          readonly status: 'loaded';
          readonly seasons: Readonly<Record<string, XtreamSerieEpisode[]>>;
      };

export interface DashboardSeriesEpisodesRequest {
    readonly playlistId: string;
    readonly seriesId: number;
    readonly credentials: XtreamCredentials;
    /**
     * The loaded list predates the episode played last: fetch it again in
     * the next round, once DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS has
     * passed since it loaded, instead of waiting for its age.
     */
    readonly refresh?: boolean;
}

/** At most this many lookups run at once, so a visit cannot flood the portal. */
const MAX_CONCURRENT_LOOKUPS = 2;

/**
 * How long a loaded list counts as current. A provider adds episodes while
 * the app stays open, so an older list is fetched again in the next lookup
 * round, the old one standing until the new one arrives.
 */
export const DASHBOARD_SERIES_EPISODES_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * How long a failed lookup, and a source whose lookups keep failing, are
 * left alone. Lookup rounds follow the user (each dashboard entry is one),
 * so without this a portal that is down or expired would be asked for
 * every series on every visit.
 */
export const DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS = 5 * 60 * 1000;

/**
 * Failures in a row after which a source's remaining lookups are skipped
 * for the retry delay: the portal, not the series, is the problem.
 */
const SOURCE_FAILURES_TO_TRIP = 2;

export function dashboardSeriesEpisodesKey(
    playlistId: string,
    seriesId: number
): string {
    return `${playlistId}::${seriesId}`;
}

/** Another server or account is another catalog. */
function sourceOf(request: DashboardSeriesEpisodesRequest): string {
    return `${request.credentials.serverUrl}::${request.credentials.username}`;
}

/** Same series, same credentials, same refresh hint, same order. */
export function sameDashboardSeriesEpisodesRequests(
    requestsA: readonly DashboardSeriesEpisodesRequest[],
    requestsB: readonly DashboardSeriesEpisodesRequest[]
): boolean {
    return (
        requestsA.length === requestsB.length &&
        requestsA.every((a, index) => {
            const b = requestsB[index];
            return (
                a.playlistId === b.playlistId &&
                a.seriesId === b.seriesId &&
                a.credentials.serverUrl === b.credentials.serverUrl &&
                a.credentials.username === b.credentials.username &&
                a.credentials.password === b.credentials.password &&
                !!a.refresh === !!b.refresh
            );
        })
    );
}

/**
 * Episode lists for the series Continue Watching has to look past: a series
 * whose newest episode is watched, or is an extra, goes on with an episode
 * only the portal's `get_series_info` names. Lists are kept per session and
 * source. A failed lookup, or a list older than
 * DASHBOARD_SERIES_EPISODES_MAX_AGE_MS, is tried again in a later lookup
 * round, once DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS has passed since the
 * failure. A source that fails SOURCE_FAILURES_TO_TRIP lookups in a row is
 * not asked for the rest of its series until then either. Lookups run in
 * the background, so a failure is logged, never shown.
 */
@Injectable({ providedIn: 'root' })
export class DashboardSeriesEpisodesService {
    private readonly api = inject(XtreamApiService);
    private readonly logger = createLogger('DashboardSeriesEpisodes');
    private readonly entries = signal<
        ReadonlyMap<string, DashboardSeriesEpisodes>
    >(new Map());
    private readonly queue: DashboardSeriesEpisodesRequest[] = [];
    /** The source each series was last asked for, and the round it was last asked in. */
    private readonly sources = new Map<string, string>();
    private readonly rounds = new Map<string, number>();
    /** The password of each series' last attempt: a corrected one retries a failed attempt. */
    private readonly passwords = new Map<string, string>();
    private readonly loadedAt = new Map<string, number>();
    /** When each series' last lookup failed, until one succeeds. */
    private readonly failedAt = new Map<string, number>();
    /** Each source's failures in a row, and when the last one happened. */
    private readonly sourceFailures = new Map<
        string,
        { count: number; at: number }
    >();
    private readonly inFlight = new Set<string>();
    /**
     * A request that arrived with another password while its series was in
     * flight: asked again once the attempt with the old one has failed.
     */
    private readonly followUps = new Map<
        string,
        DashboardSeriesEpisodesRequest
    >();
    private active = 0;

    readonly episodes = this.entries.asReadonly();

    /**
     * Queues every series whose list is missing or comes from another
     * source. A failed lookup, or a list past its age, is asked again only
     * in a later `round` (the caller's deliberate lookup rounds) and after
     * the retry delay: the same round asking again, for more series, never
     * repeats a request. A failed lookup is also asked again at once with a
     * corrected password. A list being refreshed stands until the new one
     * arrives.
     */
    request(
        requests: readonly DashboardSeriesEpisodesRequest[],
        round = 0
    ): void {
        const next = new Map(this.entries());
        const now = Date.now();
        let queued = false;
        for (const request of requests) {
            const key = dashboardSeriesEpisodesKey(
                request.playlistId,
                request.seriesId
            );
            const source = sourceOf(request);
            const entry = next.get(key);
            const sameSource = this.sources.get(key) === source;
            if (sameSource && this.inFlight.has(`${key}#${source}`)) {
                if (this.passwords.get(key) !== request.credentials.password) {
                    this.followUps.set(key, request);
                }
                continue;
            }
            const laterRound = round > (this.rounds.get(key) ?? -1);
            this.rounds.set(
                key,
                Math.max(round, this.rounds.get(key) ?? round)
            );
            const passwordChanged =
                this.passwords.get(key) !== request.credentials.password;
            // The last attempt failed (a first lookup or a refresh of a list
            // that stands) and the password differs: a deliberate retry.
            const correctedPassword =
                sameSource && passwordChanged && this.failedAt.has(key);
            const retryDue =
                now - (this.failedAt.get(key) ?? -Infinity) >=
                DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS;
            const listAge = now - (this.loadedAt.get(key) ?? 0);
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
            if (correctedPassword) {
                // A corrected password is a deliberate retry of the source.
                this.sourceFailures.delete(source);
            }
            if (!sameSource || entry?.status !== 'loaded') {
                next.set(key, { status: 'loading' });
            }
            this.sources.set(key, source);
            this.passwords.set(key, request.credentials.password);
            this.inFlight.add(`${key}#${source}`);
            this.queue.push(request);
            queued = true;
        }
        if (queued) {
            this.entries.set(next);
            this.pump();
        }
    }

    private pump(): void {
        while (this.active < MAX_CONCURRENT_LOOKUPS) {
            const request = this.queue.shift();
            if (!request) {
                return;
            }
            this.active++;
            void this.load(request).finally(() => {
                this.active--;
                this.pump();
            });
        }
    }

    private async load(request: DashboardSeriesEpisodesRequest): Promise<void> {
        const key = dashboardSeriesEpisodesKey(
            request.playlistId,
            request.seriesId
        );
        const source = sourceOf(request);
        let seasons: Readonly<Record<string, XtreamSerieEpisode[]>> | null =
            null;
        const skipped = this.isTripped(source);
        if (skipped) {
            // The source failed its last lookups: asking for more series
            // would only repeat the answer.
            this.logger.debug('Skipped a series lookup on a failing source');
        } else {
            try {
                const details = await this.api.getSeriesInfo(
                    request.credentials,
                    request.seriesId,
                    { suppressErrorLog: true }
                );
                seasons = details?.episodes ?? {};
            } catch (error) {
                this.logger.warn(
                    'Could not load the episodes of a series',
                    error
                );
            }
        }
        const now = Date.now();
        this.inFlight.delete(`${key}#${source}`);
        // The series was asked for from another source meanwhile.
        if (this.sources.get(key) !== source) {
            this.followUps.delete(key);
            return;
        }
        const followUp = this.followUps.get(key);
        this.followUps.delete(key);
        if (seasons) {
            this.loadedAt.set(key, now);
            this.failedAt.delete(key);
            this.sourceFailures.delete(source);
            if (followUp) {
                this.passwords.set(key, followUp.credentials.password);
            }
            this.entries.update((entries) =>
                new Map(entries).set(key, { status: 'loaded', seasons })
            );
            return;
        }
        if (skipped) {
            // Due again with the source, whose cooldown a skip must not
            // extend: a round after it could never reach a recovered portal.
            this.failedAt.set(key, this.sourceFailures.get(source)?.at ?? now);
        } else {
            this.recordFailure(key, source);
        }
        // A failed refresh keeps the list it had.
        if (this.entries().get(key)?.status !== 'loaded') {
            this.entries.update((entries) =>
                new Map(entries).set(key, { status: 'failed' })
            );
        }
        if (followUp) {
            // The password was corrected while the old one was being tried.
            this.request([followUp], this.rounds.get(key));
        }
    }

    private isTripped(source: string): boolean {
        const failures = this.sourceFailures.get(source);
        return (
            !!failures &&
            failures.count >= SOURCE_FAILURES_TO_TRIP &&
            Date.now() - failures.at < DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS
        );
    }

    private recordFailure(key: string, source: string): void {
        const now = Date.now();
        this.failedAt.set(key, now);
        const failures = this.sourceFailures.get(source);
        this.sourceFailures.set(source, {
            count: (failures?.count ?? 0) + 1,
            at: now,
        });
    }
}
