import { Injectable, NgZone, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { normalizeStoredStalkerAccountInfo } from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService, PortalStatusService } from '@iptvnator/services';
import {
    PlaylistMeta,
    isStalkerAccountPlaylist,
    isXtreamAccountPlaylist,
} from '@iptvnator/shared/interfaces';
import type { SourceExpiryFacts } from './dashboard-source-expiry.util';

/**
 * Collects subscription-expiry facts for the dashboard's source cards.
 *
 * Xtream expirations ride on the same cached `PortalStatusService` check the
 * playlist switcher makes (30s TTL + in-flight dedup), so the dashboard adds
 * no portal round-trips beyond that shared check. Stalker expirations come
 * from the `stalkerAccountInfo` snapshot persisted at import — it lives in
 * the playlist payload (not on the meta rows), so each Stalker source costs
 * one full-playlist read, memoized until the playlist is refreshed.
 */
@Injectable({ providedIn: 'root' })
export class DashboardSourceExpiryService {
    private readonly ngZone = inject(NgZone);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly portalStatusService = inject(PortalStatusService);

    private readonly factsState = signal<ReadonlyMap<string, SourceExpiryFacts>>(
        new Map()
    );
    /** Facts per playlist id; entries land as each source's lookup resolves. */
    readonly facts = this.factsState.asReadonly();

    /**
     * Stalker snapshots only change on re-import/refresh; fingerprinting on
     * the playlist's update timestamp keeps dashboard revisits IPC-free.
     */
    private readonly stalkerFactsCache = new Map<
        string,
        { fingerprint: string; facts: SourceExpiryFacts | null }
    >();

    private refreshRound = 0;

    /** Refreshes facts for the given sources; prunes ids no longer present. */
    async refresh(playlists: readonly PlaylistMeta[]): Promise<void> {
        const round = ++this.refreshRound;
        const validIds = new Set(playlists.map((playlist) => playlist._id));

        this.applyIfCurrent(round, (map) => {
            let next: Map<string, SourceExpiryFacts> | null = null;
            for (const id of map.keys()) {
                if (!validIds.has(id)) {
                    next ??= new Map(map);
                    next.delete(id);
                }
            }
            return next ?? map;
        });

        await Promise.all(
            playlists.map(async (playlist) => {
                const facts = await this.loadFacts(playlist);
                this.applyIfCurrent(round, (map) => {
                    if ((map.get(playlist._id) ?? null) === facts) {
                        return map;
                    }
                    const next = new Map(map);
                    if (facts === null) {
                        next.delete(playlist._id);
                    } else {
                        next.set(playlist._id, facts);
                    }
                    return next;
                });
            })
        );
    }

    private async loadFacts(
        playlist: PlaylistMeta
    ): Promise<SourceExpiryFacts | null> {
        if (isXtreamAccountPlaylist(playlist)) {
            return this.loadXtreamFacts(playlist);
        }
        if (isStalkerAccountPlaylist(playlist)) {
            return this.loadStalkerFacts(playlist);
        }
        return null;
    }

    private async loadXtreamFacts(
        playlist: PlaylistMeta & {
            serverUrl: string;
            username: string;
            password: string;
        }
    ): Promise<SourceExpiryFacts | null> {
        try {
            const details =
                await this.portalStatusService.checkPortalStatusDetails(
                    playlist.serverUrl,
                    playlist.username,
                    playlist.password
                );
            // An unreachable portal is unknown, not expired — no badge.
            if (details.status === 'unavailable') {
                return null;
            }
            return {
                expiresAtSeconds: details.expiresAtSeconds,
                reportedExpired: details.status === 'expired',
            };
        } catch {
            return null;
        }
    }

    private async loadStalkerFacts(
        playlist: PlaylistMeta
    ): Promise<SourceExpiryFacts | null> {
        const fingerprint = String(
            playlist.updateDate ?? playlist.importDate ?? ''
        );
        const cached = this.stalkerFactsCache.get(playlist._id);
        if (cached && cached.fingerprint === fingerprint) {
            return cached.facts;
        }

        let facts: SourceExpiryFacts | null;
        try {
            const fullPlaylist = await firstValueFrom(
                this.playlistsService.getPlaylistById(playlist._id)
            );
            const snapshot = normalizeStoredStalkerAccountInfo(
                fullPlaylist?.stalkerAccountInfo
            );
            facts =
                snapshot?.expireDate !== undefined
                    ? {
                          expiresAtSeconds: snapshot.expireDate,
                          reportedExpired: false,
                      }
                    : null;
        } catch {
            // Don't cache failures — the next refresh should retry the read.
            return null;
        }

        this.stalkerFactsCache.set(playlist._id, { fingerprint, facts });
        return facts;
    }

    private applyIfCurrent(
        round: number,
        update: (
            map: ReadonlyMap<string, SourceExpiryFacts>
        ) => ReadonlyMap<string, SourceExpiryFacts>
    ): void {
        if (round !== this.refreshRound) {
            return;
        }
        this.ngZone.run(() => {
            this.factsState.update(update);
        });
    }
}
