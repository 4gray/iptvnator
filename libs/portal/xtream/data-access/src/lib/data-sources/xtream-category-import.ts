import type {
    DatabaseService,
    ParentalLockService,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import type { XtreamContentType } from '@iptvnator/shared/interfaces';
import type {
    CategoryType,
    XtreamApiService,
    XtreamCredentials,
} from '../services/xtream-api.service';
import type {
    DbCategoryType,
    XtreamCategoryFromDb,
    XtreamOperationOptions,
} from './xtream-data-source.interface';

/** Failed imports may retain committed chunks when their first cleanup fails. */
export async function clearIncompleteCatalog(
    db: Pick<DatabaseService, 'clearXtreamImportCache'>,
    playlistId: string,
    type: XtreamContentType
): Promise<void> {
    if (!(await db.clearXtreamImportCache(playlistId, type)))
        throw new Error('Could not clear incomplete catalog cache.');
}

/** Cold category import stays outside the warm-cache/startup dependency path. */
export async function loadRemoteCategories(
    services: {
        db: DatabaseService;
        api: XtreamApiService;
        pending: XtreamPendingRestoreService;
        locks: ParentalLockService;
    },
    playlistId: string,
    credentials: XtreamCredentials,
    type: CategoryType,
    dbType: DbCategoryType,
    options?: XtreamOperationOptions
): Promise<XtreamCategoryFromDb[]> {
    options?.onPhaseChange?.('loading-categories');
    const remoteData = await services.api.getCategories(credentials, type, {
        sessionId: options?.sessionId,
    });
    if (remoteData && Array.isArray(remoteData) && remoteData.length > 0) {
        const hidden = services.pending.get(playlistId)?.hiddenCategories;
        const hiddenIds = hidden?.length
            ? hidden
                  .filter((category) => category.categoryType === dbType)
                  .map((category) => category.xtreamId)
            : undefined;
        options?.onPhaseChange?.('saving-categories');
        await services.db.saveXtreamCategories(
            playlistId,
            remoteData,
            dbType,
            hiddenIds,
            services.locks.lockedXtreamIds(playlistId, dbType)
        );
    }
    return services.db.getXtreamCategories(playlistId, dbType);
}
