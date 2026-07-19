import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import { createLogger } from '@iptvnator/portal/shared/util';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerItvChannel } from './models';
import {
    StalkerItvLoadProgress,
    loadFullItvChannelList,
} from './stalker-itv-channel-loader';
import { StalkerSessionService } from './stalker-session.service';
import { StalkerRequestDeps } from './stores/utils';

export type { StalkerItvLoadProgress };

/**
 * After a transient crawl failure, don't immediately re-crawl the whole portal
 * on the next resource fire — a deterministically-failing page would otherwise
 * trigger an unbounded re-crawl loop that hammers the portal.
 */
const ERROR_COOLDOWN_MS = 30_000;

/**
 * Session cache holding the complete ITV channel list per Stalker portal.
 *
 * Stalker portals paginate `get_ordered_list` with a server-side page size
 * (typically 14), so incremental loading can never power a complete local
 * search. This service loads the full list once per portal: it first tries the
 * Ministra `get_all_channels` action (all channels in a single response) and
 * falls back to crawling `get_ordered_list` pages. Portals where both
 * strategies fail are marked unsupported and keep the legacy paged behavior.
 */
@Injectable({ providedIn: 'root' })
export class StalkerItvCacheService {
    private readonly logger = createLogger('StalkerItvCache');
    private readonly requestDeps: StalkerRequestDeps = {
        dataService: inject(DataService),
        stalkerSession: inject(StalkerSessionService),
    };

    /** Portal keys whose full channel list is loaded. */
    private readonly readyKeys = signal<ReadonlySet<string>>(new Set());
    private readonly loadingKeys = signal<ReadonlySet<string>>(new Set());
    private readonly progressByKey = signal<
        Readonly<Record<string, StalkerItvLoadProgress>>
    >({});
    /**
     * Per-portal version counters. Kept as independent signals (not one shared
     * counter) so a resource that reads `versionFor(portal)` only re-fires when
     * THAT portal's list becomes ready or is refreshed — a different portal's
     * background load completing must never re-fire an unrelated resource.
     */
    private readonly versionSignals = new Map<string, WritableSignal<number>>();

    private readonly channelsByKey = new Map<string, StalkerItvChannel[]>();
    private readonly unsupportedKeys = new Set<string>();
    private readonly inflight = new Map<string, Promise<void>>();
    /** Wall-clock (ms) until which a portal's crawl error suppresses retries. */
    private readonly errorCooldownUntil = new Map<string, number>();

    /**
     * Reactive, per-portal readiness token. Changes only when this portal's
     * full channel list becomes ready or is refreshed. Resources that serve
     * from the cache read this to re-fire at the right moment without being
     * disturbed by other portals' loads.
     */
    versionFor(playlist: PlaylistMeta | undefined): number {
        const key = this.keyFor(playlist);
        return key === null ? 0 : this.versionSignalFor(key)();
    }

    isReady(playlist: PlaylistMeta | undefined): boolean {
        const key = this.keyFor(playlist);
        return key !== null && this.readyKeys().has(key);
    }

    isLoading(playlist: PlaylistMeta | undefined): boolean {
        const key = this.keyFor(playlist);
        return key !== null && this.loadingKeys().has(key);
    }

    progressOf(
        playlist: PlaylistMeta | undefined
    ): StalkerItvLoadProgress | null {
        const key = this.keyFor(playlist);
        return key !== null ? (this.progressByKey()[key] ?? null) : null;
    }

    /** Full channel list for the portal, or null while not (yet) loaded. */
    getChannels(playlist: PlaylistMeta | undefined): StalkerItvChannel[] | null {
        const key = this.keyFor(playlist);
        if (key === null || !this.readyKeys().has(key)) {
            return null;
        }
        return this.channelsByKey.get(key) ?? null;
    }

    /**
     * Loads the full channel list once per portal. No-op when the list is
     * already loaded, currently loading, or the portal is unsupported.
     */
    async ensureLoaded(playlist: PlaylistMeta | undefined): Promise<void> {
        const key = this.keyFor(playlist);
        if (
            key === null ||
            !playlist ||
            this.readyKeys().has(key) ||
            this.unsupportedKeys.has(key) ||
            this.isInErrorCooldown(key)
        ) {
            return;
        }

        await (this.inflight.get(key) ?? this.runLoad(key, playlist));
    }

    /** Reloads the list while keeping the current cache served in the meantime. */
    async refresh(playlist: PlaylistMeta | undefined): Promise<void> {
        const key = this.keyFor(playlist);
        if (key === null || !playlist) {
            return;
        }

        const pending = this.inflight.get(key);
        if (pending) {
            return pending;
        }

        this.unsupportedKeys.delete(key);
        this.errorCooldownUntil.delete(key);
        await this.runLoad(key, playlist);
    }

    private keyFor(playlist: PlaylistMeta | undefined): string | null {
        return playlist?._id ?? playlist?.portalUrl ?? null;
    }

    private versionSignalFor(key: string): WritableSignal<number> {
        let versionSignal = this.versionSignals.get(key);
        if (!versionSignal) {
            versionSignal = signal(0);
            this.versionSignals.set(key, versionSignal);
        }
        return versionSignal;
    }

    private isInErrorCooldown(key: string): boolean {
        const until = this.errorCooldownUntil.get(key);
        if (until === undefined) {
            return false;
        }
        if (Date.now() >= until) {
            this.errorCooldownUntil.delete(key);
            return false;
        }
        return true;
    }

    private runLoad(key: string, playlist: PlaylistMeta): Promise<void> {
        const task = (async () => {
            this.patchKeySet(this.loadingKeys, key, true);
            try {
                const outcome = await loadFullItvChannelList(
                    this.requestDeps,
                    playlist,
                    (loaded, total) => this.reportProgress(key, loaded, total),
                    this.logger
                );
                if (Array.isArray(outcome)) {
                    this.channelsByKey.set(key, outcome);
                    this.errorCooldownUntil.delete(key);
                    this.patchKeySet(this.readyKeys, key, true);
                    this.versionSignalFor(key).update((version) => version + 1);
                } else if (outcome === 'error') {
                    this.errorCooldownUntil.set(
                        key,
                        Date.now() + ERROR_COOLDOWN_MS
                    );
                } else if (!this.readyKeys().has(key)) {
                    this.unsupportedKeys.add(key);
                }
            } finally {
                this.inflight.delete(key);
                this.patchKeySet(this.loadingKeys, key, false);
                this.progressByKey.update((progress) => {
                    const next = { ...progress };
                    delete next[key];
                    return next;
                });
            }
        })();

        this.inflight.set(key, task);
        return task;
    }

    private reportProgress(key: string, loaded: number, total: number): void {
        this.progressByKey.update((progress) => ({
            ...progress,
            [key]: { loaded, total },
        }));
    }

    private patchKeySet(
        target: ReturnType<typeof signal<ReadonlySet<string>>>,
        key: string,
        present: boolean
    ): void {
        target.update((current) => {
            const next = new Set(current);
            if (present) {
                next.add(key);
            } else {
                next.delete(key);
            }
            return next;
        });
    }
}
