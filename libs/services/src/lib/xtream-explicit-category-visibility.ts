import {
    parseXtreamCategoryVisibility,
    xtreamCategoryVisibilityKey,
} from '@iptvnator/shared/interfaces';
import type { DatabaseService } from './database-electron.service';
import type { DeferredCatalogSnapshot } from './xtream-deferred-catalog-restore.service';
import type { XtreamBackupHiddenCategory } from '@iptvnator/shared/interfaces';

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
