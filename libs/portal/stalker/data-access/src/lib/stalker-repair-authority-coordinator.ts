import { reservePlaylistAuthority } from '@iptvnator/services';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';

/** Shares one repair locally and reserves its source across PWA tabs. */
export class StalkerRepairAuthorityCoordinator {
    private readonly pending = new Map<string, Promise<PlaylistMeta | null>>();
    private readonly blockers = new Map<string, number>();

    block(playlistId: string): void {
        this.blockers.set(playlistId, (this.blockers.get(playlistId) ?? 0) + 1);
    }

    unblock(playlistId: string): void {
        const remaining = (this.blockers.get(playlistId) ?? 1) - 1;
        if (remaining > 0) {
            this.blockers.set(playlistId, remaining);
        } else {
            this.blockers.delete(playlistId);
        }
    }

    async run(
        playlistId: string,
        operation: () => Promise<PlaylistMeta | null>
    ): Promise<PlaylistMeta | null> {
        if (this.blockers.has(playlistId)) {
            return null;
        }
        const pending = this.pending.get(playlistId);
        if (pending) {
            await pending;
            return this.run(playlistId, operation);
        }

        // Publish before the Web Lock request yields so concurrent failures
        // in this tab share one reservation and outcome.
        const run = this.runReserved(playlistId, operation);
        this.pending.set(playlistId, run);
        try {
            return await run;
        } finally {
            if (this.pending.get(playlistId) === run) {
                this.pending.delete(playlistId);
            }
        }
    }

    async wait(playlistId: string): Promise<void> {
        await this.pending.get(playlistId)?.catch(() => null);
    }

    private async runReserved(
        playlistId: string,
        operation: () => Promise<PlaylistMeta | null>
    ): Promise<PlaylistMeta | null> {
        const reservation = await reservePlaylistAuthority(playlistId).catch(
            () => ({ status: 'unavailable' as const })
        );
        if (reservation.status !== 'acquired') {
            return null;
        }

        try {
            return await operation();
        } finally {
            reservation.release();
            await reservation.released;
        }
    }
}
