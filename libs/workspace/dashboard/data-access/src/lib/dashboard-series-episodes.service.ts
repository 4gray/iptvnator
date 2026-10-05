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

export function dashboardSeriesEpisodesKey(
    playlistId: string,
    seriesId: number
): string {
    return `${playlistId}::${seriesId}`;
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
 * only the portal's `get_series_info` names. Each list is fetched once per
 * session; a failed lookup is retried the next time it is requested.
 * Lookups run in the background, so a failure is logged, never shown.
 */
@Injectable({ providedIn: 'root' })
export class DashboardSeriesEpisodesService {
    private readonly api = inject(XtreamApiService);
    private readonly logger = createLogger('DashboardSeriesEpisodes');
    private readonly entries = signal<
        ReadonlyMap<string, DashboardSeriesEpisodes>
    >(new Map());
    private readonly queue: DashboardSeriesEpisodesRequest[] = [];
    private active = 0;

    readonly episodes = this.entries.asReadonly();

    /** Queues every series that is neither loaded nor loading. */
    request(requests: readonly DashboardSeriesEpisodesRequest[]): void {
        const next = new Map(this.entries());
        let queued = false;
        for (const request of requests) {
            const key = dashboardSeriesEpisodesKey(
                request.playlistId,
                request.seriesId
            );
            const status = next.get(key)?.status;
            if (status === 'loading' || status === 'loaded') {
                continue;
            }
            next.set(key, { status: 'loading' });
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
        let entry: DashboardSeriesEpisodes;
        try {
            const details = await this.api.getSeriesInfo(
                request.credentials,
                request.seriesId,
                { suppressErrorLog: true }
            );
            entry = { status: 'loaded', seasons: details?.episodes ?? {} };
        } catch (error) {
            this.logger.warn('Could not load the episodes of a series', error);
            entry = { status: 'failed' };
        }
        const key = dashboardSeriesEpisodesKey(
            request.playlistId,
            request.seriesId
        );
        this.entries.update((entries) => new Map(entries).set(key, entry));
    }
}
