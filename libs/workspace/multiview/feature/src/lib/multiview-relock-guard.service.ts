import { Injectable, effect, inject, untracked } from '@angular/core';
import {
    MultiviewSessionStore,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import { MultiviewPickerDataService } from './multiview-picker-data.service';

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
                const withheld = tiles
                    .filter((tile) => {
                        const item = this.items.get(tile.playbackSessionKey);
                        return !!item && !this.data.isAllowed(item);
                    })
                    .map((tile) => tile.id);
                if (withheld.length > 0) this.store.withhold(withheld);
            });
        });
    }

    /** Remembers which item a tile source plays, for the lock checks. */
    track(source: MultiviewTileSource, item: UnifiedCollectionItem): void {
        this.items.set(source.playbackSessionKey, item);
    }
}
