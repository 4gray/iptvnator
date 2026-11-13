import { Injectable, inject } from '@angular/core';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import { ParentalLockService } from '@iptvnator/services';

const LOCK_TYPES = {
    live: 'live',
    movie: 'movies',
    series: 'series',
} as const;

/**
 * R11 for Xtream items: whether the parental lock withholds the item now.
 * Collection rows carry either a provider or a stored category id depending
 * on where they come from, so the item's category is not trusted: the data
 * source looks the content up by its stream id (SQLite in Electron, the
 * cached catalog in the PWA) and applies the lock itself.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewXtreamLock {
    private readonly locks = inject(ParentalLockService);
    private readonly source = inject(XTREAM_DATA_SOURCE);

    async isLocked(item: UnifiedCollectionItem): Promise<boolean> {
        if (item.sourceType !== 'xtream' || item.xtreamId == null) {
            return false;
        }
        if (this.locks.withholdsEverything()) return true;
        if (!this.locks.active()) return false;
        const type = item.contentType;
        // Unknown content (a catalog the PWA has not cached, a failed
        // lookup) is only allowed while nothing of its type is locked in its
        // playlist: fail closed otherwise.
        const unknown = () =>
            this.locks.lockedXtreamIds(item.playlistId, LOCK_TYPES[type])
                .length > 0;
        try {
            const known = await this.source.getContentByXtreamId(
                item.xtreamId,
                item.playlistId,
                type
            );
            if (!known) return unknown();
            const allowed = await this.source.getContentByXtreamId(
                item.xtreamId,
                item.playlistId,
                type,
                undefined,
                undefined,
                true
            );
            return allowed === null;
        } catch {
            return unknown();
        }
    }
}
