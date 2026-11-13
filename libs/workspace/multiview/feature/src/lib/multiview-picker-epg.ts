import {
    collectionEpgKey,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';

/** Q1: at most this many channels' EPG is requested per picker open. */
export const MULTIVIEW_PICKER_EPG_CAP = 20;

/**
 * The EPG requests one open of the picker may still make. Only visible
 * live rows are asked for, each at most once; when the allowance is spent,
 * rows simply show no programme line.
 */
export class MultiviewEpgAllowance {
    private readonly requested = new Set<string>();

    constructor(private remaining = MULTIVIEW_PICKER_EPG_CAP) {}

    get left(): number {
        return this.remaining;
    }

    /** The visible items to request now; marks them as requested. */
    take(visible: readonly UnifiedCollectionItem[]): UnifiedCollectionItem[] {
        const batch: UnifiedCollectionItem[] = [];
        for (const item of visible) {
            if (this.remaining === 0) break;
            if (item.contentType !== 'live') continue;
            const key = collectionEpgKey(item);
            if (!key || this.requested.has(key)) continue;
            this.requested.add(key);
            batch.push(item);
            this.remaining--;
        }
        return batch;
    }
}
