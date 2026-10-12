import { Injectable, Injector, inject, signal } from '@angular/core';
import {
    PortalStatus,
    PortalStatusService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    isConclusiveReachability,
    PlaylistMeta,
    sourceHealthType,
    sourceReachabilityFromHealth,
    sourceReachabilityFromPortalStatus,
    SourceStatus,
} from '@iptvnator/shared/interfaces';
import { SourceHealthHistoryService } from './source-health-history.service';
import { SourceHealthService } from './source-health.service';

type XtreamAccount = PlaylistMeta & {
    serverUrl: string;
    username: string;
    password: string;
};

function isXtreamAccount(playlist: PlaylistMeta): playlist is XtreamAccount {
    return !!(playlist.serverUrl && playlist.username && playlist.password);
}

/**
 * One status per network source for every list that shows one: the Sources
 * page, its status filter and the playlist switcher.
 *
 * - Desktop: the live health check, else the last result kept across
 *   restarts, so a source that failed yesterday is listed as failing before
 *   it is checked again.
 * - Browser build: the Xtream portal status only, as before; it has no
 *   probes for M3U URLs or Stalker portals.
 *
 * Local files have no status (`null`).
 */
@Injectable({ providedIn: 'root' })
export class SourceStatusService {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly injector = inject(Injector);
    private readonly history = inject(SourceHealthHistoryService);
    private readonly portalStatus = inject(PortalStatusService);
    private readonly portalStatuses = signal<ReadonlyMap<string, PortalStatus>>(
        new Map()
    );

    /** Whether the status of every network source is known (desktop). */
    get supportsStatusFilter(): boolean {
        return this.runtime.supportsSourceHealth;
    }

    tracks(playlist: PlaylistMeta): boolean {
        return this.runtime.supportsSourceHealth
            ? !!sourceHealthType(playlist)
            : isXtreamAccount(playlist);
    }

    statusOf(playlist: PlaylistMeta): SourceStatus | null {
        if (!this.tracks(playlist)) {
            return null;
        }
        if (!this.runtime.supportsSourceHealth) {
            const status = this.portalStatuses().get(playlist._id);
            return {
                reachability: status
                    ? sourceReachabilityFromPortalStatus(status)
                    : 'unknown',
            };
        }
        const live = this.health.get(playlist);
        const reachability = sourceReachabilityFromHealth(live);
        const kept = this.history.entries().get(playlist._id);
        if (isConclusiveReachability(reachability)) {
            return {
                reachability,
                failingSince: kept?.failingSince,
                checkedAt: live?.checkedAt,
            };
        }
        if (kept) {
            return {
                reachability: kept.state,
                failingSince: kept.failingSince,
                checkedAt: kept.checkedAt,
                pending: reachability === 'checking',
            };
        }
        return { reachability };
    }

    /** A passive check: cached results count; the signal cancels it. */
    ensureChecked(playlist: PlaylistMeta, signal: AbortSignal): void {
        if (!this.tracks(playlist)) {
            return;
        }
        if (this.runtime.supportsSourceHealth) {
            void this.health.check(playlist, { signal });
        } else if (isXtreamAccount(playlist)) {
            void this.checkPortal(playlist, false, signal);
        }
    }

    /** "Check again" / "Retry": a fresh check that bypasses every cache. */
    recheck(playlist: PlaylistMeta): void {
        if (!this.tracks(playlist)) {
            return;
        }
        if (this.runtime.supportsSourceHealth) {
            void this.health.recheck(playlist);
        } else if (isXtreamAccount(playlist)) {
            void this.checkPortal(playlist, true);
        }
    }

    private get health(): SourceHealthService {
        return this.injector.get(SourceHealthService);
    }

    private async checkPortal(
        playlist: XtreamAccount,
        fresh: boolean,
        signal?: AbortSignal
    ): Promise<void> {
        const { _id, serverUrl, username, password } = playlist;
        const cached = fresh
            ? null
            : this.portalStatus.getCachedStatus(serverUrl, username, password);
        if (cached) {
            this.setPortalStatus(_id, cached);
            return;
        }
        if (fresh || !this.portalStatuses().has(_id)) {
            this.setPortalStatus(_id, 'checking');
        }
        let status: PortalStatus;
        try {
            status = await this.portalStatus.checkPortalStatus(
                serverUrl,
                username,
                password,
                fresh ? { skipCache: true } : undefined
            );
        } catch {
            status = 'unavailable';
        }
        if (signal?.aborted) {
            // A slow portal must not land after the list has closed; drop a
            // placeholder so the next opening checks again.
            if (this.portalStatuses().get(_id) === 'checking') {
                this.setPortalStatus(_id, null);
            }
            return;
        }
        this.setPortalStatus(_id, status);
    }

    private setPortalStatus(id: string, status: PortalStatus | null): void {
        this.portalStatuses.update((current) => {
            const next = new Map(current);
            if (status) {
                next.set(id, status);
            } else {
                next.delete(id);
            }
            return next;
        });
    }
}
