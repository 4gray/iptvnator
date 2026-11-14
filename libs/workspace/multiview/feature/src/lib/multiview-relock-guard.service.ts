import { Injectable, effect, inject, untracked } from '@angular/core';
import {
    MultiviewAnchorRegistry,
    MultiviewSessionStore,
    type MultiviewTile,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import { MultiviewPickerDataService } from './multiview-picker-data.service';
import { MultiviewXtreamLock } from './multiview-xtream-lock';

/**
 * R11 after the fact: a tile stops as soon as a parental relock withholds
 * its item ("Lock now", a category locked while it plays). Tiles added from
 * the picker or a list are known by their item; a source the view played
 * carries its own (`lockItem`), so it stays checked after the view moved on.
 * The tile playing the view's current selection follows the view's own
 * lock handling.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewRelockGuard {
    private readonly store = inject(MultiviewSessionStore);
    private readonly data = inject(MultiviewPickerDataService);
    private readonly xtreamLock = inject(MultiviewXtreamLock);
    private readonly anchors = inject(MultiviewAnchorRegistry);
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
        tiles: readonly MultiviewTile[]
    ): Promise<void> {
        const viewSelection = this.anchors
            .find(this.store.anchorId())
            ?.host.source()?.playbackSessionKey;
        const checks = await Promise.all(
            tiles.map(async (tile) => {
                if (tile.playbackSessionKey === viewSelection) return null;
                const item =
                    this.items.get(tile.playbackSessionKey) ?? tile.lockItem;
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
