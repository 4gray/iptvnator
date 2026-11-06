import {
    applyExplicitRestoreListEdits,
    fillRestoreHistoryMetadata,
} from './pwa-xtream-restore-edits';

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
    map: Record<string, unknown>,
    options?: { userEdit?: boolean }
): void {
    const raw = storage.getItem(key);
    let previous: unknown;
    try {
        previous = raw ? JSON.parse(raw) : {};
    } catch {
        /* Damaged legacy data has no usable receipt. */
    }
    const stored = isRecord(previous) ? previous : {};
    const receipts = stored[XTREAM_RESTORE_RECEIPTS];
    const retained = isRecord(receipts) ? { ...receipts } : undefined;
    if (
        options?.userEdit !== false &&
        retained &&
        key === XTREAM_USER_DATA_KEYS.favorites
    ) {
        for (const [playlistId, value] of Object.entries(retained)) {
            if (!isRecord(value) || !Array.isArray(value['keys'])) continue;
            const before = new Set(
                Array.isArray(stored[playlistId])
                    ? (stored[playlistId] as unknown[])
                    : []
            );
            const after = new Set(
                Array.isArray(map[playlistId])
                    ? (map[playlistId] as unknown[])
                    : []
            );
            // Shrink the archive-owned set on removal. Re-adding never restores archive ownership.
            // This is atomic with the list and needs no extra quota space for a tombstone.
            retained[playlistId] = {
                ...value,
                keys: value['keys'].filter(
                    (id) => !before.has(id) || after.has(id)
                ),
            };
        }
    }
    if (retained) {
        for (const [playlistId, receipt] of Object.entries(retained)) {
            if (!isRecord(receipt) || !Array.isArray(receipt['serverList']))
                continue;
            retained[playlistId] = {
                ...receipt,
                serverList:
                    options?.userEdit === false
                        ? key === XTREAM_USER_DATA_KEYS.recentItems
                            ? fillRestoreHistoryMetadata(
                                  receipt['serverList'],
                                  Array.isArray(map[playlistId])
                                      ? (map[playlistId] as unknown[])
                                      : []
                              )
                            : receipt['serverList']
                        : applyExplicitRestoreListEdits(
                              receipt['serverList'],
                              Array.isArray(stored[playlistId])
                                  ? (stored[playlistId] as unknown[])
                                  : [],
                              Array.isArray(map[playlistId])
                                  ? (map[playlistId] as unknown[])
                                  : [],
                              key === XTREAM_USER_DATA_KEYS.favorites
                                  ? 'value'
                                  : key === XTREAM_USER_DATA_KEYS.recentItems
                                    ? 'id'
                                    : 'position'
                          ),
            };
        }
    }
    storage.setItem(
        key,
        JSON.stringify({
            ...map,
            ...(retained ? { [XTREAM_RESTORE_RECEIPTS]: retained } : {}),
        })
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
