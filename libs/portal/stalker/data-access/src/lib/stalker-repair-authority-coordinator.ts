import { reservePlaylistAuthority } from '@iptvnator/services';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';

/** Shares one repair locally and reserves its source across PWA tabs. */
export class StalkerRepairAuthorityCoordinator {
    private readonly pending = new Map<string, Promise<PlaylistMeta | null>>();

    async run(
        playlistId: string,
        operation: () => Promise<PlaylistMeta | null>
    ): Promise<PlaylistMeta | null> {
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
        }
    }
}
