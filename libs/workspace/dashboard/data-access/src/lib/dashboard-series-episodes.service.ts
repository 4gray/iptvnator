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
}

/** At most this many lookups run at once, so a visit cannot flood the portal. */
const MAX_CONCURRENT_LOOKUPS = 2;

/**
 * How long a loaded list counts as current. A provider adds episodes while
 * the app stays open, so an older list is fetched again in the next lookup
 * round, the old one standing until the new one arrives.
 */
export const DASHBOARD_SERIES_EPISODES_MAX_AGE_MS = 60 * 60 * 1000;

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

/** Same series, same credentials, same order. */
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
                a.credentials.password === b.credentials.password
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
 * round. Lookups run in the background, so a failure is logged, never shown.
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
    /** The password of each series' last attempt: a corrected one retries a failure. */
    private readonly passwords = new Map<string, string>();
    private readonly loadedAt = new Map<string, number>();
    private readonly inFlight = new Set<string>();
    private active = 0;

    readonly episodes = this.entries.asReadonly();

    /**
     * Queues every series whose list is missing or comes from another
     * source. A failed lookup, or a list past its age, is asked again only
     * in a later `round` (the caller's deliberate lookup rounds): the same
     * round asking again, for more series, never repeats a request. A
     * failed lookup is also asked again at once with a corrected password.
     * A list being refreshed stands until the new one arrives.
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
                continue;
            }
            const laterRound = round > (this.rounds.get(key) ?? -1);
            this.rounds.set(
                key,
                Math.max(round, this.rounds.get(key) ?? round)
            );
            const passwordChanged =
                this.passwords.get(key) !== request.credentials.password;
            const due =
                !entry ||
                !sameSource ||
                (entry.status === 'failed' && passwordChanged) ||
                (laterRound &&
                    (entry.status === 'failed' ||
                        (entry.status === 'loaded' &&
                            now - (this.loadedAt.get(key) ?? 0) >=
                                DASHBOARD_SERIES_EPISODES_MAX_AGE_MS)));
            if (!due) {
                continue;
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
        try {
            const details = await this.api.getSeriesInfo(
                request.credentials,
                request.seriesId,
                { suppressErrorLog: true }
            );
            seasons = details?.episodes ?? {};
        } catch (error) {
            this.logger.warn('Could not load the episodes of a series', error);
        }
        this.inFlight.delete(`${key}#${source}`);
        // The series was asked for from another source meanwhile.
        if (this.sources.get(key) !== source) {
            return;
        }
        if (seasons) {
            this.loadedAt.set(key, Date.now());
            this.entries.update((entries) =>
                new Map(entries).set(key, { status: 'loaded', seasons })
            );
        } else if (this.entries().get(key)?.status !== 'loaded') {
            this.entries.update((entries) =>
                new Map(entries).set(key, { status: 'failed' })
            );
        }
        // A failed refresh keeps the list it had.
    }
}
