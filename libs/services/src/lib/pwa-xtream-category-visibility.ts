import {
    parseXtreamCategoryVisibility,
    xtreamCategoryVisibilityKey,
    type XtreamCategoryVisibility,
} from '@iptvnator/shared/interfaces/xtream-category-visibility';
import type { XtreamBackupHiddenCategory } from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from './user-data-storage';

type CategoryType = XtreamBackupHiddenCategory['categoryType'];

interface VisibilityRecord extends XtreamCategoryVisibility {
    restoreId?: string;
}

function readRecord(
    storage: UserDataStorage,
    playlistId: string
): VisibilityRecord | undefined {
    const raw = storage.getItem(xtreamCategoryVisibilityKey(playlistId));
    return raw === null ? undefined : parseXtreamCategoryVisibility(raw);
}

export function readPwaXtreamVisibility(
    storage: UserDataStorage,
    playlistId: string,
    pending?: { id: string; hiddenCategories: XtreamBackupHiddenCategory[] }
): XtreamBackupHiddenCategory[] | undefined {
    const saved = readRecord(storage, playlistId);
    if (pending && saved?.restoreId !== pending.id)
        return pending.hiddenCategories;
    return saved?.categories
        .filter((row) => row.hidden)
        .map(({ categoryType, xtreamId }) => ({ categoryType, xtreamId }));
}

function writeRecord(
    storage: UserDataStorage,
    playlistId: string,
    hidden: XtreamBackupHiddenCategory[],
    restoreId?: string
): void {
    const key = xtreamCategoryVisibilityKey(playlistId);
    if (!hidden.length && !restoreId) {
        storage.removeItem(key);
        return;
    }
    const value: VisibilityRecord = {
        version: 1,
        categories: hidden.map((row) => ({ ...row, hidden: true })),
        restoreId,
    };
    storage.setItem(key, JSON.stringify(value));
}

export function restorePwaXtreamVisibility(
    storage: UserDataStorage,
    playlistId: string,
    hidden: XtreamBackupHiddenCategory[],
    restoreId: string
): void {
    if (readRecord(storage, playlistId)?.restoreId === restoreId) return;
    // Commit the preference and the replay receipt together, even for an empty archive.
    writeRecord(storage, playlistId, hidden, restoreId);
}

export function editPwaXtreamVisibility(
    storage: UserDataStorage,
    playlistId: string,
    categoryType: CategoryType,
    changes: ReadonlyMap<number, boolean>
): void {
    if (!changes.size) return;
    const saved = readRecord(storage, playlistId);
    const hidden = (saved?.categories ?? [])
        .filter(
            (row) =>
                row.hidden &&
                (row.categoryType !== categoryType ||
                    !changes.has(row.xtreamId))
        )
        .map(({ categoryType, xtreamId }) => ({ categoryType, xtreamId }));
    for (const [xtreamId, selected] of changes) {
        if (!selected) hidden.push({ categoryType, xtreamId });
    }
    writeRecord(storage, playlistId, hidden, saved?.restoreId);
}
