import type { StalkerTokenCache } from './stalker-token-cache';

/** Opaque ownership proof for one lazy-repair authentication fence. */
export interface StalkerPortalRepairDiscoveryFence {
    readonly playlistId: string;
    readonly owner: symbol;
    /** Existing runtime authentication that repair must drain first. */
    readonly drained: Promise<void>;
}

interface PendingPortalRepairDiscovery {
    readonly owner: symbol;
    readonly settled: Promise<void>;
    readonly release: () => void;
}

/** Serializes runtime authentication against lazy endpoint repair. */
export class StalkerPortalRepairDiscoveryCoordinator {
    private readonly pending = new Map<string, PendingPortalRepairDiscovery>();

    constructor(private readonly tokens: StalkerTokenCache) {}

    begin(playlistId: string): StalkerPortalRepairDiscoveryFence {
        if (this.pending.has(playlistId)) {
            throw new Error('Stalker portal repair already in progress');
        }

        const owner = Symbol('stalker-portal-repair');
        let release: () => void = () => undefined;
        const settled = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.pending.set(playlistId, { owner, settled, release });
        const pendingAuthentication = this.tokens.getPending(playlistId);
        const drained = (
            pendingAuthentication?.promise.catch(() => undefined) ??
            Promise.resolve()
        ).then(() => {
            if (this.pending.get(playlistId)?.owner !== owner) {
                throw new Error('Stale Stalker portal repair fence');
            }
        });

        return { playlistId, owner, drained };
    }

    complete(fence: StalkerPortalRepairDiscoveryFence): void {
        const pending = this.pending.get(fence.playlistId);
        if (pending?.owner !== fence.owner) {
            return;
        }
        this.pending.delete(fence.playlistId);
        pending.release();
    }

    /** Returns synchronously when no repair owns the playlist. */
    waitIfPending(playlistId: string): Promise<void> | null {
        if (!this.pending.has(playlistId)) {
            return null;
        }
        return this.waitUntilAvailable(playlistId);
    }

    assertAvailable(playlistId: string): void {
        if (this.pending.has(playlistId)) {
            throw new Error('Stale Stalker playlist configuration');
        }
    }

    private async waitUntilAvailable(playlistId: string): Promise<void> {
        for (;;) {
            const pending = this.pending.get(playlistId);
            if (!pending) {
                return;
            }
            await pending.settled;
        }
    }
}
