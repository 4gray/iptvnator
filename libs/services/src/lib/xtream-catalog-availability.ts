import {
    XTREAM_CONTENT_TYPES,
    type XtreamContentType,
} from '@iptvnator/shared/interfaces';
import type { DatabaseService } from './database-electron.service';

/** Selected types load now; completed retained caches can accept dormant state too. */
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
