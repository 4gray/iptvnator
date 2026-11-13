import { Injectable, effect, inject, untracked } from '@angular/core';
import {
    MultiviewSessionStore,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import { MultiviewPickerDataService } from './multiview-picker-data.service';
import { MultiviewXtreamLock } from './multiview-xtream-lock';

/**
 * R11 after the fact: a tile added from the picker or a list stops as soon
 * as a parental relock withholds its item ("Lock now", a category locked
 * while it plays). The anchor's own tile is the view's own selection and
 * follows the view's lock handling.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewRelockGuard {
    private readonly store = inject(MultiviewSessionStore);
    private readonly data = inject(MultiviewPickerDataService);
    private readonly xtreamLock = inject(MultiviewXtreamLock);
    private readonly items = new Map<string, UnifiedCollectionItem>();

    constructor() {
        const locks = inject(ParentalLockService);
        effect(() => {
            locks.version();
            locks.withholdsEverything();
            const tiles = this.store.tiles();
            untracked(() => {
                if (!this.store.exists()) {
                    this.items.clear();
                    return;
                }
                void this.withholdLocked(tiles);
            });
        });
    }

    private async withholdLocked(
        tiles: readonly { id: string; playbackSessionKey: string }[]
    ): Promise<void> {
        const checks = await Promise.all(
            tiles.map(async (tile) => {
                const item = this.items.get(tile.playbackSessionKey);
                if (!item) return null;
                const locked =
                    !this.data.isAllowed(item) ||
                    (await this.xtreamLock.isLocked(item));
                return locked ? tile.id : null;
            })
        );
        // A tile replaced while its check ran keeps its id: only withhold a
        // tile that still plays the source that was checked.
        const checked = new Map(
            tiles.map((tile) => [tile.id, tile.playbackSessionKey])
        );
        const still = checks.filter(
            (id): id is string =>
                id !== null &&
                this.store.tile(id)?.playbackSessionKey === checked.get(id)
        );
        if (still.length > 0) this.store.withhold(still);
    }

    /** Remembers which item a tile source plays, for the lock checks. */
    track(source: MultiviewTileSource, item: UnifiedCollectionItem): void {
        this.items.set(source.playbackSessionKey, item);
    }
}
