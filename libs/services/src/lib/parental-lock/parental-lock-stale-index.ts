import { computed, signal } from '@angular/core';

/**
 * Playlists whose SQLite `categories.locked` index may lag behind the lock
 * store: a re-stamp in progress, or one that failed (with its rollback) and
 * is retried on the next store access. The lock store is not `readable`
 * while any playlist is listed.
 */
export class ParentalLockStaleIndex {
    private readonly playlists = new Set<string>();
    /**
     * Listed while a queued write is stamping them: stale (not `readable`)
     * but not retryable — a reconcile running beside the write would
     * re-stamp from a store the write has not committed yet.
     */
    private readonly inFlight = new Set<string>();
    private readonly count = signal(0);

    readonly isEmpty = computed(() => this.count() === 0);

    /** The retryable entries: not the ones a write is still stamping. */
    ids(): string[] {
        return [...this.playlists].filter((id) => !this.inFlight.has(id));
    }

    /** Stale and retryable (a failed stamp or rollback). */
    mark(playlistId: string): void {
        this.inFlight.delete(playlistId);
        this.playlists.add(playlistId);
        this.count.set(this.playlists.size);
    }

    /** Stale while the write in progress stamps it. */
    markInFlight(playlistId: string): void {
        this.inFlight.add(playlistId);
        this.playlists.add(playlistId);
        this.count.set(this.playlists.size);
    }

    unmark(...playlistIds: string[]): void {
        for (const playlistId of playlistIds) {
            this.playlists.delete(playlistId);
            this.inFlight.delete(playlistId);
        }
        this.count.set(this.playlists.size);
    }

    clear(): void {
        this.unmark(...this.playlists);
    }

    /**
     * Re-stamps every listed playlist through `stamp`; the ones that
     * succeed leave the list. True when any did.
     */
    async reconcile(
        stamp: (playlistId: string) => Promise<boolean>
    ): Promise<boolean> {
        const restamped: string[] = [];
        for (const playlistId of this.ids()) {
            try {
                if (await stamp(playlistId)) {
                    restamped.push(playlistId);
                }
            } catch (error) {
                console.error(
                    'Failed to reconcile the parental lock index.',
                    error
                );
            }
        }
        if (restamped.length > 0) {
            this.unmark(...restamped);
        }
        return restamped.length > 0;
    }
}
