/**
 * The PWA Xtream user-data maps in USER_DATA_STORAGE, each a JSON object
 * keyed by playlist id. Shared with the playlist backup, which reads and
 * writes them directly.
 */
export const XTREAM_USER_DATA_KEYS = {
    favorites: 'xtream-favorites',
    recentItems: 'xtream-recent-items',
    collectionItems: 'xtream-collection-items',
    playbackPositions: 'xtream-playback-positions',
} as const;

/** Internal metadata is outside playlist arrays and never appears in backup manifests. */
export const XTREAM_RESTORE_RECEIPTS = '__iptvnator_xtream_restore_receipts__';

/** Preserve atomic restore receipts when normalizers project only playlist lists. */
export function writeXtreamUserDataMap(
    storage: Pick<Storage, 'getItem' | 'setItem'>,
    key: string,
    map: Record<string, unknown>
): void {
    let receipts: unknown;
    const raw = storage.getItem(key);
    try {
        receipts = raw ? JSON.parse(raw)?.[XTREAM_RESTORE_RECEIPTS] : undefined;
    } catch {
        /* Damaged legacy data has no usable receipt. */
    }
    storage.setItem(
        key,
        JSON.stringify({
            ...map,
            ...(receipts &&
            typeof receipts === 'object' &&
            !Array.isArray(receipts)
                ? { [XTREAM_RESTORE_RECEIPTS]: receipts }
                : {}),
        })
    );
}
