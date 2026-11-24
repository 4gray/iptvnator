import {
    parseXtreamCategoryVisibility,
    xtreamCategoryVisibilityKey,
    type XtreamCategoryVisibility,
} from '@iptvnator/shared/interfaces/xtream-category-visibility';
import type { XtreamBackupHiddenCategory } from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from './user-data-storage';

type CategoryType = XtreamBackupHiddenCategory['categoryType'];

export function readPwaXtreamVisibility(
    storage: UserDataStorage,
    playlistId: string
): XtreamBackupHiddenCategory[] | undefined {
    const raw = storage.getItem(xtreamCategoryVisibilityKey(playlistId));
    if (raw === null) return undefined;
    return parseXtreamCategoryVisibility(raw)
        .categories.filter((row) => row.hidden)
        .map(({ categoryType, xtreamId }) => ({ categoryType, xtreamId }));
}

export function writePwaXtreamVisibility(
    storage: UserDataStorage,
    playlistId: string,
    hidden: XtreamBackupHiddenCategory[]
): void {
    const key = xtreamCategoryVisibilityKey(playlistId);
    if (!hidden.length) {
        storage.removeItem(key);
        return;
    }
    const value: XtreamCategoryVisibility = {
        version: 1,
        categories: hidden.map((row) => ({ ...row, hidden: true })),
    };
    storage.setItem(key, JSON.stringify(value));
}

export function editPwaXtreamVisibility(
    storage: UserDataStorage,
    playlistId: string,
    categoryType: CategoryType,
    changes: ReadonlyMap<number, boolean>
): void {
    if (!changes.size) return;
    const hidden = (readPwaXtreamVisibility(storage, playlistId) ?? []).filter(
        (row) => row.categoryType !== categoryType || !changes.has(row.xtreamId)
    );
    for (const [xtreamId, selected] of changes) {
        if (!selected) hidden.push({ categoryType, xtreamId });
    }
    writePwaXtreamVisibility(storage, playlistId, hidden);
}
