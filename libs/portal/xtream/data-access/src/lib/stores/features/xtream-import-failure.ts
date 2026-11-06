import type { DatabaseService, XtreamImportStatus } from '@iptvnator/services';

type ContentType = 'live' | 'vod' | 'series';

/** Only remote work can leave partial rows; healthy warm caches stay intact. */
export async function finalizePendingImportTypes(
    db: Pick<
        DatabaseService,
        'setXtreamImportStatus' | 'clearXtreamImportCache'
    >,
    playlistId: string,
    types: readonly ContentType[],
    completed: ReadonlySet<ContentType>,
    remoteWork: ReadonlySet<ContentType>,
    status: XtreamImportStatus
): Promise<void> {
    for (const type of types) {
        if (completed.has(type) || !remoteWork.has(type)) continue;
        const nativeType = type === 'vod' ? 'movie' : type;
        await db.setXtreamImportStatus(playlistId, nativeType, status);
        await db.clearXtreamImportCache(playlistId, nativeType);
    }
}
