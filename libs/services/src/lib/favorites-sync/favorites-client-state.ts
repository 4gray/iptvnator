import type { FavoriteLocalRecord } from '@iptvnator/shared/interfaces/favorites-sync';

/** Resolve against the newest known server copy, including retained conflicts. */
export function latestFavoriteBase(
    record: Pick<FavoriteLocalRecord, 'base' | 'conflict'>
) {
    return record.conflict && record.conflict.revision > record.base.revision
        ? record.conflict
        : record.base;
}
