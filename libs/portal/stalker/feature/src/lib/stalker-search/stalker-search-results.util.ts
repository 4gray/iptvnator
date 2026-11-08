import {
    type StalkerVodSource,
    stalkerWithheldRowKey,
} from '@iptvnator/portal/stalker/data-access';

/** Portals can shift items between pages mid-append — drop duplicate ids. */
export function dedupeSearchResults(
    items: StalkerVodSource[]
): StalkerVodSource[] {
    const seenIds = new Set<string>();
    return items.filter((item) => {
        const id =
            item.id === undefined || item.id === null ? null : String(item.id);
        if (id === null) {
            return true;
        }
        if (seenIds.has(id)) {
            return false;
        }
        seenIds.add(id);
        return true;
    });
}

/**
 * Records the rows of `rawItems` the parental lock withheld (those missing
 * from `keptItems`) into `seenWithheldIds` and returns how many of them were
 * not seen before.
 */
export function recordNewWithheldRows(
    rawItems: StalkerVodSource[],
    keptItems: StalkerVodSource[],
    seenWithheldIds: Set<string>
): number {
    let newWithheldCount = 0;
    if (keptItems.length < rawItems.length) {
        const kept = new Set(keptItems);
        for (const item of rawItems) {
            const id = stalkerWithheldRowKey(item);
            if (!kept.has(item) && !seenWithheldIds.has(id)) {
                seenWithheldIds.add(id);
                newWithheldCount += 1;
            }
        }
    }
    return newWithheldCount;
}
