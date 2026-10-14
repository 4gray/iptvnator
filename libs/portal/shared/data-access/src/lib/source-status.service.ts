import { Injectable, Injector, inject, signal } from '@angular/core';
import {
    PortalStatus,
    PortalStatusService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    PlaylistMeta,
    SourceHealthReason,
    sourceHealthType,
    SourceStatus,
} from '@iptvnator/shared/interfaces';
import { sourceHealthFingerprint } from './source-health-identity';
import { SourceHealthHistoryService } from './source-health-history.service';
import { SourceHealthService } from './source-health.service';
import {
    isConclusiveReachability,
    sourceReachabilityFromHealth,
    sourceReachabilityFromPortalStatus,
} from './source-reachability';

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
/** What the browser build's portal status says about its cause. */
const PORTAL_STATUS_REASON: Record<
    PortalStatus,
    SourceHealthReason | undefined
> = {
    active: 'available',
    inactive: 'disabled',
    expired: 'expired',
    unavailable: 'network',
    checking: undefined,
};

@Injectable({ providedIn: 'root' })
export class SourceStatusService {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly injector = inject(Injector);
    private readonly history = inject(SourceHealthHistoryService);
    private readonly portalStatus = inject(PortalStatusService);
    /**
     * Browser-build portal statuses by playlist and connection
     * (`portalKey`): a slow check of an account the user has since edited
     * lands under the old key and cannot overwrite the new account's.
     */
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
            const status = this.portalStatuses().get(portalKey(playlist));
            return status
                ? {
                      reachability: sourceReachabilityFromPortalStatus(status),
                      reason: PORTAL_STATUS_REASON[status],
                  }
                : { reachability: 'unknown' };
        }
        const live = this.health.get(playlist);
        const reachability = sourceReachabilityFromHealth(live);
        const entry = this.history.entries().get(playlist._id);
        // A result kept for the source's old address or account is not its.
        const kept =
            entry?.connection &&
            entry.connection !== sourceHealthFingerprint(playlist)
                ? undefined
                : entry;
        if (isConclusiveReachability(reachability)) {
            return {
                reachability,
                failingSince: kept?.failingSince,
                checkedAt: live?.checkedAt,
                reason: live?.reason,
            };
        }
        if (kept) {
            return {
                reachability: kept.state,
                failingSince: kept.failingSince,
                checkedAt: kept.checkedAt,
                pending: reachability === 'checking',
                reason: kept.reason,
            };
        }
        // An inconclusive check still says why ("Connection checks paused").
        return reachability === 'checking' || !live
            ? { reachability }
            : {
                  reachability,
                  reason: live.reason,
                  checkedAt: live.checkedAt || undefined,
              };
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
        const { serverUrl, username, password } = playlist;
        const key = portalKey(playlist);
        const cached = fresh
            ? null
            : this.portalStatus.getCachedStatus(serverUrl, username, password);
        if (cached) {
            this.setPortalStatus(key, cached);
            return;
        }
        if (fresh || !this.portalStatuses().has(key)) {
            this.setPortalStatus(key, 'checking');
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
            if (this.portalStatuses().get(key) === 'checking') {
                this.setPortalStatus(key, null);
            }
            return;
        }
        this.setPortalStatus(key, status);
    }

    private setPortalStatus(key: string, status: PortalStatus | null): void {
        this.portalStatuses.update((current) => {
            const next = new Map(current);
            if (status) {
                next.set(key, status);
            } else {
                next.delete(key);
            }
            return next;
        });
    }
}

/** A playlist's portal status key: its ID and its connection. */
function portalKey(playlist: PlaylistMeta): string {
    return `${playlist._id}\u0000${sourceHealthFingerprint(playlist)}`;
}
