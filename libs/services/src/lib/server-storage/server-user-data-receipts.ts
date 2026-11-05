import {
    XTREAM_RESTORE_RECEIPTS,
    XTREAM_USER_DATA_KEYS,
} from '../xtream-user-data-keys';

const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/** Client receipts share the cache blob with lists, but are never server playlist entries. */
export function retainServerRestoreReceipts(
    map: Record<string, unknown>,
    namespace: string
): boolean {
    const receipts = map[XTREAM_RESTORE_RECEIPTS];
    if (!record(receipts) || namespace !== XTREAM_USER_DATA_KEYS.favorites)
        return false;
    const next = { ...receipts };
    for (const [id, receipt] of Object.entries(receipts)) {
        if (
            !record(receipt) ||
            !Array.isArray(receipt['keys']) ||
            receipt['serverList'] !== undefined
        )
            continue;
        const list = map[id];
        next[id] = {
            ...receipt,
            keys: receipt['keys'].filter(
                (key) => Array.isArray(list) && list.includes(key)
            ),
        };
    }
    map[XTREAM_RESTORE_RECEIPTS] = next;
    return true;
}

export function forgetServerRestoreReceipts(
    map: Record<string, unknown>,
    playlistId: string
): void {
    const receipts = map[XTREAM_RESTORE_RECEIPTS];
    if (record(receipts)) {
        const next = { ...receipts };
        delete next[playlistId];
        map[XTREAM_RESTORE_RECEIPTS] = next;
    }
}
