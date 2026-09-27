import { computed, signal } from '@angular/core';

/**
 * Playlists whose SQLite `categories.locked` index may lag behind the lock
 * store: a re-stamp in progress, or one that failed (with its rollback) and
 * is retried on the next store access. The lock store is not `readable`
 * while any playlist is listed.
 */
export class ParentalLockStaleIndex {
    private readonly playlists = new Set<string>();
    private readonly count = signal(0);

    readonly isEmpty = computed(() => this.count() === 0);

    ids(): string[] {
        return [...this.playlists];
    }

    mark(playlistId: string): void {
        this.playlists.add(playlistId);
        this.count.set(this.playlists.size);
    }

    unmark(...playlistIds: string[]): void {
        for (const playlistId of playlistIds) {
            this.playlists.delete(playlistId);
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
