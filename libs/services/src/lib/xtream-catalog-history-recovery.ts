import {
    parseXtreamHistoryRecovery,
    xtreamHistoryRecoveryKey,
    type XtreamBackupRecentlyViewedItem,
    type XtreamBackupHiddenCategory,
    XTREAM_CONTENT_TYPES,
    type XtreamPendingRestoreState,
    type XtreamContentType,
} from '@iptvnator/shared/interfaces';
import type { DatabaseService } from './database-electron.service';
import type { PlaybackPositionService } from './playback-position.service';

export async function readCatalogHistoryRecovery(
    db: Pick<DatabaseService, 'readAppState'>,
    playlistId: string
) {
    const row = await db.readAppState(xtreamHistoryRecoveryKey(playlistId));
    if (!row) throw new Error('Could not read catalog history recovery.');
    return row.value ? parseXtreamHistoryRecovery(row.value) : null;
}

/** The worker merges live history inside the registration transaction. */
export async function beginCatalogHistoryRecovery(
    db: Pick<DatabaseService, 'setAppState'>,
    playlistId: string,
    contentTypes: readonly XtreamContentType[],
    recentlyViewed: XtreamBackupRecentlyViewedItem[]
): Promise<void> {
    if (
        !(await db.setAppState(
            xtreamHistoryRecoveryKey(playlistId),
            JSON.stringify({
                version: 1,
                contentTypes,
                recentlyViewed,
            })
        ))
    )
        throw new Error('Could not retain catalog history recovery.');
}

export async function clearCatalogHistoryRecovery(
    db: Pick<DatabaseService, 'setAppState'>,
    playlistId: string
): Promise<void> {
    if (!(await db.setAppState(xtreamHistoryRecoveryKey(playlistId), '')))
        throw new Error('Could not finish catalog history recovery.');
}

export async function exportCatalogRecoveryState(
    db: Pick<
        DatabaseService,
        'readAppState' | 'getRecentItemsOrThrow' | 'getAllXtreamCategories'
    >,
    positions: Pick<PlaybackPositionService, 'getAllPlaybackPositionsOrThrow'>,
    playlistId: string,
    hiddenFallback: XtreamBackupHiddenCategory[] = [],
    snapshot?: XtreamPendingRestoreState['catalogSnapshot']
) {
    const [journal, categories] = await Promise.all([
        readCatalogHistoryRecovery(db, playlistId),
        Promise.all(
            XTREAM_CONTENT_TYPES.map(async (type) => {
                const categoryType: XtreamBackupHiddenCategory['categoryType'] =
                    type === 'movie' ? 'movies' : type;
                return (
                    await db.getAllXtreamCategories(playlistId, categoryType)
                ).map(
                    (
                        row
                    ): XtreamBackupHiddenCategory & { hidden: boolean } => ({
                        categoryType,
                        xtreamId: row.xtream_id,
                        hidden: row.hidden,
                    })
                );
            })
        ),
    ]);
    const currentCategories = ([] as (typeof categories)[number]).concat(
        ...categories
    );
    const currentIds = new Set(
        currentCategories.map((row) => `${row.categoryType}:${row.xtreamId}`)
    );
    const recentlyViewed =
        journal?.recentlyViewed ??
        (await db.getRecentItemsOrThrow(playlistId)).map((row) => ({
            contentType: row.type as XtreamContentType,
            xtreamId: row.xtream_id,
            viewedAt: row.viewed_at ?? new Date().toISOString(),
        }));
    return {
        recentlyViewed,
        historyRecovery: {
            ...(journal ?? { contentTypes: [] }),
            currentCategories,
            snapshot,
        },
        hiddenCategories: [
            ...hiddenFallback.filter(
                (row) => !currentIds.has(`${row.categoryType}:${row.xtreamId}`)
            ),
            ...currentCategories
                .filter((row) => row.hidden)
                .map(({ categoryType, xtreamId }) => ({
                    categoryType,
                    xtreamId,
                })),
        ],
        playbackPositions:
            await positions.getAllPlaybackPositionsOrThrow(playlistId),
    };
}
