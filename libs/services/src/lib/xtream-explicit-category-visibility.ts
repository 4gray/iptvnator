import {
    parseXtreamCategoryVisibility,
    xtreamCategoryVisibilityKey,
} from '@iptvnator/shared/interfaces/xtream-category-visibility';
import type { DatabaseService } from './database-electron.service';
import type { DeferredCatalogSnapshot } from './xtream-deferred-catalog-restore.service';
import type {
    XtreamBackupHiddenCategory,
    XtreamCategoryVisibility,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';

/** Apply native choices after dormant/current export data has been combined. */
export function reconcileExplicitCatalogVisibilityForExport(
    state: Pick<
        XtreamPendingRestoreState,
        'hiddenCategories' | 'recentlyViewed'
    >,
    choices: XtreamCategoryVisibility['categories']
) {
    const flags = new Map(
        [
            ...state.hiddenCategories.map((row) => ({ ...row, hidden: true })),
            ...choices,
        ].map((row) => [`${row.categoryType}:${row.xtreamId}`, row])
    );
    return {
        ...state,
        hiddenCategories: Array.from(flags.values())
            .filter((row) => row.hidden)
            .map(({ categoryType, xtreamId }) => ({ categoryType, xtreamId })),
    };
}

export function explicitCategoryVisibilityForReplay(
    snapshot: DeferredCatalogSnapshot,
    incoming: XtreamBackupHiddenCategory[]
): XtreamBackupHiddenCategory[] {
    return Array.from(
        new Map(
            [...snapshot.state.hiddenCategories, ...incoming].map((row) => [
                `${row.categoryType}:${row.xtreamId}`,
                row,
            ])
        ).values()
    );
}

export async function readExplicitCatalogVisibility(
    db: Pick<DatabaseService, 'readAppState'>,
    playlistId: string
) {
    const row = await db.readAppState(xtreamCategoryVisibilityKey(playlistId));
    if (!row) throw new Error('Could not read explicit category visibility.');
    return row.value ? parseXtreamCategoryVisibility(row.value).categories : [];
}

/** A new explicit archive owns its choices; older local overrides cannot replace them. */
export async function clearExplicitCatalogVisibility(
    db: Pick<DatabaseService, 'setAppState'>,
    playlistId: string
): Promise<void> {
    if (!(await db.setAppState(xtreamCategoryVisibilityKey(playlistId), '')))
        throw new Error('Could not reset explicit category visibility.');
}
