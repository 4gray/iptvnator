import { XTREAM_CONTENT_TYPES } from '@iptvnator/shared/interfaces';
import type { DatabaseService, XCategoryFromDb } from '@iptvnator/services';
import type {
    XtreamContentType,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';

// Local dynamic-import target: keep restoration-only work off the startup path.
export { XtreamDeferredCatalogRestoreService } from '@iptvnator/services/xtream-catalog-restore';

export async function restoreCategoryVisibility(
    db: Pick<DatabaseService, 'updateCategoryVisibility'>,
    playlistId: string,
    categoriesByType: XCategoryFromDb[][],
    available: readonly XtreamContentType[],
    hiddenCategories: XtreamPendingRestoreState['hiddenCategories']
): Promise<void> {
    for (const categories of categoriesByType) {
        if (
            categories.length === 0 ||
            !available.some(
                (type) =>
                    type ===
                    (categories[0].type === 'movies'
                        ? 'movie'
                        : categories[0].type)
            )
        ) {
            continue;
        }

        const reset = await db.updateCategoryVisibility(
            categories.map((category) => category.id),
            false
        );
        if (!reset) {
            throw new Error(
                `Resetting category visibility for "${playlistId}" failed.`
            );
        }

        const hiddenCategoryIds = categories
            .filter((category) =>
                hiddenCategories.some(
                    (hiddenCategory) =>
                        hiddenCategory.categoryType === category.type &&
                        hiddenCategory.xtreamId === category.xtream_id
                )
            )
            .map((category) => category.id);
        if (
            hiddenCategoryIds.length > 0 &&
            !(await db.updateCategoryVisibility(hiddenCategoryIds, true))
        ) {
            throw new Error(
                `Restoring category visibility for "${playlistId}" failed.`
            );
        }
    }
}

export async function resolveAvailableCatalogs(
    db: Pick<DatabaseService, 'hasXtreamContent' | 'getXtreamImportStatus'>,
    playlistId: string,
    enabled: readonly XtreamContentType[]
): Promise<XtreamContentType[]> {
    return (
        await Promise.all(
            XTREAM_CONTENT_TYPES.map(async (type) =>
                enabled.includes(type) ||
                ((await db.hasXtreamContent(playlistId, type)) &&
                    (await db.getXtreamImportStatus(playlistId, type)) ===
                        'completed')
                    ? type
                    : null
            )
        )
    ).filter((type): type is XtreamContentType => type !== null);
}
